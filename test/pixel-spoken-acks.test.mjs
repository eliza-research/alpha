import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// Spoken model acknowledgements on the Pixel (native platform): the batch fallback, streaming
// Cloud speech and on-device live voice. The cue is only ever the model's own label; nothing
// canned is spoken, and a missing or dropped ack is silence.
const ACK='Checking your calendar now.',REPLY='Synthetic matching reply.';
const progress=(input,patch={})=>input.onProgress?.({turnId:input.turnId,conversationId:input.binding.conversationId,ownerId:input.binding.session.ownerId,kind:'thinking',label:ACK,...patch});
const silent=[{label:''},{label:'   '},{label:undefined},{label:'x'.repeat(161)},{kind:'running_tool',toolName:'calendar.read',label:undefined},{kind:'running_action',actionName:'CALENDAR',label:'Using Calendar'}];

// The views run in a VM realm with the host's DOMException; as in the app's WebView, an
// AbortError must also be an Error there, so the realm shares the host's Error.
function viewFixture(options){const f=cloudVoiceViewFixture(options);f.box.Error=Error;return f;}

// This suite targets the reviewed busy-hold SDK projection. A legacy projection is not a pass:
// running this file against it fails explicitly rather than silently skipping the new contract.
test('the spoken ACK suite uses the canonical busy-hold session',()=>{
 assert.match(fs.readFileSync('.eliza/client-features/packages/voice/src/voice-assistant-session.ts','utf8'),/inputHeld/);
});

// --- Batch fallback (streaming route absent, or direct inference): one Cloud TTS request per cue.
async function batchTurn(options={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,peak:.5,holdReply:true,...options});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 await f.shell.startVoice();await clock.flush();await clock.advance(700);f.peak=0;await clock.advance(1200);
 assert.equal(f.native,options.native??true);assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'the clip capture is retired before any cue');
 return {f,clock,input:f.sendInputs[0],texts:()=>(f.speechInputs||[]).map(value=>value.text)};
}
async function closeBatch({f,clock}){f.releasePlaybackCleanup?.();f.finishPlayback?.();f.releaseReply?.();await clock.flush();f.close();await clock.flush();}

test('native batch: the model acknowledgement is spoken once, then the reply',async()=>{
 const t=await batchTurn();
 try{
  progress(t.input);await t.clock.flush();progress(t.input);progress(t.input,{label:'Different later words.'});await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY]);
 }finally{await closeBatch(t);}
});

test('native batch: an empty, oversized, unlabelled or activity-only ack is silent; no canned line',async()=>{
 const t=await batchTurn();
 try{
  for(const patch of silent)progress(t.input,patch);await t.clock.flush();
  assert.deepEqual(t.texts(),[]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[REPLY]);
 }finally{await closeBatch(t);}
});

test('native batch: reply_ready preempts a playing ack and the reply waits for its cleanup',async()=>{
 const t=await batchTurn({holdPlayback:true,holdPlaybackCleanup:true});
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);assert.ok(t.f.activePlayback,'the ack is playing');
  t.input.onReplyStarted();await t.clock.flush();
  assert.equal(t.f.stopPlaybackInputs?.length,1,'the playing ack is stopped');
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK],'no reply audio before the ack cleanup is confirmed');
  t.f.releasePlaybackCleanup();await t.clock.advance(0);
  assert.deepEqual(t.texts(),[ACK,REPLY]);
 }finally{await closeBatch(t);}
});

// --- Streaming Cloud speech (the Pixel default on Cloud) and on-device live voice.
function loadSession(f){
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/voice-assistant-session.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export class','class').replaceAll('export const','const').replaceAll('export function','function').replaceAll('export interface','interface').replaceAll('export type','type');
 vm.runInNewContext('{'+stripTypeScriptTypes(source)+';globalThis.VoiceAssistantSession=VoiceAssistantSession;}',f.box);
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.randomId=()=>crypto.randomUUID();
 f.box.createHeardReporter=()=>({report:async()=>'not-needed'});
 const Session=f.box.VoiceAssistantSession;f.box.VoiceAssistantSession=class extends Session{constructor(...args){super(...args);f.session=this;}};
 f.box.recordEndpointVoiceTiming=()=>{};f.box.activeVoiceTurn=()=>undefined;f.box.recordHeardVoiceTiming=()=>{};f.box.toSpeakableText=text=>text;
}
/** One speaker for the live paths: `hold` keeps matching speech playing; `holdStart` delays its
 * first audio until `start()`; `holdCancel` keeps its cancellation pending. */
function speaker(){
 const s={plays:[],hold:()=>false,holdStart:()=>false,holdCancel:false,overlap:false};
 s.speak=(text,signal,onStarted)=>{
  signal.throwIfAborted();
  if(s.plays.some(play=>play.active))s.overlap=true;
  const play={text,signal,active:true};s.plays.push(play);
  return new Promise((resolve,reject)=>{
   play.start=()=>{if(!play.started){play.started=true;onStarted?.();}};
   if(!s.holdStart(text))play.start();
   play.finish=()=>{if(!play.active)return;play.active=false;resolve();};
   signal.addEventListener('abort',()=>{const settle=()=>{play.active=false;reject(signal.reason??new DOMException('Speech cancelled','AbortError'));};if(s.holdCancel)play.releaseCancel=settle;else settle();},{once:true});
   if(!s.hold(text))queueMicrotask(play.finish);
  });
 };
 s.spoken=()=>s.plays.map(play=>play.text);
 return s;
}
function streamingFixture({fullDuplex=true}={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,holdReply:true});
 loadSession(f);
 const s=speaker();s.listens=0;s.closes=0;s.cancels=0;s.captures=[];
 f.box.nativeCloudStreamingAvailable=()=>true;
 f.box.createCloudStreamingSpeech=()=>({
  async listen(input){
   s.listens++;s.handlers=input;const capture={handlers:input,active:true};s.captures.push(capture);
   return {fullDuplex,close:async()=>{s.closes++;await s.closeGate?.(capture);capture.active=false;},cancel:async()=>{s.cancels++;capture.active=false;}};
  },
  speak:s.speak,
  async stop(){for(const capture of s.captures)capture.active=false;},
 });
 return Object.assign(f,{clock,s});
}
function onDeviceLiveFixture(){
 const clock=voiceFakeClock(),f=viewFixture({clock,holdReply:true});
 loadSession(f);
 const s=speaker();s.listens=0;s.closes=0;s.cancels=0;s.captures=[];
 f.box.nativeLiveVoiceReady=async()=>true;
 f.box.nativeAssistantListener=()=>async input=>{
  s.listens++;s.handlers=input;const capture={handlers:input,active:true};s.captures.push(capture);
  return {fullDuplex:true,close:async()=>{s.closes++;await s.closeGate?.(capture);capture.active=false;},cancel:async()=>{s.cancels++;capture.active=false;}};
 };
 f.box.createEndpointChain=()=>async()=>'unavailable';f.box.residentEndpoint=()=>undefined;f.box.clefEndpointStage=()=>undefined;
 f.box.createOnDeviceVoice=()=>({ready:async()=>true,playbackReady:async()=>true,speak:(text,signal,onStarted)=>s.speak(text,signal,onStarted)});
 return Object.assign(f,{clock,s});
}
async function liveTurn(f,gapMs=0){
 await f.shell.startVoice();await f.clock.flush();const h=f.s.handlers;assert.ok(h,'the live capture is open');
 h.onSpeechStart(0);h.onSpeechEnd(20);h.onSegment('Add lunch with Sam tomorrow.');await f.clock.advance(gapMs);
 // A compatibility close must finish before the first request is allowed to exist.
 if(f.s.confirmInitialClose){assert.equal(f.sends,0,'first send waits for confirmed capture close');assert.equal(f.s.capturing,true);f.s.confirmInitialClose();await f.clock.flush();assert.equal(f.s.capturing,false);}
 assert.equal(f.sends,1);return f.sendInputs[0];
}

function assertInputHeld(f,input){
 assert.equal(input.signal.aborted,false,'closed capture callbacks cannot interrupt the pending turn');
 assert.equal(f.sends,1,'no stale-capture follow-up turn');
 assert.equal(f.s.captures.filter(capture=>capture.active).length,0,'no physical capture during the busy hold');
}
async function closeLive(f){f.s.confirmInitialClose?.();f.s.stopped?.();for(const play of f.s.plays){play.releaseCancel?.();play.finish?.();}f.releaseReply?.();await f.clock.flush();f.close();await f.clock.flush();}

test('native streaming: the model acknowledgement plays once on the speech socket, then the reply, with no batch speech',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();progress(input);progress(input,{label:'Different later words.'});await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
  assert.equal(f.cloudSpeech,0,'no Cloud TTS request beside the socket');assert.equal(f.uploads,0);assert.equal(f.starts,0);
 }finally{await closeLive(f);}
});

test('native streaming: an empty, oversized, unlabelled or activity-only ack is silent; no canned line',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  for(const patch of silent)progress(input,patch);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);
 }finally{await closeLive(f);}
});

test('native streaming: reply_ready preempts a playing ack; the reply waits for its cancellation and never overlaps it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdCancel=true;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];assert.equal(ack.active,true);
  input.onReplyStarted();await f.clock.flush();assert.equal(ack.signal.aborted,true,'reply_ready cancels the ack');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK],'no reply audio before the ack cancellation settles');
  ack.releaseCancel();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
 }finally{await closeLive(f);}
});

test('native streaming: a reply that arrives while the ack plays also preempts it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.releaseReply();await f.clock.flush();
  assert.equal(ack.signal.aborted,true);assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
 }finally{await closeLive(f);}
});

test('native streaming: Stop cancels a playing ack and the turn, and waits for the ack cleanup',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdCancel=true;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  let stopped=false;const stopping=f.shell.stopVoiceConversation().then(()=>{stopped=true;});await f.clock.flush();
  assert.equal(ack.signal.aborted,true,'Stop cancels the ack');assert.equal(input.signal.aborted,true,'and the turn');
  assert.equal(stopped,false,'Stop settles only after the ack cleanup');
  ack.releaseCancel();await f.clock.flush();await stopping;assert.equal(stopped,true);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK],'nothing is spoken after Stop');
 }finally{await closeLive(f);}
});

test('native streaming: Mute during an ack turns the microphone off at once; the cue never reopens it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.s.closes,1,'Mute closes the capture');assert.equal(f.renderChat().muted,'true');
  // Mute is microphone-only, as for a reply: the turn and its cue continue.
  assert.equal(input.signal.aborted,false);assert.equal(ack.active,true);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.listens,1,'the microphone stays off after the ack and the reply');
  f.renderChat().toggleMute();await f.clock.flush();assert.equal(f.s.listens,2,'Unmute reopens it');
 }finally{await closeLive(f);}
});

test('native streaming: the ack echo held past the barge-in window never interrupts its own turn',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(2000);
  h.onSpeechEnd(2100);h.onSegment('checking your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'echo of the ack is not a barge-in');assert.equal(ack.signal.aborted,false);assert.equal(f.sends,1);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
 }finally{await closeLive(f);}
});

