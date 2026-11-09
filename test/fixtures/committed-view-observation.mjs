import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';
import {randomUUID,webcrypto} from 'node:crypto';
import vm from 'node:vm';

const sdk='vendor/eliza/';
const transform=path=>stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'strip'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
export const committedViewSources=[
 sdk+'packages/core/src/events.ts',
 sdk+'packages/core/src/views/view-interact-protocol.ts',
 sdk+'packages/core/src/views/view-action-handoff.ts',
 sdk+'packages/core/src/views/completed-action-navigation.ts',
 sdk+'packages/agent/src/api/view-installations.ts',
 sdk+'packages/agent/src/api/pending-request-map.ts',
 sdk+'packages/agent/src/api/view-interaction-host.ts',
 'apps/app/src/runtime/view-navigation.ts',
  sdk+'packages/agent/src/api/views-routes.ts',
];
// Real observer, installation registry, host and pending map. Asset transport and
// runtime role/error adapters are inert here; no renderer/network/model is run.
export function committedViewFixture(mode,observedContext={view:"calendar",sensitive:false}){
 const sources=committedViewSources.slice(0,-1).map(transform).join('\n');
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
 let context=observedContext,session=true,prepared,settled,history=0,outcome="none";
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
   outcome='pending';
   settled.then(result=>{outcome=result.success?'positive':'negative';onResult(result);},()=>{outcome='timeout';});
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
   // The page hides while the claim is in flight; an aborted fetch the host already
   // processed rejects here even though the claim is recorded.
   if(mode==='superseded-claim'&&context.view==='calendar'){c.document.hidden=true;client.observeCommittedView();context={view:'settings',sensitive:false};if(signal.aborted)throw Error('claim aborted');}
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
 return {client,calls,timers,host,context:c,get settled(){return settled;},get history(){return history;},
  get observedView(){return context.view;},get session(){return session;},get outcome(){return outcome;},
  setMode(value){mode=value;},setView(view){context={view,sensitive:false};},
  expire(){for(const [id,timer] of [...timers])if(timer.ms===120000){timers.delete(id);timer.fn();}},
  close(){host.close();client.dispose();}};
}
