import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// The native status/probe cache and single flight are tested with the shared client (vendor/eliza
// packages/auth/android). These check the renderer's explicit Retry and automatic readiness wiring.
test('interactive sign-in refreshes partial readiness while automatic startup can use the cache',async()=>{
 const {transformSync}=await import('esbuild');const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');const text=(a,b)=>{const from=ui.indexOf(a),to=ui.indexOf(b,from+a.length);assert.ok(from>=0&&to>from);return ui.slice(from,to);};const methods=text('async function inAppSignInMethods(','/** A failed or cancelled step');const begin=text('  async beginSignIn(','  /** Leaves the sign-in screen');const module=await import('../apps/app/src/runtime/cloud-sign-in.ts');
 const body=`const cloudServiceName=()=> 'Eliza Cloud';let inAppPhone=false,inAppEmail=true;let operation=null,inAppGoogle=false,epoch=0,signInReadinessOwner=null,googleSignInGeneration=0;const inputs=[],updates=[];const cloudSignIn={status:async input=>{inputs.push(input);return {inApp:true,email:true,google:false};}};const SIGN_IN_READINESS_WAIT_MS=6000,cloudEnvironmentAllowed=()=>true,residentCloudFlow=()=>true,residentEnvironment=()=>'production';let cloud={environment:'production',cancelLogin(){}};const state={purpose:'agent'},update=x=>updates.push(x),work=async(_,action)=>action(new AbortController().signal),ensureResident=async()=>{};${methods};const controller={${begin}};return {controller,inputs,updates};`;
 const compiled=transformSync('function make(){'+body+'}',{loader:'ts',format:'esm'}).code;const make=new Function('signInReadiness',compiled+';return make();');const ordinary=make(module.signInReadiness);await ordinary.controller.beginSignIn('production');assert.deepEqual(ordinary.inputs,[{environment:'production',refreshNegative:true}]);const automatic=make(module.signInReadiness);await automatic.controller.beginSignIn('production',false,true);assert.deepEqual(automatic.inputs,[{environment:'production'}]);const retry=make(module.signInReadiness);await retry.controller.beginSignIn('production',true);assert.deepEqual(retry.inputs,[{environment:'production',refreshNegative:true}]);assert.equal(retry.updates.at(-1).signIn.step,'choose');assert.ok(ui.includes('beginSignIn(residentEnvironment(),true)}>Retry sign-in'));assert.equal((ui.match(/beginSignIn\(residentEnvironment\(\),true\)/g)||[]).length,1,'required-entry Retry remains available');
});

test('automatic readiness retains existing and newer errors without restarting the agent',async()=>{
 const {transformSync}=await import('esbuild');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const part=(a,b)=>{const from=ui.indexOf(a),to=ui.indexOf(b,from+a.length);assert.ok(from>=0&&to>from);return ui.slice(from,to);};
 const work=part('async function work(','/** Start (or restart) the resident.');
 const begin=part('  async beginSignIn(','  /** Leaves the sign-in screen');
 const compiled=transformSync(`function make(){
  let operation=null,residentStartInBackground=false,epoch=0,signInReadinessOwner=null,googleSignInGeneration=0,inAppGoogle=false,inAppPhone=false,inAppEmail=true,release,starts=0;
  const state={purpose:'agent',error:'Saved sign-in expired'},update=value=>Object.assign(state,value);
  const cloud={environment:'production',cancelLogin(){}},cloudSignIn={},cloudServiceName=()=> 'Eliza Cloud';
  const cloudEnvironmentAllowed=()=>true,residentCloudFlow=()=>true,residentEnvironment=()=> 'production';
  const inAppSignInMethods=()=>new Promise(resolve=>{release=()=>resolve({google:false,email:true});});
  const runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},ensureResident=async()=>{starts++;};
  ${work}
  const controller={${begin}};
  return {controller,state,release:()=>release(),starts:()=>starts};
 }`,{loader:'ts',format:'esm'}).code;
 const fixture=new Function(compiled+';return make();')();
 const automatic=fixture.controller.beginSignIn('production',false,true);
 assert.equal(fixture.state.error,'Saved sign-in expired','the existing error remains visible while readiness is pending');
 fixture.state.error='A newer native failure';fixture.release();await automatic;
 assert.equal(fixture.state.error,'A newer native failure','completion cannot overwrite a newer asynchronous error');
 assert.equal(fixture.starts(),0,'readiness alone cannot retry a blocked startup');
 const explicit=fixture.controller.beginSignIn('production');
 assert.equal(fixture.state.error,'','an explicit new attempt clears the previous error');
 fixture.release();await explicit;assert.equal(fixture.starts(),1);
});
