import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/native-reading-voice.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
function fixture({cloud}){
 const f={onDevice:0,synthesized:0};
 const resident={sessionId:'s1',agentId:'a1'};
 const box={Date,JSON,DOMException,AbortController,document:{hidden:false,addEventListener(){},removeEventListener(){}},cloudRuntimeEnabled:cloud,testMocksEnabled:false,
  registerPlugin:()=>({synthesizeLocalBrowserReading:async()=>{f.synthesized++;return {playbackId:'p',execution:'device'};}}),playOwnedSpeech:async()=>{},createPairedVoice:()=>null,
  createOnDeviceVoice:()=>{f.onDevice++;return {playbackReady:async()=>true};},
  connectionController:{getResidentReadingBinding:()=>resident,getPairedVoiceBinding:()=>null,getSnapshot:()=>({open:false}),subscribe:()=>()=>{}}};
 vm.runInNewContext(source+';Object.assign(globalThis,{createNativeReadingVoice,CLOUD_PROFILE_READING_NOTE});',box);
 return {f,box};
}
test('the Cloud QA profile offers no page reading and never asks the on-device engine',()=>{
 const {f,box}=fixture({cloud:true});
 assert.equal(box.createNativeReadingVoice(),null);
 assert.equal(f.onDevice,0);assert.equal(f.synthesized,0);
 assert.equal(box.CLOUD_PROFILE_READING_NOTE,"Page reading uses on-device speech, which this build doesn't include.");
});
test('the on-device profile reads a page through the connected resident',()=>{
 const {f,box}=fixture({cloud:false});
 const voice=box.createNativeReadingVoice();
 assert.ok(voice);assert.equal(f.onDevice,1);assert.equal(voice.binding.sessionId,'s1');assert.equal(voice.isCurrent(),true);
});
