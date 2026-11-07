import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

function fixture(streamError,{speak}={}){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.randomId=()=>crypto.randomUUID();
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/voice-assistant-session.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export class','class').replaceAll('export const','const').replaceAll('export function','function').replaceAll('export interface','interface').replaceAll('export type','type');
 vm.runInNewContext('{'+stripTypeScriptTypes(source)+';globalThis.VoiceAssistantSession=VoiceAssistantSession;}',f.box);
 const reports=[];f.box.createHeardReporter=()=>({report:async input=>{reports.push(input);return 'not-needed';}});
 f.box.recordEndpointVoiceTiming=()=>{};f.box.activeVoiceTurn=()=>undefined;f.box.recordHeardVoiceTiming=()=>{};
 f.box.shouldRespondToVoiceTurn=()=>true;f.box.buildVoiceTurnSignal=()=>({});f.box.toSpeakableText=t=>t;
 f.box.nativeCloudStreamingAvailable=()=>true;
 let handlers,stopped=0,attempts=0;const spoken=[];
 f.box.createCloudStreamingSpeech=()=>({
  async listen(input){attempts++;if(streamError)throw typeof streamError==='string'?Object.assign(Error('Cloud streaming request failed'),{code:streamError}):streamError;handlers=input;input.signal.addEventListener('abort',()=>stopped++,{once:true});return {fullDuplex:true,close:async()=>{},cancel:async()=>stopped++};},
  async speak(text,signal,onStarted){signal.throwIfAborted();if(speak)return speak(text,signal,onStarted,spoken);spoken.push(text);onStarted();},
  async stop(){stopped++;},
 });
 return Object.assign(f,{clock,spoken,reports,getHandlers:()=>handlers,attempts:()=>attempts,stopped:()=>stopped});
}

test('Cloud Talk streams endpointed speech into the resident without batch STT or progress TTS',async()=>{
 const f=fixture();
 try{
  await f.shell.startVoice();await f.clock.flush();const h=f.getHandlers();assert.ok(h);
  assert.equal(f.starts,0);assert.equal(f.uploads,0);
  h.onSpeechStart(0);h.onSpeechEnd(20);h.onSegment('A completed Cloud utterance.');
  await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.sends,1);assert.equal(f.uploads,0);assert.equal(f.cloudSpeech,0);
  assert.deepEqual(f.spoken,['Synthetic matching reply.']);
  assert.equal(f.localFactories,0);
 }finally{f.close();await f.clock.flush();}
});

test('only an absent streaming route retains compatibility recording; auth and provider failures do not replay',async()=>{
 for(const code of ['cloud-http-404','voice-http-401','voice-http-503']){
  const f=fixture(code);
  try{
   await f.shell.startVoice();await f.clock.flush();
   assert.equal(f.starts,code==='cloud-http-404'?1:0,code);
   assert.equal(f.uploads,0);assert.equal(f.sends,0);
  }finally{f.close();await f.clock.flush();}
 }
});

test('stopping streaming Talk retires capture and never falls back to batch recording',async()=>{
 const f=fixture();
 try{
  await f.shell.startVoice();await f.clock.flush();
  const stopping=f.shell.stopVoiceConversation();await f.clock.flush();await stopping;
  assert.ok(f.stopped()>0);assert.equal(f.starts,0);assert.equal(f.uploads,0);assert.equal(f.sends,0);
 }finally{f.close();await f.clock.flush();}
});

// The native bridge rejects a refused streaming start as the batch route does: voice-http-<status>
// with a 429's retry facts as data (cloud-http-404 alone means "no streaming route").
test('a refused streaming start shows what the batch route shows for the same refusal, and waits the same way',async()=>{
 const timeline=async(failure,streaming)=>{
  const f=fixture(streaming?failure:undefined);
  if(!streaming){f.box.nativeCloudStreamingAvailable=()=>false;f.startError=failure;}
  const shown=()=>{const view=f.renderChat();return JSON.stringify([view?.state,view?.lines,streaming?f.attempts():f.starts,f.shell.messages,f.uploads,f.sends]);};
  try{
   await f.shell.startVoice();await f.clock.flush();const seen=[shown()];
   for(let second=0;second<8;second++){await f.clock.advance(1000);seen.push(shown());}
   return seen;
  }finally{f.close();await f.clock.flush();}
 };
 const refusals=[[401],[402],[429,{retryAfterSeconds:3,limitCode:'rate_limited'}],[429,{retryAfterSeconds:42}],[503]];
 for(const [status,data] of refusals){
  const refused=()=>Object.assign(Error('Cloud streaming speech is unavailable'),{code:'voice-http-'+status},data?{data}:{});
  const streaming=await timeline(refused(),true),batch=await timeline(refused(),false);
  assert.deepEqual(streaming,batch,`${status} ${JSON.stringify(data??{})}`);
 }
 const text=async status=>{const f=fixture(Object.assign(Error('refused'),{code:'voice-http-'+status}));try{await f.shell.startVoice();await f.clock.flush();return f.renderChat()?.lines?.[0]?.t;}finally{f.close();await f.clock.flush();}};
 assert.equal(await text(401),'Sign in to Cloud again in Settings, then retry voice.');
 assert.match(await text(402),/declined cloud voice for your account's billing/);
});

test('a speech failure after a finished sentence keeps the whole reply and reports nothing heard',async()=>{
 const replyId='33333333-3333-4333-8333-333333333333',text='First sentence here. Second sentence here.';
 const f=fixture(undefined,{speak:async(sentence,signal,onStarted,spoken)=>{if(spoken.length)throw Object.assign(Error('Speech playback failed.'),{code:'playback'});spoken.push(sentence);onStarted();}});
 f.badReply={text,assistantMessageId:replyId};
 f.shell.state.msgs.push({id:replyId,from:'agent',text});
 try{
  await f.shell.startVoice();await f.clock.flush();const h=f.getHandlers();
  h.onSpeechStart(0);h.onSpeechEnd(20);h.onSegment('Tell me two things.');
  await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.sends,1);assert.equal(f.spoken.length,1,'one sentence played before the failure');
  const reply=f.shell.state.msgs.find(m=>m.id===replyId);
  assert.equal(reply.text,text,'the bubble keeps the full reply');assert.equal(reply.interrupted,undefined);
  assert.deepEqual(f.reports,[],'a playback failure is not reported as heard');
  assert.ok(f.shell.messages.includes('Couldn’t read the rest aloud. The full reply is above.'));
 }finally{f.close();await f.clock.flush();}
});

test('the batch fallback after a missing streaming route shows no stale error',async()=>{
 const f=fixture();
 // The session publishes its error before start rejects, as a refused native start does.
 const Session=f.box.VoiceAssistantSession;
 f.box.VoiceAssistantSession=class extends Session{constructor(ports,options){super(ports,options);this.ports404=ports;}async start(){const failure=Object.assign(Error('Cloud streaming request failed'),{code:'cloud-http-404'});this.ports404.onState({phase:'error',error:failure});throw failure;}};
 try{
  await f.shell.startVoice();await f.clock.flush();
  const view=f.renderChat();
  assert.equal(f.starts,1,'the recorded-clip loop took over');
  assert.notEqual(view.state,'error');assert.doesNotMatch(JSON.stringify(view.lines),/Voice stopped/);
 }finally{f.close();await f.clock.flush();}
});
