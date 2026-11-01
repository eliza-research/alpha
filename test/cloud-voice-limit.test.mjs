// Cloud speech HTTP 429 (voice-http-429): the native plugin and the development browser route carry
// only its retry facts (limit code, wait, reset); cloudVoiceFailure maps them to plan-limit wording
// with the retry time, keeps the recording, and records the shared lastLimit for the same account.
// Real cloud-voice source with stub ports; the shared readServiceLimit is the projected SDK.
// This is not Cloud, provider, APK or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {tsImport} from 'tsx/esm/api';

const limitModule=await tsImport(new URL('../apps/app/src/runtime/cloud-voice-limit.ts',import.meta.url).href,{parentURL:import.meta.url});
const sdk=await tsImport(new URL('../.eliza/client-features/packages/cloud/sdk/src/subscription-entitlement.ts',import.meta.url).href,{parentURL:import.meta.url});
const {readCloudVoiceLimit,cloudVoiceLimitOf}=limitModule;
const now=Date.UTC(2026,9,28,12);
const SENTINEL='PRIVATE_PROVIDER_BODY_SENTINEL';

function loadCloudVoice(f={}){
 const notes=[];
 const native={transcribeRecording:async()=>{throw f.failure;},synthesize:async()=>{throw f.failure;},transcribeDevelopmentCloudRecording:async()=>{throw f.failure;}};
 const box={browserCloudResidentEnabled:false,developmentCartesiaVoiceEnabled:false,developmentCloudVoiceEnabled:f.developer===true,registerPlugin:()=>native,
  connectionController:{getCloudEnvironment:()=>'production',getCloudClient:()=>({sessionId:f.session??'account-session',credentialId:'credential'}),getBrowserSpeechAgent:()=>({session:{sessionId:'developer'}}),getSnapshot:()=>({open:false}),subscribe:()=>()=>{},
   noteCloudServiceLimit:(limit,sessionId)=>{notes.push({limit,sessionId});return true;}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},AbortController,DOMException,Date,markTtsPlaybackStarted(){},markTtsPlaybackEnded(){},
  playOwnedSpeech:async(_native,_signal,prepare)=>{await prepare('request');},
  cloudVoiceLimitOf,readServiceLimit:sdk.readServiceLimit,retryDuration:sdk.retryDuration,cloudServiceName:()=>'Eliza Cloud'};
 const source=fs.readFileSync('apps/app/src/runtime/cloud-voice.ts','utf8').replace(/^import [^;]*;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export type','type');
 vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'transform'})+';globalThis.failure=cloudVoiceFailure;globalThis.serviceLimit=cloudVoiceServiceLimit;globalThis.create=createCloudVoice;}',box);
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
 assert.match(allowance,/^Your Eliza Cloud plan's voice allowance is used up\. It resets .+\. Your recording is kept\. Nothing is purchased automatically\.$/);
 assert.match(box.failure(limited({limitCode:'subscription_required'})),/needs an active Eliza Cloud plan/);
 // Only the validated facts are read: forged fields, provider bodies and messages never show.
 for(const data of [{retryAfterSeconds:42,message:SENTINEL},{limitCode:SENTINEL,retryAfterSeconds:'42'},{retryAfterSeconds:1e9},{resetAt:'tomorrow'}]){
  const text=box.failure(limited(data),{recording:true});
  assert.doesNotMatch(text,new RegExp(SENTINEL));assert.doesNotMatch(text,/\(429\)/);
 }
 // Other HTTP codes keep their earlier wording.
 assert.equal(box.failure({code:'voice-http-503'}),'Cloud voice could not complete this request (503). Try again later.');
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

test('connection controller records a Cloud speech limit only for the account it was read for',()=>{
 const ui=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
 const start=ui.indexOf('  noteCloudServiceLimit(');const end=ui.indexOf('\n  },',start);
 assert.ok(start>=0&&end>start);
 const updates=[];let service={identity:{sessionId:'account-session'}};
 const object=stripTypeScriptTypes(`const controller={${ui.slice(start,end+4)}};`,{mode:'transform'});
 const method=(limit,sessionId)=>new Function('update','service','limit','sessionId',`${object}\nreturn controller.noteCloudServiceLimit(limit,sessionId);`)(value=>updates.push(value),service,limit,sessionId);
 const limit={kind:'rate-limited',retryAfterMs:30_000,resetsAt:null};
 assert.equal(method(limit,'account-session'),true);
 assert.equal(method(limit,'earlier-session'),false);
 assert.equal(method(null,'account-session'),false);
 service=null;assert.equal(method(limit,'account-session'),false);
 assert.equal(updates.length,1);assert.equal(updates[0].lastServiceLimit.kind,'rate-limited');assert.ok(Number.isFinite(updates[0].lastServiceLimit.observedAt));
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

test('native CloudVoiceLimit keeps the same facts and never the body text',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-voice-limit-'));
 try{
  const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['--release','11','-d',out,'android/app/src/main/java/ai/elizaresearch/alphaphone/CloudVoiceLimit.java','test/fixtures/CloudVoiceLimitTest.java']);
  assert.match(execFileSync(binary('java'),['-cp',out,'ai.elizaresearch.alphaphone.CloudVoiceLimitTest'],{encoding:'utf8'}),/PASS Cloud voice 429 retry facts/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
 const plugin=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java','utf8');
 assert.match(plugin,/if\(status==429\)throw new VoiceHttpException\(status,limitOf\(c\)\);successful\(c\);/);
 assert.match(plugin,/@Override protected void rejectFailure\(PluginCall call,String message,String code,Exception failure\)/);
 assert.match(plugin,/call\.reject\(message,"voice-http-"\+limited\.status,limitData\(limited\.limit\)\)/);
 assert.match(plugin,/super\.rejectFailure\(call,message,code,failure\)/);
 assert.doesNotMatch(plugin,/submitLimited|request\.resolvedEarly/,'429 delivery never bypasses shared post-cleanup settlement');
 assert.equal(plugin.match(/successful\(c\)/g).length,1,'every Alpha speech response goes through answered, which keeps a 429 limit');
 assert.equal(plugin.match(/submit\(call,/g).length,5,'all Alpha speech requests use the shared settlement path');
 // String members only: JSON null or a number is no code or instant (optString would coerce them).
 const limitOf=plugin.slice(plugin.indexOf('private static CloudVoiceLimit limitOf('),plugin.indexOf('private static JSObject limitData('));
 assert.doesNotMatch(limitOf,/optString/);
 assert.match(limitOf,/code=jsonText\(row,"code"\);retryAt=jsonText\(row,"retryAt"\);resetAt=jsonText\(row,"resetAt"\)/);
 assert.match(plugin,/private static String jsonText\(JSONObject row,String key\)\{Object value=row\.opt\(key\);return value instanceof String\?\(String\)value:null;\}/);
 // Only the three facts cross the bridge.
 const data=plugin.slice(plugin.indexOf('private static JSObject limitData('),plugin.indexOf('private static JSObject limitData(')+400);
 assert.deepEqual([...data.matchAll(/data\.put\("([a-zA-Z]+)"/g)].map(match=>match[1]),['retryAfterSeconds','limitCode','resetAt']);
});

test('only the explicit Cloud profile and development browser-resident builds reach Cloud speech',()=>{
 const selection=fs.readFileSync('apps/app/src/runtime/voice-selection.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export type','type');
 for(const [cloud,mocks,expected] of [[false,false,'device'],[true,false,'cloud']]){
  const box={cloudRuntimeEnabled:cloud,testMocksEnabled:mocks,browserDevProfile:false,localStorage:{getItem:()=>JSON.stringify({version:1,route:'cloud',disclosed:'cloud-speech-uses-plan',chosenAt:1}),setItem(){}},JSON,Number,Date,connectionController:{getCloudEnvironment:()=>'production',getCloudClient:()=>({})}};
  vm.runInNewContext('{'+stripTypeScriptTypes(selection,{mode:'transform'})+'\nglobalThis.api={selectVoiceRoute,voiceRoutePreference};}',box);
  // A native flag-off build routes speech to the device even with a stored Cloud choice.
  for(const requested of ['default','device','manual','agent'])assert.equal(box.api.selectVoiceRoute(requested),expected);
  assert.equal(box.api.voiceRoutePreference(),expected);
 }
 // The development browser route is the only other caller: a test-mocks (development) surface.
 const browser=fs.readFileSync('apps/app/src/browser/voice.ts','utf8');
 assert.match(browser,/if\(!devSurfacesEnabled\)throw Error\('Cloud voice requires the native app or a development host\.'\)/);
});
