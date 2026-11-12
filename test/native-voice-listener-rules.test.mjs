import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeSource, upstreamBridgeSource} from './fixtures/jvm-tools.mjs';

// Source contracts for Alpha's speech bridge subclass against the shared bridge at the reviewed
// pin. Not a compile, MediaPlayer, AudioTrack or device evidence.
const strip = source => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
const alpha = strip(fs.readFileSync(nativeSource('AlphaVoiceCloudPlugin.java'), 'utf8'));
const shared = strip(fs.readFileSync(upstreamBridgeSource('LocalSpeechBridgePlugin.java'), 'utf8'));
const method = name => {
  const start = alpha.indexOf(`@PluginMethod public void ${name}(PluginCall call){`);
  assert.notEqual(start, -1, `${name} is a bridge method`);
  return alpha.slice(start, alpha.indexOf('\n', start));
};
const busy = 'if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&speakerBusy()){call.reject("Speaker is in use","playback-busy");return;}';

test('replace:false never interrupts a clip or a streamed utterance on any Alpha synthesis route', () => {
  // Each route checks both forms of playback and any synthesis in flight.
  assert.match(shared, /protected final boolean speakerBusy\(\)\{return playbackBusy\(\)\|\|!gate\.idle\(\);\}/);
  assert.match(shared, /private boolean playbackBusy\(\)\{return playbackFile!=null\|\|streamPlayback!=null;\}/);
  for (const name of ['synthesize', 'synthesizeOwn', 'synthesizePaired']) {
    const body = method(name);
    assert.ok(body.startsWith(`@PluginMethod public void ${name}(PluginCall call){${busy}`), `${name} refuses a busy speaker before any work`);
  }
});

test('a busy speaker refuses browser reading before its approval is consumed', () => {
  const body = method('synthesizeBrowserReading');
  const refused = body.indexOf(busy), consumed = body.indexOf('browser.consumeReading(call)');
  assert.ok(refused !== -1 && consumed !== -1 && refused < consumed);
  assert.ok(body.startsWith('@PluginMethod public void synthesizeBrowserReading(PluginCall call){mainHandler().post(()->{' + busy), 'the speaker is read on the main thread');
  // The on-device reading goes through the shared reviewed synthesis, which checks clip and stream itself.
  assert.match(method('synthesizeLocalBrowserReading'), /synthesizeReviewed\(call,reviewed\)/);
  assert.match(shared, /if\(Boolean\.FALSE\.equals\(call\.getBoolean\("replace",true\)\)&&playbackBusy\(\)\)\{refusal\[0\]="playback-busy";return;\}/);
});
