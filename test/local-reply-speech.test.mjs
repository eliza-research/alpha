import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
// Controller contract over a fake bridge; not playback, gaplessness or latency evidence.
const source=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/local-reply-speech.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(){
 const listeners={},calls=[];let active;
 const emit=(event,value)=>{for(const listener of listeners[event]||[])listener(value);};
 const bridge={
  addListener:async(event,listener)=>{(listeners[event]??=[]).push(listener);return {remove:async()=>{}};},
  synthesizeLocal:async input=>{calls.push(['synthesize',input.text,input.append]);if(active)return {playbackId:active,execution:'device',appended:true};active='p1';return {playbackId:'p1',execution:'device'};},
  play:async input=>{calls.push(['play',input.playbackId]);},
  cancel:async input=>{calls.push(['cancel']);},
  stopPlayback:async input=>{calls.push(['stop',input.playbackId]);if(bridge.stopFails)throw Error('refused');active=undefined;},
  holdSpeechEngine:async()=>{calls.push(['hold']);},releaseSpeechEngineHold:async()=>{calls.push(['release']);},
 };
 let ids=0;const requests=[];
 const box={registerPlugin:()=>bridge,planLocalSpeech:text=>text?[text]:[],nativeVoiceTurnId:()=>undefined,crypto:{randomUUID:()=>{const id=`r${++ids}`;requests.push(id);return id;}},setTimeout,clearTimeout,Date,Math,Number,Promise,Error,Object,Map,DOMException,AbortController};
 vm.runInNewContext(source+'\nglobalThis.speaker=createLocalReplySpeaker();',box);
 return {speaker:box.speaker,calls,emit,requests,bridge,end:()=>{active=undefined;emit('playbackEnded',{playbackId:'p1'});}};
}
test('the next sentence joins the playing utterance and each call settles when its own sentence ended',async()=>{
 const f=fixture(),order=[];
 const first=f.speaker.speak('First sentence here.',new AbortController().signal,()=>order.push('first audible')).then(()=>order.push('first ended'));
 await tick();assert.deepEqual(f.calls,[['synthesize','First sentence here.',true],['play','p1']]);assert.deepEqual(order,['first audible']);
 const second=f.speaker.speak('Second sentence here.',new AbortController().signal,()=>order.push('second audible')).then(()=>order.push('second ended'));
 await tick();assert.deepEqual(f.calls.at(-1),['synthesize','Second sentence here.',true]);assert.equal(f.calls.filter(call=>call[0]==='play').length,1,'an appended sentence needs no play');
 assert.deepEqual(order,['first audible']);
 f.emit('playbackSegmentStarted',{playbackId:'p1',requestId:f.requests[1],atMs:Date.now()});
 await tick();await first;assert.deepEqual([...order].sort(),['first audible','first ended','second audible']);
 f.end();await second;assert.equal(order.length,4);assert.equal(order.at(-1),'second ended');
 assert.equal(f.calls.some(call=>call[0]==='stop'),false,'a played reply is not stopped');
});
test('an interruption stops the utterance and rejects every sentence in flight',async()=>{
 const f=fixture(),controller=new AbortController();
 const first=f.speaker.speak('First sentence here.',controller.signal,()=>{}),second=(await tick(),f.speaker.speak('Second sentence here.',controller.signal,()=>assert.fail('never audible')));
 await tick();controller.abort();
 await assert.rejects(first,{name:'AbortError'});await assert.rejects(second,{name:'AbortError'});
 assert.equal(f.calls.filter(call=>call[0]==='stop').length,2);
});
test('a stop the bridge refuses is reported as unconfirmed cleanup',async()=>{
 const f=fixture(),controller=new AbortController();f.bridge.stopFails=true;
 const speaking=f.speaker.speak('First sentence here.',controller.signal,()=>{});await tick();controller.abort();
 await assert.rejects(speaking,{code:'speech-cleanup-unconfirmed'});
});
test('a phone call ends the sentence with its reason; silence resolves without the bridge',async()=>{
 const f=fixture();const speaking=f.speaker.speak('First sentence here.',new AbortController().signal,()=>{});await tick();
 f.emit('playbackStopped',{playbackId:'p1',reason:'call-active'});await assert.rejects(speaking,{code:'call-active'});
 let started=0;await f.speaker.speak('',new AbortController().signal,()=>started++);assert.equal(started,1);
 f.speaker.hold();f.speaker.release();await tick();assert.deepEqual(f.calls.slice(-2),[['hold'],['release']]);
});
