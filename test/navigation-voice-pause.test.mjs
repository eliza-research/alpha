import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await tick();assert.ok(predicate(),'speech operation reached the native playback boundary');};
const load=(box,file,names)=>{let src=readFileSync(file,'utf8').replace(/^import [\s\S]*?;\n/gm,'').replace(/^export /gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});vm.runInNewContext('{'+src+';Object.assign(globalThis,{'+names+'});}',box);};
// The real Alpha wrapper, shared NavigationVoice and createOnDeviceVoice over a stubbed native bridge.
function fixture({ready=true,cloud=false,hold=false,cloudHold=false,canSpeak=()=>true,readyGate}={}){
 const f={spoken:[],cloud:[],failed:[],listeners:{},pending:[],account:'account-1',statusReads:0};
 const native={localSpeechStatus:async()=>{f.statusReads++;await readyGate?.();return {ready,execution:'device'};},addListener:async(event,listener)=>{(f.listeners[event]??=new Set()).add(listener);return {remove:async()=>{f.listeners[event].delete(listener);}};},
  synthesizeLocal:async({text})=>{f.spoken.push(text);return {playbackId:'p'+f.spoken.length,execution:'device'};},
  play:async({playbackId})=>{const end=()=>{for(const l of f.listeners.playbackEnded??[])l({playbackId});};if(hold)f.end=end;else setTimeout(end,0);},cancel:async()=>{},stopPlayback:async()=>{}};
 const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}}});
 const box={AbortController,DOMException,EventTarget,crypto,console,setTimeout,clearTimeout,queueMicrotask,document,Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>true},registerPlugin:()=>native,planLocalSpeech:text=>[text],nativeVoiceTurnId:()=>undefined,
  connectionController:{getSnapshot:()=>({}),getCloudClient:()=>({sessionId:f.account,credentialId:f.account}),getCloudEnvironment:()=>cloud?'production':undefined,subscribe:()=>()=>{}},speechRoute:()=>cloud?'cloud':'device',speakAppText:async(text,signal)=>{f.cloud.push(text);if(cloudHold)await new Promise((resolve,reject)=>f.pending.push({text,signal,resolve,reject}));}};
 load(box,'.eliza/client-features/packages/voice/src/native-speech-request.ts','createNativeSpeechRequests');
 load(box,'apps/app/src/local-speech-playback.ts','speakLocalText');
 load(box,'apps/app/src/runtime/local-voice.ts','createOnDeviceVoice');
 load(box,'.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts','SharedNavigationVoice:NavigationVoice');
 load(box,'apps/app/src/maps/navigation-voice.ts','NavigationVoice');
 const voice=new box.NavigationVoice(error=>f.failed.push(error),canSpeak);
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
 voice.update('step-1','Turn left');await until(()=>f.end);
 screen(true);await settle();
 assert.equal(voice.enabled,true);assert.equal(f.failed.length,0);
 f.end=undefined;screen(false);await until(()=>f.end);f.end();await settle();
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

test('on the run-time Cloud route, navigation is spoken through the app speaker (which falls back to this phone), not the engine directly',async()=>{
 const {f,voice}=fixture({cloud:true});
 voice.update('step-1','Turn left');await settle();
 assert.deepEqual(f.cloud,['Turn left']);assert.deepEqual(f.spoken,[]);assert.equal(voice.enabled,true);
});

test('same-step location updates while hidden retain only one owed instruction',async()=>{
 const {f,voice,screen}=fixture({cloud:true});screen(true);voice.update('step-1','Turn left');voice.update('step-1','Turn left');screen(false);await settle();assert.deepEqual(f.cloud,['Turn left']);
});
test('mute clears owed guidance; enabling explicitly resumes only the latest instruction',async()=>{
 const {f,voice,screen}=fixture({cloud:true});screen(true);voice.update('step-1','Turn left');voice.toggle();voice.update('step-2','Keep right');screen(false);await settle();assert.deepEqual(f.cloud,[]);voice.toggle();await settle();assert.deepEqual(f.cloud,['Keep right']);
});
test('a changed Cloud account cannot resume the old account instruction',async()=>{
 const {f,voice,screen}=fixture({cloud:true});screen(true);voice.update('step-1','Turn left');f.account='account-2';screen(false);await settle();assert.deepEqual(f.cloud,[]);voice.pause();
});

