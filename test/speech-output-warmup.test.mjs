import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {materializeNativePatches} from '../scripts/prepare-patched-native.mjs';
import {upstreamNativeSource} from '../scripts/upstream-native-source.mjs';
import {runJvm,upstreamVoiceSource,fixture} from './fixtures/jvm-tools.mjs';

const root=path.resolve(import.meta.dirname,'..');
test('shared output warmup patch is admitted and closes on first audio, cancellation and lifecycle retirement',t=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-warmup-patch-'));
 t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 materializeNativePatches({source:upstreamNativeSource(root),manifest:JSON.parse(fs.readFileSync(path.join(root,'patches/eliza/native-manifest.json'))),patchRoot:path.join(root,'patches/eliza'),temporary});
 const speech=path.join(temporary,'plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice');
 const bridge=fs.readFileSync(path.join(speech,'LocalSpeechBridgePlugin.java'),'utf8');
 assert.match(bridge,/@PluginMethod public void warmSpeechOutput\(PluginCall call\)/);
 assert.match(bridge,/if\(!destroyed&&speechForeground&&\(focus==null\|\|!focus\.callActive\(\)\)&&!speakerBusy\(\)\)/);
 assert.match(bridge,/new SpeechOutputWarmup\(LocalSpeechEngine\.STREAM_RATE\)/);
 assert.match(bridge,/private void clearPlayback\(boolean stopped\)\{closeOutputWarmup\(\)/);
 assert.match(bridge,/private void stopSpeechFor\(String reason\)\{closeOutputWarmup\(\)/);
 assert.match(bridge,/@PluginMethod public void cancel\(PluginCall call\)\{main\.post\(this::closeOutputWarmup\)/);
 assert.match(bridge,/try\{closeOutputWarmup\(\);capture\.cancel\(\);\}/);
 for(const name of ['handleOnPause','handleOnDestroy']){
  const start=bridge.indexOf(name+'()');
  assert.ok(start>=0);
  assert.match(bridge.slice(start,bridge.indexOf('\n }',start)+3),/main\.post\(this::clearPlayback\)/);
 }
 assert.match(bridge,/clearPlayback\(\);streamPlayback=playback/,'the first streamed samples retire warmup before publication');
 const stub=path.join(temporary,'AudioTrackSpeechOutput.java');
 fs.writeFileSync(stub,'package ai.eliza.voice; final class AudioTrackSpeechOutput { static StreamingSpeechPlayback.Output open(int rate){throw new AssertionError("Android output is not used by this host test");} }');
 const sources=['VoiceLatencyTrials.java','SpeechPcmQueue.java','StreamingSpeechPlayback.java','SpeechAudioFocusPolicy.java'].map(upstreamVoiceSource);
 assert.match(runJvm([...sources,stub,path.join(speech,'SpeechOutputWarmup.java'),fixture('SpeechOutputWarmupTest.java')],'ai.eliza.voice.SpeechOutputWarmupTest'),/^PASS output warmup/);
});
