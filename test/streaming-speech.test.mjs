import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runJvm, upstreamBridgeSource, upstreamVoiceFixture, upstreamVoiceSource } from './fixtures/jvm-tools.mjs';

// Issue #397 streamed on-device speech output. The queue, writer, focus policy and validated session
// backend are the shared ai.eliza.voice pipeline at the reviewed pin; Alpha runs its upstream host-JVM
// fixture and checks its own bridge wiring. Not AudioTrack, device playback or latency evidence.
// AlphaVoiceCloudPlugin subclasses the shared bridge, which owns the local speech wiring checked here.
const bridge = () => fs.readFileSync(upstreamBridgeSource('LocalSpeechBridgePlugin.java'), 'utf8');
const shared = name => fs.readFileSync(upstreamVoiceSource(name), 'utf8');
const strip = source => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

test('bounded PCM queue, streamed writer, cancellation, focus policy and chunk validation (host JVM)', () => {
  const sources = ['VoiceLatencyTrials.java', 'SpeechPcmQueue.java', 'StreamingSpeechPlayback.java', 'SpeechAudioFocusPolicy.java', 'SpeechStreamValidation.java'].map(upstreamVoiceSource);
  assert.match(runJvm([...sources, upstreamVoiceFixture('StreamingSpeechTest.java')], 'ai.eliza.voice.StreamingSpeechTest'), /^PASS streaming speech/);
});

test('local speech streams through AudioTrack when the engine supports it and falls back only when it does not', () => {
  const plugin = strip(bridge()), output = strip(shared('AudioTrackSpeechOutput.java')), paradee = strip(shared('SessionSpeech.java'));
  // One process-wide session owns speech output, recognition and VAD. The engine's backend is its own
  // client of that session: its cancel and release never fence or unload another consumer's calls.
  assert.match(plugin, /new LocalSpeechEngine\(\(\)->SessionSpeech\.shared\(getContext\(\)\)\)/);
  assert.doesNotMatch(plugin, /ElizaVoiceNative|openInference\(\)|new ParadeeVoice|new NativeAsr/);
  assert.match(paradee, /public void close\(\)\{if\(owned\)inference\.close\(\);else client\.release\(\);\}/);
  assert.match(paradee, /public void cancel\(\)\{client\.cancel\(\);\}/);
  assert.doesNotMatch(paradee, /inference\.(?:cancel|trimMemory|synthesize|transcribe|prepareSpeech|speechSampleRate)\(/);
  // Streaming is chosen by capability, never as an error fallback.
  assert.match(plugin, /if\(!engine\.supportsStreaming\(\)\)return false;streamLocal\(/);
  assert.match(plugin, /Boolean streamed=localEngine\.use\(/);
  assert.match(plugin, /if\(streamed\)return;/);
  assert.doesNotMatch(plugin.slice(plugin.indexOf('private void streamLocal('), plugin.indexOf('private static boolean settleRefusal(')), /File|createTempFile|FileOutputStream/, 'streamed audio is never written to storage');
  assert.match(paradee, /client\.synthesizeStream\(text,1f,/);
  assert.match(paradee, /return client\.supportsStreaming\(\);/);
  assert.match(paradee, /VoiceAssets\.sharedInference\(context\)/);
  assert.doesNotMatch(paradee, /\.open(?:Asr|Voice)\(/);
  assert.match(paradee, /prepare\(\)throws IOException\{client\.prepareSpeech\(\);\}/);
  assert.match(paradee, /speechLoaded\(\)\{return client\.isSpeechLoaded\(\);\}/);
  assert.match(plugin, /engine\.prepare\(\);return null;/);
  // AudioTrack MODE_STREAM, float mono, assistant speech attributes.
  assert.match(output, /setTransferMode\(AudioTrack\.MODE_STREAM\)/);
  assert.match(output, /ENCODING_PCM_FLOAT/);
  assert.match(output, /CHANNEL_OUT_MONO/);
  assert.match(strip(shared('SpeechAudioFocus.java')), /USAGE_ASSISTANT\)\.setContentType\(AudioAttributes\.CONTENT_TYPE_SPEECH\)/);
  // Bounded capacity, early publication and stop/barge-in semantics.
  assert.match(plugin, /STREAM_CAPACITY=LocalSpeechEngine\.STREAM_RATE\*30;/);
  assert.match(plugin, /if\(streamPlayback!=null\)\{streamPlayback\.stop\(\);streamPlayback=null;VoiceLatencyProbe\.TRIALS\.stopped\(playbackTrial\);\}/);
  assert.match(plugin, /private static boolean keepsEngine\(SpeechRequestGate\.Request request\)\{return request\.keepEngine&&request\.cancelled;\}/, 'a cancelled stream keeps the models loaded');
  assert.match(plugin, /if\(request\.resolvedEarly\)\{\}else if/);
});

test('speech holds transient duckable audio focus only while it plays and never starts during a call', () => {
  const plugin = strip(bridge()), focus = strip(shared('SpeechAudioFocus.java')), capture = strip(shared('LiveVoiceCapture.java'));
  assert.match(focus, /new AudioFocusRequest\.Builder\(AudioManager\.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK\)/);
  assert.match(focus, /abandonAudioFocusRequest\(request\)/);
  assert.match(focus, /addOnModeChangedListener\(executor,modeListener\)/);
  for (const constant of ['MODE_IN_CALL', 'MODE_IN_COMMUNICATION', 'MODE_RINGTONE']) assert.match(focus, new RegExp(`AudioManager\\.${constant}`));
  // Focus is requested before both streamed and MediaPlayer playback and released with the playback.
  assert.match(plugin, /private void playStream\(PluginCall call\)\{\n  String refusal=focus\.acquire\(\);/);
  assert.match(plugin, /String refusal=focus\.acquire\(\);if\(refusal!=null\)\{preparingPlayback=null;clearPlayback\(\);call\.reject\(refusalMessage\(refusal\),refusal\);return;\}p\.start\(\);/);
  assert.match(plugin, /if\(focus!=null\)focus\.release\(\);/);
  // Calls: synthesis, recording and live capture refuse with an honest code; a call stops speech and capture.
  assert.match(plugin, /if\(focus!=null&&focus\.callActive\(\)\)\{call\.reject\(CALL_MESSAGE,SpeechAudioFocusPolicy\.CALL_ACTIVE\);return;\}/);
  assert.match(plugin, /Voice is paused while a phone call is active/);
  assert.match(plugin, /live\.interrupt\(SpeechAudioFocusPolicy\.CALL_ACTIVE\)/);
  assert.match(capture, /sink\.ended\(captureId,error!=null\?error:interruption\)/);
});
