import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {loadAgentRuntime} from '../../refinement/services/core-runtime/module.mjs';

const roomId = '00000000-0000-4000-8000-000000000003';
const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);

function fixture(AgentRuntime, name, readerIds, messages) {
  let db = 0;
  const readers = new Map();
  const fetches = [];
  const writers = new Map();
  const writerIds = ['w1', 'w2'];
  const room = version => ({id: roomId, name: String(version)});
  async function getRows() {
    const fetch = {read: Promise.withResolvers(), settle: Promise.withResolvers(), value: -1, status: 'pending'};
    fetches.push(fetch);
    await fetch.read.promise;
    fetch.value = db;
    await fetch.settle.promise;
    return messages ? [{roomId, content: {text: String(fetch.value)}, createdAt: 1}] : [room(fetch.value)];
  }
  const runtime = new AgentRuntime({
    agentId: '00000000-0000-4000-8000-000000000001',
    runtimeInstanceId: '00000000-0000-4000-8000-000000000002',
    character: {name: 'Quint memo fixture', bio: [], plugins: []},
    fetch: async () => {throw Error('The memo fixture forbids external requests');},
    adapter: {
      getRoomsByIds: getRows,
      getMemories: getRows,
      async updateRooms([room]) {
        const writer = writers.get(room.name);
        await writer.commit.promise;
        writer.version = ++db;
        await writer.acknowledge.promise;
      },
    },
  });
  const memo = messages ? runtime.roomMessagesMemo : runtime.roomReadMemo;
  const completed = () => Math.max(0, ...[...writers.values()].filter(writer => writer.done).map(writer => writer.version));
  function observe() {
    const entry = memo.entries.get(roomId);
    const entryIndex = entry ? fetches.findIndex(fetch => fetch.promise === entry.promise) : -1;
    if (entry) assert.notEqual(entryIndex, -1, 'Source entry identifies one observed adapter fetch');
    const fetchMap = (key, absent) => qmap(readerIds.map((_, index) => [index + 1, fetches[index]?.[key] ?? absent]));
    return {
      safety: true,
      'observed.db': db,
      'observed.entry': entryIndex + 1,
      'observed.nfetch': fetches.length,
      'observed.fval': fetchMap('value', -1),
      'observed.fstate': fetchMap('status', 'pending'),
      'observed.rpc': qmap(readerIds.map(id => {
        const reader = readers.get(id);
        return [id, !reader ? 'idle' : reader.error ? 'failed' : reader.value === undefined ? 'waiting' : 'served'];
      })),
      'observed.rf': qmap(readerIds.map(id => [id, readers.get(id)?.fetch ?? 0])),
      'observed.floor': qmap(readerIds.map(id => [id, readers.get(id)?.floor ?? 0])),
      'observed.wpc': qmap(writerIds.map(id => [id, writers.get(id)?.done ? 'done' : writers.get(id)?.version ? 'committed' : 'idle'])),
      'observed.wver': qmap(writerIds.map(id => [id, writers.get(id)?.version ?? 0])),
      'observed.completed': completed(),
    };
  }
  const trace = {name, expect: observe(), steps: []};
  const point = (label, transition) => trace.steps.push({label, action: transition, expect: observe()});
  return {
    trace,
    beginRead(id, limit = 1) {
      const before = fetches.length;
      const reader = {floor: completed()};
      readers.set(id, reader);
      const pending = messages
        ? runtime.getMemories({tableName: 'messages', roomId, ...(limit === null ? {} : {limit})})
        : runtime.getRoom(roomId);
      reader.promise = pending.then(
        value => {reader.value = Number(messages ? value[0].content.text : value.name);},
        error => {reader.error = error;},
      );
      const entry = memo.entries.get(roomId);
      assert.ok(entry, 'The production read publishes its memo entry');
      const started = fetches.length > before;
      if (started) {
        assert.equal(fetches.length, before + 1);
        const fetch = fetches.at(-1);
        fetch.promise = entry.promise;
        fetch.promise.then(
          () => {fetch.status = 'resolved';},
          () => {fetch.status = 'rejected';},
        );
      }
      reader.fetch = fetches.findIndex(fetch => fetch.promise === entry.promise) + 1;
      assert.ok(reader.fetch > 0);
      point('actual read publishes a new query or shares the exact live promise', action(started ? 'ReadFetch' : 'ReadShared', id));
    },
    async read(id) {
      fetches[id - 1].read.resolve();
      await flush();
      point('adapter reads its current committed version', action('FetchRead', id));
    },
    async settle(id, failed = false) {
      const fetch = fetches[id - 1];
      if (failed) {
        const error = Error('Controlled database read failure');
        fetch.settle.reject(error);
      } else fetch.settle.resolve();
      const waiters = [...readers].filter(([, reader]) => reader.fetch === id);
      await Promise.all(waiters.map(([, reader]) => reader.promise));
      await flush();
      assert.equal(fetch.status, failed ? 'rejected' : 'resolved');
      for (const [, reader] of waiters) {
        if (failed) assert.match(reader.error.message, /Controlled database read failure/);
        else assert.equal(reader.value, fetch.value);
      }
      point('the original query settles and all attached callers receive its outcome', [
        action(failed ? 'FetchReject' : 'FetchResolve', id), ...waiters.map(([id]) => action('Serve', id)),
      ]);
    },
    async commit(id) {
      const writer = {commit: Promise.withResolvers(), acknowledge: Promise.withResolvers(), version: 0, done: false};
      writers.set(id, writer);
      writer.promise = runtime.updateRoom({...room(0), name: id}).then(() => {writer.done = true;});
      writer.commit.resolve();
      await flush();
      assert.equal(writer.done, false);
      point('database commit is visible before the mutation caller resumes', action('Commit', id));
    },
    async invalidate(id) {
      const writer = writers.get(id);
      writer.acknowledge.resolve();
      await writer.promise;
      assert.equal(memo.entries.has(roomId), false, 'The actual mutation invalidates the room read memo');
      point('mutation return follows exact memo invalidation', action('Invalidate', id));
    },
    expire() {
      memo.invalidate();
      point('actual memo invalidation drops the resident entry', action('Expire'));
    },
    finish() {
      assert.ok(fetches.every(fetch => fetch.status !== 'pending'));
      assert.ok([...readers.values()].every(reader => reader.error || reader.value !== undefined));
    },
  };
}

