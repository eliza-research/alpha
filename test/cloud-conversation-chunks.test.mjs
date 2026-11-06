import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceFakeClock } from './fixtures/shared-batch-voice.mjs';
import { cloudVoiceViewFixture } from './fixtures/cloud-voice-view.mjs';

const first = 'Your requested information is ready.';
const reply = first + ' The rest of this answer contains the details you asked for.'.repeat(8);

async function start(f, clock) {
  f.box.React = { createElement: () => null }; f.box.VoiceActivity = () => null;
  await f.shell.startVoice(); await clock.flush();
  await clock.advance(700); f.peak = 0; await clock.advance(1200);
}

test('Cloud conversation waits for the validated reply, then speaks a short first piece before the rest', async () => {
  const clock = voiceFakeClock(), f = cloudVoiceViewFixture({cloudProfile: true, clock, peak: 0.5, holdReply: true, holdPlayback: true, badReply: {text: reply}});
  try {
    await start(f, clock);
    assert.equal(f.sends, 1); assert.equal(f.cloudSpeech, 0, 'no speculative audio before the final reply');
    f.releaseReply(); await clock.flush();
    assert.equal(f.cloudSpeech, 1); assert.equal(f.speechInputs[0].text, first);
    assert.ok(f.activePlayback);
    f.finishPlayback(); await clock.flush();
    assert.equal(f.cloudSpeech, 2);
    assert.equal(f.speechInputs.map(input => input.text).join(' '), reply);
    f.finishPlayback(); await clock.flush();
    assert.equal(f.sends, 1, 'chunking never resends the user turn');
  } finally { f.close(); await clock.flush(); }
});

test('Stop between Cloud reply pieces retires playback without requesting the remaining text', async () => {
  const clock = voiceFakeClock(), f = cloudVoiceViewFixture({cloudProfile: true, clock, peak: 0.5, holdPlayback: true, badReply: {text: reply}});
  try {
    await start(f, clock);
    assert.equal(f.cloudSpeech, 1); assert.equal(f.speechInputs[0].text, first);
    const pending = f.shell.stopVoiceConversation(); await clock.flush(); await pending;
    assert.equal(f.cloudSpeech, 1); assert.equal(f.activePlayback, null);
  } finally { f.close(); await clock.flush(); }
});
