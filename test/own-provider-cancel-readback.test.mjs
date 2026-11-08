import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const start=source.indexOf('  async configureLocal('),end=source.indexOf('  /** Stops the running agent',start);
assert.ok(start>=0&&end>start);
const methods=stripTypeScriptTypes('({'+source.slice(start,end)+'})',{mode:'transform'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const reading=deferred(),release=deferred();
 const old={configured:true,provider:'cerebras',selected:true,revision:'old-key',keys:{text:{configured:true},voice:{configured:true}}};
 const cloud={configured:false,provider:'elizacloud',selected:false,revision:'cloud',keys:{text:{configured:true},voice:{configured:true}}};
 const box=new Function('methods','old','cloud','reading','release',`
  let operation=null,sending=null,providerStatusGeneration=0,signInReadinessOwner=null;const state={providerStatus:old,message:'',cloudAccount:{}};
  const update=patch=>Object.assign(state,patch),LOCAL_PROVIDER_MODEL='model',OWN_KEYS_NOT_SET_UP='Unavailable',isAndroid=false,browserCloudResidentEnabled=false;
  const work=async(_label,run)=>{operation=new AbortController();try{await run(operation.signal);}catch(error){if(!operation.signal.aborted)throw error;}finally{operation=null;}};
  const configureLocalProvider=async(_key,_model,_voice,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  let reads=0;const localProviderStatus=async()=>{reads++;if(reads===1){reading.resolve();return release.promise;}return cloud;};
  const selectLocalProvider=async()=>cloud,clearLocalProvider=async()=>cloud,retire=async()=>{},connectResident=async()=>{},restartAfterProviderChange=async()=>{},connectionToast=()=>{},OWN_KEY_BUSY='Busy',OWN_KEY_CHECKING='Checking key…',showPostSignInSetup=()=>{},ownProviderSelected=()=>state.providerStatus?.selected===true;
  const api=eval(methods);return {api,state,cancel:()=>operation.abort(new DOMException('Cancelled','AbortError')),get busy(){return !!operation;}};
 `)(methods,old,cloud,reading,release);
 return {...box,reading,release,old,cloud};
}
test('cancelling a new check with an old selected key never claims the new key was saved',async()=>{
 const f=fixture(),pending=f.api.configureLocal('synthetic-new-key');f.cancel();await f.reading.promise;f.release.resolve(f.old);await pending;
 assert.equal(f.state.providerStatus.revision,'old-key');assert.doesNotMatch(f.state.message,/was saved|verified|before Cancel/);assert.match(f.state.message,/Own API keys are selected/);
});
test('late cancelled-check status cannot replace a newer Cloud selection or its message',async()=>{
 const f=fixture(),pending=f.api.configureLocal('synthetic-new-key');f.cancel();await f.reading.promise;
 await f.api.selectCloudProvider();f.state.message='New Cloud selection';f.release.resolve(f.old);await pending;
 assert.equal(f.state.providerStatus.provider,'elizacloud');assert.equal(f.state.providerStatus.revision,'cloud');assert.equal(f.state.message,'New Cloud selection');
});

test('a selected Cloud status never claims that own keys are selected',async()=>{
 const f=fixture(),pending=f.api.configureLocal('synthetic-new-key');f.cancel();await f.reading.promise;f.release.resolve({...f.cloud,selected:true});await pending;
 assert.equal(f.state.providerStatus.provider,'elizacloud');assert.doesNotMatch(f.state.message,/Own API keys|saved|verified/);
});

test('a committed selection with a lost response reads status without replaying selection',async()=>{
 const f=fixture();
 // The controller's real method is re-evaluated against a committed-result-loss port.
 const state={providerStatus:f.old,cloudAccount:{}},updates=[];
 const run=new Function('methods','state','cloud','updates',`
  let operation=null,sending=null,providerStatusGeneration=0;
  const update=patch=>{updates.push(patch);Object.assign(state,patch);};
  const selectLocalProvider=async()=>{state.calls=(state.calls||0)+1;throw Error('response lost');};
  const localProviderStatus=async()=>{state.reads=(state.reads||0)+1;return cloud;};
  const work=async(_message,action)=>{try{await action(new AbortController().signal);}catch{}};
  const restartAfterProviderChange=async()=>{};
  return eval(methods);
 `)(methods,state,f.cloud,updates);
 await run.selectSavedProvider('cloud');
 assert.equal(state.calls,1);assert.equal(state.reads,1);assert.equal(state.providerStatus.revision,'cloud');
 assert.equal(state.providerStatus.keys.text.configured,true);assert.equal(state.providerStatus.keys.voice.configured,true);
 assert.equal(updates[0].providerStatusError,true,'route is unconfirmed while selection is unresolved');
 assert.equal(state.providerStatusError,false);
});

test('signed-out Cloud choice opens sign-in without selecting Cloud or deleting Own keys',async()=>{
 const f=fixture();delete f.state.cloudAccount;let entered=0;
 f.api.beginSignIn=async(environment,refresh,automatic,selectCloud)=>{entered++;assert.equal(environment,'production');assert.equal(selectCloud,true);};
 const original=f.state.providerStatus;
 // The method resolves its native saved-sign-in read before choosing a route.
 const api=new Function('methods','state','beginSignIn',`
  let operation=null,sending=null,providerStatusGeneration=0;
  const residentEnvironment=()=> 'production',cloudCredentialStore={read:async()=>null};
  const update=patch=>Object.assign(state,patch);
  const selectLocalProvider=async()=>{throw Error('must not select before sign-in');};
  const work=async()=>{throw Error('must not mutate before sign-in');};
  const api=eval(methods);api.beginSignIn=beginSignIn;return api;
 `)(methods,f.state,f.api.beginSignIn);
 await api.selectSavedProvider('cloud');assert.equal(entered,1);assert.equal(f.state.providerStatus,original);
 assert.equal(f.state.providerStatus.keys.text.configured,true);assert.equal(f.state.providerStatus.keys.voice.configured,true);
});

for(const change of ['dismiss','Own'])test(`late saved-credential read cannot reopen Cloud sign-in after ${change}`,async()=>{
 const release=deferred(),state={providerStatus:{provider:'cerebras',selected:true,revision:'r1',keys:{text:{configured:true},voice:{configured:true}}},open:true,purpose:'provider',signIn:null};let opened=0;
 const api=new Function('methods','state','release',`
  let operation=null,sending=null,providerStatusGeneration=0;
  const residentEnvironment=()=> 'production',cloudCredentialStore={read:()=>release.promise};
  const update=patch=>Object.assign(state,patch),selectLocalProvider=async()=>{throw Error('must not select');};
  const api=eval(methods);return api;
 `)(methods,state,release);
 api.beginSignIn=async()=>{opened++;};
 const pending=api.selectSavedProvider('cloud');
 if(change==='dismiss')state.open=false;else api.cancelProviderSelection();
 release.resolve(null);await pending;assert.equal(opened,0);assert.equal(state.providerStatus.provider,'cerebras');
 assert.equal(state.providerStatus.keys.text.configured,true);assert.equal(state.providerStatus.keys.voice.configured,true);
});
