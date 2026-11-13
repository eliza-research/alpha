import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames, modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {build} from 'esbuild';

/** Replays ResidentMapsRelayOffer model traces against the resident turn's navigation relay.
 *
 * What runs: withResidentMapsNavigation of apps/app/src/maps/resident-relay.ts with the shared
 * relay loop and navigation port it binds. The resident request and the turn's send are
 * controlled ports: the opening request, each poll and the send stay pending until the trace
 * settles them, a poll ends when its signal is aborted, and retirement is answered at once.
 *
 * Observation: `navigation` and `relay` are read from the navigation port, with bindings numbered
 * in the order they were registered. A turn is opening while its opening request is unanswered,
 * plain when its message was sent with no offer or after the offer was retired, connected when
 * its message was sent with the offer still open, and done when its promise settled; it is
 * receiving while a poll is pending. The offer latch itself (`activeOffer`, `lastAccepted`) is module-private
 * and is compared only through the flag it controls. */

const model = {path: 'specs/quint/services/ResidentMapsRelayOffer.qnt', module: 'ResidentMapsRelayOffer'};
// A scenario action that describes behaviour the code does not have; a trace ends before it.
const counterfactual = new Set(['unlatchedEnd']);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

async function load() {
  const result = await build({
    absWorkingDir: repositoryRoot, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
    stdin: {resolveDir: repositoryRoot, loader: 'ts', contents: `
      export {withResidentMapsNavigation} from './apps/app/src/maps/resident-relay.ts';
      export {residentMapsNavigationPort} from './apps/app/src/maps/agent-navigation.ts';`},
  });
  return result.outputFiles[0].text;
}

let loads = 0;
async function driver(code) {
  // A fresh evaluation per trace: the offer latch and the port are module state.
  const app = await import('data:text/javascript;base64,' + Buffer.from(code + `\n//${++loads}`).toString('base64'));
  const port = app.residentMapsNavigationPort, turns = [], bindings = new WeakMap();
  let registrations = 0;
  const binding = () => port.current ? bindings.get(port.current) : 0;
  const turn = id => { const value = turns[id - 1]; assert.ok(value, `turn ${id} has begun`); return value; };
  return {
    setNavigation(flag) {
      const next = flag ? {select() {}, start() {}, reroute() {}, stop() {}} : null;
      if (next) bindings.set(next, ++registrations);
      port.register(next);
    },
    async beginTurn(resident) {
      const state = {open: null, poll: null, offered: false, retiredEarly: false, sent: false, done: false, navigation: binding(), send: deferred(), refusal: turns.length % 2 ? 'error' : 'protocol'};
      turns.push(state);
      const request = (path, body, signal) => {
        assert.equal(path, '/api/client-devices/maps-navigation');
        assert.equal(body.conversationId, 'conversation-' + (turns.indexOf(state) + 1));
        if (body.phase === 'open') { state.offered = true; return (state.open = deferred()).promise; }
        if (body.phase === 'retire') { if (!state.sent) state.retiredEarly = true; return Promise.resolve({}); }
        assert.equal(body.phase, 'poll');
        const poll = state.poll = deferred();
        signal.addEventListener('abort', () => { if (state.poll === poll) state.poll = null; poll.reject(Error('The poll was aborted.')); });
        return poll.promise;
      };
      void app.withResidentMapsNavigation(resident ? request : undefined, 'conversation-' + turns.length, new AbortController().signal,
        () => { state.sent = true; return state.send.promise; }).then(reply => { assert.equal(reply, 'reply'); state.done = true; });
      await tick();
    },
    async openSettles(id, accepted) {
      const state = turn(id), open = state.open;
      assert.ok(open, `turn ${id} has an opening request`);
      state.open = null;
      if (accepted) open.resolve({protocol: 1, request: null});
      else if (state.refusal === 'error') open.reject(Error('The host refused the offer.'));
      else open.resolve({protocol: 2, request: null});
      await tick();
    },
    async receivingFails(id) {
      const state = turn(id), poll = state.poll;
      assert.ok(poll, `turn ${id} has a pending poll`);
      state.poll = null; poll.reject(Error('The poll was lost.'));
      await tick();
    },
    async endTurn(id) { turn(id).send.resolve('reply'); await tick(); },
    observe() {
      const phases = [1, 2, 3].map(id => {
        const state = turns[id - 1];
        return [id, !state ? {phase: 'idle', receiving: false, navigation: 0}
          : {phase: state.done ? 'done' : !state.sent ? 'opening' : state.offered && !state.retiredEarly ? 'connected' : 'plain',
            receiving: !!state.poll, navigation: state.navigation}];
      });
      return {navigation: binding(), registrations, turns: Object.fromEntries(phases), begun: turns.length, relay: port.relay};
    },
  };
}

const project = state => ({navigation: state.navigation, registrations: state.registrations, turns: state.turns, begun: state.begun, relay: state.relay});

async function replayResidentMapsRelayOffer({scenarios, witnesses, random = 60, steps = 30}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps}).map(trace => {
    const end = trace.steps.findIndex(step => counterfactual.has(step.action));
    return end < 0 ? trace : {...trace, steps: trace.steps.slice(0, end)};
  });
  const code = await load();
  return replayTraces(traces, () => driver(code), {project});
}

test('the resident navigation relay follows every ResidentMapsRelayOffer model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/ResidentMapsRelayOffer.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 6);
  const result = await replayResidentMapsRelayOffer({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['setNavigation', 'beginTurn', 'openSettles', 'receivingFails', 'endTurn']) assert.ok(result.actions[action] > 0, action);
});
