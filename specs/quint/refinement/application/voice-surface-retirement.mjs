import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deferred} from '../../../../test/fixtures/wait-for.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';
import {checkTraces} from '../check-traces.mjs';

const voiceView = new URL('../../../../test/fixtures/cloud-voice-view.mjs', import.meta.url);
const batchVoice = new URL('../../../../test/fixtures/shared-batch-voice.mjs', import.meta.url);
const call = (name, ...args) => ({name, args});

const schedules = [
  {name: 'restore-original'},
  {name: 'preserve-current', policy: 'preserve', refuseWhileStopping: true},
  {name: 'keyboard-from-sheet', policy: 'keyboard', startPanel: 'sheet'},
  {name: 'keyboard-from-full', policy: 'keyboard', startPanel: 'full'},
  {name: 'new-detent', changePanel: true},
  {name: 'new-binding', changeBinding: true},
  {name: 'same-binding-restored', changeBinding: true, restoreBinding: true},
  {name: 'dismiss-unconfirmed', fails: true},
  {name: 'close-ready-dictation', idle: true},
];

async function replay(scenario, cloudVoiceViewFixture, voiceFakeClock) {
  const clock = voiceFakeClock();
  const f = cloudVoiceViewFixture({cloudProfile: !scenario.idle, clock});
  const {shell} = f;
  f.box.React = {createElement: () => null};
  f.box.VoiceActivity = () => null;
  f.box.HTMLElement = class {};
  f.box.nativeLiveVoiceReady = async () => false;
  if (scenario.idle) f.box.createOnDeviceVoice = () => ({ready: async () => false});
  shell.setState({chat: 'input'});

  // Every cancel reaches the same held synthetic native boundary. The real
  // conversation and cleanup chain still own cancellation, including rechecks.
  const stopGate = deferred();
  const cancelRecording = f.driver.cancelRecording.bind(f.driver);
  let cancelAttempts = 0;
  f.driver.cancelRecording = async () => {
    cancelAttempts++;
    await stopGate.promise;
    return cancelRecording();
  };
  const observe = () => {
    const recorder = f.renderChat();
    const retirement = recorder?.state === 'stopping' ? 'stopping'
      : recorder?.state === 'error' && recorder.lines[0].t === f.box.MEDIA_UNCONFIRMED_NOTICE ? 'error' : 'none';
    return {
      's.surface': !recorder || retirement !== 'none' ? 'closed'
        : recorder.regionLabel === 'Voice transcription' ? 'dictation' : 'conversation',
      's.retirement': retirement,
      's.panel': shell.S().chat,
    };
  };
  const trace = {name: scenario.name, expect: observe(), steps: []};
  const record = (label, action) => trace.steps.push({label, action, expect: observe()});

  try {
    if (scenario.startPanel) {
      shell.setState({chat: scenario.startPanel});
      record('Shell starts at the specified shown detent', call('panelChanged', scenario.startPanel));
    }
    if (scenario.idle) {
      shell.startTranscription();
      await clock.flush();
      assert.equal(f.renderChat().state, 'ready');
      assert.equal(f.starts, 0);
      record('Unstarted dictation presents its sheet', call('startVoice', true));
      f.renderChat().discard();
      await clock.flush();
      assert.equal(shell.stopVoiceConversation(), undefined, 'No media means no retirement promise');
      assert.equal(cancelAttempts, 0);
      record('Discard from ready directly restores input', call('leave'));
      return trace;
    }

    await shell.startVoice();
    await clock.flush();
    assert.equal(f.renderChat().state, 'listening');
    assert.ok(f.activeRecording, 'Actual batch voice owns a synthetic capture');
    record('Voice is shown at its admitted detent', [call('startVoice', false), call('mediaStarts')]);

    let requestedStop;
    if (scenario.policy === 'preserve') requestedStop = shell.stopVoiceConversation();
    else if (scenario.policy === 'keyboard') f.renderChat().keyboard();
    else shell.renderVals().closeChat();
    await clock.flush();
    assert.ok(cancelAttempts > 0, 'Actual cleanup reaches the held native boundary');
    assert.ok(f.activeRecording, 'Capture remains held until the native response');
    const chain = shell.stopVoiceConversation();
    assert.ok(chain);
    if (requestedStop) assert.equal(chain, requestedStop, 'Both reads name the same retirement promise');
    let settled = false;
    const result = chain.then(() => {settled = true; return true;}, () => {settled = true; return false;});
    await clock.flush();
    assert.equal(settled, false);
    record('Closing leaves the shown detent on a held stop', scenario.policy ? call('cancelChat', scenario.policy) : call('leave'));

    if (scenario.refuseWhileStopping) {
      const starts = f.starts;
      await shell.startVoice();
      assert.equal(f.starts, starts, 'A new start cannot cross the held stop');
      record('Start is refused during held retirement', call('startVoice', false));
    }
    if (scenario.changePanel) {
      shell.setState({chat: 'full'});
      record('User selected a different panel while stopping', call('panelChanged', 'full'));
    }
    if (scenario.changeBinding) {
      const original = f.credential;
      f.credential = 'different-synthetic-credential';
      record('The current binding overtook the held return', call('panelBindingChanged', false));
      if (scenario.restoreBinding) {
        f.credential = original;
        record('The exact binding is current again before settlement', call('panelBindingChanged', true));
      }
    }
    if (scenario.fails) f.captureCancelError = Error('Synthetic recording cancellation was unconfirmed');
    stopGate.resolve();
    assert.equal(await result, !scenario.fails, 'Exact cleanup result controls retirement');
    await clock.flush();
    if (!scenario.fails) assert.equal(f.activeRecording, null);
    record('Controlled native cancellation settles', call('stoppingSettles', !scenario.fails, false));

    if (scenario.fails) {
      shell.setState({chat: 'full'});
      record('User changed the detent after stop failed', call('panelChanged', 'full'));
      shell.back();
      await clock.flush();
      assert.equal(shell.messages.at(-1), f.box.MEDIA_UNCONFIRMED_NOTICE);
      record('Back explicitly returns to the stored detent', call('dismissError'));
      const starts = f.starts;
      await shell.startVoice();
      assert.equal(f.starts, starts, 'Putting away the error does not admit another microphone');
      assert.equal(shell.messages.at(-1), f.box.MEDIA_UNCONFIRMED_NOTICE);
      record('The process still refuses another capture', call('startVoice', false));
    }
    return trace;
  } finally {
    stopGate.resolve();
    f.close();
    await clock.flush();
  }
}

export async function checkVoiceSurfaceRetirement(owner) {
  const sources = ['apps/app/src/prototype/voice-adapter.ts', fileURLToPath(voiceView), fileURLToPath(batchVoice),
    fileURLToPath(import.meta.url), owner];
  const driverHashes = captureReplayClosure(sources);
  const {cloudVoiceViewFixture} = await import(voiceView.href);
  const {voiceFakeClock} = await import(batchVoice.href);
  const traces = [];
  for (const scenario of schedules) traces.push(await replay(scenario, cloudVoiceViewFixture, voiceFakeClock));
  return checkTraces({
    model: 'VoiceSurfaceRetirement', id: 'VoiceSurfaceRetirement-shown-panel', traces,
    sources, driverHashes, scope: 'bounded-component',
    assumptions: [
      'The installed whole voice adapter and the prepared batch voice implementation run with controlled shell states, clock, native microphone replies, and connection fields.',
      'Readback covers the shown input, sheet and full detents and the actual retirement control state. A controlled binding change is read by cleanup before attempting restoration.',
      'The fixture makes no actual recording or service calls. It exercises stopVoiceConversation at the voice boundary; typed agent dispatch and hidden Home pill presentation are separate.',
    ],
  });
}
