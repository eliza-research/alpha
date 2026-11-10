import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAsr} from '../scripts/local-asr.ts';
function fixture(options={}){
 const calls=[];const service={initialized:false,async initialize(){await options.boot?.();this.initialized=true;},async transcribe(id,samples,rate,signal){calls.push({id,samples,rate,signal});return options.transcribe?options.transcribe(signal):'  reviewed transcript  ';},stop(){calls.push('stop');this.initialized=false;}};
 return {service,calls,load:async()=>({service,readAudio:audio=>{assert.equal(audio.toString(),'synthetic-wave');return{samples:Buffer.from([1,0,2,0]),sampleRate:16000};}})};
}
test('development ASR reports ready only after native initialization; result comes from shared service',async()=>{
 let ready;const f=fixture({boot:()=>new Promise(r=>ready=r)}),asr=createLocalAsr(f.load);let settled=false;
 const status=asr.available().then(value=>{settled=true;return value;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);ready();assert.equal(await status,true);
 const result=await asr.transcribeWav(Buffer.from('synthetic-wave'),new AbortController().signal);
 assert.deepEqual(result,{text:'reviewed transcript',language:'en',engine:'local-inference',local:true,durationSeconds:2/16000});assert.equal(f.calls.length,1);assert.match(f.calls[0].id,/^[a-f0-9-]{36}$/);assert.equal(f.calls[0].rate,16000);asr.stop();
});
test('admission/init failures never become available or a transcript',async()=>{
 const asr=createLocalAsr(async()=>{throw Error('unadmitted');});assert.equal(await asr.available(),false);await assert.rejects(asr.transcribeWav(Buffer.alloc(1)),/unadmitted/);
});
test('cancelled loading never dispatches audio and late transcription cannot escape cancellation',async()=>{
 const f=fixture();let release;const asr=createLocalAsr(()=>new Promise(r=>release=()=>r(f.load())));const abort=new AbortController();const pending=asr.transcribeWav(Buffer.from('synthetic-wave'),abort.signal);abort.abort();release();await assert.rejects(pending);assert.equal(f.calls.length,0);
 let result;const g=fixture({transcribe:()=>new Promise(r=>result=r)}),other=createLocalAsr(g.load),controller=new AbortController();const late=other.transcribeWav(Buffer.from('synthetic-wave'),controller.signal);await new Promise(r=>setImmediate(r));controller.abort();result('late text');await assert.rejects(late);other.stop();
});
test('shutdown during load stops the late engine and refuses restart',async()=>{
 const f=fixture();let release;const asr=createLocalAsr(()=>new Promise(r=>release=()=>r(f.load())));const pending=asr.available();asr.stop();release();assert.equal(await pending,false);assert.deepEqual(f.calls,['stop']);assert.equal(await asr.available(),false);
});
test('empty or malformed native transcript cannot claim successful local recognition',async()=>{
 for(const text of ['',null,'x'.repeat(16001)]){const f=fixture({transcribe:async()=>text}),asr=createLocalAsr(f.load);await assert.rejects(asr.transcribeWav(Buffer.from('synthetic-wave')),/usable speech/);asr.stop();}
});
