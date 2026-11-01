import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import React from 'react';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const part=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return source.slice(start,end);};
const declarations=[
 part('function update(','// P-43: where the resident'),
 part('function retire(','/** Test mocks only (the mock-mode exit'),
 part('async function work(','// Keep startup-error provenance'),
 part('async function ensureResident(','/** P-43: a startup path'),
 part('async function inAppSignInMethods(','/** A failed or cancelled step'),
 part('export function productionCloudSignInRequired(','export function ConnectionChooser()').replaceAll('export ',''),
].join('\n');
const hooks=part('  const automaticSignInProbe =','  const visible=');
const methods=part('  async restoreSavedSignIn()','  async pair(')+part('  async beginSignIn(','  /** Leaves the sign-in screen');
const body=`function make(React, signInReadiness, options){
 const {useRef,useEffect,useSyncExternalStore}=React;
 let state={residentRecoveryReason:options.recoveryReason,open:true,purpose:'agent',cloudAccount:null,startupResolved:true,residentSavedCredential:false,residentPlanNotice:null,error:'',message:'',busy:false,signIn:{step:'choose',environment:'production'},session:{sessionId:'existing-owner-session'},kind:'resident',legacySignInRecovery:true};
 let epoch=0,operation=null,residentStartInBackground=false,residentStartFailure='',sending=null,active={kind:'resident'},signInReadinessOwner=null,inAppGoogle=false,inAppPhone=false,inAppEmail=true;
 const timeline=[],listeners=new Set(),actionReceipts=new Map(),conversationMemory=new Map(),appRequests=new Set();
 const RESIDENT_NAME='Local agent',RESIDENT_STARTING='Starting',SIGN_IN_READINESS_WAIT_MS=6000;
 const isAndroid=true,testMocksEnabled=false,residentAlwaysPresent=true,developmentPageSuspended=false;
 const residentCloudFlow=()=>true,residentEnvironment=()=> 'production',cloudEnvironmentAllowed=environment=>environment==='production';
 const cloudServiceName=()=> 'Service',cloud={environment:'production',cancelLogin(){}};
 const makeCloud=()=>cloud,errorMessage=error=>error?.status===401?'Expired':error?.message??'Unavailable',expired=()=>false,residentRecoveryReason=()=>null,residentRecoveryMessage=()=> 'Recovery required';
 const flushConversationEvents=()=>Promise.resolve(),retireConversationEvents=()=>{},retireReadReplies=()=>{},pauseHostedBackground=()=>Promise.resolve(),retireClockReviews=()=>Promise.resolve(),cancelStoppedReply=()=>{},runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},clearClientObservationSupport=()=>{};
 let nativeResolve,admissionResolve,nativeCalls=0,nativeCancels=0,admissions=0,probeCalls=0,copied=false,invocation;const admissionGate=new Promise(resolve=>{admissionResolve=resolve;});
 const native=new Promise(resolve=>{nativeResolve=resolve;}),probeResolves=[];
 const cloudSignIn={restoreSavedSignIn(){nativeCalls++;timeline.push('native-request');return native;},async cancel(){nativeCancels++;timeline.push('native-cancel');},async savedSignInRecoveryStatus(){return{eligible:!copied};},status(){probeCalls++;timeline.push('readiness-start');return new Promise(resolve=>probeResolves.push(resolve));}};
 class CloudSignInError extends Error{}
 async function connectResident(signal){admissions++;timeline.push('normal-admission-start');signal.throwIfAborted();if(options.deferAdmission)await admissionGate;signal.throwIfAborted();if(options.failAdmission)throw Error('Current account verification failed');if(options.unbound){active={kind:'resident'};update({residentInference:'unavailable',session:{sessionId:'unbound-session'}});timeline.push('normal-admission-unbound');return;}active={kind:'resident'};update({cloudAccount:{userId:'verified-owner'},residentInference:'cloud',session:{sessionId:'current-session'}});timeline.push('normal-admission-complete');}
 ${declarations}
 const connectionController={subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},getSnapshot:()=>state,${methods}cancel(){operation?.abort(new DOMException('Cancelled','AbortError'));cloud.cancelLogin();}};
 const snapshots=[];
 function Harness(){const snapshot=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);const productionSignInRequired=productionCloudSignInRequired(snapshot),signInEntryRequired=productionSignInRequired||explicitSignedOutCloudEntry(snapshot);${hooks}
 snapshots.push({busy:snapshot.busy,step:snapshot.signIn?.step??null,account:!!snapshot.cloudAccount});
 return React.createElement('button',{disabled:snapshot.busy,onClick:()=>{invocation=connectionController.restoreSavedSignIn();}},'Restore saved sign-in');}
 return {Harness,releaseAdmission(){admissionResolve();},resolveNative(restored=true){copied=restored;timeline.push('native-result');nativeResolve({restored});},cancel(){connectionController.cancel();},releaseProbes(){for(const resolve of probeResolves)resolve({inApp:true,google:true,email:true});},read:()=>({state,nativeCalls,nativeCancels,admissions,probeCalls,timeline:[...timeline],snapshots:[...snapshots],operationActive:!!operation,invocation}),controller:connectionController};
}`;
const compiled=transformSync(body,{loader:'ts',format:'cjs'}).code;
const make=new Function(compiled+';return make;')();
const readiness=(await import('../apps/app/src/runtime/cloud-sign-in.ts')).signInReadiness;
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<deadline,'finite React observation');await new Promise(resolve=>setTimeout(resolve,2));}}
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1/',pretendToBeVisual:true});
 for(const key of ['window','document','HTMLElement','Event','MouseEvent']){Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]});}
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')),f=make(React,readiness,options);root.render(React.createElement(f.Harness));await until(()=>dom.window.document.querySelector('button'));
 // Use the real scheduler, external store and effects. No act/flushSync/manual effect invocation.
 await new Promise(resolve=>setTimeout(resolve,10));
 return {...f,click(){dom.window.document.querySelector('button').click();},async close(){f.releaseProbes();await new Promise(resolve=>setTimeout(resolve,10));root.unmount();await new Promise(resolve=>setTimeout(resolve,30));dom.window.close();/* Each node:test file owns its worker; retain closed DOM globals for React scheduler cleanup. */}};
}
test('native restore reaches normal admission without the real automatic chooser stealing its operation',async t=>{
 const f=await fixture();try{
  f.click();await until(()=>f.read().nativeCalls===1);await new Promise(resolve=>setTimeout(()=>{f.resolveNative();resolve();},0));
  await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));
  const r=f.read();t.diagnostic(JSON.stringify({admissions:r.admissions,probes:r.probeCalls,timeline:r.timeline,snapshots:r.snapshots}));
  assert.equal(r.admissions,1,'one normal admission after a successful explicit native result');
  assert.equal(r.probeCalls,0,'readiness does not replace the owned recovery continuation');
 }finally{await f.close();}
});

