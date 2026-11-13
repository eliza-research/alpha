import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {deferred} from '../specs/quint/refinement/services/support.mjs';
import {loadRuntimeEmbeddings} from '../specs/quint/refinement/services/core-runtime/module.mjs';
import {embeddingStoreDatabaseTraces, loadEmbeddingStoreDatabase} from '../specs/quint/refinement/services/embedding-store-pglite.mjs';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {EMBEDDING_STATE_TARGET} from '../scripts/core-state-patch.ts';

const model = 'EmbeddingStoreIdentity';
const driver = fileURLToPath(import.meta.url);
const candidates = [
  null,
  {provider: 'a', width: 2, metadata: {displayModel: ' alpha '}},
  {provider: 'b', width: 2, metadata: {displayModelDefault: ' beta '}},
  {provider: 'b', width: 2, metadata: {displayModel: 'alpha'}},
  {provider: 'a', width: 2},
  {provider: 'b', width: 2},
  {provider: 'b', width: 3, metadata: {displayModelDefault: 'beta'}},
  {provider: 'b', width: 2, metadata: {displayModelSettings: ['UNSET', 'FIXTURE_MODEL'], displayModelDefault: 'alpha'}},
];

function fixture(module, name) {
  const {RuntimeEmbeddings, ModelType, EMBEDDING_STORE_IDENTITY_CACHE_KEY, EMBEDDING_STORE_ACCEPT_MODEL_SETTING} = module;
  const memory = {id: 'fixture-memory', content: {text: 'Synthetic memory'}};
  const storageError = Error('Fixture identity read failed');
  const writeError = Error('Fixture identity write failed');
  const clearError = Error('Fixture clear failed');
  const providerError = Error('Fixture probe failed');
  let stored, column = 2, writes = 0, clearFailures = 0, calls = 0, warningCount = 0;
  let active, outcome = 'none', joined = false;
  const runtime = {
    agentId: '00000000-0000-4000-8000-000000000001',
    logger: {info() {}, debug() {}, warn(_data, message) {
      if (message.startsWith('Embedding generation is disabled')) warningCount++;
    }},
    getSetting(key) {
      if (key === EMBEDDING_STORE_ACCEPT_MODEL_SETTING && active.ack !== 'none') return ' ' + active.ack + ' ';
      if (key === 'FIXTURE_MODEL') return ' beta ';
    },
    async getCache(key) {
      assert.equal(key, EMBEDDING_STORE_IDENTITY_CACHE_KEY);
      if (active.fault === 'read') throw storageError;
      return stored;
    },
    async setCache(key, value) {
      assert.equal(key, EMBEDDING_STORE_IDENTITY_CACHE_KEY);
      if (active.fault === 'write') throw writeError;
      if (active.fault === 'write-false') return false;
      assert.ok(Number.isFinite(Date.parse(value.recordedAt)));
      stored = structuredClone(value);
      writes++;
      active.committed = true;
      checkpoint('identity committed before the source published a pin', 'commitIdentity');
      if (active.fault === 'write-committed') throw writeError;
      return true;
    },
    async useModel(type, params, provider) {
      assert.equal(type, ModelType.TEXT_EMBEDDING);
      assert.equal(params, null);
      assert.equal(provider, candidates[active.id].provider);
      calls++;
      active.started.resolve();
      await active.reply.promise;
      const vector = Array(candidates[active.id].width).fill(0);
      await embeddings.validateProviderOutput(type, params, vector, vector, provider);
      return vector;
    },
    reportError(scope, error) {
      assert.equal(scope, 'AgentRuntime.embeddingDimensionReconcile');
      assert.equal(error, clearError);
      clearFailures++;
    },
    adapter: {
      async ensureEmbeddingDimension(width) {
        column = width;
        active.selected = true;
        checkpoint('identity read completed before the adapter selected the width', 'selectWidth');
      },
      async clearEmbeddingsOutsideActiveDimension() {
        if (active.fault === 'clear') throw clearError;
        return [];
      },
    },
  };
  const embeddings = new RuntimeEmbeddings(runtime, {
    resolveModelRegistrations(type) {
      assert.equal(type, ModelType.TEXT_EMBEDDING);
      const {provider, metadata} = candidates[active.id];
      return [{provider, metadata, modelKey: ModelType.TEXT_EMBEDDING}];
    },
  });
  function observe() {
    return {
      'state.stored': {provider: stored?.provider ?? 'none', model: stored?.modelLabel ?? 'none', width: stored?.dimension ?? 0},
      'state.pin': {provider: embeddings.getPinnedProvider() ?? 'none', width: embeddings.pinnedEmbeddingDimension ?? 0},
      'state.column': column,
      'state.disabled': embeddings.isEmbeddingGenerationDisabled(),
      'state.warned': embeddings.embeddingSkipWarned,
      'state.fenced': embeddings.embeddingStoreTransition,
      'state.selected': active?.selected ?? false,
      'state.committed': active?.committed ?? false,
      'state.writes': writes,
      'state.clearFailures': clearFailures,
      'state.probe': embeddings.embeddingInitialization ? active.id : 0,
      'state.calls': calls,
      'state.joined': joined,
      'state.acknowledgement': active?.ack ?? 'none',
      'state.fault': active?.fault ?? 'none',
      'state.outcome': outcome,
    };
  }
  const trace = {name, init: {name: 'init'}, expect: observe(), steps: []};
  function checkpoint(label, action, ...args) {
    trace.steps.push({label, action: {name: action, args}, expect: observe()});
  }
  return {
    trace,
    async start(id, ack = 'none', fault = 'none') {
      active = {id, ack, fault, started: deferred(), reply: deferred()};
      active.initialization = embeddings.ensureEmbeddingDimension();
      active.result = active.initialization.then(() => undefined, error => error);
      await active.started.promise;
      assert.equal(embeddings.embeddingInitialization, active.initialization);
      checkpoint('source owns a held provider probe', 'start', id, ack, fault);
    },
    join() {
      assert.equal(embeddings.ensureEmbeddingDimension(), active.initialization);
      joined = true;
      checkpoint('the second caller gets the same source promise', 'join');
    },
    async finish() {
      if (active.fault === 'provider') active.reply.reject(providerError);
      else active.reply.resolve();
      const error = await active.result;
      if (!error) outcome = 'success';
      else if (error === storageError) outcome = 'read-failed';
      else if (error === writeError || error.code === 'EMBEDDING_STORE_IDENTITY_WRITE_UNCONFIRMED') outcome = 'write-failed';
      else if (error.code === 'EMBEDDING_STORE_MODEL_MISMATCH') outcome = 'model-mismatch';
      else if (error.name === 'EmbeddingDimensionProbeError') {
        assert.equal(error.attempts.length, 1);
        assert.equal(error.attempts[0].error, providerError.message);
        outcome = 'probe-failed';
      } else throw error;
      joined = false;
      active.selected = false;
      active.committed = false;
      assert.equal(embeddings.embeddingInitialization, undefined);
      checkpoint('cache, dimension and pin reflect the settled probe', 'finish');
    },
    async skip() {
      const expectedWarnings = warningCount + (embeddings.embeddingSkipWarned ? 0 : 1);
      assert.equal(await embeddings.addEmbeddingToMemory(memory), memory);
      assert.equal(memory.embedding, undefined);
      assert.equal(warningCount, expectedWarnings);
      checkpoint('disabled writes skip the vector and warn once', 'skip');
    },
  };
}

