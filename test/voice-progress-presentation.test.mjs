import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

test('accepted voice progress is ephemeral, clears with SDK state and cannot return after Stop or session retirement', async t => {
  const f = cloudVoiceViewFixture({native: false, platform: 'web'});
  t.after(() => f.close());
  f.box.testMocksEnabled = true; // Closed test ports; this does not change application build flags.
  f.box.developmentCartesiaVoiceEnabled = true;
  f.box.React = {createElement: () => null};
  f.box.VoiceActivity = () => null;
  const sessions = [];
  f.box.developmentCartesiaConversation = async options => {
    sessions.push(options);
    return {async start() { options.assertCurrent(); options.onState('listening', ''); }, async stop() {}, recheck() {}, microphoneMuted: false, microphoneAutomaticallyMuted: false, setMicrophoneMuted() {}};
  };
  const messagesBefore = JSON.stringify(f.shell.state.msgs);
  await f.shell.startVoice();
  const first = sessions[0];
  first.onState('thinking', 'Creating that now.');
  // The label shimmers on the transcript line above the composer; the composer keeps the phase.
  assert.equal(f.shell.renderVals().turnStatus, 'Creating that now.');
  assert.equal(f.renderChat().lines[0].t, 'Thinking…');
  assert.notEqual(f.renderChat().statusClass, 'alpha-turn-status');
  assert.equal(f.shell.renderVals().pillVoice?.progressText || '', '');
  first.onState('speaking', 'Creating that now.');
  assert.equal(f.shell.renderVals().turnStatus, 'Creating that now.');
  assert.equal(f.renderChat().lines[0].t, 'Speaking…');
  assert.equal(JSON.stringify(f.shell.state.msgs), messagesBefore, 'progress is never saved as a message');
  assert.equal(f.sends, 0, 'displaying progress must not send another turn');
  assert.equal(f.cloudSpeech, 0, 'the server owns progress TTS');
  assert.equal(f.localSpeech, 0, 'the client must not speak a duplicate acknowledgement');

  // SDK accepted-state clears include local barge-in, a new STT turn and playback completion.
  first.onState('thinking', '');
  assert.equal(f.renderChat().progressText || '', '');
  first.onState('listening', 'A label outside the accepted display phase');
  assert.equal(f.renderChat().progressText || '', '');
  first.onState('listening', '');
  assert.equal(f.renderChat().progressText || '', '');
  assert.equal(f.renderChat().statusClass, 'alpha-voice-status-hidden');
  first.onState('thinking', 'Checking that.');
  first.onError(Error('Synthetic voice failure'));
  assert.equal(f.renderChat().progressText || '', '');
  assert.doesNotMatch(f.renderChat().lines[0].t, /Checking that/);

  f.renderChat().stop();
  for (let i = 0; i < 8; i++) await f.tick();
  await f.shell.startVoice();
  assert.equal(sessions.length, 2);
  first.onState('thinking', 'Obsolete session label');
  assert.equal(f.renderChat().progressText || '', '');
  assert.doesNotMatch(JSON.stringify(f.renderChat()), /Obsolete session label/);
  sessions[1].onState('thinking', 'Current session label');
  assert.equal(f.shell.renderVals().turnStatus, 'Current session label');
});
