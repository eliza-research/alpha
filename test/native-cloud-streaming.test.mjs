import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

function fixture(options={}){
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/native-cloud-speech.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export interface','interface').replaceAll('export const','const').replaceAll('export function','function');
 const box={crypto,AbortController,DOMException,Error,Promise,Map,Date,setTimeout,clearTimeout,registerPlugin:()=>({}),Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>true}};
 vm.runInNewContext(stripTypeScriptTypes(source)+'\nglobalThis.create=createCloudStreamingSpeech;',box);
 let listener,sessionId,current=true,stops=0,mutes=[],speaks=[],cancels=[],removed=0;
 const port={
  async addListener(_name,fn){listener=fn;return {remove:async()=>{removed++;listener=undefined;}};},
  async startCloudSpeech(input){sessionId=input.sessionId;if(options.start)return options.start(input);return {sessionId,sampleRate:16000,echoCancelled:true};},
  async stopCloudSpeech(){stops++;},async setCloudSpeechMuted(input){mutes.push(input.muted);},
  async speakCloudSpeech(input){speaks.push(input);},async cancelCloudSpeech(input){cancels.push(input);},
 };
 const interim=[],speech=box.create({environment:'production',credentialId:'not-a-secret-revision',assertCurrent(){if(!current)throw Error('Owner changed');},onInterim:t=>interim.push(t)},port);
 const events=[],controller=new AbortController();
 const handlers={signal:controller.signal,onSpeechStart:()=>events.push('start'),onSpeechEnd:()=>events.push('end'),onSegment:t=>events.push(t),onEnd:e=>events.push('failed'),onLevel:p=>events.push(p)};
 return {speech,port,events,interim,handlers,controller,speaks,cancels,mutes,get stops(){return stops},get removed(){return removed},get id(){return sessionId},change(){current=false;},emit(event){listener?.({sessionId,...event});}};
}

test('streaming ASR sends one final segment, interims never submit, unrelated sessions are ignored',async()=>{
 const f=fixture(),capture=await f.speech.listen(f.handlers);
 assert.equal(capture.fullDuplex,true);assert.deepEqual(f.mutes,[false]);
 f.emit({sessionId:'stale',type:'speech-start'});f.emit({type:'speech-start'});f.emit({type:'speech-start'});
 f.emit({type:'transcript',text:'partial',final:false});assert.deepEqual(f.events,['start']);assert.deepEqual(f.interim,['partial']);
 f.emit({type:'speech-end',text:'finished sentence',final:true});assert.deepEqual(f.events,['start','end','finished sentence']);
 await capture.close();assert.deepEqual(f.mutes,[false,true]);assert.equal(f.stops,0,'mute preserves the output socket');
 await f.speech.listen(f.handlers);assert.deepEqual(f.mutes,[false,true,false]);
 await f.speech.stop();assert.equal(f.stops,1);assert.equal(f.removed,1);
});

test('first PCM starts playback before completion; unrelated completion cannot settle speech',async()=>{
 const f=fixture();await f.speech.listen(f.handlers);let started=0,finished=false;
 const pending=f.speech.speak('Finalized reply.',new AbortController().signal,()=>started++).then(()=>finished=true);
 await Promise.resolve();const id=f.speaks[0].utteranceId;
 f.emit({type:'audio-start',utteranceId:id});assert.equal(started,1);assert.equal(finished,false);
 f.emit({type:'audio-start',utteranceId:id});assert.equal(started,1);
 f.emit({type:'audio-end',utteranceId:'stale'});await Promise.resolve();assert.equal(finished,false);
 f.emit({type:'audio-end',utteranceId:id});await pending;assert.equal(finished,true);
 await f.speech.stop();
});

test('speech cancellation waits for native cancellation and drops late audio',async()=>{
 const f=fixture();await f.speech.listen(f.handlers);const abort=new AbortController();let started=0;
 const pending=f.speech.speak('Finalized reply.',abort.signal,()=>started++);await Promise.resolve();const id=f.speaks[0].utteranceId;
 abort.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.cancels.length,1);
 f.emit({type:'audio-start',utteranceId:id});assert.equal(started,0);await f.speech.stop();
});

test('account change closes capture and output without forwarding another transcript',async()=>{
 const f=fixture();await f.speech.listen(f.handlers);f.change();f.emit({type:'speech-end',text:'must not submit',final:true});
 await Promise.resolve();assert.deepEqual(f.events,['failed']);assert.equal(f.stops,1);
});

test('server completion with no played PCM fails instead of claiming heard text',async()=>{
 const f=fixture();await f.speech.listen(f.handlers);
 const pending=f.speech.speak('Finalized reply.',new AbortController().signal,()=>{});await Promise.resolve();
 f.emit({type:'audio-end',utteranceId:f.speaks[0].utteranceId});await assert.rejects(pending,/without audio/);await f.speech.stop();
});

test('aborting during socket bootstrap reaches native stop before delayed start settles',async()=>{
 let release;const f=fixture({start:input=>new Promise(resolve=>release=()=>resolve({sessionId:input.sessionId,sampleRate:16000,echoCancelled:true}))});
 const opening=f.speech.listen(f.handlers);for(let i=0;i<20&&!release;i++)await Promise.resolve();assert.equal(typeof release,'function');f.controller.abort();await Promise.resolve();
 assert.equal(f.stops,1);release();await assert.rejects(opening,{name:'AbortError'});assert.equal(f.removed,1);
});

test('ending a muted conversation still retires its retained output socket',async()=>{
 const f=fixture(),capture=await f.speech.listen(f.handlers);await capture.close();
 assert.equal(f.stops,0);f.controller.abort();await f.speech.stop();
 assert.equal(f.stops,1);assert.equal(f.removed,1);
});

test('a listener arriving after Stop is removed without opening the microphone',async()=>{
 const f=fixture();let release,removed=0;
 f.port.addListener=()=>new Promise(resolve=>release=()=>resolve({remove:async()=>removed++}));
 const opening=f.speech.listen(f.handlers);await Promise.resolve();assert.equal(typeof release,'function');
 await f.speech.stop();release();await assert.rejects(opening,{name:'AbortError'});
 assert.equal(removed,1);assert.equal(f.id,undefined,'native microphone start was never dispatched');
});

test('unconfirmed native cancellation preserves its safe cleanup failure',async()=>{
 const f=fixture();await f.speech.listen(f.handlers);f.port.cancelCloudSpeech=async()=>{throw Error('private native error');};
 const controller=new AbortController(),pending=f.speech.speak('Finalized reply.',controller.signal,()=>{});controller.abort();
 await assert.rejects(pending,error=>error.code==='speech-cleanup-unconfirmed'&&!error.message.includes('private'));await f.speech.stop();
});
