import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CORE_STATE_INPUTS, ROOM_QUEUE_TARGET, coreStatePatch} from '../../../../scripts/core-state-patch.mjs';
import {checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, deferred, observeFile, root, tick} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const turnIds = ['t1', 't2', 't3'];
const roomIds = [1, 2];
const map = (keys, value) => qmap(keys.map(key => [key, value(key)]));
const room = number => 'room-' + number;
const number = id => roomIds.find(key => room(key) === id);

// Observe real mutations at synchronous boundaries that precede the public
// lease and settlement promises. Hooks only read state and record snapshots.
const queueObservers = effective => ({name: 'observe-room-queue', setup(build) {
  observeFile(build, 'room-handler-queue.ts', [
    ['this.queue.push(item);', 'this.queue.push(item); __quint.enqueued(this, item);'],
    ['this.active = next;', 'this.active = next; __quint.granted(this, next);'],
    ['this.queue.splice(index, 1);', 'this.queue.splice(index, 1); __quint.cancelled(this, item);'],
    ['next.resolve(value);\n\t\t\t\t\tthis.active = null;',
      'next.resolve(value);\n\t\t\t\t\tthis.active = null; __quint.released(this, next);'],
    ['ownership.accepting = false;', '__quint.releasing(ownership); ownership.accepting = false; __quint.fenced(ownership);'],
    ['this.activeLeases.set(lease, ownership);', 'this.activeLeases.set(lease, ownership); __quint.issued(ownership);'],
    ['const operation = predecessor.then(fn);', 'const operation = predecessor.then(fn); __quint.writerAdded(ownership);'],
    ['ownership.writerTail = operation.then(\n\t\t\t() => undefined,\n\t\t\t() => undefined,\n\t\t);',
      'ownership.writerTail = operation.then(\n\t\t\t() => __quint.writerSettled(ownership),\n\t\t\t() => __quint.writerSettled(ownership),\n\t\t);'],
  ], () => effective);
}});

