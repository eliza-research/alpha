import test from 'node:test';
import assert from 'node:assert/strict';
import {runProviderConfiguration} from '../apps/app/src/runtime/abort-signal.ts';

test('native renderer propagates cancel before paused validation can commit',async()=>{
 let release,request,revoked=false,save=0,retire=0;
 const validation=new Promise(resolve=>release=resolve),controller=new AbortController();
 const pending=runProviderConfiguration(controller.signal,{
  async prepare(){return {requestId:"native-issued-request"};},
  async configure(id){request=id;await validation;if(revoked)throw Error('Credential request cancelled');save++;retire++;return {};},
  async cancel(id){assert.equal(id,request);revoked=true;},
 });
 await new Promise(resolve=>setImmediate(resolve));controller.abort(new DOMException('Back','AbortError'));await assert.rejects(pending,{name:'AbortError'});release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(save,0);assert.equal(retire,0);
});
test('native renderer allows positive commit and refuses already cancelled setup before dispatch',async()=>{
 let save=0;
 const ports={async prepare(){return {requestId:"native-issued-positive"};},async configure(){save++;return {configured:true};},async cancel(){throw Error('unexpected cancellation');}};
 assert.deepEqual(await runProviderConfiguration(new AbortController().signal,ports),{configured:true});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(runProviderConfiguration(cancelled.signal,ports),{name:'AbortError'});assert.equal(save,1);
});

test('cancelling before native reservation returns never dispatches keys or clear',async()=>{
 let reserved,cancelled=0,dispatched=0;const held=new Promise(resolve=>reserved=resolve);const controller=new AbortController();
 const pending=runProviderConfiguration(controller.signal,{prepare:()=>held,async configure(){dispatched++;},async cancel(id){assert.equal(id,'late-native-lease');cancelled++;}});
 controller.abort();reserved({requestId:'late-native-lease'});await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(dispatched,0);
});

test('failed native dispatch releases its reserved lease',async()=>{
 let released=0;const problem=Error('invalid synthetic input');
 await assert.rejects(runProviderConfiguration(new AbortController().signal,{async prepare(){return {requestId:'rejected-native-lease'};},async configure(){throw problem;},async cancel(id){assert.equal(id,'rejected-native-lease');released++;}}),error=>error===problem);
 assert.equal(released,1);
});
