import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const fixtureRoot=process.env.ALPHA_ACK_HOST_ROOT?pathToFileURL(path.resolve(process.env.ALPHA_ACK_HOST_ROOT)+path.sep):new URL('../',import.meta.url);
const {cloudVoiceViewFixture}=await import(new URL('test/fixtures/cloud-voice-view.mjs',fixtureRoot));
const {voiceFakeClock}=await import(new URL('test/fixtures/shared-batch-voice.mjs',fixtureRoot));
const adapter=readFileSync(process.env.ALPHA_ACK_VIEW_SOURCE||new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
// The browser and the Pixel batch fallback speak the same model ACK through the Cloud driver.
const platforms=[{native:false,platform:'web'},{native:true,platform:'android'}];
async function startedCue({failCleanup=false,platform}){
 const clock=voiceFakeClock();
 const f=cloudVoiceViewFixture({cloudProfile:true,...platform,clock,peak:.5,holdReply:true,holdPlayback:true,
   holdPlaybackCleanup:true,playbackCleanupError:failCleanup?Error('Native stop failed'):undefined,
   adapterSourceTransform:()=>adapter});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 await f.shell.startVoice();await clock.flush();await clock.advance(700);f.peak=0;await clock.advance(1200);
 assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'actual capture retired before cue');
 const input=f.sendInputs[0];input.onProgress({turnId:input.turnId,conversationId:input.binding.conversationId,
   ownerId:input.binding.session.ownerId,kind:'thinking',label:'Checking calendar'});
 await clock.flush();assert.equal(f.cloudSpeech,1);assert.equal(f.speechInputs[0].text,'Checking calendar');
 return{f,clock,input};
}
for(const platform of platforms)test(platform.platform+': actual Batch/session shell Stop retains ACK media until native cleanup settles',async()=>{
 const {f,clock}=await startedCue({platform});
 try{
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat()?.state,'stopping');
  assert.equal(f.starts,1);assert.equal(typeof f.releasePlaybackCleanup,'function');
  await f.shell.startVoice();await clock.flush();assert.equal(f.starts,1,'cannot reopen mic during held acknowledgement cleanup');
  f.releasePlaybackCleanup();await clock.flush();assert.notEqual(f.renderChat()?.state,'stopping');
  assert.equal(f.starts,1,'Stop never resumes capture');
 }finally{f.releasePlaybackCleanup?.();f.releaseReply?.();await clock.flush();f.close();await clock.flush();}
});
for(const platform of platforms)test(platform.platform+': actual ACK cleanup failure latches shell media error and blocks restart',async()=>{
 const {f,clock}=await startedCue({failCleanup:true,platform});
 try{
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat()?.state,'stopping');
  f.releasePlaybackCleanup();await clock.flush();assert.equal(f.renderChat()?.state,'error');
  await f.shell.startVoice();await clock.flush();assert.equal(f.starts,1,'unconfirmed acknowledgement retirement is not permission to capture');
  assert.equal(f.sends,1);assert.equal(f.audioSaves,0);
 }finally{f.releasePlaybackCleanup?.();f.releaseReply?.();await clock.flush();f.close();await clock.flush();}
});
