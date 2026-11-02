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
 const old={configured:true,provider:'cerebras',selected:true,revision:'old-key'};
 const cloud={configured:false,provider:'elizacloud',selected:false,revision:'cloud'};
 const box=new Function('methods','old','cloud','reading','release',`
  let operation=null,sending=null,providerStatusGeneration=0;const state={providerStatus:old,message:''};
  const update=patch=>Object.assign(state,patch),LOCAL_PROVIDER_MODEL='model',OWN_KEYS_NOT_SET_UP='Unavailable',isAndroid=false,browserCloudResidentEnabled=false;
  const work=async(_label,run)=>{operation=new AbortController();try{await run(operation.signal);}catch(error){if(!operation.signal.aborted)throw error;}finally{operation=null;}};
  const configureLocalProvider=async(_key,_model,_voice,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  let reads=0;const localProviderStatus=async()=>{reads++;if(reads===1){reading.resolve();return release.promise;}return cloud;};
  const clearLocalProvider=async()=>cloud,retire=async()=>{},connectResident=async()=>{},showPostSignInSetup=()=>{},ownProviderSelected=()=>state.providerStatus?.selected===true;
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
