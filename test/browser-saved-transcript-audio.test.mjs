import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const source=fs.readFileSync('apps/app/src/browser/voice.ts','utf8');
const start=source.indexOf(' private savedSpeech?'),end=source.indexOf(' private clip(',start);
assert(start>=0&&end>start);
function fixture(durationMs=60000,decodedMs=durationMs){
 const calls={decodes:0,windows:[]},row={audioId:'audio',noteId:'note',durationMs,blob:new Blob(['local audio'])};
 const pcm=Float32Array.from({length:decodedMs*16},(_,i)=>i);
 const scope=vm.createContext({Blob,Uint8Array,Float32Array,DOMException,audioRecord:async()=>row,
  decodeRecordingPcm:async()=>{calls.decodes++;return pcm;},encodePcm16Wav:samples=>{calls.windows.push({first:samples[0],length:samples.length});return new Uint8Array(samples.length*2+44);}});
 vm.runInContext(stripTypeScriptTypes('class Audio {'+source.slice(start,end)+'};globalThis.Audio=Audio;',{mode:'transform'}),scope);
 return {calls,row,pcm,audio:new scope.Audio(),input:{recordingId:'audio',savedNoteId:'note',savedDurationMs:durationMs,requestId:'request',offsetMs:0},signal:new AbortController().signal};
}
test('saved audio is decoded once, windowed in order and cleared after the final window',async()=>{
 const f=fixture();for(const offsetMs of [0,25000,50000]){const out=await f.audio.transcriptionAudio({...f.input,offsetMs},f.signal);assert.equal(out.blob.type,'audio/wav');await out.verify();}
 assert.equal(f.calls.decodes,1);assert.deepEqual(f.calls.windows,[{first:0,length:400000},{first:400000,length:400000},{first:800000,length:160000}]);assert.equal(f.audio.savedSpeech,undefined);assert(f.pcm.every(sample=>sample===0));
});
test('foreign or deleted saved audio is refused before decoding',async()=>{
 for(const patch of [{noteId:'foreign'},{deletedAt:1},{durationMs:1000}]){const f=fixture();Object.assign(f.row,patch);await assert.rejects(f.audio.transcriptionAudio(f.input,f.signal));assert.equal(f.calls.decodes,0);}
});
test('invalid window coordinates cannot nominate arbitrary audio',async()=>{
 for(const offsetMs of [-1,1,NaN,Infinity,60000]){const f=fixture();await assert.rejects(f.audio.transcriptionAudio({...f.input,offsetMs},f.signal));assert.equal(f.calls.decodes,0);}
});
test('deletion after preparing a window is refused before transport',async()=>{
 const f=fixture();const out=await f.audio.transcriptionAudio(f.input,f.signal);f.row.deletedAt=1;await assert.rejects(out.verify());
});
test('a trailing metadata frame beyond encoded audio sends no empty upload',async()=>{
 const f=fixture(50020,50000);await f.audio.transcriptionAudio(f.input,f.signal);const out=await f.audio.transcriptionAudio({...f.input,offsetMs:50000},f.signal);assert.equal(out.empty,true);assert.equal(out.blob.size,0);assert.equal(f.audio.savedSpeech,undefined);
});
