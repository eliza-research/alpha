import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=stripTypeScriptTypes(readFileSync(new URL('../.eliza/client-features/packages/ui/src/voice/voice-session-mic-capture.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
function fixture(initial='running',earlyEnd=false){
 const context=vm.createContext({AbortController,DOMException,Float32Array,Uint8Array,VOICE_PCM_SAMPLE_RATE:16000,floatPcmToInt16Bytes:samples=>new Uint8Array(samples.length*2)});
 vm.runInContext(source+';globalThis.start=startVoiceMicCapture;',context);
 let state=initial,hidden=false,listener,stops=0,closed=0,resumes=0;
 const errors=[],frames=[];const node={connect(){return node},disconnect(){}};
 const processor={...node,onaudioprocess:null};
 const audio={sampleRate:16000,get state(){return state},destination:node,createMediaStreamSource:()=>node,createScriptProcessor:()=>processor,suspend:async()=>{state='suspended'},resume:async()=>{state='running'},close:async()=>{closed++;state='closed'}};
 const trackListeners=new Map(),contextListeners=new Map();
 const track={readyState:'live',enabled:true,addEventListener(t,fn){trackListeners.set(t,fn);if(earlyEnd){this.readyState='ended';fn()}},removeEventListener(t){trackListeners.delete(t)},stop(){stops++;this.readyState='ended'}};
 audio.addEventListener=(t,fn)=>contextListeners.set(t,fn);audio.removeEventListener=t=>contextListeners.delete(t);
 const options={getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),createAudioContext:()=>audio,onFrame:frame=>frames.push(frame),onError:error=>errors.push(error),onResume:()=>resumes++,visibility:{isHidden:()=>hidden,addListener:fn=>{listener=fn},removeListener:()=>{listener=undefined}}};
 return {start:()=>context.start(options),audio,errors,frames,processor,get stops(){return stops},get closed(){return closed},get resumes(){return resumes},track,trackListeners,contextListeners,endTrack(){track.readyState='ended';trackListeners.get('ended')?.()},closeContext(){state='closed';contextListeners.get('statechange')?.()},setState:value=>{state=value},visibility(value){hidden=value;listener?.()}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('rejected initial AudioContext resume fails startup and releases the microphone',async()=>{
 const h=fixture('suspended');h.audio.resume=async()=>{throw Error('resume denied')};
 await assert.rejects(h.start(),/pipeline failed to start/);assert.equal(h.stops,1);assert.equal(h.closed,1);
});
test('a resolved resume that leaves the audio graph suspended is not readiness',async()=>{
 const h=fixture('suspended');h.audio.resume=async()=>{};
 await assert.rejects(h.start(),/pipeline failed to start/);assert.equal(h.stops,1);
});
test('failed visibility resume retains suspension and reports failure without a resumed notification',async()=>{
 const h=fixture();const mic=await h.start();h.visibility(true);h.audio.resume=async()=>{throw Error('resume denied')};h.visibility(false);await settle();
 assert.equal(mic.active,false);assert.equal(h.resumes,0);assert.equal(h.errors.length,1);
 assert.equal(h.processor.onaudioprocess,null);assert.equal(h.stops,1);assert.equal(h.frames.length,0);await mic.stop();
});
test('successful visibility resume restores actual frame delivery',async()=>{
 const h=fixture();const mic=await h.start();h.visibility(true);h.visibility(false);await settle();
 assert.equal(mic.active,true);assert.equal(h.resumes,1);h.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1600)}});assert.equal(h.frames.length,1);await mic.stop();
});
test('a resume completing after Stop cannot publish readiness',async()=>{
 const h=fixture();const mic=await h.start();let finish;h.visibility(true);h.audio.resume=()=>new Promise(resolve=>{finish=resolve});h.visibility(false);await mic.stop();finish();await settle();assert.equal(h.resumes,0);assert.equal(mic.active,false);
});

test('unexpected track end reports failure once and releases the graph',async()=>{const h=fixture();const mic=await h.start();h.endTrack();await settle();assert.equal(mic.active,false);assert.equal(h.errors.length,1);assert.equal(h.processor.onaudioprocess,null);assert.equal(h.closed,1);h.endTrack();await mic.stop();assert.equal(h.errors.length,1);assert.equal(h.stops,1);});
test('unexpected context close reports failure once and releases the track',async()=>{const h=fixture();const mic=await h.start();h.closeContext();await settle();assert.equal(mic.active,false);assert.equal(h.errors.length,1);assert.equal(h.track.readyState,'ended');assert.equal(h.processor.onaudioprocess,null);await mic.stop();assert.equal(h.errors.length,1);});
test('normal mute keeps capture active and normal Stop removes lifecycle listeners without error',async()=>{const h=fixture();const mic=await h.start();mic.setMuted(true);assert.equal(h.track.enabled,false);assert.equal(mic.active,true);mic.setMuted(false);assert.equal(h.track.enabled,true);await mic.stop();h.endTrack();h.closeContext();await settle();assert.equal(h.errors.length,0);assert.equal(h.trackListeners.size,0);assert.equal(h.contextListeners.size,0);assert.equal(h.stops,1);});

test('a track ending during listener attachment rejects startup and leaves no callbacks',async()=>{const h=fixture('running',true);await assert.rejects(h.start(),/ended during startup/);assert.equal(h.stops,1);assert.equal(h.closed,1);assert.equal(h.trackListeners.size,0);assert.equal(h.contextListeners.size,0);assert.equal(h.errors.length,0);});
