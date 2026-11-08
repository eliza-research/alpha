import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const methods=between('async function inAppSignInMethods(','/** A failed or cancelled step');
const begin=between('  async beginSignIn(','  /** Leaves the sign-in screen');
// cloud-sign-in.ts imports the shared native sign-in contract; Node loads the TypeScript directly.
const contract=await import('../apps/app/src/runtime/cloud-sign-in.ts');
const factory=transformSync(`(()=>{
 let epoch=0,operation=null,signInReadinessOwner=null,googleSignInGeneration=0,inAppGoogle=false,inAppPhone=false,inAppEmail=true;
 let state={purpose:'agent',open:true,signIn:null,cloudAccount:null};let timeout,resolve,reject,count=0,signal,probeController;
 const cloudSignIn={status(){count++;return new Promise((yes,no)=>{resolve=yes;reject=no;});}};
 const SIGN_IN_READINESS_WAIT_MS=6000,setTimeout=fn=>(timeout=fn,1),clearTimeout=()=>{};
 const cloudServiceName=()=> 'Cloud',cloudEnvironmentAllowed=()=>true,residentCloudFlow=()=>true,residentEnvironment=()=>'production';
 let cloud={environment:'production',cancelLogin(){}};const makeCloud=environment=>({environment,cancelLogin(){}});
 const update=patch=>{state={...state,...patch};};
 const work=async(_,action)=>{const controller=new AbortController();probeController=controller;signal=controller.signal;signInReadinessOwner=null;operation=controller;try{await action(signal);}finally{operation=null;}};
 const ensureResident=async()=>{};class CloudSignInError extends Error{}
 ${methods}
 const controller={${begin}};
 return {controller,timeout(){timeout();},resolve(value){resolve(value);},reject(){reject(Error('offline'));},read(){return {google:inAppGoogle,email:inAppEmail,phone:inAppPhone,count,chooser:state.signIn};},change(kind){if(kind==='abort')probeController.abort();if(kind==='epoch')epoch++;if(kind==='closed')state={...state,open:false};if(kind==='account')state={...state,cloudAccount:{}};if(kind==='environment')cloud=makeCloud('staging');if(kind==='chooser')state={...state,signIn:{step:'choose',environment:'production'}};if(kind==='step')state={...state,signIn:{step:'email',environment:'production'}};if(kind==='new-operation')signInReadinessOwner=null;}}
})`,{loader:'ts',format:'cjs'}).code.trim().replace(/;$/,'');
const make=new Function('signInReadiness','return ('+factory+')()');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function waiting(){const h=make(contract.signInReadiness);const start=h.controller.beginSignIn();h.timeout();await start;assert.equal(h.read().google,false);assert.equal(h.read().email,true);assert.equal(h.read().count,1);return h;}
test('same chooser adopts one late positive result after the unchanged email fallback deadline',async()=>{
 const h=await waiting();h.resolve({inApp:true,google:true,email:true,phone:false});await settle();assert.equal(h.read().google,true);assert.equal(h.read().email,true);assert.equal(h.read().count,1);
});
for(const kind of ['abort','epoch','closed','account','environment','chooser','step','new-operation'])test(`late positive is retired after ${kind}`,async()=>{
 const h=await waiting();h.change(kind);h.resolve({inApp:true,google:true,email:true});await settle();assert.equal(h.read().google,false);assert.equal(h.read().count,1);
});
test('real negative, malformed and rejected late results do not invent Google support',async()=>{
 for(const value of [{inApp:true,google:false,email:true},{google:true,email:true},null]){const h=await waiting();h.resolve(value);await settle();assert.equal(h.read().google,false);assert.equal(h.read().email,true);assert.equal(h.read().count,1);}
 const h=await waiting();h.reject();await settle();assert.equal(h.read().google,false);assert.equal(h.read().email,true);
});
test('a result in the timeout/chooser-publication microtask gap is retained for the same chooser',async()=>{
 const h=make(contract.signInReadiness),start=h.controller.beginSignIn();h.timeout();h.resolve({inApp:true,google:true,email:true});await start;await settle();assert.equal(h.read().google,true);assert.equal(h.read().count,1);
});
test('immediate native readiness keeps the existing path and does not issue another probe',async()=>{
 const h=make(contract.signInReadiness),start=h.controller.beginSignIn();h.resolve({inApp:true,google:true,email:true});await start;assert.equal(h.read().google,true);assert.equal(h.read().count,1);
});
test('new ordinary operations revoke late-readiness ownership at the actual work boundary',()=>{
 const assignments=[...source.matchAll(/(?<![.\w])operation\s*=\s*controller\s*;/g)];
 assert.equal(assignments.length,4,'all ordinary, plan-refresh, edit and device-request operation boundaries');
 for(const assignment of assignments)assert.match(source.slice(Math.max(0,assignment.index-45),assignment.index),/signInReadinessOwner\s*=\s*null;\s*$/);
 assert.match(source,/const SIGN_IN_READINESS_WAIT_MS = 6000;/);
});
