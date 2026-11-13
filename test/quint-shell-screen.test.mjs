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
import {readFileSync} from 'node:fs';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {shellCore} from '../specs/quint/refinement/application/shell-core-fixture.mjs';

// ShellScreen traces from the simulator, replayed on the reference shell's own methods
// (runBoot, unlock, power, openView, goHome, scripted voice) with held timers. The lock frame
// offers Unlock and no Camera entry; refusal steps check that absence without fabricating a
// source handler or injecting a secure session. Android owns Keyguard on a device.
const BOOT = 3400, TYPE = 45, THINK = 450, SPEAK = 1500, END = 4300;
const model = readFileSync('apps/app/src/prototype/model.js', 'utf8');
const template = readFileSync('apps/app/src/prototype/template.html', 'utf8');
const development = readFileSync('apps/app/src/prototype/development-system-surfaces.html', 'utf8');
const lockFrame = development.slice(0, development.indexOf('<sc-if value="{{isOff}}">'));
function assertNoLockCameraEntry(source = model, page = template, locked = lockFrame) {
  assert.doesNotMatch(source, /lockCamera(?:Offered)?:/, 'no renderer Camera entry behind Keyguard');
  assert.doesNotMatch(page, /onClick="\{\{lockCamera\}\}"/, 'no product Camera shortcut on the lock frame');
  assert.match(locked, /onClick="\{\{unlock\}\}"/, 'the development lock frame offers Unlock');
  assert.doesNotMatch(locked, /camera|photos|library/i, 'the development lock frame exposes no Camera or library route');
}
function tryLockedCamera(shell) {
  const before = structuredClone(shell.S());
  assert.equal(before.screen, 'lock');
  assertNoLockCameraEntry();
  assert.equal(typeof shell.lockCamera, 'undefined');
  assert.deepEqual(structuredClone(shell.S()), before, 'an absent locked control dispatches nothing');
}

test("partial source contract: simulated ShellScreen traces agree with the reference shell after every step", {timeout: scaledTimeout(120000)}, async () => {
  const traces = modelTraces({module: 'ShellScreen', traces: 120, steps: 30});
  const result = await replay(traces, {
    start() {
      const core = shellCore({views: {camera: {}, photos: {}, notes: {chat: 'input'}}});
      const shell = new core.Shell({nativeSystemChrome: false, systemShade: 'none', initial: 'boot'});
      shell.preset('boot');
      return {
        apply({action, picks}, before) {
          if (action === 'bootTick') core.fire(BOOT);
          else if (action === 'unlock') shell.unlock();
          else if (action === 'power') shell.power();
          else if (action === 'tryLockedCamera') tryLockedCamera(shell);
          else if (action === 'openView') shell.openView(picks.view);
          else if (action === 'openKept') shell.openView(picks.view, {keepState: true});
          else if (action === 'goHome') shell.goHome();
          else if (action === 'armViewTimer') shell.api(before.view).later(() => {}, 1000);
          else if (action === 'startVoice') shell.startVoice();
          else if (action === 'stopVoice') shell.stopVoice();
          else if (action === 'voiceAdvance') {
            // The phrase is typed out, then each stage has its own timer.
            if (before.voice === 'listening') { while (core.pending(TYPE, 'interval')) core.fire(TYPE, 'interval'); core.fire(THINK); }
            else if (before.voice === 'thinking') core.fire(SPEAK);
            else core.fire(END);
          } else assert.fail(`unmapped action ${action}`);
        },
        observe() {
          const S = shell.S(), armed = core.armed(shell);
          const viewTimers = armed.filter(group => group.startsWith('m_')).map(group => group.slice(2));
          assert.ok(viewTimers.length <= 1, 'one view owns view timers');
          return {screen: S.screen, bootPending: core.pending(BOOT), view: S.view || '', viewTimers: viewTimers[0] || '',
            secure: !!S.secure, voice: S.voice, voiceTimers: armed.includes('v') || core.pending(TYPE, 'interval')};
        },
      };
    },
    project: s => ({screen: s.screen, bootPending: s.bootPending, view: s.view, viewTimers: s.viewTimers, secure: s.secure,
      voice: s.voice, voiceTimers: s.voiceTimers}),
  });
  assert.deepEqual([...result.exercised].sort(), ['armViewTimer', 'bootTick', 'goHome', 'openKept', 'openView',
    'power', 'startVoice', 'stopVoice', 'tryLockedCamera', 'unlock', 'voiceAdvance']);
});

test("partial source contract: the locked frame refuses Camera, then Unlock permits Camera and kept app navigation", () => {
  const core = shellCore({views: {camera: {}, photos: {}, notes: {}}});
  const shell = new core.Shell({nativeSystemChrome: false});
  shell.setState({screen: 'lock'});
  tryLockedCamera(shell);
  assert.deepEqual([shell.S().screen, shell.S().view, shell.S().secure], ['lock', null, false]);
  shell.unlock();
  shell.openView('camera');
  assert.deepEqual([shell.S().screen, shell.S().view, shell.S().secure], ['home', 'camera', false]);
  shell.openView('notes', null, null, {restore: true, keepStack: true});
  assert.deepEqual([shell.S().screen, shell.S().view, shell.S().secure], ['home', 'notes', false]);
  assert.deepEqual([...shell.toasts], []);
});

test("partial source contract: lock-entry negative canaries reject a restored handler, product shortcut or development Camera control", () => {
  assertNoLockCameraEntry();
  assert.throws(() => assertNoLockCameraEntry(model + '\nlockCamera: function () {}'), /no renderer Camera entry/);
  assert.throws(() => assertNoLockCameraEntry(model, template + '\n<button onClick="{{lockCamera}}">Camera</button>'), /no product Camera shortcut/);
  assert.throws(() => assertNoLockCameraEntry(model, template, lockFrame + '\n<button>Camera</button>'), /no Camera or library route/);
});