test('cancelling before the native result propagates once and never starts admission from a stale success',async()=>{
 const f=await fixture();try{f.click();await until(()=>f.read().nativeCalls===1);f.cancel();f.resolveNative();await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));const r=f.read();assert.equal(r.nativeCancels,1);assert.equal(r.admissions,0);assert.equal(r.probeCalls,0);assert.equal(r.state.cloudAccount,null);assert.equal(r.state.busy,false);}finally{await f.close();}
});
test('cancelling normal admission after native commit neither replays nor clears the saved sign-in',async()=>{
 const f=await fixture({deferAdmission:true});try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative();await until(()=>f.read().admissions===1);f.cancel();f.releaseAdmission();await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));const r=f.read();assert.equal(r.nativeCalls,1);assert.equal(r.nativeCancels,0,'native commit stage listener has ended');assert.equal(r.state.cloudAccount,null);assert.equal(r.timeline.includes('normal-admission-complete'),false);assert.equal(r.state.residentSavedCredential,true,'committed saved sign-in is retained');}finally{await f.close();}
});
test('a refused native recovery never begins admission or pretends an account is verified',async()=>{
 const f=await fixture();try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative(false);await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));const r=f.read();assert.equal(r.admissions,0);assert.equal(r.nativeCalls,1);assert.equal(r.state.cloudAccount,null);assert.match(r.state.error,/no longer available/);assert.equal(r.state.signIn.step,'choose');}finally{await f.close();}
});
test('genuine normal-admission failure remains visible without a second native recovery',async()=>{
 const f=await fixture({failAdmission:true});try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative();await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));const r=f.read();assert.equal(r.admissions,1);assert.equal(r.nativeCalls,1);assert.equal(r.state.cloudAccount,null);assert.match(r.state.error,/Current account verification failed/);assert.equal(r.timeline.includes('normal-admission-complete'),false);}finally{await f.close();}
});
test('existing agent record-recovery refusal is not bypassed by a restored credential',async()=>{
 const f=await fixture({recoveryReason:'review-required'});try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative();await f.read().invocation;assert.equal(f.read().admissions,0);assert.match(f.read().state.error,/Recovery required/);assert.equal(f.read().state.residentSavedCredential,true);}finally{await f.close();}
});
test('manual chooser readiness cannot take over during the owned post-commit admission',async()=>{
 const f=await fixture({deferAdmission:true});try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative();await until(()=>f.read().admissions===1);await f.controller.beginSignIn('production',true);assert.equal(f.read().probeCalls,0);f.releaseAdmission();await f.read().invocation;assert.equal(f.read().admissions,1);assert.equal(f.read().state.busy,false);assert.ok(f.read().state.cloudAccount);}finally{await f.close();}
});
test('normal unbound admission cannot be promoted into a verified account by the recovery continuation',async()=>{
 const f=await fixture({unbound:true});try{f.click();await until(()=>f.read().nativeCalls===1);f.resolveNative();await f.read().invocation;await new Promise(resolve=>setTimeout(resolve,20));const r=f.read();assert.equal(r.admissions,1);assert.equal(r.nativeCalls,1);assert.equal(r.state.cloudAccount,null);assert.equal(r.state.residentInference,'unavailable');assert.equal(r.timeline.includes('normal-admission-complete'),false);}finally{await f.close();}
});