test('native streaming: real speech during the ack from the closed capture cannot barge in',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(300);h.onSpeechEnd(400);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');assert.equal(ack.signal.aborted,false,'stale speech cannot cancel the ACK');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: speech during the ack is ignored, as during a reply',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(2000);h.onSpeechEnd(2100);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
 }finally{await closeLive(f);}
});

test('on-device live voice: the model acknowledgement plays through on-device speech once, then the reply',async()=>{
 const f=onDeviceLiveFixture();
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();progress(input);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);assert.equal(f.cloudSpeech,0);
 }finally{await closeLive(f);}
});

// --- A dropped ack is silence on every path: a cue that fails to play never costs the reply.
test('native batch: an ack whose Cloud speech request fails is silence; the reply is still spoken',async()=>{
 const t=await batchTurn();const synthesize=t.f.driver.synthesize;
 t.f.driver.synthesize=async input=>{if(input.text!==ACK)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Cloud speech failed'),{code:'voice-http-502'});};
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY],'no canned line in its place, and the reply plays');
  assert.notEqual(t.f.renderChat()?.state,'error');
 }finally{await closeBatch(t);}
});

// The browser's clip loop speaks the ack through the same wrapper, so a failed ack is silence there
// too (at 445e5744 it ended the web conversation). A failed reply still ends it, as before.
for(const failing of [ACK,REPLY])
test(`browser batch: ${failing===ACK?'an ack whose Cloud speech request fails is silence; the reply is spoken and the conversation goes on':'a reply whose Cloud speech request fails still ends the conversation with its notice'}`,async()=>{
 const t=await batchTurn({native:false,platform:'web'});const synthesize=t.f.driver.synthesize;
 t.f.driver.synthesize=async input=>{if(input.text!==failing)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Cloud speech failed'),{code:'voice-http-502'});};
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);
  // Microtasks drain before any timer, as in the app: the reply's speech and its failure settle first.
  t.f.releaseReply();for(let i=0;i<10;i++)await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY]);
  if(failing===ACK)assert.notEqual(t.f.renderChat()?.state,'error');
  else{assert.equal(t.f.renderChat()?.state,'error');assert.match(t.f.renderChat()?.lines?.[0]?.t,/\(502\)/);}
 }finally{await closeBatch(t);}
});

// A speak call the speaker refuses fails only that utterance (the socket's failures: 'speech socket' below).
test('native streaming: an ack whose speech call is refused is silence; the reply is still spoken and the conversation goes on',async()=>{
 const f=streamingFixture();const speak=f.s.speak;
 f.s.speak=(text,signal,onStarted)=>text===ACK?Promise.reject(Error('Speech could not start')):speak(text,signal,onStarted);
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);assert.equal(input.signal.aborted,false);
  assert.equal(f.renderChat()?.state,'listening');
 }finally{await closeLive(f);}
});

// --- The ack's echo tail: speech the capture reports just after the cue's audio ended.
test('native streaming: echo of the ack that starts after its audio ended neither interrupts its turn nor is sent',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'held past the barge-in window, the tail does not interrupt by time');
  h.onSpeechEnd(2);h.onSegment('calendar now');await f.clock.advance(0);
  h.onSpeechStart(3);h.onSpeechEnd(4);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  await f.clock.advance(2000);
  h.onSpeechStart(5);h.onSpeechEnd(6);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'later echo carries no transcript');assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1,'the echo is never sent as a turn');
 }finally{await closeLive(f);}
});

test('native streaming: real speech just after the ack from the closed capture cannot barge in',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: echo of the ack that starts after its audio ended neither interrupts its turn nor is sent',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'held past the barge-in window, the tail does not interrupt by time');
  h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1,'the echo is never sent as a turn');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: real speech just after the ack from the closed capture cannot barge in',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

test('on-device live voice: echo of the ack that starts after its audio ended does not interrupt its turn',async()=>{
 const f=onDeviceLiveFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(1300);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1);
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: speech that starts before the ack audio is discarded after capture closure',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);ack.start();await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');assert.equal(ack.signal.aborted,false);
  h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

// --- On-device recorded-clip loop (the Pixel when on-device live ASR is not ready).
function onDeviceBatchFixture(){
 const clock=voiceFakeClock(),f=viewFixture({clock,peak:.5,holdReply:true});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 const s=speaker();
 f.box.nativeLiveVoiceReady=async()=>false;
 f.box.createOnDeviceVoice=()=>({ready:async()=>true,playbackReady:async()=>true,transcribe:async()=>({text:'Add lunch with Sam tomorrow.'}),speak:(text,signal,onStarted)=>s.speak(text,signal,onStarted)});
 return Object.assign(f,{clock,s});
}
test('on-device batch: the model acknowledgement plays through on-device speech once, after the clip is retired, then the reply',async()=>{
 const f=onDeviceBatchFixture();
 try{
  await f.shell.startVoice();await f.clock.flush();await f.clock.advance(700);f.peak=0;await f.clock.advance(1200);
  assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'the clip capture is retired before any cue');
  const input=f.sendInputs[0];
  progress(input);await f.clock.flush();progress(input);progress(input,{label:'Different later words.'});await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);assert.equal(f.cloudSpeech,0);
 }finally{await closeLive(f);}
});

// --- Streaming Cloud speech through the shared native-cloud-speech.ts module over a port that
// keeps the native bridge's rules (SpeechStreamBridgePlugin, patches/eliza/cloud-speech-native.patch):
// one utterance at a time, and a cancelled utterance drains before the speaker takes the next one;
// audio-end only follows audio-start (the playback exists from the first PCM); Cloud's 'complete'
// with no PCM, and any Cloud error frame, fail the whole session through its error event, and the
// retired session refuses later speech. A refused speak call (audio focus, busy speaker) fails only
// that utterance. `mutes` records the capture's mute calls (false: capturing); `closeMute`, when
// set, is how the native mute for a close settles (deferred, refused or never), and `openMute`
// how the unmute for a listen does.
function socketFixture({echoCancelled=true}={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,holdReply:true});
 loadSession(f);
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/native-cloud-speech.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export interface','interface');
 vm.runInNewContext('{'+stripTypeScriptTypes(source)+';globalThis.createSharedCloudStreamingSpeech=createCloudStreamingSpeech;}',f.box);
 const n={spoken:[],refused:[],cancels:0,stops:0,mutes:[],utterance:null,draining:false,holdCancel:false,physicalActive:false,lateOpenRetired:0};
 const port={
  async addListener(_event,callback){n.emit=callback;return {remove:async()=>{}};},
  async startCloudSpeech(input){n.sessionId=input.sessionId;return {sessionId:input.sessionId,sampleRate:16000,echoCancelled};},
  async stopCloudSpeech(){n.stops++;n.retired=true;n.physicalActive=false;n.utterance=null;},
  async setCloudSpeechMuted({muted}){
   n.mutes.push(muted);
   if(muted){await n.closeMute?.();n.physicalActive=false;}
   else{await n.openMute?.();if(n.retired){n.lateOpenRetired++;throw Error('Native session already retired');}n.physicalActive=true;}
  },
  async speakCloudSpeech({utteranceId,text}){if(n.retired)throw Error('Invalid speech request');if(n.utterance||n.draining||n.refuse?.(text)){n.refused.push(text);throw Error('Speech could not start');}n.utterance={id:utteranceId,text,started:false};n.spoken.push(text);},
  async cancelCloudSpeech({utteranceId}){n.cancels++;if(n.retired||n.utterance?.id!==utteranceId)return;n.utterance=null;n.draining=true;if(n.holdCancel)await new Promise(resolve=>n.releaseCancel=resolve);n.draining=false;},
 };
 const event=value=>n.emit({sessionId:n.sessionId,...value});
 n.audioStart=()=>{n.utterance.started=true;event({type:'audio-start',utteranceId:n.utterance.id});};
 n.audioEnd=()=>{assert.equal(n.utterance.started,true,'the bridge ends only an utterance whose audio started');const id=n.utterance.id;n.utterance=null;event({type:'audio-end',utteranceId:id});};
 // The bridge's fail(): one error event for the whole session, which is then retired.
 n.fail=code=>{n.retired=true;n.utterance=null;event({type:'error',code});};
 // Cloud's 'complete' for the utterance: played out, or with no PCM a protocol failure.
 n.complete=()=>n.utterance.started?n.audioEnd():n.fail('protocol');
 n.cloudError=()=>n.fail('unavailable');
 n.utter=text=>{event({type:'speech-start'});event({type:'speech-end',text});};
 f.box.nativeCloudStreamingAvailable=()=>true;
 f.box.createCloudStreamingSpeech=input=>f.box.createSharedCloudStreamingSpeech(input,port);
 return Object.assign(f,{clock,n});
}
async function socketTurn(f){
 await f.shell.startVoice();await f.clock.flush();assert.equal(typeof f.n.emit,'function','the speech socket is open');
 f.n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(0);
 assert.equal(f.sends,1);return f.sendInputs[0];
}
async function closeSocket(f){f.n.releaseCancel?.();f.releaseReply?.();await f.clock.flush();f.close();await f.clock.flush();}

test('speech socket: the ack plays once; reply_ready cancels it and the reply starts only after the native cancel drains',async()=>{
 const f=socketFixture(),n=f.n;n.holdCancel=true;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();progress(input);await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK]);n.audioStart();await f.clock.flush();
  input.onReplyStarted();f.releaseReply();await f.clock.flush();
  assert.equal(n.cancels,1);assert.deepEqual(n.spoken,[ACK],'no reply request while the cancelled ack drains');
  n.releaseCancel();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,REPLY]);assert.deepEqual(n.refused,[],'the native speaker never refuses the reply');
  n.audioStart();n.audioEnd();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'listening');assert.equal(f.cloudSpeech,0);assert.equal(f.uploads,0);
 }finally{await closeSocket(f);}
});

/** Records whether the agent request completed with its reply (the shell's sendVoiceTurn). */
function watchReply(f){const send=f.shell.sendVoiceTurn.bind(f.shell),seen={};f.shell.sendVoiceTurn=input=>send(input).then(reply=>{seen.reply=reply;return reply;},error=>{seen.error=error;throw error;});return seen;}
// No capture end waits for the ack. Cloud completing the ack with no audio fails the whole speech
// session with the bridge's catch-all 'protocol' code, which also covers every other fault in its
// message handler (its own owner/session check, a frame that does not parse, an oversized frame, an
// unexpected event), so nothing the renderer receives ties that end to the ack. Until the bridge
// reports a typed failure bound to the session and to the ack's own request, that end retires the
// capture, the turn and the conversation at once, as any 'protocol' end did at 445e5744: the agent
// request is cancelled and its reply is never spoken. Only the ack's own speak call failing (a
// refusal, below) is the ack's, and that is silence.
test('speech socket: Cloud completes the ack without audio: the socket-wide failure ends the turn and the conversation at once',async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.spoken,[ACK]);
  n.complete();const abortedAtOnce=input.signal.aborted;await f.clock.flush();
  assert.equal(abortedAtOnce,true,'the request is cancelled with the capture end itself, not attributed to the ack');
  assert.equal(f.renderChat()?.state,'error');assert.ok(n.stops>=1,'the failed socket is stopped');
  assert.match(f.renderChat()?.lines?.[0]?.t,/^Voice stopped\./,'the existing stopped notice');
  f.releaseReply();await f.clock.flush();
  assert.equal(seen.reply,undefined,'the cancelled request never completes');assert.equal(f.renderChat()?.state,'error');
  assert.deepEqual(n.spoken,[ACK],'nothing is spoken on the retired socket, and no canned line');
 }finally{await closeSocket(f);}
});

