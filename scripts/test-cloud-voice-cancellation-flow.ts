/** Actual renderer/Cloud driver with authenticated shared source and closed fake ports.
 * No microphone, native audio, network/provider or account API is admitted. */
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from '../test/fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from '../test/fixtures/shared-batch-voice.mjs';
type Fixture = ReturnType<typeof cloudVoiceViewFixture>;
type Clock = ReturnType<typeof voiceFakeClock>;
async function owned(run: (fixture: Fixture, clock: Clock) => Promise<void>){const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock,holdPlayback:true});f.box.testMocksEnabled=true;f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.shell.openView('notes');try{await run(f,clock);}finally{f.holdPlaybackCleanup=false;f.releasePlaybackCleanup?.();f.close();await clock.flush();}}
await owned(async(f,clock)=>{
 f.box.pendingAudioDeletions=async()=>({});
 f.shell.notes={open:'kept-note',list:[{id:'kept-note',title:'Kept note',body:'Reviewed note text.',updatedAt:1}]};
 const view=()=>f.render().ed;
 assert.equal(typeof view().readAloud,'function');
 assert.match(view().cloudSpeechDisclosure,/^Text → /);
 view().readAloud();await clock.flush();assert.equal(f.cloudSpeech,1);assert.equal(typeof view().stopReading,'function');
 assert.equal(f.localFactories,0);assert.equal(f.pairedFactories,0);
 const request=f.speechInputs[0].requestId;f.holdPlaybackCleanup=true;view().stopReading();await clock.advance(650);
 assert.equal(f.stopPlaybackInputs.filter(input=>input.requestId===request).length,1,'Idempotent exact request cleanup');
 const starting=f.shell.startVoice();await clock.flush();assert.equal(f.starts,0,'Prior Notes speaker retirement blocks new capture beyond the old500ms timeout');
 assert.equal(f.renderChat().primaryLabel,'Stop voice conversation');
 f.holdPlaybackCleanup=false;assert.ok(f.releasePlaybackCleanup);f.releasePlaybackCleanup();await starting;assert.equal(f.starts,1,'New capture follows confirmed speaker retirement');f.renderChat().discard();await clock.flush();
});
await owned(async(f,clock)=>{
 const first= f.box.createCloudVoice(),oldAbort=new AbortController();const oldSpeech=first.speak('Old owner fixture',oldAbort.signal).catch(()=>{});await clock.flush();const oldCallbacks=[...(f.events.get('playbackEnded')||[])],oldId=f.activePlayback;
 f.account='owner-B';f.credential='credential-B';f.changed();await oldSpeech;
 const next=f.box.createCloudVoice(),abort=new AbortController();let settled=false;const speech=next.speak('New owner fixture',abort.signal).finally(()=>{settled=true;});void speech.catch(()=>{});await clock.flush();
 assert.notEqual(f.activePlayback,oldId);for(const callback of oldCallbacks)callback({playbackId:f.activePlayback});await clock.flush();assert.equal(settled,false,'Retired owner callback cannot settle new playback');abort.abort();await assert.rejects(speech);assert.equal(settled,true);
});
await owned(async(f,clock)=>{
 const original=f.driver.addListener;
 const listener=Promise.withResolvers<Awaited<ReturnType<typeof original>>>();
 let requested=false,removed=0;
 f.driver.addListener=()=>{requested=true;return listener.promise;};
 const voice=f.box.createCloudVoice(),abort=new AbortController();const speaking=voice.speak('Held listener fixture',abort.signal);void speaking.catch(()=>{});await clock.flush();assert.ok(requested);abort.abort();await assert.rejects(speaking);
 listener.resolve({remove:async()=>{removed++;}});await clock.flush();assert.equal(removed,1);assert.equal(f.cloudSpeech,0);f.driver.addListener=original;
});
await owned(async(f,clock)=>{
 const original=f.driver.synthesize;const synthesis=Promise.withResolvers<Awaited<ReturnType<typeof original>>>();f.driver.synthesize=()=>synthesis.promise;
 const voice=f.box.createCloudVoice(),abort=new AbortController();let settled=false;const speaking=voice.speak('Late synthesis fixture',abort.signal).finally(()=>{settled=true;});void speaking.catch(()=>{});await clock.flush();abort.abort();await clock.flush();
 // Cloud speech drains strictly: cancellation settles only after the held synthesis returns.
 assert.equal(settled,false,'Cancelled speech waits for its synthesis to drain');synthesis.resolve({playbackId:'late-old-audio'});await assert.rejects(speaking);await clock.flush();
 assert.equal(f.activePlayback,null,'Cancelled synthesis cannot admit late playback');assert.ok(f.stopPlaybackInputs.some(input=>input.playbackId==='late-old-audio'),'Late playback is stopped by identity');f.driver.synthesize=original;
});
console.log('PASS: actual saved-Notes renderer/Cloud driver retain pending exact cleanup; new capture waits for confirmed retirement; stale-owner, held-listener and late-synthesis callbacks cannot admit playback. Closed fake ports only.');