async function runEmbeddingStoreIdentityRefinement(extraSources = []) {
  const inputs = [driver, fileURLToPath(new URL('../specs/quint/refinement/services/support.mjs', import.meta.url)), ...extraSources];
  const [bundle, database] = await Promise.all([loadRuntimeEmbeddings(inputs), loadEmbeddingStoreDatabase(inputs)]);
  for (const compiled of [bundle, database]) {
    assert.ok(compiled.coreState.transforms.some(entry => entry.path === EMBEDDING_STATE_TARGET),
      'The authenticated embedding state patch reached the executed source');
  }
  const sources = [...new Set([...bundle.sources, ...database.sources])];
  const driverHashes = {...bundle.driverHashes};
  for (const [file, digest] of Object.entries(database.driverHashes)) {
    if (Object.hasOwn(driverHashes, file)) assert.equal(driverHashes[file], digest, `Embedding inputs changed between compilers: ${file}`);
    driverHashes[file] = digest;
  }
  const traces = [];
  async function scenario(name, drive) {
    const f = fixture(bundle, name);
    await drive(f);
    traces.push(f.trace);
  }
  const probe = async (f, ...args) => { await f.start(...args); await f.finish(); };
  await scenario('same-width-model-mismatch-and-explicit-acceptance', async f => {
    await probe(f, 1); await probe(f, 2); await f.skip(); await f.skip();
    await probe(f, 2, 'alpha'); await probe(f, 2, 'beta');
  });
  await scenario('known-model-shared-by-two-registered-providers', async f => {
    await probe(f, 1); await probe(f, 3); await probe(f, 3, 'none', 'write');
  });
  await scenario('unlabelled-model-uses-provider-custody', async f => {
    await probe(f, 4); await probe(f, 1); await probe(f, 5); await probe(f, 5, 'b');
  });
  await scenario('wider-probe-reclaims-column-after-clear-failure', async f => {
    await probe(f, 1); await f.start(6, 'none', 'clear'); f.join(); await f.finish();
  });
  await scenario('cache-read-fails-before-adapter-resize', async f => {
    await probe(f, 1); await probe(f, 6, 'none', 'read'); await probe(f, 6);
  });
  await scenario('cache-write-refusal-does-not-advance-pin', async f => {
    await probe(f, 1, 'none', 'write'); await probe(f, 7);
  });
  await scenario('provider-failure-disables-generation-until-recovery', async f => {
    await probe(f, 2, 'none', 'provider'); await f.skip(); await probe(f, 7);
  });
  traces.push(...await embeddingStoreDatabaseTraces(database));
  const receipt = await checkTraces({model, traces, sources, driverHashes,
    scope: 'bounded-component', assumptions: [
      `Actual RuntimeEmbeddings and provider-output validation from the authenticated effective SDK.`,
      'A controlled model port returns untagged widths two and three. Controlled adapter and cache ports expose stored identity, committed width, write failures and reconciliation outcomes.',
      'The real AgentRuntime uses a temporary PGlite database with actual cache commit and width selection. Synthetic providers and adapter exceptions isolate before-read, after-resize, rejected/false-write and committed-but-unacknowledged outcomes.',
      'The source compares known labels across providers and falls back to provider identity for unlabelled data. A single caller joins an in-flight probe. Named-space changes and concurrent SQL writers remain separate.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Named representation and concurrent storage owners',
      reason: 'The untagged identity ledger does not establish named-vector provenance or atomicity across distinct runtimes sharing a store.'},
    {model, obligation: 'Database process restart and in-flight provider output across a completed re-pin',
      reason: 'The source schedules retry one live AgentRuntime and fence output delivered while the transition is unconfirmed. Durable process restart, SQLite/PostgreSQL-specific failures and outputs held until after a successful re-pin need separate schedules.'},
  ]};
}

test('actual embedding probe preserves the prior store on read failure and fences uncertain writes', async () => {
  const {receipts: [receipt]} = await runEmbeddingStoreIdentityRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.checkpoints, 139);
});
