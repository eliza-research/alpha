import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync('.eliza/client-features/packages/ui/src/voice/voice-session-client-core.ts','utf8');
const start=source.indexOf('  function sendUplinkAudio('),end=source.indexOf('  function handleServerFrame(',start);
assert(start>0&&end>start);
const body=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
function fixture(getUiContext,throwOnError=false){
 const calls=[],errors=[];let stops=0;
 const context=vm.createContext({Uint8Array,ArrayBuffer,JSON,Error,console,ws:{send:value=>calls.push(value)},connPhase:'open',uiContextSupported:true,options:{getUiContext},parseVoiceUiContext:value=>value,encodeClientControl:JSON.stringify,lastUiContext:undefined,microphoneMuted:false,state:{phase:'listening',traceId:'turn'},mark(){},emitError:error=>{errors.push(error.message);if(throwOnError)throw Error("UI failed");},stop:async()=>{stops++}});
 vm.runInContext(body+';globalThis.send=sendUplinkAudio;',context);
 return {send:()=>context.send(new Uint8Array([1,2])),calls,errors,get stops(){return stops}};
}
test('retired renderer context stops capture without sending PCM or exposing private error details',()=>{
 const h=fixture(()=>{throw Error('private context detail')});h.send();assert.equal(h.calls.length,0);assert.deepEqual(h.errors,['Voice context changed. Start voice again.']);assert.equal(h.stops,1);
});
test('current renderer context and PCM still reach the socket',()=>{
 const h=fixture(()=>({uiViewPath:'/notes'}));h.send();assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[0]).t,'ui_context');assert.equal(h.calls[1].byteLength,2);assert.equal(h.stops,0);
});
test('an absent context clears the old context without suppressing normal audio',()=>{
 const h=fixture(()=>undefined);h.send();assert.deepEqual(JSON.parse(h.calls[0]).context,{});assert.equal(h.calls[1].byteLength,2);assert.equal(h.errors.length,0);
});

test('a failing UI error callback still retires capture after context loss',()=>{
 const h=fixture(()=>{throw Error("retired")},true);assert.throws(()=>h.send(),/UI failed/);assert.equal(h.calls.length,0);assert.equal(h.stops,1);
});
