// Cloud speech HTTP 429 (voice-http-429): the native plugin and the development browser route carry
// only its retry facts (limit code, wait, reset); cloudVoiceFailure maps them to plan-limit wording
// with the retry time, keeps the recording, and records the shared lastLimit for the same account.
// Real cloud-voice source with stub ports; the shared readServiceLimit is the projected SDK.
// This is not Cloud, provider, APK or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {tsImport} from './support/ts-import.mjs';

const limitModule=await tsImport(new URL('../apps/app/src/runtime/cloud-voice-limit.ts',import.meta.url).href,{parentURL:import.meta.url});
const sdk=await tsImport(new URL('../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts',import.meta.url).href,{parentURL:import.meta.url});
const {readCloudVoiceLimit,cloudVoiceLimitOf}=limitModule;
const now=Date.UTC(2026,9,28,12);
const SENTINEL='PRIVATE_PROVIDER_BODY_SENTINEL';

function loadCloudVoice(f={}){
 const notes=[];
 const native={transcribeRecording:async()=>{throw f.failure;},synthesize:async()=>{throw f.failure;},transcribeOwnRecording:async()=>{throw f.failure;},synthesizeOwn:async()=>{throw f.failure;},transcribeDevelopmentCloudRecording:async()=>{throw f.failure;}};
 const snapshot={open:false,residentInference:f.own?'direct':'cloud',session:{sessionId:'owner-session'},providerStatus:{voiceConfigured:true,revision:'own-revision'}};
 const box={Capacitor:{isNativePlatform:()=>true},browserCloudResidentEnabled:false,developmentCartesiaVoiceEnabled:false,developmentCloudVoiceEnabled:f.developer===true,registerPlugin:()=>native,
  connectionController:{getCloudEnvironment:()=>'production',getCloudClient:()=>({sessionId:f.session??'account-session',credentialId:'credential'}),getBrowserSpeechAgent:()=>({session:{sessionId:'developer'}}),getSnapshot:()=>snapshot,subscribe:()=>()=>{},
   noteCloudServiceLimit:(limit,sessionId)=>{notes.push({limit,sessionId});return true;}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},AbortController,DOMException,Date,markTtsPlaybackStarted(){},markTtsPlaybackEnded(){},
  playOwnedSpeech:async(_native,_signal,prepare)=>{await prepare('request');},
  cloudVoiceLimitOf,readServiceLimit:sdk.readServiceLimit,retryDuration:sdk.retryDuration,cloudServiceName:()=>'Eliza Cloud'};
 const source=fs.readFileSync('apps/app/src/runtime/cloud-voice.ts','utf8').replace(/^import [^;]*;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export type','type');
 vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'strip'})+';globalThis.failure=cloudVoiceFailure;globalThis.serviceLimit=cloudVoiceServiceLimit;globalThis.create=createCloudVoice;}',box);
 return {box,notes};
}

