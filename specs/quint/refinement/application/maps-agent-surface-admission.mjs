/** Replays MapsAgentSurfaceAdmission model traces against the Maps adapter's agent surface.
 *
 * What runs: the `present` check installPrototypeMapsAdapter hands the shared screen's
 * navigation surface, with the shared screen and controller behind it (see
 * maps-adapter-harness.mjs). The shell is a controlled port: its launcher state, liveness,
 * suspension and assistant flag are set by the trace, `openView` and the `setState` callbacks
 * are recorded, and a commit applies a recorded open and runs the callbacks, rendering Maps as
 * the shell does when Maps comes to the front or asks to be drawn again. The connection sheet
 * and page visibility are ports; the time limit is the timer the check sets, fired by the trace.
 *
 * Observation: each request's promise (pending, yes or no) and whether the shell was asked to
 * open Maps during it; every open and every yes with the view in front and whether anything
 * blocked Maps at that moment; the view, the open not yet committed and the blocks are the
 * shell port's own state. `lateOpens` counts commits that applied an open with no request
 * waiting. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces} from '../services/maps-model-traces.mjs';
import {bundleMapsAdapter, mountMapsAdapter, tick, providerId, connectionId, providerConfig} from './maps-adapter-harness.mjs';

const model = {path: 'specs/quint/application/MapsAgentSurfaceAdmission.qnt', module: 'MapsAgentSurfaceAdmission'};
const realView = {home: 'home', maps: 'maps', other: 'notes'};

async function driver(code) {
  const provider = {providerId, connectionId, async search() { return []; }, async detail() { return null; }, async route() { throw Error('No route in this fixture.'); }};
  let m;
  m = await mountMapsAdapter(code, {view: 'home', configure: app => app.configureMapsProvider(providerConfig, provider),
    onSet(patch) { if ('nativeMapsRevision' in patch && m.shellState.view === 'maps') m.render(); }});
  const {harness, shell, shellState} = m;
  const blocks = new Set(), requests = [], opens = [], admissions = new Set();
  let pendingOpen = false, disposed = false, lateOpens = 0, opening = null;
  const blocked = () => disposed || blocks.size > 0;
  const view = () => Object.keys(realView).find(key => realView[key] === shellState.view);
  const look = () => ({view: view(), blocked: blocked()});
  shell.openView = target => { assert.equal(target, 'maps'); assert.ok(opening, 'Maps is opened only for a request'); opening.opened = true; opens.push(look()); pendingOpen = true; };
  const apply = {
    system: on => { shellState.screen = on ? 'lock' : 'home'; }, secure: on => { shellState.secure = on; }, shade: on => { shellState.shade = on; },
    suspended: on => { shell.pageSuspended = on; }, assistant: on => { shell.props = {assistantSurface: on}; },
    sheet: on => { harness.connection.snapshot = {...harness.connection.snapshot, open: on}; },
    hidden: on => { m.visibility(on); }, dead: on => { shell.live = !on; },
  };
  const settle = async () => {
    await tick();
    for (const request of requests) if (request.phase === 'admitted' && !request.noted) {
      request.noted = true; admissions.add(JSON.stringify(look()));
      assert.ok(harness.surface.snapshot(), 'an admitted request finds the Maps state');
    }
  };
  return {
    async setBlock(name, on) { if (on) blocks.add(name); else blocks.delete(name); apply[name](on); await settle(); },
    async go(target) {
      if (shellState.view === 'maps' && target !== 'maps') m.mapsModule.onLeave?.();
      const entering = shellState.view !== 'maps' && target === 'maps';
      shellState.view = realView[target]; pendingOpen = false;
      if (entering) m.render();
      await settle();
    },
    async request() {
      const request = {phase: 'waiting', opened: false, timer: null, noted: false}, timers = [], setTimer = globalThis.setTimeout;
      requests.push(request); opening = request;
      globalThis.setTimeout = (run, delay) => { assert.equal(delay, 2000); timers.push(run); return 0; };
      try { void harness.surface.present().then(yes => { request.phase = yes ? 'admitted' : 'refused'; }); } finally { globalThis.setTimeout = setTimer; opening = null; }
      assert.equal(timers.length, request.opened ? 1 : 0, 'a time limit is set exactly when Maps was opened');
      request.timer = timers[0] ?? null;
      await settle();
    },
    async commit() {
      const waiting = requests.some(request => request.phase === 'waiting');
      if (pendingOpen) { if (!waiting) lateOpens++; shellState.view = 'maps'; pendingOpen = false; m.render(); }
      for (const done of shell.commits.splice(0)) done();
      await settle();
    },
    async timeout(id) { requests[id - 1].timer(); await settle(); },
    async dispose() { m.stop(); disposed = true; await settle(); },
    observe() {
      const phases = [1, 2, 3].map(id => [id, requests[id - 1] ? {phase: requests[id - 1].phase, opened: requests[id - 1].opened} : {phase: 'idle', opened: false}]);
      return {view: view(), pendingOpen, blocks: [...blocks].sort(), disposed, requests: Object.fromEntries(phases), begun: requests.length,
        opens: opens.map(open => ({...open})), admissions: [...admissions].sort().map(item => JSON.parse(item)), lateOpens};
    },
    close() { if (disposed) { delete globalThis.mapsHarness; } else m.restore(); },
  };
}

const project = state => ({...state, admissions: state.admissions.map(item => JSON.stringify({view: item.view, blocked: item.blocked})).sort().map(item => JSON.parse(item))});

export async function replayMapsAgentSurfaceAdmission({scenarios, witnesses, random = 80, steps = 40}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const code = await bundleMapsAdapter();
  return replayTraces(traces, () => driver(code), {project});
}
