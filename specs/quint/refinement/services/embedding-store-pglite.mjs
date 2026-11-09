import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {deferred} from './support.mjs';
import {loadTaskService} from './task-service/module.mjs';

const key = 'embedding:store-identity';
const modelType = 'TEXT_EMBEDDING';
const batchType = 'TEXT_EMBEDDING_BATCH';
const candidates = {1: {provider: 'a', width: 384}, 6: {provider: 'b', width: 768}};
const widthClasses = new Map([[undefined, 0], [384, 2], [768, 3]]);
const widthClass = width => widthClasses.get(width);

export const loadEmbeddingStoreDatabase = extraSources => loadTaskService([fileURLToPath(import.meta.url), ...extraSources]);

async function scenario(loaded, name, drive) {
  const db = await loaded.createIsolatedTestDatabase('quint-embedding-'+randomUUID(), [], {postgresUrl: null});
  const {adapter, runtime} = db;
  // The shared test helper shallow-copies its character. Own the settings
  // before changing provider selection for this runtime.
  runtime.character.settings = {...runtime.character.settings};
  const embeddings = runtime.embeddings;
  const read = adapter.getCache.bind(adapter), write = adapter.setCache.bind(adapter);
  const resize = adapter.ensureEmbeddingDimension.bind(adapter);
  const clear = adapter.clearEmbeddingsOutsideActiveDimension.bind(adapter);
  const calls = [];
  const refusal = Error('Fixture persistence rejected');
  const lostReply = Error('Fixture persistence committed, reply lost');
  let current, probes = 0, writes = 0, outcome = 'none';
  const vector = width => Array(width).fill(0.125);
  for (const {provider, width} of Object.values(candidates)) {
    runtime.registerModel(modelType, async (_runtime, params) => {
      if (params === null) {
        probes++;
        current.probed.resolve();
        await current.probeReply.promise;
      }
      return vector(width);
    }, provider, 10, {displayModel: provider === 'a' ? 'alpha' : 'beta'});
    runtime.registerModel(batchType, async (_runtime, {texts}) => texts.map(() => vector(width)), provider);
  }
  adapter.getCache = async cacheKey => {
    if (cacheKey !== key) return read(cacheKey);
    calls.push('read');
    if (current.fault === 'read') throw refusal;
    return read(cacheKey);
  };
  adapter.ensureEmbeddingDimension = async width => {
    calls.push('select');
    await resize(width);
    current.selected = true;
    current.widthSelected.resolve();
    await current.widthReply.promise;
    if (current.fault === 'resize') throw lostReply;
  };
  adapter.setCache = async (cacheKey, value) => {
    if (cacheKey !== key) return write(cacheKey, value);
    calls.push('write');
    if (current.fault === 'write') throw refusal;
    if (current.fault === 'write-false') return false;
    const result = await write(cacheKey, value);
    assert.equal(result, true);
    writes++;
    current.committed = true;
    current.cacheCommitted.resolve();
    await current.cacheReply.promise;
    if (current.fault === 'write-committed') throw lostReply;
    return result;
  };
  adapter.clearEmbeddingsOutsideActiveDimension = async () => {
    calls.push('clear');
    assert.equal(embeddings.embeddingStoreTransition, false);
    assert.equal(embeddings.getPinnedProvider(), candidates[current.id].provider);
    return clear();
  };
  async function observe() {
    const stored = await read(key);
    const column = Number(adapter.embeddingDimension.slice(3));
    assert.ok([384, 768].includes(column));
    return {
      'state.stored': {provider: stored?.provider ?? 'none', model: stored?.modelLabel ?? 'none',
        width: widthClass(stored?.dimension)},
      'state.pin': {provider: embeddings.getPinnedProvider() ?? 'none',
        width: widthClass(embeddings.pinnedEmbeddingDimension)},
      'state.column': widthClass(column),
      'state.disabled': runtime.isEmbeddingGenerationDisabled(),
      'state.warned': embeddings.embeddingSkipWarned,
      'state.fenced': embeddings.embeddingStoreTransition,
      'state.selected': current?.selected ?? false,
      'state.committed': current?.committed ?? false,
      'state.writes': writes,
      'state.probe': embeddings.embeddingInitialization ? current.id : 0,
      'state.calls': probes,
      'state.fault': current?.fault ?? 'none',
      'state.outcome': outcome,
    };
  }
  function gateOrResult(gate, phase) {
    return Promise.race([gate.promise, current.result.then(error => {
      throw error ?? Error('Embedding initialization completed before '+phase);
    })]);
  }
  try {
    await runtime.ensureConnection({entityId: runtime.agentId, roomId: runtime.agentId,
      worldId: runtime.agentId, source: 'quint-embedding'});
    const trace = {name, init: {name: 'init'}, expect: await observe(), steps: []};
    async function checkpoint(label, name, ...args) {
      trace.steps.push({label, action: name ? {name, args} : null, expect: await observe()});
    }
    const fixture = {
      async start(id, fault = 'none') {
        assert.equal(embeddings.embeddingInitialization, undefined);
        runtime.setSetting('ELIZA_EMBEDDING_PROVIDER', candidates[id].provider);
        current = {id, fault, eventOffset: calls.length, selected: false, committed: false,
          probed: deferred(), probeReply: deferred(), widthSelected: deferred(), widthReply: deferred(),
          cacheCommitted: deferred(), cacheReply: deferred()};
        current.result = runtime.ensureEmbeddingDimension().then(() => undefined, error => error);
        await gateOrResult(current.probed, 'probe');
        await checkpoint('real dispatcher owns the held provider probe', 'start', id, 'none', fault);
        current.probeReply.resolve();
      },
      async select() {
        await gateOrResult(current.widthSelected, 'width selection');
        assert.deepEqual(calls.slice(current.eventOffset), ['read', 'select']);
        await checkpoint('real PGlite width selected after the identity read', 'selectWidth');
        current.widthReply.resolve();
      },
      async commit() {
        await gateOrResult(current.cacheCommitted, 'cache commit');
        assert.deepEqual(calls.slice(current.eventOffset), ['read', 'select', 'write']);
        await checkpoint('SQL readback observes the committed identity while its write reply is held', 'commitIdentity');
      },
      async finish(expectedOrder) {
        current.cacheReply.resolve();
        const error = await current.result;
        if (current.fault === 'read') { assert.equal(error, refusal); outcome = 'read-failed'; }
        else if (current.fault === 'resize') { assert.equal(error, lostReply); outcome = 'resize-failed'; }
        else if (current.fault === 'write') { assert.equal(error, refusal); outcome = 'write-failed'; }
        else if (current.fault === 'write-false') {
          assert.equal(error?.code, 'EMBEDDING_STORE_IDENTITY_WRITE_UNCONFIRMED'); outcome = 'write-failed';
        } else if (current.fault === 'write-committed') { assert.equal(error, lostReply); outcome = 'write-failed'; }
        else { assert.equal(error, undefined); outcome = 'success'; }
        current.selected = false;
        current.committed = false;
        assert.equal(embeddings.embeddingInitialization, undefined);
        assert.deepEqual(calls.slice(current.eventOffset), expectedOrder);
        await checkpoint('settled runtime pin and durable cache readback', 'finish');
      },
      async healthy(implicitWidth, explicitWidth) {
        assert.equal((await runtime.useModel(modelType, {text: 'synthetic'})).length, implicitWidth);
        if (explicitWidth) assert.equal((await runtime.useModel(modelType, {text: 'synthetic'}, 'b')).length, explicitWidth);
        await checkpoint('normal dispatch returns its configured vectors', null);
      },
      async fenced() {
        for (const [type, input] of [[modelType, {text: 'synthetic'}], [batchType, {texts: ['synthetic']}]]) {
          await assert.rejects(runtime.useModel(type, input), {code: 'EMBEDDING_STORE_TRANSITION_UNCONFIRMED'});
        }
        await checkpoint('single and batch output are refused while store state is unconfirmed', null);
        const memory = {content: {text: 'synthetic'}};
        assert.equal(await runtime.addEmbeddingToMemory(memory), memory);
        assert.equal(memory.embedding, undefined);
        let queued = false;
        const emit = runtime.emitEvent;
        runtime.emitEvent = async () => { queued = true; };
        try { await runtime.queueEmbeddingGeneration(memory); }
        finally { runtime.emitEvent = emit; }
        assert.equal(queued, false);
        const provided = {...memory, embedding: vector(384)};
        assert.equal(await runtime.addEmbeddingToMemory(provided), provided);
        await checkpoint('new vector generation is skipped; supplied vectors retain prior behavior', 'skip');
      },
    };
    await drive(fixture);
    return trace;
  } finally {
    if (current) {
      current.probeReply.resolve(); current.widthReply.resolve(); current.cacheReply.resolve();
      await current.result;
    }
    await runtime.stop();
    await db.cleanup();
  }
}

