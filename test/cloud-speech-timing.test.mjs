import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

test('Cloud speech timing keeps bounded, content-free phases and terminal outcomes (host JVM)', () => {
  assert.match(runJvm([nativeSource('CloudSpeechTimings.java'), fixture('CloudSpeechTimingsTest.java')], 'ai.elizaresearch.alphaphone.CloudSpeechTimingsTest'), /^PASS Cloud speech timing/);
});

test('native Cloud routes measure response wait and playback start separately without touching local timing', () => {
  const source = fs.readFileSync(nativeSource('AlphaVoiceCloudPlugin.java'), 'utf8');
  assert.match(source, /transcribeRecording\(PluginCall call\)\{submit\(call,"stt",/);
  assert.match(source, /synthesizeAudio\(PluginCall call,boolean paired,String reviewed\)\{submit\(call,paired\?null:"tts",/);
  assert.match(source, /p\.start\(\);cloudTimings\.mark\(playbackTiming,"playback-start"\);/);
  assert.match(source, /cloudTimings\.mark\(playbackTiming,"playback-end"\);cloudTimings\.finish\(playbackTiming,"completed"\);/);
  assert.match(source, /cloudVoiceTiming\(PluginCall call\).*cloudTimings\.snapshot\(\)/);
});
