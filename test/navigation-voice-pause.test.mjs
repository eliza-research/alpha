import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const load=(box,file,names)=>{let src=readFileSync(file,'utf8').replace(/^import [\s\S]*?;\n/gm,'').replace(/^export /gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});vm.runInNewContext('{'+src+';Object.assign(globalThis,{'+names+'});}',box);};
// The real Alpha wrapper, shared NavigationVoice and createOnDeviceVoice over a stubbed native bridge.
function fixture({ready=true,cloud=false,hold=false}={}){
 const f={spoken:[],cloud:[],failed:[],listeners:{}};
 const native={localSpeechStatus:async()=>({ready,execution:'device'}),addListener:async(event,listener)=>{(f.listeners[event]??=new Set()).add(listener);return {remove:async()=>{f.listeners[event].delete(listener);}};},
  synthesizeLocal:async({text})=>{f.spoken.push(text);return {playbackId:'p'+f.spoken.length,execution:'device'};},
  play:async({playbackId})=>{const end=()=>{for(const l of f.listeners.playbackEnded??[])l({playbackId});};if(hold)f.end=end;else setTimeout(end,0);},cancel:async()=>{},stopPlayback:async()=>{}};
 const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}}});
 const box={AbortController,DOMException,EventTarget,crypto,console,setTimeout,clearTimeout,document,Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>true},registerPlugin:()=>native,planLocalSpeech:text=>[text],nativeVoiceTurnId:()=>undefined,
  connectionController:{getSnapshot:()=>({}),getCloudClient:()=>null,subscribe:()=>()=>{}},cloudRuntimeEnabled:cloud,speakAppText:async text=>{f.cloud.push(text);}};
 load(box,'.eliza/client-features/packages/voice/src/native-speech-request.ts','createNativeSpeechRequests');
 load(box,'apps/app/src/local-speech-playback.ts','speakLocalText');
 load(box,'apps/app/src/runtime/local-voice.ts','createOnDeviceVoice');
 load(box,'.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts','SharedNavigationVoice:NavigationVoice');
 load(box,'apps/app/src/maps/navigation-voice.ts','NavigationVoice');
 const voice=new box.NavigationVoice(error=>f.failed.push(error));
 const screen=hidden=>{document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));};
 return {f,voice,screen};
}
const settle=async()=>{for(let i=0;i<20;i++)await tick();};

test('a step reached with the screen off keeps voice on and is spoken once the screen is on',async()=>{
 const {f,voice,screen}=fixture();
 screen(true);voice.update('step-1','Turn left');await settle();
 assert.equal(voice.enabled,true);assert.deepEqual(f.spoken,[]);assert.equal(f.failed.length,0);
 screen(false);await settle();
 assert.deepEqual(f.spoken,['Turn left']);
 voice.update('step-1','Turn left');screen(true);screen(false);await settle();
 assert.deepEqual(f.spoken,['Turn left'],'the owed step is spoken only once');
});

test('only the latest step is spoken on return; a stale step never is',async()=>{
 const {f,voice,screen}=fixture();
 screen(true);voice.update('step-1','Turn left');voice.update('step-2','Keep right');await settle();
 screen(false);await settle();
 assert.deepEqual(f.spoken,['Keep right']);assert.equal(voice.enabled,true);
});

test('an utterance cut off by the screen turning off is a pause, not a failure',async()=>{
 const {f,voice,screen}=fixture({hold:true});
 voice.update('step-1','Turn left');while(!f.end)await tick();
 screen(true);await settle();
 assert.equal(voice.enabled,true);assert.equal(f.failed.length,0);
 f.end=undefined;screen(false);while(!f.end)await tick();f.end();await settle();
 assert.deepEqual(f.spoken,['Turn left','Turn left']);assert.equal(f.failed.length,0);
});

test('stopping navigation while the screen is off drops the owed step',async()=>{
 const {f,voice,screen}=fixture();
 screen(true);voice.update('step-1','Turn left');await settle();voice.pause();screen(false);await settle();
 assert.deepEqual(f.spoken,[]);
});

test('speech that is unavailable with the screen on still turns voice guidance off',async()=>{
 const {f,voice}=fixture({ready:false});
 voice.update('step-1','Turn left');await settle();
 assert.equal(voice.enabled,false);assert.equal(f.failed.length,1);assert.match(String(f.failed[0]),/On-device navigation speech is unavailable/);
});

test('the Cloud QA profile speaks navigation through the app Cloud route, not the on-device engine',async()=>{
 const {f,voice}=fixture({cloud:true});
 voice.update('step-1','Turn left');await settle();
 assert.deepEqual(f.cloud,['Turn left']);assert.deepEqual(f.spoken,[]);assert.equal(voice.enabled,true);
});