export async function embeddingStoreDatabaseTraces(loaded) {
  const traces = [];
  const drive = async (name, run) => traces.push(await scenario(loaded, name, run));
  const success = async (f, id, writes = true) => {
    await f.start(id); await f.select();
    if (writes) await f.commit();
    await f.finish(writes ? ['read', 'select', 'write', 'clear'] : ['read', 'select', 'clear']);
  };
  await drive('pglite-cache-read-failure-leaves-previous-pin-and-width', async f => {
    await success(f, 1);
    await f.healthy(384, 768);
    await f.start(6, 'read');
    await f.finish(['read']);
    await f.healthy(384, 768);
    await success(f, 6);
    await f.healthy(768);
  });
  await drive('pglite-lost-commit-reply-keeps-fence-through-read-failure-and-retry', async f => {
    await success(f, 1);
    await f.start(6, 'write-committed'); await f.select(); await f.commit(); await f.fenced();
    await f.finish(['read', 'select', 'write']); await f.fenced();
    await f.start(6, 'read'); await f.finish(['read']); await f.fenced();
    await success(f, 6, false); await f.healthy(768);
  });
  await drive('pglite-adapter-and-cache-failures-do-not-release-fence', async f => {
    await success(f, 1);
    await f.start(6, 'resize'); await f.select(); await f.finish(['read', 'select']); await f.fenced();
    for (const fault of ['write-false', 'write']) {
      await f.start(6, fault); await f.select(); await f.finish(['read', 'select', 'write']); await f.fenced();
    }
    await success(f, 6); await f.healthy(768);
  });
  return traces;
}
