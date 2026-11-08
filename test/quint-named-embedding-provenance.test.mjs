import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {sql} from 'drizzle-orm';
import {coreStateBuildPlugin, NAMED_EMBEDDING_TARGETS} from '../scripts/core-state-patch.mjs';
import {loadEmbeddingStoreDatabase} from '../specs/quint/refinement/services/embedding-store-pglite.mjs';
import {runNamedEmbeddingProvenanceRefinement} from '../specs/quint/refinement/services/named-embedding-provenance.mjs';

test('named embedding admission preserves SQL provenance and rolls back rejected mutations', {timeout: 120000}, async () => {
  const {receipts, obligations} = await runNamedEmbeddingProvenanceRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].model, 'NamedEmbeddingProvenance');
  assert.equal(receipts[0].passed, true);
  assert.equal(receipts[0].traces, 8);
  assert.equal(obligations.length, 2);
});

test('experience reload and metadata flush retain the stored vector without restamping it', {timeout: 120000}, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(root, 'vendor/eliza');
  const target = NAMED_EMBEDDING_TARGETS.find(name => name.endsWith('/experience/service.ts'));
  const core = coreStateBuildPlugin(root, source);
  const bundled = await build({
    stdin: {contents: `export {ExperienceService} from './vendor/eliza/${target}';`, resolveDir: root},
    bundle: true, write: false, format: 'esm', platform: 'node', external: ['file-type'],
    banner: {js: `import {createRequire as createBoundRequire} from 'node:module'; const require=createBoundRequire(${JSON.stringify(path.join(root, 'package.json'))});`},
    plugins: [core.plugin, {name: 'source-core', setup(builder) {
      builder.onResolve({filter: /^@elizaos\/core$/}, () => ({path: path.join(source, 'packages/core/src/index.ts')}));
    }}],
  });
  assert.doesNotMatch(bundled.outputFiles[0].text, /['"]file-type['"]/);
  assert.ok(core.transforms.some(transform => transform.path === target));
  const {ExperienceService} = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const loaded = await loadEmbeddingStoreDatabase([fileURLToPath(import.meta.url)]);
  const setup = await loaded.createIsolatedTestDatabase('quint-experience-vector-'+randomUUID(), [], {postgresUrl: null});
  const {runtime, adapter} = setup;
  const agentId = runtime.agentId;
  const space = 'BAAI/bge-small-en-v1.5:cls:l2:384:hf-bert-v1:tail-v1';
  let service, providerCalls = 0;
  runtime.registerModel('TEXT_EMBEDDING', async () => {
    const vector = Array(384).fill(++providerCalls / 100);
    Object.defineProperty(vector, Symbol.for('@elizaos/core/embedding-vector-space'), {value: space});
    return vector;
  }, 'quint-experience-bge', 10);
  try {
    await runtime.ensureConnection({agentId, entityId: agentId, roomId: agentId, worldId: agentId, source: 'quint-experience'});
    service = await ExperienceService.start(runtime);
    const {id} = await service.recordExperience({learning: 'Synthetic initial learning'});
    const connection = await adapter.getConnection();
    async function row() {
      const result = await connection.execute(sql`
        SELECT e.space_id, e.write_nonce, e.dim_384::text AS vector,
          m.content->'data'->>'confidence' AS confidence, m.content->>'text' AS text
        FROM memories m JOIN embeddings e ON e.memory_id = m.id
        WHERE m.id = ${id}
      `);
      assert.equal(result.rows.length, 1);
      return result.rows[0];
    }
    const initial = await row();
    assert.equal(initial.space_id, space);
    assert.ok(initial.write_nonce);
    await service.stop();
    service = await ExperienceService.start(runtime);
    const callsBeforeMetadata = providerCalls;
    assert.equal((await service.updateExperience(id, {confidence: 0.8})).confidence, 0.8);
    const updated = await row();
    assert.deepEqual(updated, {...initial, confidence: '0.8'});
    assert.equal(providerCalls, callsBeforeMetadata);
    await service.updateExperience(id, {learning: 'Synthetic replacement learning'});
    const replaced = await row();
    assert.notEqual(replaced.write_nonce, initial.write_nonce);
    assert.notEqual(replaced.vector, initial.vector);
    assert.equal(replaced.space_id, space);
    assert.equal(replaced.text, 'Experience: Synthetic replacement learning');
    await service.stop();
    service = undefined;
    assert.deepEqual(await row(), replaced);
  } finally {
    if (service) await service.stop();
    await runtime.stop();
    await setup.cleanup();
  }
});