for(const cloud of [false,true])test(`provider-restricted guidance never reaches ${cloud?'Cloud':'local'} synthesis`,async()=>{
 const {f,voice,screen}=fixture({cloud,canSpeak:()=>false});
 voice.update('google-step','Turn left');voice.toggle();screen(true);screen(false);await settle();
 assert.deepEqual(f.spoken,[]);assert.deepEqual(f.cloud,[]);assert.deepEqual(f.failed,[]);
 assert.equal(f.statusReads,0);
});

test('a provider restriction introduced while the screen sleeps retires the owed instruction',async()=>{
 let allowed=true;
 const {f,voice,screen}=fixture({cloud:true,canSpeak:()=>allowed});
 screen(true);voice.update('step-1','Turn left');await settle();
 allowed=false;screen(false);await settle();
 assert.deepEqual(f.cloud,[]);
 allowed=true;voice.toggle();voice.toggle();await settle();
 assert.deepEqual(f.cloud,[],'enabling guidance cannot replay the retired instruction');
 voice.update('step-2','Keep right');await settle();
 assert.deepEqual(f.cloud,['Keep right']);
});

test('a provider restriction introduced during local readiness prevents synthesis',async()=>{
 let allowed=true,release;
 const ready=new Promise(resolve=>release=resolve);
 const {f,voice}=fixture({canSpeak:()=>allowed,readyGate:()=>ready});
 voice.update('step-1','Turn left');await until(()=>f.statusReads===1);
 allowed=false;release();await settle();
 assert.deepEqual(f.spoken,[]);assert.deepEqual(f.failed,[]);
 allowed=true;voice.toggle();voice.toggle();await settle();
 assert.deepEqual(f.spoken,[],'enabling guidance cannot replay the refused instruction');voice.pause();
});
test('a fast screen-off/on transition resumes interrupted speech once after cleanup',async()=>{
 const {f,voice,screen}=fixture({cloud:true,cloudHold:true});voice.update('step-1','Turn left');await tick();screen(true);screen(false);f.pending[0].reject(new DOMException('Visibility changed','AbortError'));await settle();assert.deepEqual(f.cloud,['Turn left','Turn left']);f.pending[1].resolve();await settle();screen(true);screen(false);await settle();assert.equal(f.cloud.length,2);assert.equal(f.failed.length,0);
});
for(const code of ['voice-http-402','speech-cleanup-unconfirmed'])test(`hidden ${code} remains a real failure instead of an automatic replay`,async()=>{
 const {f,voice,screen}=fixture({cloud:true,cloudHold:true});voice.update('step-1','Turn left');await tick();screen(true);f.pending[0].reject(Object.assign(new Error(code),{name:code==='speech-cleanup-unconfirmed'?'AbortError':'Error',code}));await settle();screen(false);await settle();assert.equal(voice.enabled,false);assert.equal(f.failed.length,1);assert.deepEqual(f.cloud,['Turn left']);
});
for(const action of ['stop','mute','new-step'])test(`late screen-off cancellation cannot undo ${action}`,async()=>{
 const {f,voice,screen}=fixture({cloud:true,cloudHold:true});voice.update('step-1','Turn left');await tick();screen(true);
 if(action==='stop')voice.pause();else if(action==='mute')voice.toggle();else voice.update('step-2','Keep right');
 assert.equal(f.pending[0].signal.aborted,true);f.pending[0].reject(new DOMException('Visibility changed','AbortError'));await settle();screen(false);await settle();assert.deepEqual(f.cloud,action==='new-step'?['Turn left','Keep right']:['Turn left']);assert.equal(f.failed.length,0);f.pending[1]?.resolve();voice.pause();
});
