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
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {deferred} from '../specs/quint/refinement/services/support.mjs';

const model = 'NamedEmbeddingProvenance';
const driver = fileURLToPath(import.meta.url);
const space = 'BAAI/bge-small-en-v1.5:cls:l2:384:hf-bert-v1:tail-v1';
const representation = Symbol.for('@elizaos/core/embedding-vector-space');
const noPending = {kind: 'none', vector: 'absent', text: 'missing', current: false, width: 0};
const outcomes = new Map([
  ['EMBEDDING_SPACE_NOT_INITIALIZED', 'uninitialized'],
  ['EMBEDDING_SPACE_MISMATCH', 'space'],
  ['EMBEDDING_SPACE_CHANGED', 'resize-refused'],
  ['EMBEDDING_DIMENSION_MISMATCH', 'dimension'],
  ['EMBEDDING_VECTOR_INVALID', 'vector'],
]);

function input(kind, width) {
  if (kind === 'absent') return undefined;
  const vector = Array(kind === 'bad-width' ? 384 + width : width).fill(0.125);
  if (kind === 'bad-value') vector[0] = NaN;
  if (kind !== 'unmarked') {
    Object.defineProperty(vector, representation, {
      value: kind === 'other' ? 'fixture:other-representation' : space,
    });
  }
  return vector;
}

function classify(vector, width) {
  if (vector === undefined) return 'absent';
  if (vector[representation] === undefined) return 'unmarked';
  if (vector[representation] !== space) return 'other';
  if (vector.length !== width) return 'bad-width';
  return vector.every(Number.isFinite) ? 'marked' : 'bad-value';
}

/** Delay one real PGlite admission at its manager-initialization await. */
function holdManager(adapter) {
  const manager = adapter.manager;
  const initialize = manager.initialize.bind(manager);
  const entered = deferred(), resume = deferred();
  manager.initialize = async (...args) => {
    manager.initialize = initialize;
    entered.resolve();
    await resume.promise;
    return initialize(...args);
  };
  return {entered, resume};
}

function refusal(error) {
  for (let cause = error; cause; cause = cause.cause) {
    if (outcomes.has(cause.code)) return outcomes.get(cause.code);
  }
  throw error;
}

