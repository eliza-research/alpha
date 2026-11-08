import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('provider cancellation is forwarded to each backend and checked before renderer state or retirement',()=>{
 const local=readFileSync(new URL('../apps/app/src/runtime/local-agent.ts',import.meta.url),'utf8');
 const host=readFileSync(new URL('../scripts/browser-cloud-dev-bridge.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 assert.match(local,/browserResidentCall\('residentOwn',[^;]+,signal\)/);
 assert.match(local,/prepare:\(\)=>native\.prepareProviderConfiguration/);
 assert.match(local,/cancel:requestId=>native\.cancelProviderConfiguration/);
 assert.match(host,/selectOwn\(\{apiKey:data\.apiKey,[^;]+controller\.signal\)/);
 assert.match(ui,/await configureLocalProvider\(apiKey,model,cartesiaKey,signal\);signal\.throwIfAborted\(\);const providerStatus=await localProviderStatus\(\);signal\.throwIfAborted\(\);update/);
});

test('cancelling before native reservation returns never dispatches keys or clear',async()=>{
 let reserved,cancelled=0,dispatched=0;const held=new Promise(resolve=>reserved=resolve);const controller=new AbortController();
 const pending=runProviderConfiguration(controller.signal,{prepare:()=>held,async configure(){dispatched++;},async cancel(id){assert.equal(id,'late-native-lease');cancelled++;}});
 controller.abort();reserved({requestId:'late-native-lease'});await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(dispatched,0);
});
test('Cloud selection uses the same cancellation boundary on both backends',()=>{
 const local=readFileSync(new URL('../apps/app/src/runtime/local-agent.ts',import.meta.url),'utf8');
 const host=readFileSync(new URL('../scripts/browser-cloud-dev-bridge.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 assert.match(ui,/browserResidentCall\('residentCloud',undefined,undefined,undefined,signal\)/);assert.match(ui,/clearLocalProvider\(false,signal\)/);
 const clear=local.slice(local.indexOf('export async function clearLocalProvider('),local.indexOf('/** True only when native'));
 assert.match(clear,/runProviderConfiguration\(signal/);assert.match(host,/selectCloud\(controller\.signal\)/);
});

test('failed native dispatch releases its reserved lease',async()=>{
 let released=0;const problem=Error('invalid synthetic input');
 await assert.rejects(runProviderConfiguration(new AbortController().signal,{async prepare(){return {requestId:'rejected-native-lease'};},async configure(){throw problem;},async cancel(id){assert.equal(id,'rejected-native-lease');released++;}}),error=>error===problem);
 assert.equal(released,1);
});
