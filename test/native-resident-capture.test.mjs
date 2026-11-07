import test from 'node:test';
import assert from 'node:assert/strict';
// The shared native live transport (@elizaos/voice/native-live) projected from the reviewed pin.
import {openNativeResidentCapture} from '../.eliza/client-features/packages/voice/src/native-live-voice.ts';

const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
 const listeners=new Map(),stops=[],results=[],errors=[],edges=[],levels=[];let id,valid=true,startResolve,stopResolve,eventFeed;
 const state={delayStart:false,delayStop:false,ack:true};
 const port={async addListener(name,handler){listeners.set(name,handler);return {remove:async()=>listeners.delete(name)};},
  async startLiveCapture(input){id=input.captureId;if(state.delayStart)await new Promise(resolve=>{startResolve=resolve;});return {captureId:id,sampleRate:16000,echoCancelled:true,nativeAsr:true};},
  async stopLiveCapture(input){stops.push(input);state.onStop?.();if(state.delayStop)await new Promise(resolve=>{stopResolve=resolve;});return {serverClosed:state.ack};}};
 const controller=new AbortController();
 const input={signal:controller.signal,ownerId:'owner',echoCancel:true,current:()=>valid,subscribe:handler=>{eventFeed=handler;return()=>{eventFeed=undefined;};},onSpeechStart:at=>edges.push(['start',at]),onSpeechEnd:at=>edges.push(['end',at]),onSegment:(text)=>results.push(text),onLost:error=>errors.push(error),onLevel:peak=>levels.push(peak)};
 return {state,stops,results,errors,edges,levels,controller,listeners,open:()=>openNativeResidentCapture(port,input),emit:(name,event)=>listeners.get(name)?.(Object.defineProperty(Object.create(event),'captureId',{value:id})),invalidate:()=>{valid=false;},finishStart:()=>startResolve?.(),finishStop:()=>stopResolve?.(),feed:event=>eventFeed?.(event)};
}
test('native path sees metadata and one final; PCM property is never read',async()=>{
 const f=fixture(),capture=await f.open();
 const event={vad:[{type:'speech-start',timestampMs:1},{type:'speech-end',timestampMs:2}],peak:.5};Object.defineProperty(event,'frames',{get(){throw Error('PCM entered renderer');},enumerable:false});
 f.emit('liveCaptureFrames',event);f.emit('liveCaptureTranscript',{final:{turnId:'one',text:'hello',mode:'stream'}});f.emit('liveCaptureTranscript',{final:{turnId:'one',text:'duplicate'}});
 assert.deepEqual(f.results,['hello']);assert.deepEqual(f.edges,[['start',1],['end',2]]);assert.deepEqual(f.levels,[.5]);await capture.close(3);assert.equal(f.stops[0].discard,false);assert.equal(f.listeners.size,0);
});
test('owner change cancels and refuses late transcript',async()=>{
 const f=fixture(),capture=await f.open();f.invalidate();f.emit('liveCaptureTranscript',{final:{turnId:'one',text:'private'}});await flush();assert.equal(f.stops[0].discard,true);assert.equal(f.errors.length,1);assert.deepEqual(f.results,[]);await capture.cancel();
});
test('abort reaches native stop during delayed startup and drops its late acknowledgement',async()=>{
 const f=fixture();f.state.delayStart=true;const opening=f.open();await flush();f.controller.abort();await flush();assert.equal(f.stops.length,1);f.finishStart();await assert.rejects(opening,{name:'AbortError'});assert.equal(f.listeners.size,0);
});
test('abort overtakes graceful close and discards late finals',async()=>{
 const f=fixture(),capture=await f.open();f.emit('liveCaptureFrames',{vad:[{type:'speech-start',timestampMs:1}]});f.state.delayStop=true;
 const closing=capture.close(2);await flush();f.state.delayStop=false;f.controller.abort();await flush();assert.equal(f.stops.length,2);assert.equal(f.stops[1].discard,true);
 f.emit('liveCaptureTranscript',{final:{turnId:'late',text:'discard'}});f.finishStop();await closing;assert.deepEqual(f.results,[]);
});
test('unconfirmed server close is reported and bounded missing final resolves null',async()=>{
 const failed=fixture(),first=await failed.open();failed.state.ack=false;await assert.rejects(first.close(),/not confirmed/);
 const f=fixture(),capture=await f.open();f.emit('liveCaptureFrames',{vad:[{type:'speech-start',timestampMs:1}]});await capture.close(2);assert.deepEqual(f.results,[null]);
});

test('graceful close reconciles a start frame flushed after the Stop tap',async()=>{
 const f=fixture(),capture=await f.open();
 f.state.onStop=()=>{f.emit('liveCaptureFrames',{vad:[{type:'speech-start',timestampMs:1}]});f.emit('liveCaptureEnded',{});f.emit('liveCaptureTranscript',{final:{turnId:'flushed',text:'captured before stop',mode:'stream'}});};
 await capture.close(2);assert.deepEqual(f.results,['captured before stop']);assert.deepEqual(f.edges,[['start',1],['end',2]]);
});