async function scenario(loaded, name, drive, documents = false) {
  const setup = await loaded.createIsolatedTestDatabase('quint-named-embedding-'+randomUUID(), [], {postgresUrl: null});
  const {runtime, adapter} = setup;
  const agentId = runtime.agentId;
  const owner = {agentId, roomId: agentId, entityId: agentId};
  const id = randomUUID(), documentId = randomUUID();
  const tableName = documents ? 'document_fragments' : 'messages';
  const db = await adapter.getConnection();
  let rowInput = 'absent', pending = noPending, result = 'none', activation, held;

  const width = () => Number(adapter.embeddingDimension.slice(3));
  const memory = (text, embedding, unique = true) => ({
    id, ...owner, ...(unique === null ? {} : {unique}), content: {text}, embedding,
    ...(documents && {metadata: {type: 'fragment', documentId, position: 0, documentRevision: 0}}),
  });
  async function row() {
    const query = await db.execute(sql`
      SELECT m.content->>'text' AS text, e.space_id AS space,
        CASE WHEN e.dim_384 IS NOT NULL THEN 384 WHEN e.dim_768 IS NOT NULL THEN 768 ELSE 0 END AS width,
        e.write_nonce AS nonce
      FROM memories m LEFT JOIN embeddings e ON e.memory_id = m.id
      WHERE m.id = ${id}
    `);
    assert.ok(query.rows.length <= 1);
    return query.rows[0] ?? {text: 'missing', space: null, width: 0, nonce: null};
  }
  async function observe() {
    const stored = await row();
    const named = adapter.embeddingSpace === space;
    assert.ok(named || adapter.embeddingSpace === null);
    assert.ok(stored.space === null || stored.space === space);
    assert.equal(Boolean(stored.nonce), stored.space !== null);
    return {
      's.space': named ? 'named' : adapter.requestedEmbeddingSpace ? 'activating' : 'legacy',
      's.width': width(), 's.text': stored.text,
      's.rowSpace': stored.width === 0 ? 'none' : stored.space === space ? 'named' : 'legacy',
      's.rowWidth': stored.width, 's.rowInput': rowInput,
      's.pending': pending, 's.result': result,
    };
  }

  try {
    await runtime.ensureConnection({...owner, worldId: agentId, source: 'quint-embedding'});
    if (documents) {
      await runtime.createMemory({...owner, id: documentId, unique: true, content: {text: 'source'},
        metadata: {type: 'document', documentId, scope: 'global', title: 'Synthetic source', timestamp: 1}}, 'documents');
    }
    const trace = {name, init: {name: 'init'}, expect: await observe(), steps: []};
    async function checkpoint(label, action, ...args) {
      trace.steps.push({label, action: action ? {name: action, args} : null, expect: await observe()});
    }

    async function operate(kind, vector, text, current, unique = true) {
      try {
        if (kind === 'insert') await adapter.createMemory(memory(text, vector, unique), tableName);
        else if (kind === 'batch') await runtime.createMemory(memory(text, vector, unique), tableName, unique ?? undefined);
        else if (kind === 'update') {
          assert.equal(await runtime.updateMemory({id, content: {text}, embedding: vector}), true);
        } else if (kind === 'cas') {
          const written = await runtime.updateMemoryEmbedding({
            id, embedding: vector, expected: {...owner, text: current ? text : 'stale source'},
          });
          if (!written) return 'stale';
        } else {
          const found = kind === 'search'
            ? await runtime.searchMemories({tableName, roomId: owner.roomId, embedding: vector})
            : await adapter.queryDocumentFragments({
              agentId, requesterEntityId: agentId, requesterRoomIds: [agentId],
              requesterRole: 'OWNER', documentId, limit: 5, ...(vector && {embedding: vector}),
            });
          assert.deepEqual(found.map(memory => memory.id), found.length ? [id] : []);
          return found.length ? 'hit' : 'miss';
        }
        return 'written';
      } catch (error) {
        return refusal(error);
      }
    }

    async function startActivation(fail = false) {
      const gate = holdManager(adapter);
      // A rejected initialization leaves the SQL table and active label intact.
      const completion = adapter.ensureEmbeddingSpace(space).then(
        () => true,
        error => {
          assert.equal(error.code, 'EMBEDDING_SPACE_ACTIVATION_FAILED');
          return false;
        },
      );
      activation = {gate, completion, fail};
      await gate.entered.promise;
      assert.equal(adapter.requestedEmbeddingSpace, space);
      await checkpoint('named activation owns the held database initialization', 'startActivation');
    }

    async function finishActivation() {
      if (activation.fail) activation.gate.resume.reject(Error('Fixture database initialization refused'));
      else activation.gate.resume.resolve();
      const ok = await activation.completion;
      activation = undefined;
      await checkpoint('real PGlite activation and label settlement', 'finishActivation', ok);
    }

    async function write(kind, vector, text, current = true, unique = true) {
      const vectorClass = classify(vector, width());
      const before = await row();
      result = await operate(kind, vector, text, current, unique);
      const after = await row();
      if (result !== 'written') assert.deepEqual(after, before);
      if (result === 'written' && vector && after.width) rowInput = vectorClass;
      await checkpoint(kind+' observed from real SQL and source settlement', 'write', kind, vectorClass, text, current);
      return result;
    }

    async function holdWrite(kind, vector, text, current = true) {
      const gate = holdManager(adapter);
      const completion = operate(kind, vector, text, current);
      held = {gate, completion};
      await gate.entered.promise;
      pending = {kind, vector: classify(vector, width()), text, current, width: 0};
      await checkpoint('caller supplied vector held inside real PGlite admission',
        'holdWrite', kind, pending.vector, text, current);
    }

    async function finishWrite() {
      const before = await row();
      held.gate.resume.resolve();
      result = await held.completion;
      const after = await row();
      if (result !== 'written') assert.deepEqual(after, before);
      if (result === 'written' && after.width) rowInput = pending.vector;
      held = undefined;
      pending = noPending;
      await checkpoint('held write settles against the current adapter state', 'finishWrite');
      return result;
    }

    async function resize(nextWidth, delay = false) {
      const gate = delay ? holdManager(adapter) : undefined;
      const completion = adapter.ensureEmbeddingDimension(nextWidth).then(() => 'resized', refusal);
      if (gate) {
        held = {gate, completion};
        await gate.entered.promise;
        pending = {...noPending, kind: 'resize', width: nextWidth};
        await checkpoint('old width request held inside real PGlite admission', 'holdResize', nextWidth);
      } else {
        result = await completion;
        await checkpoint('width request settled', 'resize', nextWidth);
      }
    }

    async function finishResize() {
      held.gate.resume.resolve();
      result = await held.completion;
      held = undefined;
      pending = noPending;
      await checkpoint('held width request settled after activation', 'finishResize');
      return result;
    }

    async function generate() {
      runtime.registerModel('TEXT_EMBEDDING', async () => input('marked', 384), 'quint-bge', 10);
      const vector = await runtime.useModel('TEXT_EMBEDDING', {text: 'synthetic'});
      assert.equal(classify(vector, width()), 'marked');
      await checkpoint('real ModelDispatch preserved the synthetic provider marker', null);
      return vector;
    }

    await drive({
      startActivation, finishActivation, write, holdWrite, finishWrite, resize, finishResize, generate,
      activate: async () => { await startActivation(); await finishActivation(); },
      input: kind => input(kind, width()),
      read: () => runtime.getMemoryById(id),
    });
    return trace;
  } finally {
    if (activation) {
      activation.gate.resume.resolve();
      await activation.completion;
    }
    if (held) {
      held.gate.resume.resolve();
      await held.completion;
    }
    await runtime.stop();
    await setup.cleanup();
  }
}

