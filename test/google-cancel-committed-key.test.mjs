import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// spec-cloud-sign-in-F01: Android has no Google commit boundary, so a cancel can land after the
// native tail stored the new key. The cancel used to show the method screen over a stored sign-in.
// It now re-reads the key once the attempt unwinds and adopts a key other than the one held before.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to);};
const code=stripTypeScriptTypes(`globalThis.controller={${between('  async cancelSignIn() {','  /** Google\'s external browser flow')}};`,{mode:'strip'});

function harness({stored,prior='old-key',environment='production',active=true}){
  const view={step:'google',environment},operation=new AbortController(),events=[];
  const box={state:{signIn:view,open:true,message:'In browser',error:''},operation,signInReadinessOwner:null,active:active?{}:null,
    googleSignInGeneration:3,googleSignInPrior:{generation:3,environment,credentialId:prior},setTimeout,
    signInClient:()=>({googleCancellationSupported:false}),signInEntryPage:()=>false,explicitSignedOutCloudEntry:()=>false,
    residentCloudFlow:()=>true,residentEnvironment:()=>'production',
    cloudCredentialStore:{read:async()=>stored},update:patch=>Object.assign(box.state,patch),
    queueResidentRebind:()=>events.push('rebind'),ensureResident:async()=>{events.push('ensure');},
    connectionController:{cancel:()=>{events.push('cancel');box.operation=null;},close:()=>events.push('close')}};
  vm.createContext(box);vm.runInContext(code,box);
  return {box,events};
}

test('a key stored before the cancel landed is adopted, not hidden behind the method screen',async()=>{
  const {box,events}=harness({stored:{credentialId:'new-key'}});
  await box.controller.cancelSignIn();
  assert.deepEqual({signIn:box.state.signIn,message:box.state.message,saved:box.state.residentSavedCredential},{signIn:null,message:'Signed in',saved:true});
  assert.deepEqual(events,['cancel','rebind']);
  const stopped=harness({stored:{credentialId:'new-key'},active:false});
  await stopped.box.controller.cancelSignIn();
  assert.deepEqual(stopped.events,['cancel','ensure']);
});

test('the key held before the attempt, or none, leaves the cancel as it was',async()=>{
  for(const stored of [{credentialId:'old-key'},null]){
    const {box,events}=harness({stored});
    await box.controller.cancelSignIn();
    assert.equal(box.state.signIn.step,'choose');assert.equal(box.state.message,'');
    assert.deepEqual(events,['cancel']);
  }
});

test('a key for another environment than the resident one is never adopted here',async()=>{
  const {box,events}=harness({stored:{credentialId:'new-key'},environment:'staging'});
  await box.controller.cancelSignIn();
  assert.equal(box.state.signIn.step,'choose');assert.deepEqual(events,['cancel']);
});