test('speech socket: Cloud completes the ack without audio: a request that would fail later is already cancelled; nothing more surfaces',async()=>{
 const f=socketFixture(),n=f.n,send=f.shell.sendVoiceTurn.bind(f.shell);
 f.shell.sendVoiceTurn=input=>send(input).then(()=>{throw Error('Local agent response interrupted.');});
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');const line=f.renderChat()?.lines?.[0]?.t;
  f.releaseReply();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.equal(f.renderChat()?.lines?.[0]?.t,line);assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

// Positive controls: with no fault, a normal ack plays out and its turn completes, and the capture
// keeps hearing the next turn.
test('speech socket: a normal ack plays out, its turn completes with the reply spoken, and the next turn is heard',async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.spoken,[ACK]);
  n.audioStart();await f.clock.flush();n.complete();await f.clock.flush();
  f.releaseReply();await f.clock.flush();assert.deepEqual(n.spoken,[ACK,REPLY]);
  n.audioStart();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(seen.reply?.text,REPLY);assert.equal(f.renderChat()?.state,'listening');assert.equal(n.stops,0);
  n.utter('And lunch on Friday.');await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'And lunch on Friday.');
 }finally{await closeSocket(f);}
});

test('on-device live voice: a normal ack plays out, its turn completes with the reply spoken, and the next turn is heard',async()=>{
 const f=onDeviceLiveFixture(),seen=watchReply(f);
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(input.signal.aborted,false);assert.equal(seen.reply?.text,REPLY);assert.equal(f.renderChat()?.state,'listening');
  const h=f.s.handlers;h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment('And lunch on Friday.');await f.clock.advance(1300);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'And lunch on Friday.');
 }finally{await closeLive(f);}
});

test('speech socket: a socket failure with no ack in flight still ends the conversation and cancels the request at once',async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  n.cloudError();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
  f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined);
 }finally{await closeSocket(f);}
});

test('speech socket: a socket failure after the ack played out cancels the request at once, as without an ack',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();
  n.cloudError();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
 }finally{await closeSocket(f);}
});

// 'protocol' with no ack in flight, or after the ack played out: immediate, as at 445e5744.
for(const [name,before] of [['with no ack in flight',async()=>{}],['after the ack played out',async(f,input)=>{progress(input);await f.clock.flush();f.n.audioStart();f.n.complete();}]])
test(`speech socket: a 'protocol' failure ${name} ends the conversation and cancels the request at once`,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  await before(f,input);await f.clock.flush();
  n.fail('protocol');await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
  f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined);
 }finally{await closeSocket(f);}
});

test('speech socket: an ack the speaker refuses is silence; the reply is spoken and the conversation goes on',async()=>{
 const f=socketFixture(),n=f.n;n.refuse=text=>text===ACK;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.refused,[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(n.spoken,[REPLY]);n.audioStart();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(f.renderChat()?.state,'listening');
 }finally{await closeSocket(f);}
});

test('speech socket: an ack completed without audio has already ended the turn; Stop then closes the conversation quietly',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,true,'the failure ended the turn before Stop');assert.equal(f.renderChat()?.state,'error');
  await f.shell.stopVoiceConversation();await f.clock.flush();
  assert.equal(f.renderChat()?.state,undefined,'Stop closes the conversation');
  f.releaseReply();await f.clock.flush();
  assert.equal(f.renderChat()?.state,undefined,'no error surfaces after Stop');assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

test('speech socket: Stop cancels a playing ack and stops the socket; nothing is spoken after Stop',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();await f.clock.flush();
  await f.shell.stopVoiceConversation();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(n.cancels,1,'the ack is cancelled');assert.ok(n.stops>=1,'and the socket stopped');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

test('speech socket: Cloud reports the ack echo after the ack audio ended; it neither interrupts nor is sent',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();n.audioEnd();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(900);
  n.emit({sessionId:n.sessionId,type:'speech-end',text:'your calendar now'});await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();n.audioStart();n.audioEnd();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,REPLY]);assert.equal(f.sends,1);
 }finally{await closeSocket(f);}
});

// --- Lifecycle: every capture end stays immediate, 'protocol' included, exactly as without an ack
// (445e5744). Each case runs twice, with the ack playing and with no ack (a label that is silence),
// and the outcome at the moment of the end must match.
const outcome=(f,input,seen)=>({aborted:input.signal.aborted,state:f.renderChat()?.state,line:f.renderChat()?.lines?.[0]?.t,replied:seen.reply!==undefined});
async function sameAsWithoutAck(run){
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1,'the ack was playing');assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.atEnd,withoutAck.atEnd,'the end is handled as without an ack');
 assert.equal(withAck.atEnd.aborted,true,'the request is cancelled at once');
 return withAck.atEnd;
}
// The conversation's own fences: Stop, leaving the view, and an owner session change.
const fences=[['Stop',f=>f.shell.stopVoiceConversation()],['navigation away',f=>f.shell.openView('notes')],['an owner session change',f=>{f.agent='another-agent-session';f.changed();}]];
// The bridge's session failures and retirements (SpeechStreamBridgePlugin fail/retire codes), the
// catch-all 'protocol', an unknown code and no code, whether or not the ack's audio has started.
const socketEnds=['call-active','audio-focus-lost','expired','capture','permission-denied','unavailable','connection-lost','playback','closed','protocol','an-unknown-code',undefined];
for(const audible of [false,true])for(const code of socketEnds)
test(`speech socket: '${code??'no code'}' while the ack ${audible?'plays':'waits for its first audio'} stops the conversation and its request at once`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   if(audible&&spoken)n.audioStart();await f.clock.flush();
   n.fail(code);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined,'the cancelled request never completes');assert.equal(n.spoken.length,spoken,'nothing more is spoken');
   return result;
  }finally{await closeSocket(f);}
 });
 assert.equal(atEnd.state,'error');
});

async function sameClosedInputWithOrWithoutAck(run){
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1,'the genuine model ACK is exercised');assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.atEnd,withoutAck.atEnd,'closed input obeys the same contract with no ACK');
 assert.equal(withAck.atEnd.aborted,false,'stale input never cancels the current request');
 return withAck.atEnd;
}
// Faults the native bridge reports with the same 'protocol' error event (RelayListener.onMessage's
// one catch in patches/eliza/cloud-speech-native.patch), so none identifies the ack: each, while
// the ack's turn is pending, cancels the agent request with the capture end itself and retires the
// capture (the socket is stopped and hears nothing more), exactly as the same fault with no ack.
const protocolFaults=['its own owner/session check failing (own.check)','a control frame that does not parse','an oversized control frame','an unexpected event in its dispatch','Cloud completing an utterance with no audio, or twice','an unknown fault'];
const retiredAtOnce=async(f,input,seen,fault)=>{
 const before=f.sends;fault();const abortedAtOnce=input.signal.aborted;await f.clock.flush();
 f.n.utter('Is this still heard?');await f.clock.advance(0);
 return {...outcome(f,input,seen),abortedAtOnce,socketStopped:f.n.stops>=1,heardAfter:f.sends-before};
};
for(const audible of [false,true])for(const fault of protocolFaults)
test(`speech socket: ${fault} (reported as 'protocol') while the ack ${audible?'plays':'waits for its first audio'} cancels the request and retires the capture at once, as without an ack`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   if(audible&&spoken)n.audioStart();await f.clock.flush();
   assert.equal(input.signal.aborted,false,'the turn is pending');
   const result={spoken,atEnd:await retiredAtOnce(f,input,seen,()=>n.fail('protocol'))};
   f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined,'the cancelled request never completes');assert.equal(n.spoken.length,spoken,'nothing more is spoken');
   return result;
  }finally{await closeSocket(f);}
 });
 assert.deepEqual(atEnd,{aborted:true,state:'error',line:atEnd.line,replied:false,abortedAtOnce:true,socketStopped:true,heardAfter:0});
 assert.match(atEnd.line,/^Voice stopped\./);
});

// The renderer bridge's own owner/session check (native-cloud-speech.ts check()) failing on an event
// that arrives after the owner changed, before any fence reported it: the same immediate end.
for(const audible of [false,true])
test(`speech socket: the renderer bridge's owner/session check failing while the ack ${audible?'plays':'waits for its first audio'} cancels the request and retires the capture at once, as without an ack`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   if(audible&&spoken)n.audioStart();await f.clock.flush();
   const result={spoken,atEnd:await retiredAtOnce(f,input,seen,()=>{f.agent='another-agent-session';n.emit({sessionId:n.sessionId,type:'level',peak:.2});})};
   f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined);assert.equal(n.spoken.length,spoken);
   return result;
  }finally{await closeSocket(f);}
 });
 assert.equal(atEnd.abortedAtOnce,true);assert.equal(atEnd.socketStopped,true);assert.equal(atEnd.heardAfter,0);
});

for(const [name,act] of fences)
test(`speech socket: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;if(spoken)n.audioStart();await f.clock.flush();
   void act(f);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(n.cancels,1,'the ack is cancelled');
   f.releaseReply();await f.clock.flush();assert.equal(n.spoken.length,spoken);
   return result;
  }finally{await closeSocket(f);}
 });
});

// Input is already held closed; its lifecycle observer still makes a real socket failure terminal under Mute.
test('speech socket: Mute during an ack, then a socket failure: handled as without an ack, muted and after Unmute',async()=>{
 const run=async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   f.renderChat().toggleMute();await f.clock.flush();
   n.fail('protocol');await f.clock.flush();
   const muted=outcome(f,input,seen);
   f.renderChat().toggleMute();await f.clock.flush();
   const unmuted=outcome(f,input,seen);
   return {spoken,muted,unmuted};
  }finally{await closeSocket(f);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.muted,withoutAck.muted);assert.deepEqual(withAck.unmuted,withoutAck.unmuted);
 assert.equal(withAck.unmuted.state,'error','Unmute finds the socket gone');assert.equal(withAck.unmuted.aborted,true);
});

// On-device live voice: its own speaker plays the ack, so no capture end is ever the ack's: all
// are immediate ('protocol' included).
const deviceEnds=[
 ['capture failure',Object.assign(Error('Microphone capture was interrupted.'),{code:'capture'})],
 ['phone call',Object.assign(Error('Voice paused.'),{code:'capture',reason:'call-active'})],
 ['audio focus loss',Object.assign(Error('Voice paused.'),{code:'capture',reason:'audio-focus-lost'})],
 ['expiry',Object.assign(Error('Live transcription expired.'),{code:'live-asr',reason:'expired'})],
 ['permission',Object.assign(Error('Microphone permission denied'),{code:'permission-denied'})],
 ['protocol',Object.assign(Error('Cloud streaming speech is unavailable.'),{code:'protocol'})],
 ['unknown code',Object.assign(Error('Something else.'),{code:'an-unknown-code'})],
 ['no error',undefined],
];
for(const audible of [false,true])for(const [name,error] of deviceEnds)
test(`on-device live voice: ${name} while the ack ${audible?'plays':'waits for its first audio'} stops the conversation and its request at once`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=onDeviceLiveFixture(),seen=watchReply(f);f.s.hold=text=>text===ACK;if(!audible)f.s.holdStart=text=>text===ACK;
  try{
   const input=await liveTurn(f,1300);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   f.s.handlers.onEnd(error);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(f.s.plays[0].signal.aborted,true,'the ack is cancelled with its turn');
   f.releaseReply();await f.clock.flush();assert.equal(f.s.plays.length,spoken);
   return result;
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.state,'error');
});

for(const [name,act] of fences)
test(`on-device live voice: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const f=onDeviceLiveFixture(),seen=watchReply(f);f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,1300);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   void act(f);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(f.s.plays[0].signal.aborted,true);
   return result;
  }finally{await closeLive(f);}
 });
});

