import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {loadTurnControllers} from '../specs/quint/refinement/services/core-runtime/module.mjs';

const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);

function fixture(TurnControllerRegistry, name) {
  const registries = new Map([1, 2].map(id => [id, new TurnControllerRegistry()]));
  const records = new Map();
  const signals = new Map();
  const events = [];
  const listeners = new Map();
  const order = [];
  const contexts = new Map([[1, 0], [2, 0]]);
  let signal = 0;
  let queryRegistry = 0;
  let queryRoom = 0;
  let abortable = false;
  let changed = false;
  let abortedRooms = [];
  const listen = registry => registries.get(registry).onEvent(event => {
    events.push({registry, room: Number(event.roomId), kind: event.type});
  });
  for (const [id, registry] of registries) {
    registry.onEvent(() => {throw Error('Controlled telemetry failure');});
    listeners.set(id, listen(id));
  }
  const identify = value => {
    if (value === null) return 0;
    assert.ok(signals.has(value), 'Every observed signal belongs to this source campaign');
    return signals.get(value);
  };
  const observe = () => {
    const active = [];
    const roomOrder = [];
    for (const [registryId, registry] of registries) {
      roomOrder.push([registryId, [...registry.active.keys()].map(Number)]);
      for (const [room, turns] of registry.active) {
        active.push(...turns.map(turn => identify(turn.controller.signal)));
      }
    }
    return {
      's.active': qset(active),
      's.aborted': qset([...records].filter(([, record]) => record.signal.aborted).map(([id]) => id)),
      's.reasons': qmap([1, 2, 3].map(id => [id, records.get(id)?.signal.reason?.reason || 'none'])),
      's.results': qmap([1, 2, 3].map(id => [id, records.get(id)?.result || 'unused'])),
      's.registry': qmap([1, 2, 3].map(id => [id, records.get(id)?.registry || 0])),
      's.room': qmap([1, 2, 3].map(id => [id, records.get(id)?.room || 0])),
      's.order': [...order], 's.roomOrder': qmap(roomOrder),
      's.listening': qset([...registries].filter(([, registry]) => registry.listeners.size > 1).map(([id]) => id)),
      's.closedReason': qmap([...registries].map(([id, registry]) => [id, registry.closedReason ?? 'none'])),
      's.events': [...events], 's.signal': signal, 's.queryRegistry': queryRegistry, 's.queryRoom': queryRoom, 's.abortable': abortable,
      's.changed': changed, 's.abortedRooms': qset(abortedRooms),
    };
  };
  const trace = {name, expect: observe(), steps: []};
  const point = (label, transition) => trace.steps.push({label, action: transition, expect: observe()});
  const f = {
    trace,
    begin(id, registryId, room) {
      const gate = Promise.withResolvers();
      const record = {registry: registryId, room, result: 'running', gate, contexts: new Map(contexts)};
      record.contexts.set(registryId, id);
      records.set(id, record);
      order.push(id);
      const promise = registries.get(registryId).runWith(String(room), async ownedSignal => {
        record.signal = ownedSignal;
        signals.set(ownedSignal, id);
        record.runInside = AsyncLocalStorage.snapshot();
        return gate.promise;
      });
      record.promise = promise.then(
        () => {record.result = 'ok';},
        () => {record.result = 'failed';},
      );
      point('turn registered before the handler waits', action('begin', id, registryId, room));
    },
    inside(id, run) {
      const record = records.get(id);
      const previous = new Map(contexts);
      contexts.clear();
      for (const entry of record.contexts) contexts.set(...entry);
      try {return record.runInside(run);}
      finally {
        contexts.clear();
        for (const entry of previous) contexts.set(...entry);
      }
    },
    query(registryId, room) {
      const registry = registries.get(registryId);
      queryRegistry = registryId;
      queryRoom = room;
      signal = identify(registry.signalFor(String(room)));
      abortable = registry.hasAbortableTurn(String(room));
      assert.equal(registry.hasActiveTurn(String(room)), registry.active.has(String(room)));
      assert.deepEqual(registry.activeRoomIds(), [...registry.active.keys()]);
      point('lookup uses this registry and its own asynchronous context', action('query', registryId, room, contexts.get(registryId)));
    },
    abortRoom(registryId, room, reason = 'stop') {
      changed = registries.get(registryId).abortTurn(String(room), reason);
      point('room cancellation excludes only the caller in this registry', action('abortRoom', registryId, room, contexts.get(registryId), reason));
    },
    abortAll(registryId, reason = 'shutdown') {
      abortedRooms = registries.get(registryId).abortAllTurns(reason).map(Number);
      point('runtime cancellation includes every active caller', action('abortAll', registryId, reason));
    },
    closeTurns(registryId, reason = 'shutdown') {
      abortedRooms = registries.get(registryId).closeTurns(reason).map(Number);
      point('closure aborts existing turns and fences later admission', action('closeTurns', registryId, reason));
    },
    listen(registryId, subscribed) {
      listeners.get(registryId)?.();
      listeners.delete(registryId);
      if (subscribed) listeners.set(registryId, listen(registryId));
      point('telemetry observer subscription changes independently', action('listen', registryId, subscribed));
    },
    async settle(id, success = true) {
      const record = records.get(id);
      if (success) record.gate.resolve('completed');
      else record.gate.reject(Error('Controlled handler failure'));
      await record.promise;
      await flush();
      point('handler settles and unregisters its exact controller', action('settle', id, success));
    },
    async finish() {
      for (const record of records.values()) assert.notEqual(record.result, 'running');
      await flush();
      for (const registry of registries.values()) assert.deepEqual(registry.activeRoomIds(), []);
    },
  };
  return f;
}

