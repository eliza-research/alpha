import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync('.eliza/client-features/packages/ui/src/voice/voice-session-client-core.ts','utf8');
const start=source.indexOf('  function handleServerFrame('),end=source.indexOf('  async function startCapture(',start);
assert(start>0&&end>start);
const terminal=source.match(/const NON_RECOVERABLE_SERVER_ERROR_CODES[\s\S]*?\n\]\);/)?.[0];
assert(terminal);
const js=stripTypeScriptTypes(terminal+'\n'+source.slice(start,end),{mode:'transform'});
function fixture(){
 const errors=[];let stops=0,recoveries=0;const socket={};
 const context=vm.createContext({ArrayBuffer,Uint8Array,Set,Error,ws:socket,state:{phase:'listening',traceId:'turn'},options:{},parseServerControl:JSON.parse,isLifecycleCurrent:()=>true,applyServerEvent:state=>state,setState(){},mark(){},emitError:error=>errors.push(error.message),stop:async()=>{stops++},requestRecovery:()=>{recoveries++}});
 vm.runInContext(js+';globalThis.handle=handleServerFrame;',context);
 return {errors,get stops(){return stops},get recoveries(){return recoveries},send:code=>context.handle(JSON.stringify({t:'error',code,retryable:false,traceId:'turn'}),1,socket)};
}
test('insufficient credits stop voice with useful copy and never request a replacement session',()=>{const h=fixture();h.send('insufficient_credits');assert.equal(h.stops,1);assert.equal(h.recoveries,0);assert.deepEqual(h.errors,['Voice needs more Eliza Cloud credits. Add credits, then try again.']);});
test('quota and revoke retain their terminal behavior',()=>{for(const code of ['quota_exhausted','revoked']){const h=fixture();h.send(code);assert.equal(h.stops,1);assert.equal(h.recoveries,0);}});
test('other fatal server errors retain the existing recovery path',()=>{const h=fixture();h.send('temporary_provider_error');assert.equal(h.stops,0);assert.equal(h.recoveries,1);});