// The recorded-clip loop: its capture is retired before any cue, so no capture can end while the
// ack plays. Stop and navigation cancel the ack and the turn at once; the ack's own playback
// failing for a lifecycle reason is silence and holds nothing (the turn goes on as without an ack).
for(const [name,act] of fences)
test(`native batch: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const t=await batchTurn({holdPlayback:true}),seen=watchReply(t.f);
  try{
   progress(t.input,{label});await t.clock.flush();const spoken=t.texts().length;
   if(spoken)assert.ok(t.f.activePlayback,'the ack is playing');
   void act(t.f);await t.clock.flush();
   const result={spoken,atEnd:outcome(t.f,t.input,seen)};
   if(spoken)assert.equal(t.f.stopPlaybackInputs?.length,1,'the playing ack is stopped');
   t.f.releaseReply();await t.clock.flush();assert.equal(t.texts().length,spoken,'nothing is spoken after it');
   return result;
  }finally{await closeBatch(t);}
 });
});

for(const code of ['call-active','audio-focus-lost','expired','capture','permission-denied','an-unknown-code'])
test(`native batch: the ack's playback failing for '${code}' is silence and holds nothing; the turn goes on as without an ack`,async()=>{
 const run=async label=>{
  const t=await batchTurn(),seen=watchReply(t.f);const synthesize=t.f.driver.synthesize;
  t.f.driver.synthesize=async input=>{if(input.text!==ACK)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Speech stopped'),{code});};
  try{
   progress(t.input,{label});await t.clock.flush();const spoken=t.texts().length;
   const during=outcome(t.f,t.input,seen);
   t.f.releaseReply();await t.clock.flush();
   return {spoken,during,after:outcome(t.f,t.input,seen),texts:t.texts().filter(text=>text!==ACK)};
  }finally{await closeBatch(t);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.during,withoutAck.during);assert.deepEqual(withAck.after,withoutAck.after);assert.deepEqual(withAck.texts,withoutAck.texts);
 assert.equal(withAck.during.aborted,false);assert.deepEqual(withAck.texts,[REPLY]);
});

// --- The live capture with and without an ack (adapter level: the session's own rules apply).
test('native streaming: with no ack, callbacks from the closed capture cannot interrupt after 700 ms',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  progress(input,{label:''});await f.clock.flush();assert.deepEqual(f.s.spoken(),[]);
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  h.onSpeechEnd(2);h.onSegment('Move it to noon.');assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

test('native streaming: closed-capture segments stay stale in order; neither segment is sent',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);h.onSpeechEnd(2);ack.finish();await f.clock.flush();await f.clock.advance(1600);
  h.onSpeechStart(3);h.onSegment('checking your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the held echo carries no transcript');
  h.onSpeechEnd(4);h.onSegment('Move it to noon.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: closed-capture segments cannot consume a later live capture\'s words',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);h.onSpeechEnd(2);ack.finish();await f.clock.flush();await f.clock.advance(1600);
  h.onSpeechStart(3);h.onSpeechEnd(4);
  h.onSegment('Actually make it Friday.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the words of the ignored segment are not the session\'s');
  h.onSegment('Move it to noon.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

// Both sides of the old echo-tail boundary use the already closed handle; neither can interrupt.
for(const after of [1000,1600])
test(`native streaming: stale speech ${after} ms after the ack audio ended cannot interrupt the closed-input turn`,async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();await f.clock.advance(after);
  h.onSpeechStart(1);await f.clock.advance(800);
  assertInputHeld(f,input);
 }finally{await closeLive(f);}
});

test('native streaming: an ack never starts over the user: it is silence while their speech is open',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);const h=f.s.handlers;
  h.onSpeechStart(1);progress(input);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[],'no ack over the user');
  h.onSpeechEnd(2);h.onSegment(null);await f.clock.advance(0);
  progress(input);await f.clock.flush();assert.deepEqual(f.s.spoken(),[],'one ack per turn: dropped is silence');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);assert.equal(input.signal.aborted,false);
 }finally{await closeLive(f);}
});

test('native streaming: an ack cancelled before its first audio leaves no echo window: closed-capture speech cannot interrupt by time',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  input.onReplyStarted();await f.clock.flush();assert.equal(ack.signal.aborted,true);assert.equal(ack.started,undefined,'no ack audio');
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);
 }finally{await closeLive(f);}
});

test('native streaming: speech that starts before the ack audio is still checked against the ack: its echo carries no transcript',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);ack.start();h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  await f.clock.advance(800);assert.equal(input.signal.aborted,false,'a closed segment never confirms by time');
 }finally{await closeLive(f);}
});

test('native streaming: even past the echo window, a closed capture cannot submit the ack\'s words',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();await f.clock.advance(9001);
  h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the retired capture cannot interrupt');
  assertInputHeld(f,input);f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,1,'closed-capture speech is not sent');
 }finally{await closeLive(f);}
});

// Speech ignored in the ack (no echo cancellation) is left open on the closed capture; held speech
// is not, since Mute hands it to the session (below).
test('native streaming without echo cancellation: a reopened capture (Mute, then Unmute) carries no ignored speech or speaking state from the closed one',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.s.handlers.onSpeechStart(1);
  f.renderChat().toggleMute();await f.clock.flush();ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
  f.renderChat().toggleMute();await f.clock.flush();assert.equal(f.s.listens,2);
  const h=f.s.handlers;h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment('And lunch on Friday.');await f.clock.advance(0);
  assert.equal(f.sends,2);progress(f.sendInputs[1]);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY,ACK],'the next ack plays: the closed capture no longer counts as speaking');
 }finally{await closeLive(f);}
});

