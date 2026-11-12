import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, sourceContext, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/hosted-background.ts';
const model = 'HostedBackgroundAdmission';
const ids = [1, 2];
const empty = {session: '', phase: '', active: false, retired: false,
  begins: 0, configs: 0, cancels: 0, cancelFault: 'none', outcome: ''};
const beginError = Error('Synthetic native reservation refusal');
const configureError = Error('Synthetic native configuration refusal');
const cancelError = Error('Synthetic native cancellation refusal');
const disableError = Error('Synthetic native disable refusal');

async function scenario(name, android, drive) {
  const attempts = new Map(), reservations = new Map();
  let starting, disables = 0, target = '', pauseOutcome = '', acceptDisable = true;
  class ObservedController extends AbortController {
    constructor() {
      super();
      assert.ok(starting && !starting.internal);
      starting.internal = this.signal;
    }
  }
  const port = {
    beginBackground(input) {
      assert.deepEqual({...input}, {attemptId: starting.uuid});
      assert.ok(!reservations.has(input.attemptId));
      reservations.set(input.attemptId, starting);
      starting.phase = 'begin';
      starting.begins++;
      return starting.begin.promise;
    },
    cancelBackground(input) {
      const attempt = reservations.get(input.attemptId);
      assert.ok(attempt, 'Cancellation uses an already dispatched reservation identity');
      assert.deepEqual({...input}, {attemptId: attempt.uuid});
      attempt.cancels++;
      const refuse = attempt.cancelFault === 'all' || (attempt.cancelFault === 'first' && attempt.cancels === 1);
      return refuse ? Promise.reject(cancelError) : Promise.resolve();
    },
    configureBackground(input) {
      const attempt = reservations.get(input.attemptId);
      assert.ok(attempt);
      assert.deepEqual({...input}, {...attempt.request, attemptId: attempt.uuid});
      attempt.phase = 'config';
      attempt.configs++;
      return attempt.config.promise;
    },
    disableBackground(input) {
      if (input !== undefined) {
        assert.ok(['A', 'B'].includes(input.sessionId));
        assert.deepEqual({...input}, {sessionId: input.sessionId});
      }
      disables++;
      target = input?.sessionId ?? 'all';
      return acceptDisable ? Promise.resolve() : Promise.reject(disableError);
    },
  };
  const api = sourceContext([implementation], ['configureHostedBackground', 'pauseHostedBackground'], {
    isAndroid: android, AbortController: ObservedController,
    crypto: {randomUUID: () => starting.uuid},
    registerPlugin(name) {assert.equal(name, 'AlphaHostedResults'); return port;},
  });

  function observe() {
    return {'s.android': android, 's.disables': disables, 's.target': target, 's.pauseOutcome': pauseOutcome,
      's.attempts': qmap(ids.map(id => {
        const a = attempts.get(id);
        if (!a) return [id, empty];
        return [id, {session: a.request.sessionId, phase: a.phase, active: a.listeners.size > 0,
          retired: a.internal?.aborted ?? a.preaborted, begins: a.begins, configs: a.configs,
          cancels: a.cancels, cancelFault: a.cancelFault, outcome: a.outcome}];
      }))};
  }
  const schedule = trace(name, observe(), call('initFor', android));
  const record = (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), observe());

  await drive({
    async start(id, session, preaborted = false, cancelFault = 'none') {
      assert.ok(!attempts.has(id));
      const external = new AbortController(), listeners = new Set(), signal = external.signal;
      if (preaborted) external.abort();
      const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
      signal.addEventListener = (type, callback, options) => {
        assert.equal(type, 'abort');
        assert.equal(options?.once, true);
        listeners.add(callback);
        add(type, callback, options);
      };
      signal.removeEventListener = (type, callback) => {
        assert.equal(type, 'abort');
        assert.ok(listeners.delete(callback), 'Cleanup removes the exact forwarding listener');
        remove(type, callback);
      };
      const request = {sessionId: session, attemptId: 'discarded-fixture-value', origin: 'https://fixture.invalid'};
      const attempt = {...empty, request, external, listeners, preaborted, cancelFault,
        uuid: `00000000-0000-4000-8000-00000000000${id}`, begin: deferred(), config: deferred()};
      attempts.set(id, attempt);
      function settle(outcome) {
        assert.equal(listeners.size, 0);
        attempt.phase = 'done';
        attempt.outcome = outcome;
      }
      starting = attempt;
      attempt.done = api.configureHostedBackground(request, signal).then(value => {
        assert.equal(typeof value, 'boolean');
        settle(String(value));
      }, error => {
        if (error === cancelError) settle('cancelRefused');
        else if (error.name === 'AbortError') settle('aborted');
        else throw error;
      });
      starting = undefined;
      await tick();
      record('The actual wrapper either dispatches one reservation or settles without a native call', 'start', id, session, preaborted, cancelFault);
    },
    async abort(id) {
      attempts.get(id).external.abort();
      await tick();
      record('External abort is forwarded only while the exact wrapper attempt is registered', 'abort', id);
    },
    async pause(session = 'all', ok = true) {
      acceptDisable = ok;
      await api.pauseHostedBackground(session === 'all' ? undefined : session).then(
        () => {pauseOutcome = 'ok';}, error => {assert.equal(error, disableError); pauseOutcome = 'refused';});
      await tick();
      record('Pause retires matching live attempts before the exact native disable settles', 'pause', session, ok);
    },
    async beginReply(id, ok = true) {
      const a = attempts.get(id);
      assert.equal(a.phase, 'begin');
      if (ok) a.begin.resolve(); else a.begin.reject(beginError);
      await tick();
      record('Reservation settlement admits setup only if its private attempt is still live', 'beginReply', id, ok);
    },
    async configReply(id, ok = true) {
      const a = attempts.get(id);
      assert.equal(a.phase, 'config');
      if (ok) a.config.resolve({scope: 'synthetic', generation: 'synthetic'}); else a.config.reject(configureError);
      await a.done;
      record('Configuration settlement exposes success, refusal, abort or a terminal cancellation failure', 'configReply', id, ok);
    },
  });
  await Promise.all([...attempts.values()].map(a => a.done));
  return schedule;
}

