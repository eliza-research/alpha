/** Actual renderer/Cloud driver with authenticated shared source and closed fake ports.
 * No microphone, native audio, network/provider or account API is admitted. */
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from '../test/fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from '../test/fixtures/shared-batch-voice.mjs';
async function owned(run){const clock=voiceFakeClock(),f=cloudVoiceViewFixture({clock,holdPlayback:true});f.box.testMocksEnabled=true;f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.shell.openView('notes');try{await run(f,clock);}finally{f.holdPlaybackCleanup=false;f.releasePlaybackCleanup?.();f.close();await clock.flush();}}
await owned(async(f,clock)=>{
 const render=f.render;
 render().record();assert.equal(render().rec.manualChoice,false);assert.equal(render().rec.routeChoice,false);
 render().rec.stop();await clock.flush();render().rec.stop();await clock.flush();render().rec.stop();await clock.flush();assert.equal(render().rec.review,true);
 render().rec.toggle();await clock.flush();assert.equal(f.cloudSpeech,1);assert.equal(render().rec.pauseLabel,'Stop audio');
 const request=f.speechInputs[0].requestId;f.holdPlaybackCleanup=true;render().rec.toggle();await clock.advance(650);
 assert.equal(render().rec.pauseLabel,'Stop audio','Unconfirmed media cleanup must remain visible beyond the old500ms timeout');assert.equal(f.stopPlaybackInputs.filter(input=>input.requestId===request).length,1,'Idempotent exact request cleanup');
 render().rec.discard();await clock.flush();const starting=f.shell.startVoice();await clock.flush();assert.equal(f.starts,1,'Prior Notes speaker retirement blocks new capture');assert.equal(f.renderChat().primaryLabel,'Stop voice conversation');
 f.holdPlaybackCleanup=false;f.releasePlaybackCleanup();await starting;assert.equal(f.starts,2,'New capture follows confirmed speaker retirement');f.renderChat().discard();await clock.flush();
});
await owned(async(f,clock)=>{
 const first= f.box.createCloudVoice(),oldAbort=new AbortController();const oldSpeech=first.speak('Old owner fixture',oldAbort.signal).catch(()=>{});await clock.flush();const oldCallbacks=[...(f.events.get('playbackEnded')||[])],oldId=f.activePlayback;
 f.account='owner-B';f.credential='credential-B';f.changed();await oldSpeech;
 const next=f.box.createCloudVoice(),abort=new AbortController();let settled=false;const speech=next.speak('New owner fixture',abort.signal).finally(()=>{settled=true;});void speech.catch(()=>{});await clock.flush();
 assert.notEqual(f.activePlayback,oldId);for(const callback of oldCallbacks)callback({playbackId:f.activePlayback});await clock.flush();assert.equal(settled,false,'Retired owner callback cannot settle new playback');abort.abort();await assert.rejects(speech);assert.equal(settled,true);
});
await owned(async(f,clock)=>{
 const original=f.driver.addListener;let late,removed=0;f.driver.addListener=()=>new Promise(resolve=>late=resolve);
 const voice=f.box.createCloudVoice(),abort=new AbortController();const speaking=voice.speak('Held listener fixture',abort.signal);void speaking.catch(()=>{});await clock.flush();assert.equal(typeof late,'function');abort.abort();await assert.rejects(speaking);
 late({remove:async()=>{removed++;}});await clock.flush();assert.equal(removed,1);assert.equal(f.cloudSpeech,0);f.driver.addListener=original;
});
await owned(async(f,clock)=>{
 const original=f.driver.synthesize;let release;f.driver.synthesize=()=>new Promise(resolve=>release=resolve);
 const voice=f.box.createCloudVoice(),abort=new AbortController();let settled=false;const speaking=voice.speak('Late synthesis fixture',abort.signal).finally(()=>{settled=true;});void speaking.catch(()=>{});await clock.flush();abort.abort();await clock.flush();
 // Cloud speech drains strictly: cancellation settles only after the held synthesis returns.
 assert.equal(settled,false,'Cancelled speech waits for its synthesis to drain');release({playbackId:'late-old-audio'});await assert.rejects(speaking);await clock.flush();
 assert.equal(f.activePlayback,null,'Cancelled synthesis cannot admit late playback');assert.ok(f.stopPlaybackInputs.some(input=>input.playbackId==='late-old-audio'),'Late playback is stopped by identity');f.driver.synthesize=original;
});
console.log('PASS: actual Notes renderer/Cloud driver retain pending exact cleanup; new capture waits for confirmed retirement; stale-owner, held-listener and late-synthesis callbacks cannot admit playback. Closed fake ports only.');