// Stale callbacks remain adversarial after busy close, with and without an ACK. Speech ends pass
// Infinity to preserve the original timing input; none of these callbacks represents new physical input.
const liveRoutes=[['native streaming',()=>streamingFixture(),0],['on-device live voice',()=>onDeviceLiveFixture(),1300]];
// Two delayed bursts from the closed handle cannot concatenate into a fresh turn on either route.
for(const [route,make,gapMs] of liveRoutes)
test(`${route}: two bursts from the closed capture cannot create a turn, with or without an ack`,async()=>{
 const atEnd=await sameClosedInputWithOrWithoutAck(async label=>{
  const f=make();f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;const h=f.s.handlers;
   h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(Infinity);h.onSegment('Wait, put the lunch on');await f.clock.advance(0);
   const aborted=input.signal.aborted;
   // Keep the second burst and pause while the original request remains pending.
   await f.clock.advance(600);h.onSpeechStart(2);await f.clock.advance(900);
   h.onSpeechEnd(Infinity);h.onSegment("Friday's list instead please");await f.clock.advance(0);
   f.releaseReply();await f.clock.advance(gapMs);
   return {spoken,atEnd:{aborted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.aborted,false);assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.']);
});

// Mute during the busy hold preserves the manual flag; a stale final cannot create another turn.
for(const [route,make,gapMs] of liveRoutes)
test(`${route}: Mute in the busy hold does not submit a stale capture final`,async()=>{
 const atEnd=await sameClosedInputWithOrWithoutAck(async label=>{
  const f=make();f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;const h=f.s.handlers;
   h.onSpeechStart(1);await f.clock.advance(300);
   f.renderChat().toggleMute();await f.clock.flush();
   // The closed capture delivers its open segment's end and final, as a real close does.
   h.onSpeechEnd(Infinity);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
   const aborted=input.signal.aborted;
   f.releaseReply();await f.clock.advance(gapMs);
   return {spoken,atEnd:{aborted,muted:f.renderChat().muted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.aborted,false);assert.equal(atEnd.muted,'true');assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.']);
});

// Even after the answer is delivered, input remains closed until final playback and cleanup settle.
test('native streaming: after the answer, the capture stays closed through reply audio preparation',async()=>{
 await sameClosedInputWithOrWithoutAck(async label=>{
  const f=streamingFixture();f.s.hold=text=>text===ACK||text===REPLY;f.s.holdStart=text=>text===REPLY;
  try{
   const input=await liveTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   f.releaseReply();await f.clock.flush();
   assert.equal(f.s.spoken().at(-1),REPLY,'the reply is requested, its audio not yet started');
   f.s.handlers.onSpeechStart(1);await f.clock.advance(800);
   assertInputHeld(f,input);return {spoken,atEnd:{aborted:input.signal.aborted}};
  }finally{await closeLive(f);}
 });
});

// Preserve corrections across the reply's start in both duplex modes, with and without Mute.
// These are callbacks on the closed handle: they cannot cut final playback or create another send.
for(const fullDuplex of [false,true])for(const mute of [false,true])
test(`native streaming${fullDuplex?'':' without echo cancellation'}: a correction held in the ack's tail and still open when the reply starts ${mute?'and finalized by Mute':'and ending on its own'} cannot cut the reply or be sent from the closed capture`,async()=>{
 const atEnd=await sameClosedInputWithOrWithoutAck(async label=>{
  const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK||text===REPLY;
  try{
   const input=await liveTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   await f.clock.advance(500);f.s.plays[0]?.finish();await f.clock.flush();
   await f.clock.advance(200);const h=f.s.handlers;h.onSpeechStart(1);
   await f.clock.advance(300);f.releaseReply();await f.clock.flush();
   const reply=f.s.plays.find(play=>play.text===REPLY);assert.equal(reply?.started,true,'the reply plays while the speech is open');
   await f.clock.advance(100);if(mute){f.renderChat().toggleMute();await f.clock.flush();}
   h.onSpeechEnd(Infinity);h.onSegment('No wait, make it Friday instead please.');await f.clock.advance(0);await f.clock.flush();
   return {spoken,atEnd:{aborted:input.signal.aborted,replyCut:reply.signal.aborted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.aborted,false);assert.equal(atEnd.replyCut,false);assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.']);
});

// The ack's own echo released that way still meets the echo gate: it neither cuts the reply nor is sent.
for(const fullDuplex of [false,true])
test(`native streaming${fullDuplex?'':' without echo cancellation'}: the ack's echo held in its tail and still open when the reply starts neither cuts the reply nor is sent`,async()=>{
 const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK||text===REPLY;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();f.s.plays[0].finish();await f.clock.flush();
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(300);
  f.releaseReply();await f.clock.flush();
  const reply=f.s.plays.find(play=>play.text===REPLY);assert.equal(reply?.started,true);
  await f.clock.advance(800);h.onSpeechEnd(Infinity);h.onSegment('your calendar now');await f.clock.advance(0);await f.clock.flush();
  assert.equal(reply.signal.aborted,false);assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
 }finally{await closeLive(f);}
});

// An owner-review pause closes the microphone and the session drops what it heard, so speech held
// in the ack's window when its turn pauses is dropped with it: past the session's 700 ms rule the
// paused turn and its review stay, the same as a turn with no ack and no speech. Handed to the
// session at the pause instead, its barge-in timer outlived the dropped speech and cut the turn.
const PAUSE={complete:false,awaitingUserInput:{proposalId:'proposal-1',digest:'digest-1'}};
for(const [route,make,gapMs,heldIn] of [['native streaming',()=>streamingFixture(),0,['the ack','its tail']],['native streaming without echo cancellation',()=>streamingFixture({fullDuplex:false}),0,['its tail']],['on-device live voice',()=>onDeviceLiveFixture(),1300,['the ack','its tail']]])
for(const where of heldIn)
test(`${route}: speech held in ${where} when the ack's turn pauses for owner review is dropped; the pause stays`,async()=>{
 const run=async label=>{
  const f=make();f.s.hold=text=>text===ACK;f.badReply=PAUSE;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   if(where==='its tail'){f.s.plays[0]?.finish();await f.clock.flush();await f.clock.advance(200);}
   if(label)f.s.handlers.onSpeechStart(1);
   await f.clock.advance(300);f.releaseReply();await f.clock.flush();
   // The session cancelled the capture at the pause: nothing more is heard from it.
   await f.clock.advance(800);await f.clock.flush();
   return {spoken,later:{state:f.renderChat()?.state,aborted:input.signal.aborted,sends:f.sends,replied:f.s.spoken().includes(REPLY)}};
  }finally{await closeLive(f);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1,'the ack was playing');assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.later,withoutAck.later);
 assert.deepEqual(withAck.later,{state:'awaiting-user-input',aborted:false,sends:1,replied:false});
});

// --- Mute, then an owner-review pause. Mute hands a start held in the ack's window to the session,
// whose 700 ms barge-in timer then runs from Mute while the muted capture finalizes. A close that
// waits for its final (the speech socket waits for Cloud's, up to 2.5 s; on-device, the
// compatibility route waits for the bridge's stop) lets the pause land first. The session drops what
// it heard there, and the start handed over at Mute is closed with it, so the timer finds no open
// speech: the paused turn keeps its review and nothing heard is sent (the session's pause rule).
// After the owner's approval the reply is spoken, the microphone stays off until Unmute, and Unmute
// really reopens the capture, which hears the next turn. Each row holds the speech 900 ms before
// Mute (held, it never cut its turn by time); the pause lands 100 ms after Mute and the capture's
// final 300 ms (before the timer) or 1000 ms (after it) after Mute.
const PAUSED={...PAUSE,userMessageId:'paused-user-message',assistantMessageId:'paused-reply'};
const APPROVED='Approved matching reply.',CORRECTION='Actually make it Friday instead.',LATE=[300,1000];
/** The owner's separately approved result of the paused turn, delivered as the app does. */
const approvePause=(f,input)=>f.shell.resumeReadReplyVoice({proposalId:PAUSE.awaitingUserInput.proposalId,digest:PAUSE.awaitingUserInput.digest,requestId:input.turnId,conversationId:f.conversation,inReplyTo:PAUSED.userMessageId},{requestId:input.turnId,conversationId:f.conversation,inReplyTo:PAUSED.userMessageId,messageId:'approved-reply',text:APPROVED});
async function muteThenPause(f,input,late,finalize){
 const at=f.clock;
 f.renderChat().toggleMute();await at.flush();assert.equal(f.renderChat().muted,'true');
 await at.advance(100);f.releaseReply();await at.flush();
 assert.equal(f.renderChat()?.state,'awaiting-user-input','the reply pauses for owner review');
 await at.advance(late-100);await finalize();await at.flush();await at.advance(2000);await at.flush();
 return {state:f.renderChat()?.state,muteDisabled:f.renderChat()?.muteDisabled,aborted:input.signal.aborted,sends:f.sends};
}
const keptPause={state:'awaiting-user-input',muteDisabled:true,aborted:false,sends:1};
function rejectWrongApproval(f,input){
 const hint={proposalId:PAUSE.awaitingUserInput.proposalId,digest:'wrong-digest',requestId:input.turnId,conversationId:f.conversation,inReplyTo:PAUSED.userMessageId};
 assert.equal(f.shell.resumeReadReplyVoice(hint,{requestId:input.turnId,conversationId:f.conversation,inReplyTo:PAUSED.userMessageId,messageId:'wrong-approved-reply',text:APPROVED}),false);
 assert.equal(f.renderChat()?.state,'awaiting-user-input');assert.equal(input.signal.aborted,false);
}
for(const echoCancelled of [true,false])for(const where of echoCancelled?['the ack','its tail']:['its tail'])for(const late of LATE)
test(`speech socket${echoCancelled?'':' without echo cancellation'}: Mute during speech held in ${where}, an owner-review pause, the capture's final ${late} ms after Mute, approval, Unmute: the pause stays, no orphan abort, and Unmute reopens capture`,async()=>{
 const f=socketFixture({echoCancelled}),n=f.n;f.badReply=PAUSED;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.spoken,[ACK]);n.audioStart();await f.clock.flush();
  if(where==='its tail'){n.complete();await f.clock.flush();await f.clock.advance(200);}
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(900);
  assert.equal(input.signal.aborted,false,'held speech never cuts its pending turn by time');
  const paused=await muteThenPause(f,input,late,()=>n.emit({sessionId:n.sessionId,type:'speech-end',text:CORRECTION}));
  assert.deepEqual(paused,keptPause);assert.deepEqual(n.mutes,[false,true],'muted at Mute, and not reopened by the pause');
  rejectWrongApproval(f,input);f.badReply=undefined;assert.equal(approvePause(f,input),true,'the approval resumes the paused turn');await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,APPROVED]);n.audioStart();n.complete();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'listening');assert.equal(f.renderChat()?.muted,'true');assert.deepEqual(n.mutes,[false,true],'still off after the approved reply');
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.renderChat()?.muted,'false');assert.deepEqual(n.mutes,[false,true,false],'Unmute reopens the socket capture');
  n.utter('And lunch on Friday.');await f.clock.advance(0);
  assert.deepEqual(f.sendInputs.map(value=>value.text),['Add lunch with Sam tomorrow.','And lunch on Friday.'],'the paused correction is never sent; the reopened capture hears the next turn');
  assert.equal(n.stops,0,'the speech socket stays open throughout');
 }finally{await closeSocket(f);}
});
// On-device live voice: the shared native routing ends the open segment when Mute closes the capture
// (before the pause can land); the compatibility route (no native routing) ends it after the bridge
// stops. The capture's final comes `late` ms after Mute on both.
function onDeviceClosingFixture(lateEnd){
 const f=onDeviceLiveFixture();f.s.listens=0;f.s.capturing=false;
 f.box.nativeAssistantListener=()=>async input=>{
  f.s.listens++;f.s.capturing=true;let open=false;
  const h={...input,onSpeechStart:at=>{open=true;input.onSpeechStart(at);},onSpeechEnd:at=>{if(!open)return;open=false;input.onSpeechEnd(at);}};f.s.handlers=h;
  return {fullDuplex:true,close:async()=>{if(lateEnd&&f.s.listens===1)await new Promise(resolve=>{f.s.confirmInitialClose=()=>{f.s.confirmInitialClose=undefined;resolve();};});else if(lateEnd)await new Promise(resolve=>f.s.stopped=resolve);f.s.capturing=false;h.onSpeechEnd(Date.now());},cancel:async()=>{f.s.capturing=false;open=false;}};
 };
 return f;
}
for(const lateEnd of [false,true])for(const where of ['the ack','its tail'])for(const late of LATE)
test(`on-device live voice (${lateEnd?'compatibility route: the segment ends after the bridge stops':'native routing: the segment ends at Mute'}): Mute during speech held in ${where}, an owner-review pause, the capture's final ${late} ms after Mute, approval, Unmute: the pause stays, no orphan abort, and Unmute reopens capture`,async()=>{
 const f=onDeviceClosingFixture(lateEnd);f.s.hold=text=>text===ACK;f.badReply=PAUSED;
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();assert.deepEqual(f.s.spoken(),[ACK]);
  if(where==='its tail'){f.s.plays[0].finish();await f.clock.flush();await f.clock.advance(200);}
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(900);
  assert.equal(input.signal.aborted,false,'held speech never cuts its pending turn by time');
  const paused=await muteThenPause(f,input,late,async()=>{f.s.stopped?.();await f.clock.flush();h.onSpeechEnd(Infinity);h.onSegment(CORRECTION);});
  assert.deepEqual(paused,keptPause);assert.equal(f.s.capturing,false);assert.equal(f.s.listens,1);
  rejectWrongApproval(f,input);f.badReply=undefined;assert.equal(approvePause(f,input),true,'the approval resumes the paused turn');await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,APPROVED]);assert.equal(f.renderChat()?.state,'listening');assert.equal(f.renderChat()?.muted,'true');assert.equal(f.s.listens,1,'still off after the approved reply');
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.renderChat()?.muted,'false');assert.equal(f.s.listens,2,'Unmute reopens the capture');assert.equal(f.s.capturing,true);
  const next=f.s.handlers;next.onSpeechStart(1);next.onSpeechEnd(2);next.onSegment('And lunch on Friday.');await f.clock.advance(1300);if(lateEnd){assert.equal(f.sends,1,'second send also waits for confirmed close');f.s.stopped();await f.clock.flush();}
  assert.deepEqual(f.sendInputs.map(value=>value.text),['Add lunch with Sam tomorrow.','And lunch on Friday.'],'the paused correction is never sent; the reopened capture hears the next turn');
 }finally{f.s.stopped?.();await closeLive(f);}
});
// The recorded-clip loop has no Mute control and holds no start: its clip capture is retired before
// the ack. An owner-review pause after the ack keeps its review with no capture restarted, and the
// approval speaks the reply, as with no ack.
test('native batch: no Mute control and no held start; an owner-review pause after the ack stays and the approval speaks the reply, as with no ack',async()=>{
 const run=async label=>{
  const t=await batchTurn(),f=t.f;f.badReply=PAUSED;
  try{
   progress(t.input,{label});await t.clock.flush();const spoken=t.texts().length;
   const control=f.renderChat()?.muteDisabled;const starts=f.starts;
   f.releaseReply();await t.clock.flush();await t.clock.advance(2500);await t.clock.flush();
   const paused={state:f.renderChat()?.state,aborted:t.input.signal.aborted,restarted:f.starts-starts,recording:f.activeRecording,sends:f.sends};
   f.badReply=undefined;const approved=approvePause(f,t.input);await t.clock.flush();await t.clock.advance(0);
   return {spoken,later:{control,paused,approved,texts:t.texts().filter(text=>text!==ACK)}};
  }finally{await closeBatch(t);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.later,withoutAck.later);
 assert.deepEqual(withAck.later,{control:true,paused:{state:'awaiting-user-input',aborted:false,restarted:0,recording:null,sends:1},approved:true,texts:[APPROVED]});
});

// A retired socket handle's correction and ACK echo are both stale, even before the owner pause.
// Preserve Mute/final ordering and keep the later review current without submitting either.
for(const [words,correction] of [[CORRECTION,true],['your calendar now',false]])
test(`speech socket: Mute during speech held in the ack's tail, its final 300 ms after Mute and before the reply: ${correction?'the stale correction':'the stale ACK echo'} is not sent and the owner-review pause stays`,async()=>{
 const f=socketFixture(),n=f.n;f.badReply=PAUSED;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();await f.clock.advance(200);
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(900);
  f.renderChat().toggleMute();await f.clock.flush();await f.clock.advance(300);
  n.emit({sessionId:n.sessionId,type:'speech-end',text:words});await f.clock.advance(0);await f.clock.flush();
  assert.equal(input.signal.aborted,false,'the native capture was closed before the ACK');
  f.releaseReply();await f.clock.advance(0);await f.clock.flush();await f.clock.advance(2000);
  assert.deepEqual(f.sendInputs.map(value=>value.text),['Add lunch with Sam tomorrow.']);
  assert.equal(f.renderChat()?.state,'awaiting-user-input');assert.equal(input.signal.aborted,false);assert.deepEqual(n.mutes,[false,true]);
 }finally{await closeSocket(f);}
});

