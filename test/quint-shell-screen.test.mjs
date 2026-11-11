import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {shellCore} from '../specs/quint/refinement/application/shell-core-fixture.mjs';

// ShellScreen traces from the simulator, replayed on the reference shell's own methods
// (runBoot, unlock, power, the lock-screen camera entry, openView, goHome, scripted voice) with
// held timers. The simulated phone frame is the host: Android's Keyguard owns the secure camera
// on a device.
const BOOT = 3400, TYPE = 45, THINK = 450, SPEAK = 1500, END = 4300;

test('simulated ShellScreen traces agree with the reference shell after every step', {timeout: 120000}, async () => {
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
          else if (action === 'lockCamera') shell.lockCamera();
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
  assert.deepEqual([...result.exercised].sort(), ['armViewTimer', 'bootTick', 'goHome', 'lockCamera', 'openKept', 'openView',
    'power', 'startVoice', 'stopVoice', 'unlock', 'voiceAdvance']);
});

test('Back\'s stack pop is held to the secure session like a kept reopen', () => {
  const core = shellCore({views: {camera: {}, photos: {}, notes: {}}});
  const shell = new core.Shell({nativeSystemChrome: false});
  shell.setState({screen: 'lock'});
  shell.lockCamera();
  shell.openView('notes', null, null, {restore: true, keepStack: true});
  assert.deepEqual([shell.S().screen, shell.S().view, shell.S().secure], ['lock', null, false]);
  assert.deepEqual([...shell.toasts], ['Unlock to continue']);
});
