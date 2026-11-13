import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {sourceContext} from '../specs/quint/refinement/application/support.mjs';

const source = 'apps/app/src/runtime/native-view-events.ts';
const action = (name, ...args) => ({name, args});
const listener = success => action('listenerResult', success);
const subscribe = (success = true, matching = true) => action('subscribeResult', success, matching);
const frame = (subscription = true, client = true, kind = 1) => action('frame', subscription, client, kind);
const close = action('close');

function fixture(subscribeNativeViewEvents, failures) {
  const registration = Promise.withResolvers();
  const subscription = Promise.withResolvers();
  const observed = {registered: false, dispatched: false, ended: 0, removals: 0, unsubscribes: 0, delivered: 0};
  let callback;
  let settled = 'pending';
  const port = {
    async addListener(name, receive) {
      assert.equal(name, 'alphaViewEvent');
      callback = receive;
      await registration.promise;
      observed.registered = true;
      return {
        remove() {
          observed.removals++;
          if (failures.remove === 'throw') throw Error('Listener cleanup failed synchronously');
          return failures.remove === 'reject' ? Promise.reject(Error('Listener cleanup rejected')) : Promise.resolve();
        },
      };
    },
    async subscribeViewEvents(input) {
      assert.equal(input.subscriptionId, 'subscription');
      assert.equal(input.ownerId, 'owner');
      assert.equal(input.clientId, 'client');
      observed.dispatched = true;
      return subscription.promise;
    },
    unsubscribeViewEvents(input) {
      assert.equal(input.subscriptionId, 'subscription');
      observed.unsubscribes++;
      if (failures.unsubscribe === 'throw') throw Error('Native cleanup failed synchronously');
      return failures.unsubscribe === 'reject' ? Promise.reject(Error('Native cleanup rejected')) : Promise.resolve();
    },
  };
  const result = subscribeNativeViewEvents(port, 'owner', 'client', () => {observed.delivered++;}, () => {observed.ended++;});
  const done = result.ready.then(() => {settled = 'ready';}, () => {settled = 'failed';});
  const snapshot = () => ({...observed, phase: settled === 'pending' ? observed.dispatched ? 'subscribing' : 'registering' : settled});
  const execute = async command => {
    const [first, second, third] = command.args || [];
    if (command.name === 'listenerResult') {
      if (first) registration.resolve(); else registration.reject(Error('Registration unavailable'));
    } else if (command.name === 'subscribeResult') {
      assert.equal(observed.dispatched, true);
      if (first) subscription.resolve({subscriptionId: second ? 'subscription' : 'foreign'});
      else subscription.reject(Error('Subscription unavailable'));
    } else if (command.name === 'close') {
      result.close();
    } else if (command.name === 'frame') {
      callback({subscriptionId: first ? 'subscription' : 'foreign', type: third === 2 ? 'end' : third === 1 ? 'event' : 'other',
        event: {type: 'agent_event', stream: 'view-interact', payload: {clientId: second ? 'client' : 'foreign', frame: {}}}});
    } else throw Error('Unknown source command');
    await new Promise(setImmediate);
  };
  return {snapshot, execute, done};
}

async function checkNativeViewSubscription(extraSources = []) {
  const sources = [source, fileURLToPath(import.meta.url), 'specs/quint/refinement/application/support.mjs',
    'test/support/strip-types.mjs', 'test/quint-native-view-subscription.test.mjs', ...extraSources];
  const driverHashes = captureInputs(sources);
  const api = sourceContext([source], ['subscribeNativeViewEvents'], {crypto: {randomUUID: () => 'subscription'}});
  const schedules = [
    ['normal and filtered frames', {}, [listener(true), subscribe(), frame(false), frame(true, false), frame(true, true, 0), frame(), close, frame()]],
    ['registration failure', {}, [listener(false), close]],
    ['close before registration returns', {}, [close, listener(true), close]],
    ['close before registration fails', {}, [close, listener(false)]],
    ['close before subscribe returns', {}, [listener(true), close, subscribe(), frame()]],
    ['close before subscribe rejects', {}, [listener(true), close, subscribe(false)]],
    ['mismatched subscribe reply', {}, [listener(true), subscribe(true, false), frame()]],
    ['subscribe failure', {}, [listener(true), subscribe(false), close]],
    ['terminal before registration', {}, [frame(true, true, 2), listener(true)]],
    ['terminal while subscribing', {}, [listener(true), frame(true, true, 2), subscribe()]],
    ['terminal after ready', {}, [listener(true), subscribe(), frame(), frame(true, true, 2), frame(), close]],
    ['foreign terminal stays live', {}, [listener(true), subscribe(), frame(false, true, 2), frame(), close]],
  ];
  for (const operation of ['remove', 'unsubscribe']) for (const failure of ['throw', 'reject']) {
    schedules.push([operation + ' ' + failure + ' cleanup', {[operation]: failure}, [listener(true), subscribe(), close, frame(), close]]);
    schedules.push([operation + ' ' + failure + ' during late reply', {[operation]: failure}, [listener(true), close, subscribe()]]);
  }
  const traces = [];
  for (const [name, failures, commands] of schedules) {
    const instance = fixture(api.subscribeNativeViewEvents, failures);
    const trace = {name, expect: {s: instance.snapshot()}, steps: []};
    for (const command of commands) {
      await instance.execute(command);
      trace.steps.push({label: command.name, action: command, expect: {s: instance.snapshot()}});
    }
    await instance.done;
    assert.equal(instance.snapshot().ended, 1, name);
    traces.push(trace);
  }
  return checkTraces({model: 'NativeViewSubscription', sources, driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'The actual native-view-events function executes with TypeScript annotations stripped and only native IPC, UUID generation and event delivery supplied as controlled ports.',
      'Every state field observes a public promise settlement, native call attempt or delivered callback. Rejected and synchronously throwing cleanup ports are both covered.',
      'One subscription identity, one foreign identity and two accepted frames bound the traces. Real Binder delivery and native owner enforcement remain separate obligations.',
    ]});
}

test('native view subscriptions retire across delayed replies and cleanup failures', async () => {
  const receipt = await checkNativeViewSubscription();
  assert.equal(receipt.traces, 20);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.deepEqual(receipt.observedFields, ['s']);
});