// No-ACK controls retain the same timings with busy input closed: no timer cuts the original
// owner-review turn, and the retired handle's late final never becomes another request.
for(const late of LATE)
test(`speech socket with no ack (control): the same speech, Mute, the reply and the capture's final ${late} ms after Mute: closed socket input cannot cut the turn or submit its late final`,async()=>{
 const f=socketFixture(),n=f.n;f.badReply=PAUSED;
 try{
  const input=await socketTurn(f);
  progress(input,{label:''});await f.clock.flush();assert.deepEqual(n.spoken,[]);
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(600);
  assert.equal(input.signal.aborted,false);await f.clock.advance(300);
  assert.equal(input.signal.aborted,false,'a stale start cannot arm an interrupt');
  f.renderChat().toggleMute();await f.clock.flush();await f.clock.advance(100);f.releaseReply();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'awaiting-user-input','the original owner review is preserved');
  await f.clock.advance(late-100);n.emit({sessionId:n.sessionId,type:'speech-end',text:CORRECTION});await f.clock.advance(0);await f.clock.flush();
  assert.deepEqual(f.sendInputs.map(value=>value.text),['Add lunch with Sam tomorrow.']);
 }finally{await closeSocket(f);}
});
// With no speech, Mute, an owner-review pause, approval and Unmute run the same with the ack and with
// no ack, on the speech socket and on-device.
for(const [route,make,start,audio,gapMs] of [
 ['speech socket',()=>socketFixture(),socketTurn,f=>({start:()=>f.n.audioStart(),end:()=>f.n.complete(),capturing:()=>f.n.mutes.at(-1)===false,utter:text=>f.n.utter(text),spoken:()=>f.n.spoken}),0],
 ['on-device live voice',()=>onDeviceClosingFixture(false),f=>liveTurn(f,1300),f=>({start:()=>{},end:()=>{},capturing:()=>f.s.capturing,utter:text=>{const h=f.s.handlers;h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment(text);},spoken:()=>f.s.spoken()}),1300],
])
test(`${route}: Mute during the ack's turn with no speech, an owner-review pause, approval and Unmute run as with no ack`,async()=>{
 const run=async label=>{
  const f=make();f.badReply=PAUSED;const io=audio(f);
  try{
   const input=await start(f);
   progress(input,{label});await f.clock.flush();const spoken=io.spoken().length;if(spoken)io.start();await f.clock.flush();
   const paused=await muteThenPause(f,input,1000,()=>{});
   f.badReply=undefined;const approved=approvePause(f,input);await f.clock.flush();io.start();io.end();await f.clock.flush();
   const resumed={state:f.renderChat()?.state,muted:f.renderChat()?.muted,capturing:io.capturing(),spoken:io.spoken().filter(text=>text!==ACK)};
   f.renderChat().toggleMute();await f.clock.flush();const reopened=io.capturing();
   io.utter('And lunch on Friday.');await f.clock.advance(gapMs);
   return {spoken,later:{paused,approved,resumed,reopened,sent:f.sendInputs.map(value=>value.text)}};
  }finally{f.s?.stopped?.();if(f.n)await closeSocket(f);else await closeLive(f);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.later,withoutAck.later);
 assert.deepEqual(withAck.later,{paused:keptPause,approved:true,resumed:{state:'listening',muted:'true',capturing:false,spoken:[APPROVED]},reopened:true,sent:['Add lunch with Sam tomorrow.','And lunch on Friday.']});
});

// --- Delayed audio and stale finals. Every original ACK/duplex/timing/word combination stays.
// The first capture is already confirmed closed before send. Its callbacks are adversarial stale
// handles, never a second live microphone: neither its correction nor its echo may interrupt or
// submit. Reply first-audio delay and Mute do not reopen it. Fresh input after normal drain is
// covered separately by the positive next-turn controls and the reopen lifetime matrix below.
const ECHO='your calendar now';
async function lateCut({ack,fullDuplex,where,words,firstAudio}){
 const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK||text===REPLY;f.s.holdStart=text=>text===REPLY;
 try{
  const input=await liveTurn(f);
  progress(input,{label:ack?ACK:''});await f.clock.flush();
  if(where==='its tail'){await f.clock.advance(500);f.s.plays[0]?.finish();await f.clock.flush();}
  await f.clock.advance(200);const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(300);
  f.releaseReply();await f.clock.flush();const reply=f.s.plays.find(play=>play.text===REPLY);assert.ok(reply,'the answered reply is requested');
  await f.clock.advance(firstAudio);const cutBeforeFirstAudio=reply.signal.aborted;if(!cutBeforeFirstAudio)reply.start();await f.clock.flush();
  await f.clock.advance(300);h.onSpeechEnd(Infinity);h.onSegment(words);await f.clock.advance(0);await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(f.s.captures.filter(c=>c.active).length,0);
  const replyCut=reply.signal.aborted;if(!replyCut){reply.finish();await f.clock.flush();}
  f.releaseReply();await f.clock.advance(0);await f.clock.flush();
  return {cutBeforeFirstAudio,replyPlayedOut:!replyCut,sent:f.sendInputs.slice(1).map(value=>value.text)};
 }finally{await closeLive(f);}
}
for(const ack of [true,false])for(const fullDuplex of [true,false])for(const where of ack?['the ack','its tail']:['its tail'])for(const words of ack?[ECHO,CORRECTION]:[CORRECTION])for(const firstAudio of [300,550,1000]){
 // Keep every ACK/duplex/timing/word combination; all callbacks originate on the closed handle.
 const cut=false; // The capture is closed before send: neither a timer nor a stale final can cut this reply.
 const correction=false; // Both correction and echo here come from the retired capture.
 test(`closed busy capture, delayed final audio: ${ack?'with the ack':'with no ack'}${fullDuplex?'':', without echo cancellation'}: ${words===ECHO?'the ack\'s echo':'a correction'} starting ${ack?'in '+where:'as it would in the ack\'s tail'}, the turn answered 300 ms later, the reply's first audio ${firstAudio} ms after the answer: ${cut?'cut before its first audio':'first audio plays'}, ${correction||cut?'the reply is not played out':'the reply plays out'}, ${correction?'the correction is sent':'nothing is sent'}`,async()=>{
  assert.deepEqual(await lateCut({ack,fullDuplex,where,words,firstAudio}),{cutBeforeFirstAudio:cut,replyPlayedOut:!cut&&!correction,sent:correction?[CORRECTION]:[]});
 });
}
// At Mute the retired handle reports speech and a delayed final; the manual flag stays off through reply drain.
async function muteCut({ack,fullDuplex,words,finalAt}){
 const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input,{label:ack?ACK:''});await f.clock.flush();
  await f.clock.advance(500);f.s.plays[0]?.finish();await f.clock.flush();await f.clock.advance(200);
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(300);
  f.renderChat().toggleMute();await f.clock.flush();await f.clock.advance(finalAt);const cutBeforeFinal=input.signal.aborted;
  h.onSpeechEnd(Infinity);h.onSegment(words);await f.clock.advance(0);await f.clock.flush();const aborted=input.signal.aborted;assert.equal(f.s.captures.filter(c=>c.active).length,0);
  f.releaseReply();await f.clock.advance(0);await f.clock.flush();assert.equal(f.s.listens,1,'manual Mute survives reply drain');
  return {cutBeforeFinal,aborted,replied:f.s.spoken().includes(REPLY),sent:f.sendInputs.slice(1).map(value=>value.text)};
 }finally{await closeLive(f);}
}
for(const ack of [true,false])for(const fullDuplex of [true,false])for(const words of ack?[ECHO,CORRECTION]:[CORRECTION])for(const finalAt of [300,550,1000]){
 const cut=false,correction=false; // Mute during a hold cannot revive the retired capture or submit its final.
 test(`closed busy capture at Mute, delayed final: ${ack?'with the ack':'with no ack'}${fullDuplex?'':', without echo cancellation'}: ${words===CORRECTION?'a correction':'the ack\'s echo'} reported on the closed handle at Mute while the turn is pending, its final ${finalAt} ms after Mute: ${cut?'the turn is cut by time before the final':'the turn waits for the final'}; ${correction?'the correction is sent':cut?'nothing is sent and the turn is lost':'the reply is spoken'}`,async()=>{
  assert.deepEqual(await muteCut({ack,fullDuplex,words,finalAt}),{cutBeforeFinal:cut,aborted:cut||correction,replied:!cut&&!correction,sent:correction?[CORRECTION]:[]});
 });
}

// Attempted stale speech cannot interrupt; a real socket protocol end still retires the turn immediately.
test('speech socket: a \'protocol\' failure after a stale closed-capture start ends the conversation at once, as without an ack',async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);n.holdCancel=true;
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(800);
   assert.equal(input.signal.aborted,false,'the closed capture cannot interrupt, but its lifecycle observer remains');
   n.fail('protocol');await f.clock.flush();
   return {spoken,atEnd:outcome(f,input,seen)};
  }finally{await closeSocket(f);}
 });
 assert.equal(atEnd.state,'error');
});

