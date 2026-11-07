import test from 'node:test';
import assert from 'node:assert/strict';
import {browserLocalSpeechStatus,transcribeWithSelectedBrowserAgent} from '../apps/app/src/browser/local-transcription.ts';
import {decodeRecordingPcm,recordingPcmWav} from '../.eliza/client-features/packages/voice/src/browser-capture/recording-pcm.ts';
const signal=()=>new AbortController().signal;
test('no selected agent means unavailable without decoding or network fallback',async()=>{
 assert.equal((await browserLocalSpeechStatus(()=>null,signal())).ready,false);
 let decoded=0;await assert.rejects(transcribeWithSelectedBrowserAgent(()=>null,async()=>{decoded++;return new Uint8Array();},signal()),/unavailable/);assert.equal(decoded,0);
});
test('only explicitly selected agent receives the owned recording',async()=>{
 const calls=[],bytes=new Uint8Array([1,2]);const agent={session:'a',speechRequest:async(audio)=>{calls.push(audio);return {ready:true,text:'Reviewed words'};}};
 assert.equal((await browserLocalSpeechStatus(()=>agent,signal())).ready,true);
 const result=await transcribeWithSelectedBrowserAgent(()=>agent,async()=>bytes,signal());assert.equal(result.text,'Reviewed words');assert.deepEqual(calls,[undefined,bytes]);
});
test('selection changes during decode or provider response discard old work',async()=>{
 let calls=0,current;const a={session:'a',speechRequest:async()=>{calls++;current=null;return {text:'late'};}};current=a;
 await assert.rejects(transcribeWithSelectedBrowserAgent(()=>current,async()=>{current=null;return new Uint8Array();},signal()),/selection changed/);assert.equal(calls,0);
 current=a;await assert.rejects(transcribeWithSelectedBrowserAgent(()=>current,async()=>new Uint8Array(),signal()),/selection changed/);assert.equal(calls,1);
});
test('aborted transcription and empty text never become a completed transcript',async()=>{
 const controller=new AbortController(),agent={session:'a',speechRequest:async()=>{controller.abort();return {text:'late'};}};
 await assert.rejects(transcribeWithSelectedBrowserAgent(()=>agent,async()=>new Uint8Array(),controller.signal),{name:'AbortError'});
 agent.speechRequest=async()=>({text:' '});await assert.rejects(transcribeWithSelectedBrowserAgent(()=>agent,async()=>new Uint8Array(),signal()),/No speech/);
});

function decodedRecording(t,{samples=new Float32Array([0]),duration=1,onRender=()=>{}}={}){
 const contexts=[];
 const original=globalThis.OfflineAudioContext;
 globalThis.OfflineAudioContext=class {
  destination={};
  constructor(channels,length,sampleRate){contexts.push({channels,length,sampleRate});}
  async decodeAudioData(){return {duration};}
  createBufferSource(){return {connect(){},start(){}};}
  async startRendering(){onRender();return {getChannelData:()=>samples};}
 };
 t.after(()=>{if(original===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=original;});
 return contexts;
}

test('owned browser recording reaches the selected agent as 16 kHz mono PCM WAV',async t=>{
 const samples=new Float32Array([-2,-1,-0.5,-1/65536,0,1/32767,0.5,1,2]);
 const contexts=decodedRecording(t,{samples,duration:samples.length/16000});
 let uploaded;
 const agent={session:'a',speechRequest:async audio=>{uploaded=audio;return {text:'Recorded words'};}};
 const result=await transcribeWithSelectedBrowserAgent(()=>agent,()=>recordingPcmWav(new Blob(['owned audio']),signal()),signal());
 assert.equal(result.text,'Recorded words');
 assert.equal(Buffer.from(uploaded.subarray(0,4)).toString(),'RIFF');
 assert.equal(Buffer.from(uploaded.subarray(8,12)).toString(),'WAVE');
 const wav=new DataView(uploaded.buffer,uploaded.byteOffset,uploaded.byteLength);
 assert.equal(wav.getUint16(20,true),1);
 assert.equal(wav.getUint16(22,true),1);
 assert.equal(wav.getUint32(24,true),16000);
 assert.equal(wav.getUint16(34,true),16);
 assert.equal(wav.getUint32(40,true),samples.length*2);
 assert.deepEqual(Array.from({length:samples.length},(_,i)=>wav.getInt16(44+i*2,true)),[-32768,-32768,-16384,0,0,1,16384,32767,32767]);
 assert.deepEqual(contexts,[{channels:1,length:1,sampleRate:16000},{channels:1,length:samples.length,sampleRate:16000}]);
});

test('browser recording keeps input, duration and cancellation admission before upload',async t=>{
 const controller=new AbortController();
 const contexts=decodedRecording(t,{duration:61});
 await assert.rejects(decodeRecordingPcm(new Blob(),signal()),/Recording size is invalid/);
 await assert.rejects(decodeRecordingPcm({size:16_000_001},signal()),/Recording size is invalid/);
 assert.equal(contexts.length,0);
 await assert.rejects(decodeRecordingPcm(new Blob(['audio']),signal()),/under 60 seconds/);
 assert.equal(contexts.length,1,'oversized duration never starts rendering');
 controller.abort();
 await assert.rejects(decodeRecordingPcm(new Blob(['audio']),controller.signal),{name:'AbortError'});
 assert.equal(contexts.length,1,'cancelled capture never starts decoding');
});

test('browser recording discards render completion after cancellation',async t=>{
 const controller=new AbortController();
 decodedRecording(t,{onRender:()=>controller.abort()});
 await assert.rejects(recordingPcmWav(new Blob(['audio']),controller.signal),{name:'AbortError'});
});
