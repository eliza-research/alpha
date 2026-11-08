import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('apps/app/src/runtime/abort-signal.ts','utf8');
const {anyAbortSignal}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
test('WebView113 without AbortSignal.any preserves first cancellation and removes every source listener',()=>{
 const original=Object.getOwnPropertyDescriptor(AbortSignal,'any');
 Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});
 try {
  const a=new AbortController(),b=new AbortController(),listeners=new Set();
  for(const controller of [a,b]){
   const signal=controller.signal,add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
   signal.addEventListener=(type,listener,options)=>{listeners.add(listener);return add(type,listener,options);};
   signal.removeEventListener=(type,listener,options)=>{listeners.delete(listener);return remove(type,listener,options);};
  }
  const combined=anyAbortSignal([a.signal,a.signal,b.signal]);assert.equal(listeners.size,2);assert.equal(combined.aborted,false);
  const reason=new DOMException('Owner changed','AbortError');b.abort(reason);
  assert.equal(combined.aborted,true);assert.equal(combined.reason,reason);assert.equal(listeners.size,0);
  a.abort('later');assert.equal(combined.reason,reason);
  const first=anyAbortSignal([a.signal,b.signal]);assert.equal(first.reason,'later');assert.equal(listeners.size,0);
  assert.equal(anyAbortSignal([]).aborted,false);
 } finally {Object.defineProperty(AbortSignal,'any',original);}
});
test('authenticated Maps relay still sends and retires its offer without the WebView any API',async()=>{
 const source=readFileSync('.eliza/client-features/plugins/plugin-maps/src/client/navigation-relay.ts','utf8');
 const {withMapsNavigationRelay}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
 const original=Object.getOwnPropertyDescriptor(AbortSignal,'any');
 Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});
 try{
  const owner={},connections=[],calls=[];let sends=0;
  const result=await withMapsNavigationRelay({anySignal:anyAbortSignal,current:()=>owner,execute:async()=>{throw Error('No navigation requested');},failure:()=> 'unavailable',connected:value=>connections.push(value)},async(_path,body,signal)=>{
   calls.push(body.phase);if(body.phase!=='poll')return {protocol:1,request:null};
   return new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  },'selected-conversation',new AbortController().signal,async()=>{sends++;return 'completed';});
  assert.equal(result,'completed');assert.equal(sends,1);assert.deepEqual(connections,[true,false]);assert.deepEqual(calls,['open','poll','retire']);
 }finally{Object.defineProperty(AbortSignal,'any',original);}
});