// --- The ack lives in the owning voice adapter: no Alpha cue module, and no live path claims a
// retired capture (the helper takes null there; the clip loop still requires retirement).
test('the ack is folded into the voice adapter: no cue module, and only the clip loop claims a retired capture',()=>{
 const adapter=fs.readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8');
 assert.equal(fs.existsSync('apps/app/src/runtime/live-voice-cue.ts'),false);
 assert.doesNotMatch(adapter,/captureRetired:\(\)=>true/);
 assert.equal((adapter.match(/cueSpeech=\{captureRetired:/g)||[]).length,2);
 assert.match(adapter,/cueSpeech=\{captureRetired:null,/);
 assert.match(adapter,/cueSpeech=\{captureRetired:\(\)=>batchCaptureRetired,/);
});

// --- Busy hold over the real speech socket bridge (the shared session from elizaOS
// claude/busy-mic-native-hold-20261101): submission closes the capture, and the turn is sent only
// once the native mute confirmed that close, so the ack (spoken inside the request) and the reply
// never play over open input; a close the bridge refuses, or does not confirm within its 2.5 s
// bound, ends the conversation, and so does a Mute close that fails before a turn waits on it, at
// once, also with nothing heard (idle); nothing reopens either way. The closed capture still
// hears the socket's end (the bridge keeps the last listen as its lifecycle observer), so a
// transport, expiry, protocol or owner failure during the hold ends the turn at once, also while
// the ack is refused. A refusal alone, on a healthy socket, stays silence. These rows need a
// projected shared session with the hold; the pinned one predates it.
const busyHold={}; // Mandatory paired tests: the suite prerequisite rejects a legacy projection.
const holdFaults=[
 ['a transport failure',f=>f.n.fail('connection-lost'),'error'],
 ['expiry',f=>f.n.fail('expired'),'error'],
 ['a protocol failure',f=>f.n.fail('protocol'),'error'],
 // An owner change closes the conversation (no error state), as with an open capture.
 ["the renderer bridge's owner check",f=>{f.agent='another-agent-session';f.n.emit({sessionId:f.n.sessionId,type:'level',peak:.2});},undefined],
];
const holdStages=[
 ['before the ack',async()=>{}],
 ['while the ack is refused',async(f,input)=>{f.n.refuse=text=>text===ACK;progress(input);await f.clock.flush();assert.deepEqual(f.n.refused,[ACK]);assert.equal(input.signal.aborted,false,'a refusal alone is silence');}],
 ['before the final reply',async(f,input)=>{progress(input);await f.clock.flush();f.n.audioStart();f.n.complete();await f.clock.flush();assert.deepEqual(f.n.spoken,[ACK]);}],
];
for(const [stage,before] of holdStages)for(const [fault,act,ended] of holdFaults)
test(`busy hold over the speech socket: ${fault} after the capture's confirmed close, ${stage}, ends the turn and the conversation at once`,busyHold,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  assert.deepEqual(n.mutes,[false,true],'the capture closed before the request was sent');
  await before(f,input);
  act(f);const abortedAtOnce=input.signal.aborted;await f.clock.flush();
  assert.equal(abortedAtOnce,true,'the request is cancelled with the socket end itself');
  assert.equal(f.renderChat()?.state,ended);
  f.releaseReply();await f.clock.flush();
  assert.equal(seen.reply,undefined,'the cancelled request never completes');
  assert.equal(n.spoken.includes(REPLY),false,'the reply is never spoken');
  assert.deepEqual(n.mutes,[false,true],'nothing reopens');
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: an ack refused on a healthy socket is silence; the reply plays and the capture reopens once after it',busyHold,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);n.refuse=text=>text===ACK;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.refused,[ACK]);
  f.releaseReply();await f.clock.flush();assert.deepEqual(n.spoken,[REPLY]);
  assert.deepEqual(n.mutes,[false,true],'held while the reply plays');
  n.audioStart();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(seen.reply?.text,REPLY);assert.equal(f.renderChat()?.state,'listening');
  assert.deepEqual(n.mutes,[false,true,false],'reopened once, after the reply played');
  n.utter('And lunch on Friday.');await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'And lunch on Friday.');
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: a deferred close sends nothing, so no ack plays, until the native mute confirmed it',busyHold,async()=>{
 const f=socketFixture(),n=f.n;let confirm;n.closeMute=()=>new Promise(resolve=>confirm=resolve);
 try{
  await f.shell.startVoice();await f.clock.flush();
  n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(2400);
  assert.deepEqual(n.mutes,[false,true]);assert.equal(f.sends,0,'no request while the microphone may be on');assert.deepEqual(n.spoken,[]);
  confirm();await f.clock.flush();
  assert.equal(f.sends,1);const input=f.sendInputs[0];
  progress(input);await f.clock.flush();assert.deepEqual(n.spoken,[ACK],'the ack plays once input is closed');
  n.audioStart();n.complete();f.releaseReply();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,REPLY]);n.audioStart();n.complete();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'listening');assert.deepEqual(n.mutes,[false,true,false]);
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: a close the native mute refuses ends the conversation; nothing is sent, spoken or reopened',busyHold,async()=>{
 const f=socketFixture(),n=f.n;n.closeMute=async()=>{throw Error('Voice is closed');};
 try{
  await f.shell.startVoice();await f.clock.flush();
  n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.match(f.renderChat()?.lines?.[0]?.t,/^The microphone stopped\./);
  assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);assert.ok(n.stops>=1,'the socket is retired');
  await f.clock.advance(5000);assert.deepEqual(n.mutes,[false,true],'no replacement capture');
 }finally{await closeSocket(f);}
});

// The bridge's one 2.5 s close bound covers the native mute too: a mute it never answers rejects
// the close, which ends the conversation with the microphone error; nothing is sent or reopened.
test('busy hold over the speech socket: a close the native mute does not answer ends the conversation at the bridge bound; nothing is sent, spoken or reopened',busyHold,async()=>{
 const f=socketFixture(),n=f.n;n.closeMute=()=>new Promise(()=>{});
 try{
  await f.shell.startVoice();await f.clock.flush();
  n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(2499);
  assert.equal(f.renderChat()?.state,'thinking');assert.equal(f.sends,0);assert.deepEqual(n.mutes,[false,true]);
  await f.clock.advance(1);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.match(f.renderChat()?.lines?.[0]?.t,/^The microphone stopped\./);
  assert.ok(n.stops>=1,'the socket is retired');
  await f.clock.advance(5000);assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);assert.deepEqual(n.mutes,[false,true],'nothing reopens');
 }finally{await closeSocket(f);}
});

// Mute mid-speech finalizes the utterance; the turn is submitted after the gap. A Mute close that
// fails before that (at once), or a socket end once the Mute close is confirmed, ends the
// conversation instead of sending a turn the closed or dead input cannot answer.
test('busy hold over the speech socket: Mute mid-speech, the final arrives, the native mute refuses and the socket fails before the gap: nothing is sent',busyHold,async()=>{
 const f=socketFixture(),n=f.n;let refuse;n.closeMute=()=>new Promise((_,reject)=>refuse=reject);
 try{
  await f.shell.startVoice();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-end',text:'Add lunch with Sam tomorrow.'});
  refuse(Error('Microphone could not change state'));n.fail('capture');await f.clock.flush();
  await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.match(f.renderChat()?.lines?.[0]?.t,/^The microphone stopped\./);
  await f.clock.advance(5000);assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);assert.deepEqual(n.mutes,[false,true]);
 }finally{await closeSocket(f);}
});

for(const [fault,code] of [['a transport failure','connection-lost'],['expiry','expired']])
test(`busy hold over the speech socket: Mute mid-speech, the mute confirmed with the final in, then ${fault} before the gap: nothing is sent`,busyHold,async()=>{
 const f=socketFixture(),n=f.n;
 try{
  await f.shell.startVoice();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-end',text:'Add lunch with Sam tomorrow.'});await f.clock.flush();
  assert.equal(f.sends,0);assert.deepEqual(n.mutes,[false,true]);
  n.fail(code);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');
  await f.clock.advance(5000);assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);assert.deepEqual(n.mutes,[false,true]);
 }finally{await closeSocket(f);}
});

test('busy hold on-device: Mute mid-speech, the final arrives, the Mute close rejects before the gap: nothing is sent, spoken or reopened',busyHold,async()=>{
 const f=onDeviceLiveFixture();let reject,closes=0,listens=0;
 f.box.nativeAssistantListener=()=>async input=>{listens++;f.s.handlers=input;return {fullDuplex:true,close:()=>{closes++;return closes===1?new Promise((_,no)=>reject=no):Promise.resolve();},cancel:async()=>{}};};
 try{
  await f.shell.startVoice();await f.clock.flush();const h=f.s.handlers;
  h.onSpeechStart(0);await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.flush();
  h.onSpeechEnd(20);h.onSegment('Add lunch with Sam tomorrow.');await f.clock.flush();
  reject(Error('Native transcription close was not confirmed.'));await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error','Mute is not left showing over the unconfirmed close');
  await f.clock.advance(1300);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.match(f.renderChat()?.lines?.[0]?.t,/^The microphone stopped\./);
  await f.clock.advance(5000);
  assert.equal(f.sends,0);assert.deepEqual(f.s.spoken(),[]);assert.equal(closes,1);assert.equal(listens,1,'no replacement capture');
 }finally{await closeLive(f);}
});


// --- Paired bridge/session lifetime boundaries. These cases run through the actual projected
// native-cloud-speech module and canonical VoiceAssistantSession, never a replacement controller.
// The native port exposes explicit close/open/cancel gates and a physical-input ownership sentinel.
const terminalActions=[
 ['transport',f=>f.n.fail('connection-lost'),'error'],
 ['expiry',f=>f.n.fail('expired'),'error'],
 ['protocol',f=>f.n.fail('protocol'),'error'],
 ['owner',f=>{f.agent='another-agent-session';f.n.emit({sessionId:f.n.sessionId,type:'level',peak:.2});},undefined],
];
function assertSocketRetired(f,{sends=1,spoken,stops=1}={}){
 assert.equal(f.sends,sends,'no late or duplicate send');
 if(spoken)assert.deepEqual(f.n.spoken,spoken,'no late audio request');
 assert.equal(f.n.physicalActive,false,'the port owns no active microphone');
 assert.equal(f.n.stops,stops,'one idempotent socket retirement');
}
for(const [stage,draining] of [['final audio',false],['final cancellation drain',true]])
for(const [fault,act,state] of terminalActions)
test(`paired busy hold: ${fault} during ${stage} retires once without a late reopen or extra reply`,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();
  f.releaseReply();await f.clock.flush();assert.equal(seen.reply?.text,REPLY,'the agent reply has already been delivered');
  assert.deepEqual(n.spoken,[ACK,REPLY]);n.audioStart();await f.clock.flush();assert.equal(n.physicalActive,false);
  if(draining){n.holdCancel=true;assert.equal(f.session.interruptSpeech(),true,'explicit Stop Speaking interrupts the reply');await f.clock.flush();assert.equal(n.draining,true);assert.deepEqual(n.mutes,[false,true],'input cannot reopen before cancellation drains');}
  act(f);await f.clock.flush();
  assert.notEqual(f.renderChat()?.state,'listening','a terminal event cannot resume listening');
  // An already delivered reply remains evidence; terminal handling must prevent further effects.
  assert.equal(seen.reply?.text,REPLY);n.releaseCancel?.();await f.clock.flush();if(state)assert.equal(f.renderChat()?.state,state);
  n.utter(CORRECTION);await f.clock.advance(5000);
  assertSocketRetired(f,{spoken:[ACK,REPLY]});assert.deepEqual(n.mutes,[false,true]);
 }finally{await closeSocket(f);}
});

