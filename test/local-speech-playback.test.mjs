import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
// A native bridge whose gate refuses a new request until the cancelled worker unwinds (300 ms).
function fixture({native:onDevice=true}={}){
 const f={pending:0,played:0,requests:[]};const listeners=new Map();
 const native={
  addListener:async(event,listener)=>{listeners.set(event,listener);return {remove:async()=>{}};},
  synthesizeLocal:async input=>{
   if(f.pending)throw Object.assign(Error('Voice request already active or unavailable'),{code:'UNAVAILABLE'});
   f.pending++;f.requests.push(input);
   try{if(f.requests.length===1)await new Promise((_,reject)=>f.unwind=()=>setTimeout(()=>reject(Object.assign(Error('cancelled'),{code:'CANCELLED'})),300));return {playbackId:'owned-'+f.requests.length,execution:'device'};}
   finally{f.pending--;}
  },
  play:async input=>{f.played++;setTimeout(()=>listeners.get('playbackEnded')?.({playbackId:input.playbackId}),0);},
  cancel:async()=>{f.unwind?.();},
  stopPlayback:async()=>{},
 };
 const box={AbortController,DOMException,crypto,console,setTimeout,clearTimeout,Capacitor:{isNativePlatform:()=>onDevice},registerPlugin:()=>native,planLocalSpeech:text=>[text],nativeVoiceTurnId:()=>undefined};
 let src=readFileSync('apps/app/src/local-speech-playback.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});
 vm.runInNewContext('{'+src+';Object.assign(globalThis,{speakLocalText});}',box);
 return {f,speak:box.speakLocalText};
}
for(const strictDrain of [false,true])test(`stop then start waits for the cancelled native request, strictDrain=${strictDrain}`,async()=>{
 const {f,speak}=fixture(),first=new AbortController();
 const stopped=speak('Message A',first.signal,undefined,false,undefined,strictDrain).then(()=>null,error=>error);
 while(!f.unwind)await tick();
 const started=Date.now();first.abort();
 assert.equal((await stopped)?.name,'AbortError');
 assert.ok(Date.now()-started>=250,'retirement must wait for the native request to settle');
 assert.equal(f.pending,0);
 await speak('Message B',new AbortController().signal,undefined,false,undefined,strictDrain);
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].text,'Message B');assert.equal(f.played,1);
});
for(const native of [true,false])test(`queued local speech asks not to replace current playback, native=${native}`,async()=>{
 const {f,speak}=fixture({native});f.requests.push({});
 await speak('Queued reply',new AbortController().signal,undefined,true);
 assert.equal(f.requests[1].replace,false);
});
