// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {shellCore} from '../specs/quint/refinement/application/shell-core-fixture.mjs';

// ShadePull traces from the simulator, replayed on the shell's pull entry (openSystemShade) with
// installSystemShade from source over the pinned shared shade policy. Android's answer and the
// bounded wait are the environment: the plugin call settles, or the wait's timer runs, when the
// model says so. What Android does with a request is device evidence.
const bundled = await build({entryPoints: [resolve('apps/app/src/prototype/system-shade.ts')], bundle: true, format: 'esm',
  platform: 'node', write: false, plugins: [{name: 'ports', setup(b) {
    b.onResolve({filter: /^@elizaos\/capacitor-system\/shade$/}, () => ({path: resolve('.eliza/client-features/plugins/plugin-native-system/src/client/shade.ts')}));
    b.onResolve({filter: /^\.\.\/platform-plugins$/}, a => ({path: a.path, namespace: 'stub'}));
    b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export function registerPlugin(){return globalThis.alphaShadeDevice;}', loader: 'js'}));
  }}]});
let ask = () => assert.fail('no shade request expected');
globalThis.alphaShadeDevice = {openNotificationShade: () => ask()};
const {installSystemShade, shadeFallback, SHADE_REQUEST_TIMEOUT} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const capped = count => Math.min(count, 3);

function fixture(surface, timers) {
  const touch = new Set(), pending = [];
  let requests = 0;
  globalThis.document = {querySelector: () => null, addEventListener: (type, listener) => { if (type.startsWith('touch')) touch.add(listener); },
    removeEventListener: (_type, listener) => touch.delete(listener)};
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  ask = () => { requests++; return new Promise(settle => pending.push({settle, late: false})); };
  const core = shellCore({views: {camera: {}}, globals: {shadeFallback}});
  installSystemShade(core.Shell, {native: surface === 'android'});
  const shell = new core.Shell({systemShade: surface, systemShell: true});
  shell.preset('home');
  shell.live = true;
  shell.componentDidMount();
  const waiting = () => pending.find(request => !request.late);
  return {
    async apply({action, picks}, before) {
      // The camera opens inside a lock-screen session too, so Home is left the same way in both.
      if (action === 'leaveHome') shell.openView('camera');
      // goHome ends a lock-screen session on the lock screen; the model lets Home show under one.
      else if (action === 'showHome') { if (before.secure) shell.setState({view: null, stack: []}); else shell.goHome(); }
      else if (action === 'secureHome') shell.setState({secure: picks.flag});
      else if (action === 'unmount') { shell.live = false; shell.componentWillUnmount(); }
      // The model stops counting at three requests; a fourth is outside it.
      else if (action === 'pull') { if (before.surface !== 'android' || before.secure || before.asking || before.requests < 3) void shell.openSystemShade(); }
      else if (action === 'closeStandIn') shell.back();
      else if (action === 'answer') pending.splice(pending.indexOf(waiting()), 1)[0].settle({status: picks.flag ? 'opened' : 'unsupported'});
      else if (action === 'waitEnds') { waiting().late = true; await tick(); timers.tick(SHADE_REQUEST_TIMEOUT); }
      else if (action === 'lateAnswer') pending.splice(pending.findIndex(request => request.late), 1)[0].settle({status: 'opened'});
      else assert.fail(`unmapped action ${action}`);
      await tick();
    },
    observe: () => ({listening: touch.size > 0, asking: !!shell.alphaShadeAsking, standIn: shell.live && !!shell.S().shade, requests,
      fallbacks: capped(shell.toasts.length), unanswered: pending.length}),
  };
}

test("partial source contract: simulated ShadePull traces agree with the shell pull and the Android request after every step", {timeout: scaledTimeout(120000)}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const traces = modelTraces({module: 'ShadePull', traces: 120, steps: 30});
  const result = await replay(traces, {
    start: ({state}) => fixture(state.surface, t.mock.timers),
    project: s => ({listening: s.listening, asking: s.asking, standIn: s.standIn, requests: s.requests, fallbacks: s.fallbacks,
      unanswered: s.late + (s.waiting ? 1 : 0)}),
  });
  assert.deepEqual([...result.exercised].sort(),
    ['answer', 'closeStandIn', 'lateAnswer', 'leaveHome', 'pull', 'secureHome', 'showHome', 'unmount', 'waitEnds']);
});

test("partial source contract: an answer that arrives after the shell unmounted shows no fallback and arms no toast timer", async () => {
  let settle;
  globalThis.document = {querySelector: () => null, addEventListener() {}, removeEventListener() {}};
  ask = () => new Promise(resolve => { settle = resolve; });
  const core = shellCore({views: {camera: {}}, globals: {shadeFallback}});
  installSystemShade(core.Shell, {native: true});
  const shell = new core.Shell({systemShade: 'android', systemShell: true});
  shell.preset('home'); shell.live = true; shell.componentDidMount();
  void shell.openSystemShade();
  await tick();
  shell.live = false; shell.componentWillUnmount();
  settle({status: 'unsupported'});
  await tick();
  assert.equal(shell.alphaShadeAsking, false);
  assert.deepEqual([...shell.toasts], []);
  assert.deepEqual(core.armed(shell), []);
});