for(const [ending,act] of [...terminalActions.map(([name,act])=>[name,act]),['Stop',f=>f.shell.stopVoiceConversation()]])
test(`paired busy hold: ${ending} during pending input close, then late native confirmation, never sends or plays`,async()=>{
 const f=socketFixture(),n=f.n;let confirm,stopping;
 n.closeMute=()=>new Promise(resolve=>confirm=resolve);
 try{
  await f.shell.startVoice();await f.clock.flush();n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(0);
  assert.equal(typeof confirm,'function');assert.equal(n.physicalActive,true,'the pending close is not falsely marked off');
  assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);
  stopping=act(f);await f.clock.flush();assert.equal(n.physicalActive,false,'terminal retirement disposes pending native input');
  confirm();await f.clock.flush();if(stopping)await stopping;
  n.utter(CORRECTION);await f.clock.advance(5000);
  assertSocketRetired(f,{sends:0,spoken:[]});assert.deepEqual(n.mutes,[false,true]);
  assert.notEqual(f.renderChat()?.state,'listening');
 }finally{confirm?.();await closeSocket(f);}
});

for(const [ending,act] of [...terminalActions.map(([name,act])=>[name,act]),['Stop',f=>f.shell.stopVoiceConversation()]])
test(`paired busy hold: ${ending} while reply-drain reopen is pending retires the late open and never sends again`,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);let confirm,stopping;
 try{
  const input=await socketTurn(f);progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();
  f.releaseReply();await f.clock.flush();n.audioStart();
  n.openMute=()=>new Promise(resolve=>confirm=resolve);n.complete();await f.clock.flush();
  assert.equal(typeof confirm,'function','post-reply reopen is genuinely pending');
  assert.deepEqual(n.mutes,[false,true,false]);assert.equal(n.physicalActive,false);
  assert.equal(seen.reply?.text,REPLY,'do not claim the already delivered reply was absent');
  stopping=act(f);await f.clock.flush();confirm();await f.clock.flush();if(stopping)await stopping;
  assert.equal(n.lateOpenRetired,1,'native port rejects a late open after retirement');
  n.utter(CORRECTION);await f.clock.advance(5000);
  assertSocketRetired(f,{spoken:[ACK,REPLY]});assert.deepEqual(n.mutes,[false,true,false]);
  assert.notEqual(f.renderChat()?.state,'listening');
 }finally{confirm?.();await closeSocket(f);}
});

// Healthy controls keep the adversarial gates honest: one confirmed reopen hears one fresh turn.
test('paired busy hold: healthy delayed reopen stays physically off until confirmed and hears one fresh turn',async()=>{
 const f=socketFixture(),n=f.n;let confirm;
 try{
  const input=await socketTurn(f);progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();
  f.releaseReply();await f.clock.flush();n.audioStart();n.openMute=()=>new Promise(resolve=>confirm=resolve);n.complete();await f.clock.flush();
  assert.equal(n.physicalActive,false);assert.equal(f.sends,1);assert.deepEqual(n.mutes,[false,true,false]);
  confirm();await f.clock.flush();assert.equal(n.physicalActive,true);assert.equal(f.renderChat()?.state,'listening');
  n.utter('And lunch on Friday.');await f.clock.advance(0);
  assert.deepEqual(f.sendInputs.map(v=>v.text),['Add lunch with Sam tomorrow.','And lunch on Friday.']);assert.equal(n.physicalActive,false,'the next turn also closes input before send');
 }finally{confirm?.();await closeSocket(f);}
});

// These two rows intentionally require the SDK owner's idle-Mute correction. No pending utterance
// exists, so the send barrier alone cannot satisfy them. Keep them mandatory, never version-skip.
for(const mode of ['rejected','unanswered'])
test(`paired idle Mute: ${mode} native close retires physical input and Unmute cannot reopen it`,async()=>{
 const f=socketFixture(),n=f.n;
 try{
  await f.shell.startVoice();await f.clock.flush();assert.equal(n.physicalActive,true);
  n.closeMute=mode==='rejected'?async()=>{throw Error('Native mute unconfirmed');}:()=>new Promise(()=>{});
  f.renderChat().toggleMute();await f.clock.flush();if(mode==='unanswered')await f.clock.advance(2500);await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error','unconfirmed idle Mute is terminal');assertSocketRetired(f,{sends:0,spoken:[]});
  const calls=n.mutes.length;f.renderChat()?.toggleMute?.();n.utter(CORRECTION);await f.clock.advance(5000);
  assert.equal(n.mutes.length,calls,'Unmute cannot open over unretired input');assertSocketRetired(f,{sends:0,spoken:[]});
 }finally{await closeSocket(f);}
});

// Idle Mute (nothing heard, nothing waiting to be sent): a native mute the bridge refuses, or does
// not answer within its 2.5 s bound, ends the conversation once with the microphone error and stops
// the socket once; Unmute, also pressed while that mute is pending, reopens nothing and nothing is
// sent. A Mute the native mute confirms stays quiet, and Unmute reopens the socket capture.
const microphoneNotices=f=>(f.renderChat()?.lines||[]).filter(line=>/^The microphone stopped\./.test(line.t)).length;
for(const [how,closeMute,boundMs,unmuteAtMs] of [
 ['refuses',async()=>{throw Error('Microphone could not change state');},0],
 ['never answers',()=>new Promise(()=>{}),2500],
 ['never answers, Unmute pressed while it is pending,',()=>new Promise(()=>{}),2500,1000],
])
test(`busy hold over the speech socket: an idle Mute whose native mute ${how} ends the conversation once; the socket stops once, nothing reopens or is sent`,busyHold,async()=>{
 const f=socketFixture(),n=f.n;
 try{
  await f.shell.startVoice();await f.clock.flush();n.closeMute=closeMute;
  f.renderChat().toggleMute();await f.clock.flush();
  assert.deepEqual(n.mutes,[false,true]);
  if(boundMs){
   assert.equal(f.renderChat()?.state,'listening');assert.equal(f.renderChat()?.muted,'true');
   if(unmuteAtMs){await f.clock.advance(unmuteAtMs);f.renderChat().toggleMute();await f.clock.flush();}
   await f.clock.advance(boundMs-(unmuteAtMs??0)-1);
   assert.equal(f.renderChat()?.state,'listening');assert.deepEqual(n.mutes,[false,true],'nothing reopens while the mute is pending');
   await f.clock.advance(1);await f.clock.flush();
  }
  assert.equal(f.renderChat()?.state,'error');assert.match(f.renderChat()?.lines?.[0]?.t,/^The microphone stopped\./);
  assert.equal(microphoneNotices(f),1);assert.equal(n.stops,1,'the socket is retired once');
  f.renderChat()?.toggleMute?.();await f.clock.advance(5000);
  assert.deepEqual(n.mutes,[false,true],'nothing reopens');assert.equal(f.sends,0);assert.deepEqual(n.spoken,[]);
  assert.equal(microphoneNotices(f),1);assert.equal(n.stops,1);
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: an idle Mute the native mute confirms stays quiet; Unmute reopens the socket capture and the next turn is sent',busyHold,async()=>{
 const f=socketFixture(),n=f.n;let confirm;n.closeMute=()=>new Promise(resolve=>confirm=resolve);
 try{
  await f.shell.startVoice();await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.advance(2000);confirm();n.closeMute=undefined;await f.clock.flush();await f.clock.advance(5000);
  assert.equal(f.renderChat()?.state,'listening');assert.equal(f.renderChat()?.muted,'true');assert.equal(n.stops,0);
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.renderChat()?.muted,'false');assert.deepEqual(n.mutes,[false,true,false],'Unmute reopens the socket capture');
  n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(0);
  assert.equal(f.sends,1);assert.equal(f.sendInputs[0].text,'Add lunch with Sam tomorrow.');assert.equal(microphoneNotices(f),0);
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: Mute while the capture reopens after the reply, its native mute refused: the conversation ends once; nothing reopens or is sent again',busyHold,async()=>{
 const f=socketFixture(),n=f.n;
 try{
  await socketTurn(f);
  f.releaseReply();await f.clock.flush();assert.deepEqual(n.spoken,[REPLY]);
  let reopened;n.openMute=()=>new Promise(resolve=>reopened=resolve);n.closeMute=async()=>{throw Error('Microphone could not change state');};
  n.audioStart();n.complete();await f.clock.flush();
  assert.deepEqual(n.mutes,[false,true,false],'the reopen waits for the native unmute');
  f.renderChat().toggleMute();await f.clock.flush();
  reopened();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.equal(microphoneNotices(f),1);assert.equal(n.stops,1);
  f.renderChat()?.toggleMute?.();await f.clock.advance(5000);
  assert.deepEqual(n.mutes,[false,true,false,true],'the reopened capture is closed at Mute and nothing opens again');
  assert.equal(f.sends,1);assert.deepEqual(n.spoken,[REPLY]);assert.equal(microphoneNotices(f),1);assert.equal(n.stops,1);
 }finally{await closeSocket(f);}
});

test('busy hold over the speech socket: Stop while an idle Mute waits for the native mute retires the socket at once and resolves at the bridge bound with no error',busyHold,async()=>{
 const f=socketFixture(),n=f.n;n.closeMute=()=>new Promise(()=>{});
 try{
  await f.shell.startVoice();await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.advance(1000);
  let stopped=false;const stopping=f.shell.stopVoiceConversation().then(()=>{stopped=true;});await f.clock.flush();
  assert.equal(f.renderChat()?.state,'stopping');assert.equal(n.stops,1,'Stop retires the socket');
  await f.clock.advance(1499);assert.equal(stopped,false,'Stop waits for the pending native mute');
  await f.clock.advance(1);await stopping;assert.equal(stopped,true);assert.equal(f.renderChat()?.state,undefined,'voice closed, not failed');
  await f.clock.advance(5000);
  assert.equal(microphoneNotices(f),0);assert.deepEqual(n.mutes,[false,true]);assert.equal(f.sends,0);assert.equal(n.stops,1);
 }finally{await closeSocket(f);}
});

test('busy hold on-device: an idle Mute whose close rejects ends the conversation once; Unmute reopens nothing and nothing is sent',busyHold,async()=>{
 const f=onDeviceLiveFixture();let reject,closes=0,cancels=0,listens=0;
 f.box.nativeAssistantListener=()=>async input=>{listens++;f.s.handlers=input;return {fullDuplex:true,close:()=>{closes++;return new Promise((_,no)=>reject=no);},cancel:async()=>{cancels++;}};};
 try{
  await f.shell.startVoice();await f.clock.flush();
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'listening');assert.equal(f.renderChat()?.muted,'true');
  reject(Error('Native transcription close was not confirmed.'));await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error');assert.equal(microphoneNotices(f),1);
  f.renderChat()?.toggleMute?.();await f.clock.advance(5000);
  assert.equal(f.sends,0);assert.deepEqual(f.s.spoken(),[]);assert.equal(closes,1);assert.equal(cancels,1,'the failed capture is retired once');assert.equal(listens,1,'no replacement capture');
 }finally{await closeLive(f);}
});
