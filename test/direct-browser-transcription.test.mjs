import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
function browser(run){
 let snapshot={session:{sessionId:'session-a'},residentInference:'direct',providerStatus:{voiceConfigured:true,revision:'revision-a'}},calls=0;
 const audio=new Uint8Array([1,2,3]),clip={blob:new Blob(['captured']),durationMs:20},listeners=[];
 const agent={session:snapshot.session,async developmentCloudSpeech(input,signal,route){calls++;assert.equal(route,'direct');assert.equal(input.kind,'asr');assert.deepEqual(input.audio,audio);return run(signal);}};
 const connection={getSnapshot:()=>snapshot,getBrowserSpeechAgent:()=>agent,getCloudEnvironment:()=>null,getCloudClient:()=>null,subscribe:listener=>{listeners.push(listener);return()=>{};}};
 const source=fs.readFileSync('apps/app/src/browser/voice.ts','utf8').replace(/^import\b[\s\S]*?;\s*$/gm,'').replace(/^export (?=(?:class|function)\b)/gm,'').replaceAll('import.meta.env.DEV','false');
 const box={connectionController:connection,WebPlugin:class{notifyListeners(){}},BrowserAudioCapture:class{get(){return clip;}cancel(){}clear(){}},window:{addEventListener(){}},document:{hidden:false,addEventListener(){}},migrateAudio:async()=>{},BroadcastChannel:undefined,recordingPcmWav:async()=>audio,Blob,AbortController,DOMException,crypto:{randomUUID},URL,console,speechCancelled:(_kind,reason)=>new DOMException(reason,'AbortError')};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+';globalThis.voice=new BrowserVoice();',box);
 return {voice:box.voice,calls:()=>calls,clip,change(value,notify=false){snapshot={...snapshot,...value};if(notify)for(const listener of listeners)listener();}};
}
test('captured browser dictation uses direct resident route with no Cloud account',async()=>{
 const f=browser(async()=>({text:'my note',local:false}));
 const result=await f.voice.transcribeDevelopmentCloudRecording({recordingId:'recording-a',requestId:randomUUID(),route:'direct'});
 assert.equal(result.text,'my note');assert.equal(result.local,false);assert.equal(f.calls(),1);
});
test('no key and wrong selected route refuse before any upload',async()=>{
 const f=browser(async()=>{throw Error('must not upload');});f.change({providerStatus:{voiceConfigured:false,revision:'revision-a'}});
 await assert.rejects(f.voice.transcribeDevelopmentCloudRecording({recordingId:'recording-a',requestId:randomUUID(),route:'direct'}),{name:'AbortError'});
 f.change({providerStatus:{voiceConfigured:true,revision:'revision-a'}});
 await assert.rejects(f.voice.transcribeDevelopmentCloudRecording({recordingId:'recording-a',requestId:randomUUID(),route:'cloud'}),{name:'AbortError'});assert.equal(f.calls(),0);
});
test('normal capture cancellation aborts upload and a provider change rejects late text',async()=>{
 let started,finish;const began=new Promise(resolve=>started=resolve);
 const f=browser(signal=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
 const requestId=randomUUID(),pending=f.voice.transcribeDevelopmentCloudRecording({recordingId:'recording-a',requestId,route:'direct'});
 await began;await f.voice.cancel({requestId});await assert.rejects(pending,{name:'AbortError'});
 const g=browser(async()=>new Promise(resolve=>finish=resolve));const late=g.voice.transcribeDevelopmentCloudRecording({recordingId:'recording-a',requestId:randomUUID(),route:'direct'});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));g.change({providerStatus:{voiceConfigured:true,revision:'revision-b'}});finish({text:'stale',local:false});await assert.rejects(late,{name:'AbortError'});
});
test('resident protocol sends direct WAV to the authenticated route and projects transcript only',async()=>{
 const source=fs.readFileSync('apps/app/src/runtime/local-agent.ts','utf8');const method=source.slice(source.indexOf('  async developmentCloudSpeech('),source.indexOf('  async synthesizeSpeech('));let seen;
 const box={browserCloudResidentEnabled:true,developmentCartesiaVoiceEnabled:false,developmentCloudVoiceEnabled:true,anyAbortSignal:signals=>AbortSignal.any(signals),AbortController,DOMException,crypto:{randomUUID},btoa:s=>Buffer.from(s,'binary').toString('base64'),Blob};
 vm.runInNewContext(stripTypeScriptTypes('class Protocol {session={ownerId:"owner-a"};generation=1;streams=new Set();browserSpeechAvailable=true;bridge;'+method+'};globalThis.protocol=new Protocol();',{mode:'transform'}),box);
 box.protocol.bridge={async request(input){seen=input;return {status:200,body:JSON.stringify({provider:'cartesia',route:'direct',requestId:input.requestId,text:'dictation',apiKey:'must-not-leak'})};}};
 const result=await box.protocol.developmentCloudSpeech({kind:'asr',audio:new Uint8Array([1,2,3])},new AbortController().signal,'direct');
 assert.equal(seen.path,'/api/v1/voice/session/transcribe');assert.equal(seen.ownerId,'owner-a');assert.equal(seen.audioBase64,'AQID');assert.equal(result.text,'dictation');assert.deepEqual(Object.keys(result).sort(),['local','text']);
});
