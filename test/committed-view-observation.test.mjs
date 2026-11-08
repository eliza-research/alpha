import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID,webcrypto} from 'node:crypto';
import vm from 'node:vm';

const sdk='vendor/eliza/';
const transform=path=>stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
const sources=[
 sdk+'packages/core/src/events.ts',
 sdk+'packages/core/src/views/view-interact-protocol.ts',
 sdk+'packages/core/src/views/view-action-handoff.ts',
 sdk+'packages/core/src/views/completed-action-navigation.ts',
 sdk+'packages/agent/src/api/view-installations.ts',
 sdk+'packages/agent/src/api/pending-request-map.ts',
 sdk+'packages/agent/src/api/view-interaction-host.ts',
 'apps/app/src/runtime/view-navigation.ts',
].map(transform).join('\n');
// Real observer, installation registry, host and pending map. Asset transport and
// runtime role/error adapters are inert here; no renderer/network/model is run.
function fixture(mode,observedContext={view:"calendar",sensitive:false}){
 let serial=0;const timers=new Map();
 const c=vm.createContext({randomUUID,crypto:webcrypto,AbortController,structuredClone,console,
  document:{hidden:false},window:new EventTarget(),
  setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(`class ElizaError extends Error {constructor(message,detail){super(message);Object.assign(this,detail);}}
 class AlphaClientError extends Error{};
 const satisfiesRoleGate=(roles,gate)=>!gate||roles.includes(gate.minRole);
 const bindViewAssets=()=>{},getViewAssetRoot=()=>undefined,onNativeViewDisconnect=()=>()=>{};
 const ENABLED_MVP_VIEWS=new Set(['calendar','settings']);
 ${sources}
 globalThis.api={ViewNavigationClient,ViewInteractionHost,beginViewInstallation,commitViewInstallation,revokeViewInstallation};`,c);
 const runtime={},host=new c.api.ViewInteractionHost(runtime);
 const installation=c.api.beginViewInstallation(runtime,'observer-test');
 const entries=c.api.commitViewInstallation(runtime,installation,['calendar','settings'].map(id=>({id,viewType:'gui',pluginName:'observer-test',path:'/'+id,roleGate:{minRole:'OWNER'}})));
 let context=observedContext,session=true,prepared,settled,history=0;
 const calls=[];
 const client=new c.api.ViewNavigationClient(async(path,body,signal)=>{
  calls.push({path,body,signal});
  if(path.endsWith('/navigate')){
   const entry=entries.find(entry=>path===`/api/views/${entry.id}/navigate`);
   prepared={requestId:body.completedActionHandoffId,clientId:body.clientId,viewId:entry.id,viewType:'gui',installationId:entry.installationId};
   settled=host.waitFor(prepared.requestId,body.clientId,entry,120000,{ownerId:'owner',navigation:true});
   // Execute the actual prepared-navigation route's settlement callback. Its
   // history writer is a spy; negative results must never reach that writer.
   const route=readFileSync(sdk+'packages/agent/src/api/views-routes.ts','utf8');
   const callback=route.slice(route.indexOf('        .then((result) => {',route.indexOf('const preparedBase = currentViewState;'))+14,route.indexOf('\n        .catch',route.indexOf('const preparedBase = currentViewState;')));
   const then=callback.slice(0,-1);
   const onResult=new Function('assertRuntimeViewEntry','viewRuntime','entry','getCurrentViewState','scope','preparedBase','commitCurrentViewState','ownerId','handoffId','requestedAlias',`return ${then};`)(()=>{},runtime,entry,()=>null,{},null,()=>history++,'owner',prepared.requestId,undefined);
   settled.then(onResult,()=>{});
   if(['before','cleanup-denied','cleanup-retired','negative-lost','installation-retired','bad-nonce'].includes(mode))context={view:'settings',sensitive:false};
   if(mode==='deadline')for(const [id,timer] of [...timers])if(timer.ms===5000){timers.delete(id);timer.fn();}
   if(mode==='disposed')client.dispose();
   if(mode==='retired')session=false;
   if(mode==='lost-prepare')throw Error('prepare response lost');
   if(mode==='empty-request')return {navigationBinding:{...prepared,requestId:''}};
   if(mode==='foreign-client')return {navigationBinding:{...prepared,clientId:'other-client'}};
   if(mode==='invalid-binding')return {navigationBinding:{...prepared,installationId:''}};
   return {navigationBinding:prepared};
  }
  if(path.endsWith('interact-claim')){
   const claimId=host.claim(body.clientId,body,['OWNER'],mode==='cleanup-denied'?'other-owner':'owner');
   if(mode==='cleanup-retired')session=false;
   if(mode==='installation-retired')c.api.revokeViewInstallation(runtime,installation);
   if(mode==='after')context={view:'settings',sensitive:false};
   if(mode==='claim-lost')throw Error('claim response lost');
   if(mode==='retired-after-claim')session=false;
   return {claimId:mode==='bad-nonce'?'wrong-claim':claimId};
  }
  assert.ok(path.endsWith('interact-result'));
  const accepted=host.resolve(body.clientId,body,'owner');
  if(mode==='negative-lost')throw Error('negative reply lost');
  if(mode==='positive-lost')throw Error('positive reply lost');
  return {accepted};
 },()=>session,()=>context);
 return {client,calls,timers,host,get settled(){return settled;},get history(){return history;},
  expire(){for(const [id,timer] of [...timers])if(timer.ms===120000){timers.delete(id);timer.fn();}},
  close(){host.close();client.dispose();}};
}
for(const mode of ['before','after','deadline','disposed'])test(`abandoned observation ${mode} settles actual host negative without history or later timeout`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),false);
  assert.equal([...f.timers.values()].filter(t=>t.ms===120000).length,0);
  const result=await f.settled;assert.equal(result.success,false);assert.equal(result.result.switched,false);
  assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-claim')).length,1);
  assert.equal(f.calls.filter(c=>c.path.endsWith('interact-result')).length,1);
  assert.notEqual(f.calls.at(-1).signal,f.calls[0].signal);
  assert.equal([...f.timers.values()].some(t=>t.ms===1500),false);
  assert.equal([...f.timers.values()].filter(t=>t.ms===120000).length,0);f.expire();
 }finally{f.close();}
});
for(const mode of ['unchanged'])test(`${mode} preserves underlying Calendar and records exactly one positive`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),true);await f.settled;await Promise.resolve();
  assert.equal(f.history,1);assert.equal(f.calls[0].path,'/api/views/calendar/navigate');
  assert.equal(await f.client.observeCommittedView(),true);assert.equal(f.calls.length,3);
 }finally{f.close();}
});
for(const mode of ['retired','retired-after-claim','lost-prepare','invalid-binding','empty-request','foreign-client','claim-lost','cleanup-denied','cleanup-retired'])test(`${mode} remains unknown; no cleanup under changed/unknown custody, genuine host timeout retained`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),false);assert.equal(f.calls.some(c=>c.path.endsWith('interact-result')),false);
  const rejected=assert.rejects(f.settled,error=>error.code==='PENDING_REQUEST_TIMEOUT');f.expire();await rejected;
  assert.equal(f.history,0);assert.ok(f.calls.filter(c=>c.path.endsWith('interact-claim')).length<=1);
 }finally{f.close();}
});
for(const mode of ['installation-retired','bad-nonce'])test(`${mode} rejects negative settlement and retains genuine timeout`,async()=>{
 const f=fixture(mode);try{assert.equal(await f.client.observeCommittedView(),false);const replies=f.calls.filter(c=>c.path.endsWith('interact-result'));assert.equal(replies.length,1);assert.equal(replies[0].body.success,false);const rejected=assert.rejects(f.settled,error=>error.code==='PENDING_REQUEST_TIMEOUT');f.expire();await rejected;assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-claim')).length,1);}finally{f.close();}
});
test('lost positive acknowledgment never sends a contradictory negative or retry',async()=>{
 const f=fixture('positive-lost');try{assert.equal(await f.client.observeCommittedView(),false);assert.equal((await f.settled).success,true);assert.equal(f.calls.length,3);assert.equal(f.history,1);}finally{f.close();}
});

test('lost negative acknowledgment is settled once and never replayed',async()=>{
 const f=fixture('negative-lost');try{assert.equal(await f.client.observeCommittedView(),false);assert.equal(f.calls.length,3);assert.equal((await f.settled).success,false);assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-result')).length,1);}finally{f.close();}
});

for(const view of ['calendar','settings'])for(const chat of ['sheet','full'])test(`actual adapter ${chat} overlay retains underlying ${view}`,async()=>{
 const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 const start=adapter.indexOf('  function context(shell: Shell) {');
 const helper=stripTypeScriptTypes(adapter.slice(start,adapter.indexOf('  p.componentDidMount',start)),{mode:'transform'});
 let observed;
 const alphaClient={setViewContext(value){observed=value;},getState(){return {context:observed};}};
 new Function('document','alphaClient','connectionController','currentClockTimeZone','passwordSurfaceOpen','updateBackAvailability','recoverPendingActions','shell',helper+';context(shell);')(
  {hidden:false,documentElement:{dataset:{}}},alphaClient,{getSnapshot:()=>({open:false})},()=> 'UTC',()=>false,()=>{},()=>{},
  {S:()=>({view,chat}),vget:()=>({}),calendarSelection:()=>undefined,clockSelection:()=>undefined});
 assert.equal(observed.view,view);assert.equal(observed.sensitive,false);
 const f=fixture('unchanged',observed);try{assert.equal(await f.client.observeCommittedView(),true);await f.settled;assert.equal(f.calls[0].path,`/api/views/${view}/navigate`);assert.equal(f.history,1);}finally{f.close();}
});
