import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
// The Maps speech adapter and the shared guidance state machine, with their voice
// and stable connection-owner ports injected. This is source evidence for the adapter; it does not load the shipped bundle,
// the real on-device voice or the Maps UI.
const source=path=>transformSync(readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{loader:'ts'}).code;
const shared=source('.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts').replace('class NavigationVoice','class SharedNavigationVoice');
const adapter=source('apps/app/src/maps/navigation-voice.ts');

test('Maps local speech adapter cancels owned guidance and refuses local-unready without a network fallback',async()=>{
 let ready=true;
 const f={spoken:[],aborted:0,failures:[]};
 const createOnDeviceVoice=()=>({
  ready:async()=>{throw Error('navigation speech must not use transcription readiness');},
  playbackReady:async()=>ready,
  speak:(text,signal)=>{f.spoken.push(text);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{f.aborted++;reject(signal.reason);},{once:true}));},
 });
 // The screen stays on and this is the on-device profile, so the adapter's screen-off and Cloud paths stay idle.
 const document={hidden:false,documentElement:{dataset:{connectionMode:'resident'}},addEventListener(){},removeEventListener(){}};
 const selected={session:{},residentInference:'direct',open:false};
 const connectionController={getSnapshot:()=>selected,getCloudClient:()=>null,getCloudEnvironment:()=>null};
 const NavigationVoice=new Function('createOnDeviceVoice','document','cloudRuntimeEnabled','speakAppText','connectionController',`${shared}\n${adapter}\nreturn NavigationVoice;`)(createOnDeviceVoice,document,false,async()=>{throw Error('navigation speech must not use the Cloud route here');},connectionController);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const voice=new NavigationVoice(error=>f.failures.push(error));
 voice.update('step-1','Turn right');await settle();
 assert.deepEqual(f.spoken,['Turn right']);
 voice.pause();await settle();
 assert.equal(f.aborted,1);
 // A cancelled step is not a failure: guidance stays on.
 assert.deepEqual(f.failures,[]);assert.equal(voice.enabled,true);
 ready=false;voice.update('step-2','Continue ahead');await settle();
 assert.equal(f.failures.length,1);
 assert.equal(f.failures[0].message,'On-device navigation speech is unavailable.');
 assert.equal(voice.enabled,false);
 assert.deepEqual(f.spoken,['Turn right']);
});