async function checkHostedBackgroundAdmission(extraSources = []) {
  const sources = [driver, implementation, ...extraSources];
  captureSources(sources);
  const run = (name, drive, android = true) => scenario(name, android, drive);
  const traces = [
    await run('browser-returns-without-any-native-call', async f => {
      await f.start(1, 'A', true); await f.start(2, 'B'); await f.pause('all', false); await f.abort(2);
    }, false),
    await run('pre-aborted-android-attempt-never-reserves', async f => {await f.start(1, 'A', true);}),
    await run('same-input-attempts-still-have-distinct-reservations', async f => {
      await f.start(1, 'A'); await f.start(2, 'A'); await f.beginReply(2); await f.beginReply(1);
      await f.configReply(2); await f.configReply(1); await f.abort(1);
    }),
    await run('pause-only-retires-the-requested-session', async f => {
      await f.start(1, 'A'); await f.start(2, 'B'); await f.beginReply(1); await f.pause('A');
      await f.configReply(1); await f.beginReply(2); await f.configReply(2);
    }),
    await run('disable-refusal-does-not-undo-local-retirement', async f => {
      await f.start(1, 'A'); await f.start(2, 'B'); await f.beginReply(2); await f.pause('all', false);
      await f.pause('all'); await f.beginReply(1); await f.configReply(2, false);
    }),
    await run('abort-waits-for-a-held-reservation-to-reply', async f => {
      await f.start(1, 'A', false, 'first'); await f.abort(1); await f.beginReply(1);
    }),
    await run('refused-reservation-cancels-with-or-without-retirement', async f => {
      await f.start(1, 'A'); await f.start(2, 'B'); await f.abort(2);
      await f.beginReply(1, false); await f.beginReply(2, false);
    }),
    await run('terminal-cancel-refusal-remains-visible', async f => {
      await f.start(1, 'A', false, 'all'); await f.beginReply(1); await f.abort(1); await f.configReply(1, false);
      await f.start(2, 'B', false, 'first'); await f.beginReply(2, false);
    }),
    await run('live-configuration-refusal-returns-false-after-cancellation', async f => {
      await f.start(1, 'A'); await f.beginReply(1); await f.configReply(1, false);
    }),
  ];
  return checkTraces(boundInputs({model, traces, sources, scope: 'bounded-orchestration', assumptions: [
    'The actual renderer module executes with TypeScript annotations stripped. The native bridge, platform flag and UUID source are controlled; the private and external AbortSignal lifecycles are observed.',
    'Two attempts, two sessions and immediate controlled cancellation replies. This campaign holds reservation and configuration replies, and coalesces the microtasks between sequential cancellation attempts.',
    'Native durable reservation, worker execution and renderer inbox history have separate observation boundaries.',
  ]}));
}

test('renderer hosted background setup and pause preserve exact attempt and session authority', {timeout: 120000}, async () => {
  const receipt = await checkHostedBackgroundAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 9);
  assert.deepEqual(Object.keys(receipt.actions).sort(), ['abort', 'beginReply', 'configReply', 'pause', 'start']);
  assert.deepEqual(receipt.observedFields, ['s.android', 's.attempts', 's.disables', 's.pauseOutcome', 's.target']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
