import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const raw=readFileSync('apps/app/src/runtime/native-reading-voice.ts','utf8');
const source=stripTypeScriptTypes(raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
function fixture({resident=true}={}){
 const f={onDevice:0,synthesized:0};
 const binding={sessionId:'s1',agentId:'a1'};
 const box={Date,JSON,DOMException,AbortController,document:{hidden:false,addEventListener(){},removeEventListener(){}},testMocksEnabled:false,
  registerPlugin:()=>({synthesizeLocalBrowserReading:async()=>{f.synthesized++;return {playbackId:'p',execution:'device'};}}),playOwnedSpeech:async()=>{},createPairedVoice:()=>null,
  createOnDeviceVoice:()=>{f.onDevice++;return {playbackReady:async()=>true};},
  // A signed-in Cloud account: the speech route would be Cloud, and page reading still is not.
  connectionController:{getResidentReadingBinding:()=>resident?binding:null,getPairedVoiceBinding:()=>null,getCloudEnvironment:()=>'production',getCloudClient:()=>({sessionId:'c',credentialId:'c'}),getSnapshot:()=>({open:false}),subscribe:()=>()=>{}}};
 vm.runInNewContext(source+';Object.assign(globalThis,{createNativeReadingVoice});',box);
 return {f,box};
}
test('every build reads a page through the connected resident on this phone, whatever the speech route',()=>{
 const {f,box}=fixture();
 const voice=box.createNativeReadingVoice();
 assert.ok(voice);assert.equal(f.onDevice,1);assert.equal(voice.binding.sessionId,'s1');assert.equal(voice.isCurrent(),true);
 // No build profile and no speech route gates page reading; page text has no Cloud or provider path here.
 assert.doesNotMatch(raw,/cloudRuntimeEnabled|speechRoute|CLOUD_PROFILE_READING_NOTE|createCloudVoice|speakCloudText/);
});
test('without a resident reading binding a production build offers no page reading',()=>{
 const {f,box}=fixture({resident:false});
 assert.equal(box.createNativeReadingVoice(),null);assert.equal(f.onDevice,0);assert.equal(f.synthesized,0);
});