function fixture(bundle, maxPendingTotal, name, onListenerError) {
  const context = new AsyncLocalStorage();
  const turns = new Map(turnIds.map(id => [id, {pc: 'idle', want: [], result: deferred(), writes: new Map()}]));
  const turnOf = new Map(), ownedBy = new Map();
  const queues = new Map(), capabilities = new Map();
  let admissionHistory = true, releaseHistory = true;
  const hold = (id, r) => turnOf.get(queues.get(r)?.active) === id;
  const held = id => roomIds.filter(r => hold(id, r));
  const open = (id, r) => hold(id, r) && (capabilities.get(r)?.accepting ?? true);
  const observe = () => ({
    'state.queue': map(roomIds, r => (queues.get(r)?.queue ?? []).map(item => turnOf.get(item))),
    'state.active': map(roomIds, r => turnOf.get(queues.get(r)?.active) ?? 'None'),
    'state.want': map(turnIds, id => qset(turns.get(id).want)),
    'state.held': map(turnIds, id => qset(held(id))),
    'state.pc': map(turnIds, id => turns.get(id).pc),
    'state.accepting': map(turnIds, id => qset(roomIds.filter(r => open(id, r)))),
    'state.writes': map(turnIds, id => map(roomIds, r => turns.get(id).writes.get(r) ?? 0)),
    'state.closed': !queue.isAcceptingAdmissions(),
    'state.admissionHistory': admissionHistory,
    'state.releaseHistory': releaseHistory,
  });
  function record(label, action, ...args) {
    trace.steps.push({label, action: action ? {name: action, args} : null, expect: observe()});
  }
  const hooks = {
    enqueued(source, item) {
      const id = context.getStore(), r = number(source.roomId);
      assert.ok(id && r);
      queues.set(r, source);
      turnOf.set(item, id);
      turns.get(id).pc = 'waiting';
      admissionHistory &&= queue.isAcceptingAdmissions();
      record('actual insertion in room FIFO', 'admit', id);
    },
    granted(source, item) {
      const id = turnOf.get(item), turn = turns.get(id), r = number(source.roomId);
      capabilities.delete(r);
      turn.pc = held(id).length === turn.want.length ? 'owner' : 'acquiring';
      record('FIFO head reserves the room', 'grant', r);
    },
    cancelled(source, item) {
      const id = turnOf.get(item);
      turns.get(id).pc = held(id).length ? 'unwinding' : 'cancelled';
      record('actual abort removes the waiting item', 'cancel', id, number(source.roomId));
    },
    issued(ownership) {
      const r = number(ownership.roomId), id = turnOf.get(queues.get(r).active);
      capabilities.set(r, ownership);
      ownedBy.set(ownership, id);
    },
    releasing(ownership) {
      const id = ownedBy.get(ownership), turn = turns.get(id);
      if (turn.pc === 'owner') {
        turn.pc = 'releasing';
        record('lease owner starts release', 'startRelease', id);
      }
    },
    fenced(ownership) {
      record('release closes writer admission', 'stopWrites', ownedBy.get(ownership));
    },
    released(source, item) {
      const id = turnOf.get(item), turn = turns.get(id), r = number(source.roomId);
      const capability = capabilities.get(r);
      releaseHistory &&= (turn.pc === 'releasing' || turn.pc === 'unwinding') &&
        capability?.accepting === false && !turn.writes.get(r);
      if (!held(id).length) turn.pc = turn.pc === 'unwinding' ? 'refused' : 'done';
      record('room is released after its writer tail settles', 'release', id);
    },
    writerAdded(ownership) {
      const id = ownedBy.get(ownership), r = number(ownership.roomId);
      const writes = turns.get(id).writes;
      assert.equal(writes.get(r) ?? 0, 0, 'One writer per room in the original profile');
      writes.set(r, 1);
      record('actual lease writer appended', 'beginWrite', id, r);
    },
    writerSettled(ownership) {
      const id = ownedBy.get(ownership), r = number(ownership.roomId);
      turns.get(id).writes.set(r, 0);
      record('actual writer tail observes settlement', 'endWrite', id, r);
    },
  };
  const {RoomHandlerQueue} = bundle.instantiate(hooks);
  const queue = new RoomHandlerQueue({maxPendingPerRoom: 2, maxPendingTotal, maxActiveRooms: 2, onListenerError});
  const acquire = queue.acquire.bind(queue);
  queue.acquire = async (...args) => {
    try { return await acquire(...args); }
    catch (error) {
      const id = context.getStore(), turn = turns.get(id);
      if (turn.pc === 'acquiring') {
        turn.pc = held(id).length ? 'unwinding' : 'refused';
        record('actual acquisition is refused', 'admit', id);
      }
      throw error;
    }
  };
  const trace = {name, init: {name: 'init'}, expect: observe(), steps: []};
  return {
    queue, trace,
    start(id, wanted, signal) {
      const turn = turns.get(id);
      turn.want = [...new Set(wanted)];
      turn.pc = 'acquiring';
      record('caller requests its room set', 'start', id, qset(turn.want));
      turn.settled = context.run(id, () => queue.withLeases(wanted.map(room), async leases => {
        turn.leases = leases;
        assert.deepEqual([...leases.keys()], turn.want.map(room).sort());
        for (const [key, lease] of leases) {
          assert.ok(queue.ownsLease(key, lease));
          assert.equal(queue.currentLease(key), lease);
        }
        return turn.result.promise;
      }, {signal})).then(value => ({value}), error => ({error}));
    },
    close() {
      queue.closeAdmissions('shutdown');
      record('close admissions', 'close');
    },
    write(id, r, fn) {
      const turn = turns.get(id);
      return queue.withLeaseWrite(room(r), turn.leases.get(room(r)), fn);
    },
    finish: (id, error) => error ? turns.get(id).result.reject(error) : turns.get(id).result.resolve(id),
    settled: id => turns.get(id).settled,
    async checkpoint(label) {
      await tick();
      for (const r of roomIds) {
        const q = queues.get(r);
        assert.equal(queue.pendingFor(room(r)), (q?.queue.length ?? 0) + (q?.active ? 1 : 0));
      }
      record(label, null);
    },
    async drain() {
      await queue.quiesceAll();
      assert.equal(queue.pendingTotal(), 0);
      await tick();
      assert.equal(queue.rooms.size, 0);
    },
  };
}