test('a 429 shows plan-limit wording with the retry time and keeps the recording, never provider text',()=>{
 const {box}=loadCloudVoice();
 const limited=(data,message=SENTINEL)=>Object.assign(Error(message),{code:'voice-http-429',data});
 assert.equal(box.failure(limited({retryAfterSeconds:42,limitCode:'rate_limited'}),{recording:true}),"Eliza Cloud voice reached your plan's request limit. Try again in about 42 seconds. Your recording is kept.");
 // Reading a reply aloud has no recording to keep.
 assert.equal(box.failure(limited({retryAfterSeconds:300})),"Eliza Cloud voice reached your plan's request limit. Try again in about 5 minutes.");
 // Without retry facts the wording still names the plan limit, never the bare status.
 assert.equal(box.failure(limited(undefined),{recording:true}),"Eliza Cloud voice reached your plan's request limit. Wait a moment, then try again. Your recording is kept.");
 const allowance=box.failure(limited({limitCode:'allowance_exhausted',resetAt:Date.now()+3*86_400_000}),{recording:true});
 assert.match(allowance,/^Your Eliza Cloud plan's voice allowance is used up\. It resets .+\. Your recording is kept\.$/);
 assert.match(box.failure(limited({limitCode:'subscription_required'})),/needs an active Eliza Cloud plan/);
 // Only the validated facts are read: forged fields, provider bodies and messages never show.
 for(const data of [{retryAfterSeconds:42,message:SENTINEL},{limitCode:SENTINEL,retryAfterSeconds:'42'},{retryAfterSeconds:1e9},{resetAt:'tomorrow'}]){
  const text=box.failure(limited(data),{recording:true});
  assert.doesNotMatch(text,new RegExp(SENTINEL));assert.doesNotMatch(text,/\(429\)/);
 }
 // A 402 uses the same billing wording; other HTTP codes never show the bare status.
 assert.equal(box.failure({code:'voice-http-402'},{recording:true}),'Eliza Cloud declined voice for billing. Check your account in Settings. Your recording is kept.');
 assert.equal(box.failure({code:'voice-http-503'}),'Eliza Cloud voice couldn’t complete this request. Try again later.');
 assert.equal(box.serviceLimit({code:'voice-http-503',data:{retryAfterSeconds:5}}),null);
});

test('a 429 for the signed-in account becomes the shared lastLimit; developer speech does not',async()=>{
 const failure=Object.assign(Error(SENTINEL),{code:'voice-http-429',data:{retryAfterSeconds:30,limitCode:'rate_limited'}});
 const {box,notes}=loadCloudVoice({failure});
 const voice=box.create();
 await assert.rejects(voice.transcribeRecording({recordingId:'clip',requestId:'request'}),error=>error===failure);
 await assert.rejects(voice.speak('Reply',new AbortController().signal),error=>error===failure);
 assert.equal(notes.length,2);
 for(const note of notes){assert.equal(note.sessionId,'account-session');assert.equal(note.limit.kind,'rate-limited');assert.equal(note.limit.retryAfterMs,30_000);}
 const developer=loadCloudVoice({failure,developer:true});
 await assert.rejects(developer.box.create().transcribeRecording({recordingId:'clip',requestId:'request'}));
 assert.deepEqual(developer.notes,[]);
});



test('retry facts: body, Retry-After seconds or date, and bounds',()=>{
 assert.deepEqual(readCloudVoiceLimit('17',{error:{code:'rate_limited',retryAfterSeconds:12,message:SENTINEL,plan:{id:'pro'}}},now),{retryAfterSeconds:12,limitCode:'rate_limited'});
 assert.deepEqual(readCloudVoiceLimit('17',null,now),{retryAfterSeconds:17});
 assert.deepEqual(readCloudVoiceLimit(new Date(now+90_000).toUTCString(),null,now),{retryAfterSeconds:90});
 assert.deepEqual(readCloudVoiceLimit(null,{error:{retryAt:new Date(now+4_000).toISOString()}},now),{retryAfterSeconds:4});
 assert.deepEqual(readCloudVoiceLimit(null,{code:'allowance_exhausted',resetAt:new Date(now+86_400_000).toISOString()},now),{limitCode:'allowance_exhausted',resetAt:now+86_400_000});
 for(const [header,body] of [['999999',null],['soon',null],[null,{error:{code:'Rate Limited!',retryAfterSeconds:-1}}],[null,{error:{resetAt:new Date(now-1).toISOString()}}],[null,{error:{resetAt:new Date(now+500*86_400_000).toISOString()}}],[null,'not json'],[null,[{code:'rate_limited'}]]])
  assert.deepEqual(readCloudVoiceLimit(header,body,now),{});
 assert.deepEqual(cloudVoiceLimitOf({code:'voice-http-429',data:{retryAfterSeconds:5,limitCode:'rate_limited',resetAt:now,extra:SENTINEL}}),{retryAfterSeconds:5,limitCode:'rate_limited',resetAt:now});
 assert.equal(cloudVoiceLimitOf({code:'voice-http-402',data:{retryAfterSeconds:5}}),null);
});





test('own-key HTTP limits never mutate the retained Cloud account limit',async()=>{
 const failure=Object.assign(Error(SENTINEL),{code:'voice-http-429',data:{retryAfterSeconds:30,limitCode:'rate_limited'}});
 const {box,notes}=loadCloudVoice({failure,own:true});const voice=box.create();
 await assert.rejects(voice.transcribeRecording({recordingId:'clip',requestId:'request'}),error=>error===failure);
 await assert.rejects(voice.speak('Reply',new AbortController().signal),error=>error===failure);
 assert.deepEqual(notes,[]);assert.equal(box.failure(failure),'Cartesia refused voice. Check your key and Cartesia plan.');
});