async function runTurnControllerRefinement(extraSources = []) {
  const module = await loadTurnControllers([fileURLToPath(import.meta.url), 'test/quint-core-turns.test.mjs', ...extraSources]);
  const traces = [];
  async function scenario(name, run) {
    const f = fixture(module.TurnControllerRegistry, name);
    await run(f);
    await f.finish();
    traces.push(f.trace);
  }
  await scenario('one successful turn unregisters', async f => {
    f.begin(1, 1, 1); f.query(1, 1); await f.settle(1); f.query(1, 1);
  });
  await scenario('ordinary failure unregisters', async f => {
    f.begin(1, 1, 1); await f.settle(1, false);
  });
  await scenario('same-room in-turn cancellation excludes self', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 1);
    f.inside(2, () => {f.query(1, 1); f.abortRoom(1, 1); f.query(1, 1);});
    await f.settle(1, false); await f.settle(2);
  });
  await scenario('out-of-band cancellation reaches every same-room turn once', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 1); f.abortRoom(1, 1); f.abortRoom(1, 1);
    await f.settle(2, false); await f.settle(1, false);
  });
  await scenario('cancelled noncooperative work may complete successfully', async f => {
    f.begin(1, 1, 1); f.abortRoom(1, 1); await f.settle(1);
  });
  await scenario('old cancellation reason survives later shutdown', async f => {
    f.begin(1, 1, 1); f.abortRoom(1, 1); f.abortAll(1); await f.settle(1, false);
  });
  await scenario('runtime shutdown includes its calling turn across rooms', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 2); f.begin(3, 2, 1);
    f.inside(1, () => f.abortAll(1)); f.query(2, 1);
    await f.settle(1, false); await f.settle(2, false); await f.settle(3);
  });
  await scenario('empty peer registry has no inherited signal', async f => {
    f.begin(1, 1, 1); f.inside(1, () => f.query(2, 1)); await f.settle(1);
  });
  await scenario('peer registry resolves its own same-room signal', async f => {
    f.begin(1, 1, 1); f.begin(2, 2, 1);
    f.inside(1, () => {f.query(2, 1); f.abortRoom(2, 1);});
    await f.settle(2, false); await f.settle(1);
  });
  await scenario('nested runtimes retain independent outer contexts', async f => {
    f.begin(1, 1, 1);
    f.inside(1, () => f.begin(2, 2, 1));
    f.inside(2, () => {f.query(1, 1); f.query(2, 1); f.abortRoom(1, 1);});
    await f.settle(2); await f.settle(1);
  });
  await scenario('out-of-band lookup follows newest remaining turn', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 1); f.query(1, 1);
    await f.settle(2); f.query(1, 1); await f.settle(1);
  });
  await scenario('in-turn lookup retains the caller despite a newer sibling', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 1); f.inside(1, () => f.query(1, 1));
    await f.settle(1); await f.settle(2);
  });
  await scenario('observers can unsubscribe and resubscribe while work waits', async f => {
    f.listen(1, false); f.begin(1, 1, 1); f.listen(1, true); await f.settle(1);
  });
  await scenario('room order survives an earlier member finishing', async f => {
    f.begin(1, 1, 1); f.begin(2, 1, 2); f.begin(3, 1, 1);
    await f.settle(1); f.abortAll(1); await f.settle(3, false); await f.settle(2, false);
  });
  await scenario('closed registry starts later turns with an aborted signal', async f => {
    f.closeTurns(1); f.begin(1, 1, 1); f.begin(2, 2, 1);
    f.inside(1, () => {f.query(1, 1); f.query(2, 1);});
    await f.settle(1, false); await f.settle(2);
  });
  await scenario('closing from a turn aborts it and preserves earlier reasons on reclose', async f => {
    f.begin(1, 1, 1); f.inside(1, () => f.closeTurns(1));
    f.closeTurns(1, 'stop'); f.begin(2, 1, 2); await f.settle(2, false); await f.settle(1, false);
  });
  await scenario('closed admission leaves noncooperative handler completion observable', async f => {
    f.closeTurns(1); f.begin(1, 1, 1); await f.settle(1);
  });
  return checkTraces({model: 'CoreTurnControllers', sources: module.sources, driverHashes: module.driverHashes,
    traces, scope: 'bounded-orchestration', assumptions: [
      'Two actual registries and three turn identities execute with real AsyncLocalStorage, AbortController and Promise settlement. Controlled handlers wait on explicit gates.',
      'Room IDs and cancellation reasons use finite equality classes. Timing values are omitted. Registered observer failures execute and remain isolated.',
      'Handler cooperation with cancellation, detached asynchronous work after completion, arbitrary reentrant event listeners and the complete room-queue/provider composition require additional schedules.',
    ]});
}

test('turn registries retain their own asynchronous context and cancellation authority', async () => {
  const receipt = await runTurnControllerRefinement();
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  const state = modelStateInventory(resolve('specs/quint/services/CoreTurnControllers.qnt'), 'CoreTurnControllers');
  assert.deepEqual(unobservedStateFields(state, receipt.observedFields), []);
});