export async function checkRoomHandlerQueueRefinement(vendorPath, extraSources = []) {
  const patch = coreStatePatch(root, resolve(root, vendorPath ?? 'vendor/eliza'));
  const effective = patch.files.get(ROOM_QUEUE_TARGET).bytes.toString('utf8');
  const bundle = await bundleVendorCore(vendorPath,
    'export {RoomHandlerQueue} from "./packages/core/src/runtime/room-handler-queue.ts";',
    [driver, ...CORE_STATE_INPUTS, ...extraSources], [queueObservers(effective)]);
  const capacity = fixture(bundle, 3, 'close-drains-admitted-waiter-after-writer');
  capacity.start('t1', [2, 1, 2]);
  await capacity.checkpoint('owner acquires deduplicated rooms in order');
  const writer = deferred();
  const write = capacity.write('t1', 2, () => writer.promise);
  capacity.start('t2', [2]);
  capacity.start('t3', [1]);
  assert.equal((await capacity.settled('t3')).error?.limitKind, 'pending');
  capacity.close();
  capacity.finish('t1');
  await capacity.checkpoint('close and release leave active writer and waiter intact');
  assert.equal(capacity.queue.pendingTotal(), 3);
  await assert.rejects(capacity.write('t1', 2, () => assert.fail('retired writer started')),
    {code: 'ROOM_HANDLER_LEASE_MISMATCH'});
  const quiet = capacity.queue.quiesceAll();
  writer.resolve('written');
  assert.equal(await write, 'written');
  assert.deepEqual(await capacity.settled('t1'), {value: 't1'});
  await capacity.checkpoint('waiter is granted after writer and reverse-order release');
  capacity.finish('t2');
  assert.deepEqual(await capacity.settled('t2'), {value: 't2'});
  await quiet;
  await capacity.drain();

  const closed = fixture(bundle, 3, 'close-between-two-room-acquisitions');
  closed.start('t1', [2, 1]);
  closed.close();
  assert.equal((await closed.settled('t1')).error?.code, 'ROOM_HANDLER_QUEUE_CLOSED');
  await closed.drain();

  const local = fixture(bundle, 3, 'room-capacity-callback-failure-and-waiter-handoff');
  local.start('t1', [1]);
  local.start('t2', [1]);
  local.start('t3', [1]);
  assert.equal((await local.settled('t3')).error?.code, 'ROOM_HANDLER_QUEUE_SATURATED');
  await local.checkpoint('two same-room admissions fill only one room');
  const failure = Error('fixture callback failure');
  local.finish('t1', failure);
  assert.equal((await local.settled('t1')).error, failure);
  await local.checkpoint('callback rejection still grants the waiter');
  local.finish('t2');
  await local.settled('t2');
  await local.drain();

  const cycle = fixture(bundle, 4, 'cancel-partial-owner-and-grant-independent-waiter');
  const active = new AbortController(), waiting = new AbortController();
  cycle.start('t1', [2], active.signal);
  cycle.start('t2', [2, 1], waiting.signal);
  await cycle.checkpoint('partial owner waits on a higher room');
  cycle.start('t3', [1]);
  const cause = Error('fixture cancellation');
  waiting.abort(cause);
  assert.equal((await cycle.settled('t2')).error?.cause, cause);
  active.abort(cause);
  await cycle.checkpoint('cancellation unwinds only the partial owner');
  assert.equal(cycle.queue.pendingTotal(), 2);
  cycle.finish('t3');
  cycle.finish('t1');
  await Promise.all([cycle.settled('t1'), cycle.settled('t3')]);
  await cycle.drain();

  const reentryTraces = [];
  for (const [name, first, second, third, pending, code] of [
    ['per-room', [1], 1, 1, 2, 'ROOM_HANDLER_QUEUE_SATURATED'],
    ['global', [1, 2], 2, 1, 3, 'ROOM_HANDLER_QUEUE_GLOBAL_SATURATED'],
  ]) {
    const errors = [], diagnostic = Error('fixture listener failure');
    const reentry = fixture(bundle, 3, name + '-capacity-during-enqueued-listener', (error, event) => {
      errors.push([error, event.type]);
      throw Error('fixture secondary diagnostic failure');
    });
    reentry.start('t1', first);
    await reentry.checkpoint('first owner reserves its rooms');
    let pendingAtEvent;
    reentry.queue.onEvent(event => {
      if (event.type === 'enqueued' && pendingAtEvent === undefined) {
        pendingAtEvent = reentry.queue.pendingTotal();
        reentry.start('t3', [third]);
        throw diagnostic;
      }
      if (event.type === 'completed') throw diagnostic;
    });
    reentry.start('t2', [second]);
    assert.equal(pendingAtEvent, pending, 'Telemetry sees the outer reservation');
    assert.equal((await reentry.settled('t3')).error?.code, code);
    await reentry.checkpoint('reentrant caller is refused at the reserved capacity');
    reentry.finish('t1');
    assert.deepEqual(await reentry.settled('t1'), {value: 't1'});
    await reentry.checkpoint('the reserved waiter acquires');
    reentry.finish('t2');
    assert.deepEqual(await reentry.settled('t2'), {value: 't2'});
    await reentry.drain();
    assert.deepEqual(errors, [[diagnostic, 'enqueued'], ...first.map(() => [diagnostic, 'completed']),
      [diagnostic, 'completed']]);
    reentryTraces.push(reentry.trace);
  }

  return Promise.all([
    ['CoreRoomHandlerQueue', [capacity.trace, closed.trace, local.trace, ...reentryTraces]],
    ['CoreRoomHandlerQueueCycle', [cycle.trace]],
  ].map(([model, traces]) => checkTraces({model, modelPath: 'specs/quint/legacy/CoreRoomHandlerQueue.qnt',
    id: model + '-source', sources: bundle.sources, driverHashes: bundle.driverHashes, traces,
    scope: 'bounded-component', assumptions: [
      `Actual RoomHandlerQueue at ${bundle.revision} with the authenticated product admission patch.`,
      'Observe FIFO, held rooms, capability fencing and writer tail settlement at source mutation seams. Logical turn identity comes from the caller async context or from the actual queued item.',
      'Controlled callbacks use up to three callers, two rooms, and one live writer per room. Callback failures refine ordinary release. The release boundary precedes notification of the next FIFO owner.',
      'Synchronous telemetry attempts reentry at both queue limits and diagnostic failures are observed on admission and completion. Arbitrary capacities and simultaneous multi-room writer tails remain outside the profiles.',
    ]})));
}

if (process.argv[1] === driver) {
  for (const receipt of await checkRoomHandlerQueueRefinement(process.argv[2]?.replace(/^--vendor-dir=/, ''))) {
    console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
  }
}