export async function runSingleFlightRefinement() {
  const modelPath = 'specs/quint/legacy/CoreSingleFlightMemo.qnt';
  const loaded = await loadAgentRuntime([fileURLToPath(import.meta.url), modelPath, 'test/quint-single-flight-refinement.test.mjs']);
  const receipts = [];
  for (const safetyProfile of [false, true]) {
    const readerIds = safetyProfile ? ['r1', 'r2', 'r3'] : ['r1', 'r2'];
    const traces = [];
    async function scenario(name, run, messages = false) {
      const f = fixture(loaded.AgentRuntime, name, readerIds, messages);
      await run(f);
      f.finish();
      traces.push(f.trace);
    }
    await scenario('two room readers share one source query', async f => {
      f.beginRead('r1'); f.beginRead('r2'); await f.read(1); await f.settle(1);
    });
    await scenario('a completed room write fences a later reader', async f => {
      f.beginRead('r1'); await f.read(1); await f.commit('w1'); await f.invalidate('w1');
      f.beginRead('r2'); await f.read(2); await f.settle(1); await f.settle(2);
    });
    await scenario('late read failure preserves the replacement entry', async f => {
      f.beginRead('r1'); await f.read(1); f.expire(); f.beginRead('r2'); await f.read(2);
      await f.settle(1, true); await f.settle(2);
    });
    await scenario('unbounded message read replaces an insufficient finite window', async f => {
      f.beginRead('r1'); f.beginRead('r2', null); await f.read(1); await f.read(2);
      await f.settle(1, true); await f.settle(2);
    }, true);
    if (safetyProfile) await scenario('writer acknowledgements settle out of commit order', async f => {
      f.beginRead('r1'); await f.read(1);
      await f.commit('w1'); await f.commit('w2'); await f.invalidate('w2');
      f.beginRead('r2'); await f.read(2); await f.settle(2);
      await f.invalidate('w1'); f.beginRead('r3'); await f.read(3); await f.settle(3); await f.settle(1);
    });
    const model = safetyProfile ? 'CoreSingleFlightMemoSafety' : 'CoreSingleFlightMemo';
    receipts.push(await checkTraces({model, modelPath, traces, sources: loaded.sources, driverHashes: loaded.driverHashes,
      scope: 'bounded-component', assumptions: [
        'The real AgentRuntime getRoom, getMemories and updateRoom execute with SingleFlightMemo and runtime mutation wrappers.',
        'One key, two write identities and up to three readers. A controlled adapter exposes commit and acknowledgement separately; its version values are synthetic.',
        'Read and writer promise callbacks and the actual memo entries identify versions and ownership. A result checkpoint groups adjacent promise reactions.',
        'Physical database isolation, TTL and capacity eviction across keys and additional mutation wrappers require separate schedules.',
      ]}));
  }
  return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const receipt of await runSingleFlightRefinement()) console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
}
