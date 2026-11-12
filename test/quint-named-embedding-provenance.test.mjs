import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {sql} from 'drizzle-orm';
import {coreStateBuildPlugin, NAMED_EMBEDDING_TARGETS} from '../scripts/core-state-patch.ts';
import {loadEmbeddingStoreDatabase} from '../specs/quint/refinement/services/embedding-store-pglite.mjs';
import {runNamedEmbeddingProvenanceRefinement} from '../specs/quint/refinement/services/named-embedding-provenance.mjs';
import {captureInputs} from '../specs/quint/refinement/check-traces.mjs';
import {deferred} from '../specs/quint/refinement/services/support.mjs';

test('named embedding admission preserves SQL provenance and rolls back rejected mutations', {timeout: scaledTimeout(120000)}, async () => {
  const {receipts, obligations} = await runNamedEmbeddingProvenanceRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].model, 'NamedEmbeddingProvenance');
  assert.equal(receipts[0].passed, true);
  assert.equal(receipts[0].traces, 8);
  assert.equal(obligations.length, 2);
});

// A current-source scheduling probe, separate from both the eight Named model
// traces and the immutable historical CoreEmbeddingDimension counterexample.
test('current SQL refuses a delayed unmarked insert before the runtime publishes its named pin', {timeout: scaledTimeout(120000)}, async () => {
  const loaded = await loadEmbeddingStoreDatabase([fileURLToPath(import.meta.url)]);
  const setup = await loaded.createIsolatedTestDatabase('current-embedding-publication-'+randomUUID(), [], {postgresUrl: null});
  const {runtime, adapter} = setup;
  const embeddings = runtime.embeddings;
  const provider = 'quint-activation-window';
  const space = 'BAAI/bge-small-en-v1.5:cls:l2:384:hf-bert-v1:tail-v1';
  const owner = {agentId: runtime.agentId, entityId: runtime.agentId, roomId: runtime.agentId};
  const id = randomUUID(), activated = deferred(), publish = deferred();
  const ensureSpace = adapter.ensureEmbeddingSpace.bind(adapter);
  runtime.character.settings = {...runtime.character.settings,
    ELIZA_EMBEDDING_PROVIDER: provider, EMBEDDING_PROVIDER: 'test'};
  runtime.registerModel('TEXT_EMBEDDING', async () => {
    const vector = Array(384).fill(0.125);
    Object.defineProperty(vector, Symbol.for('@elizaos/core/embedding-vector-space'), {value: space});
    return vector;
  }, provider, 10);
  adapter.ensureEmbeddingSpace = async value => {
    const result = await ensureSpace(value);
    activated.resolve();
    await publish.promise;
    return result;
  };
  let initialization;
  try {
    await runtime.ensureConnection({...owner, worldId: runtime.agentId, source: 'current-embedding-publication'});
    assert.equal(embeddings.getPinnedProvider(), undefined);
    initialization = embeddings.ensureEmbeddingDimension();
    await Promise.race([activated.promise, initialization.then(() => {
      assert.fail('Runtime initialization must remain held after SQL activation');
    })]);
    assert.equal(adapter.embeddingSpace, space);
    assert.equal(embeddings.getPinnedProvider(), undefined, 'SQL is active before the runtime publishes its provider');
    assert.equal(embeddings.pinnedEmbeddingSpace, undefined);
    const unmarked = Array(384).fill(0.25);
    await embeddings.validateProviderOutput('TEXT_EMBEDDING', {text: 'Synthetic delayed vector'}, unmarked, unmarked, 'legacy');
    const connection = await adapter.getConnection();
    const rows = async () => (await connection.execute(sql`
      SELECT (SELECT count(*)::int FROM memories WHERE id = ${id}) AS memories,
        (SELECT count(*)::int FROM embeddings WHERE memory_id = ${id}) AS embeddings
    `)).rows;
    assert.deepEqual(await rows(), [{memories: 0, embeddings: 0}]);
    await assert.rejects(adapter.createMemory({id, ...owner,
      content: {text: 'Synthetic delayed vector'}, embedding: unmarked}, 'messages'),
    {code: 'EMBEDDING_SPACE_MISMATCH'});
    assert.deepEqual(await rows(), [{memories: 0, embeddings: 0}], 'Refusal writes neither memory nor vector');
    assert.equal(embeddings.getPinnedProvider(), undefined, 'The refusal occurs inside the held publication window');
    publish.resolve();
    await initialization;
    assert.equal(embeddings.getPinnedProvider(), provider);
    assert.equal(embeddings.pinnedEmbeddingSpace, space);
  } finally {
    publish.resolve();
    await initialization?.catch(() => {});
    adapter.ensureEmbeddingSpace = ensureSpace;
    await runtime.stop();
    await setup.cleanup();
    assert.deepEqual(captureInputs(loaded.sources), loaded.driverHashes, 'Current probe source bytes remain unchanged');
  }
});

test('experience reload and metadata flush retain the stored vector without restamping it', {timeout: scaledTimeout(120000)}, async () => {
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
