import test from 'node:test';
import assert from 'node:assert/strict';
import { runJvm, upstreamVoiceFixture, upstreamVoiceSource } from './fixtures/jvm-tools.mjs';

test('bounded PCM queue, streamed writer, cancellation, focus policy and chunk validation (host JVM)', () => {
  const sources = ['VoiceLatencyTrials.java', 'SpeechPcmQueue.java', 'StreamingSpeechPlayback.java', 'SpeechAudioFocusPolicy.java', 'SpeechStreamValidation.java'].map(upstreamVoiceSource);
  assert.match(runJvm([...sources, upstreamVoiceFixture('StreamingSpeechTest.java')], 'ai.eliza.voice.StreamingSpeechTest'), /^PASS streaming speech/);
});