async function runNamedEmbeddingProvenanceRefinement(extraSources = []) {
  const loaded = await loadEmbeddingStoreDatabase([driver, ...extraSources]);
  const traces = [];
  const drive = async (name, run, documents) => traces.push(await scenario(loaded, name, run, documents));

  await drive('unmarked-width-only-store-remains-compatible', async f => {
    assert.equal(await f.write('batch', f.input('unmarked'), 'old'), 'written');
    assert.equal(await f.write('search', f.input('unmarked'), 'old'), 'hit');
    assert.equal(await f.write('update', f.input('unmarked'), 'new'), 'written');
    assert.equal(await f.write('cas', f.input('unmarked'), 'new'), 'written');
    await f.resize(768);
    assert.equal(await f.write('search', f.input('unmarked'), 'old'), 'miss');
  });
  await drive('held-unmarked-cas-does-not-retag', async f => {
    await f.write('insert', undefined, 'old');
    await f.holdWrite('cas', f.input('unmarked'), 'old');
    await f.activate();
    assert.equal(await f.finishWrite(), 'space');
    assert.equal(await f.write('cas', f.input('marked'), 'old', false), 'stale');
    assert.equal(await f.write('cas', f.input('marked'), 'old'), 'written');
    assert.equal(await f.write('cas', f.input('unmarked'), 'old'), 'space');
  });
  await drive('invalid-named-replacement-rolls-back-content-and-vector', async f => {
    await f.write('insert', f.input('unmarked'), 'old');
    await f.holdWrite('update', f.input('unmarked'), 'new');
    await f.activate();
    assert.equal(await f.finishWrite(), 'space');
    assert.equal(await f.write('search', f.input('marked'), 'old'), 'miss');
    const marked = await f.generate();
    assert.equal(await f.write('update', marked, 'new'), 'written');
    const stored = await f.read();
    assert.equal(stored.embedding[representation], space, 'SQL readback retains its authenticated representation');
    assert.deepEqual(stored.embedding, marked, 'SQL readback preserves the exact numeric vector');
    assert.equal(await f.write('update', stored.embedding, 'new'), 'written');
    const serialized = JSON.parse(JSON.stringify(stored.embedding));
    assert.equal(serialized[representation], undefined, 'Serialization carries no representation proof');
    assert.equal(await f.write('update', serialized, 'old'), 'space');
    assert.equal(await f.write('update', undefined, 'new'), 'written');
  });
  await drive('held-named-cas-rechecks-source-text-after-a-winning-edit', async f => {
    await f.activate();
    await f.write('insert', f.input('marked'), 'old');
    await f.holdWrite('cas', f.input('marked'), 'old');
    assert.equal(await f.write('update', f.input('marked'), 'new'), 'written');
    assert.equal(await f.finishWrite(), 'stale');
  });
  await drive('delayed-resize-cannot-change-active-named-width', async f => {
    await f.resize(768, true);
    await f.activate();
    assert.equal(await f.finishResize(), 'resize-refused');
    await f.resize(384);
  });
  await drive('initial-activation-fences-vector-operations-and-can-fail', async f => {
    await f.startActivation(true);
    assert.equal(await f.write('insert', f.input('unmarked'), 'old'), 'uninitialized');
    assert.equal(await f.write('search', f.input('unmarked'), 'old'), 'uninitialized');
    assert.equal(await f.write('insert', undefined, 'old'), 'written');
    await f.finishActivation();
    assert.equal(await f.write('cas', f.input('unmarked'), 'old'), 'written');
  });
  await drive('named-insert-dedupe-and-query-check-exact-marker-and-width', async f => {
    await f.activate();
    const marked = await f.generate();
    assert.equal(await f.write('insert', f.input('unmarked'), 'old', true, null), 'space');
    assert.equal(await f.write('batch', f.input('other'), 'old'), 'space');
    assert.equal(await f.write('insert', f.input('bad-width'), 'old'), 'dimension');
    assert.equal(await f.write('insert', f.input('bad-value'), 'old'), 'vector');
    assert.equal(await f.write('insert', marked, 'old', true, null), 'written');
    assert.equal(await f.write('search', f.input('other'), 'old'), 'space');
    assert.equal(await f.write('search', JSON.parse(JSON.stringify(marked)), 'old'), 'space');
    assert.equal(await f.write('search', marked, 'old'), 'hit');
  });
  await drive('named-document-vector-query-retains-lexical-path', async f => {
    await f.activate();
    const marked = await f.generate();
    assert.equal(await f.write('batch', marked, 'old'), 'written');
    assert.equal(await f.write('document-search', f.input('unmarked'), 'old'), 'space');
    assert.equal(await f.write('document-search', marked, 'old'), 'hit');
    assert.equal(await f.write('document-search', undefined, 'old'), 'hit');
  }, true);

  const receipt = await checkTraces({model, traces, sources: loaded.sources, driverHashes: loaded.driverHashes,
    scope: 'bounded-component', assumptions: [
      'Real AgentRuntime, ModelDispatch and PGlite execute authenticated effective source. A synthetic local provider marks a canonical BGE384 vector. No encoder inference or device is invoked.',
      'One memory or document fragment is observed through raw PGlite text, vector-column and label readback. The held operation retains its exact source arguments across named activation.',
      'Ordinary unlabelled stores and text-only operations are independently exercised. Retained prepatch named rows, SQLite/PostgreSQL-specific concurrency and installed native BGE execution remain outside this campaign.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Existing named rows and independent adapter processes',
      reason: 'The fence validates new input, and the campaign observes one active adapter. It does not establish prior-row provenance or concurrent PostgreSQL and SQLite process behavior.'},
    {model, obligation: 'Installed native BGE admission and hardware output',
      reason: 'The dispatch campaign uses a synthetic marked provider and exact SQL readback. Actual packaged library, model, tokenizer and device evidence remains separate.'},
  ]};
}

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
