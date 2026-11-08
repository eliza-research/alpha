import {residentRecoveryReason} from '../apps/app/src/runtime/resident-recovery.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
// Execute the real operation boundary; infrastructure state is injected, no network/storage/media.
const source=await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const begin=source.indexOf('async function work('),end=source.indexOf('\nfunction activate(',begin);
assert.ok(begin>=0&&end>begin);
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'});
function fixture(){
 const state={open:false,busy:false,purpose:'agent',message:'',error:''},updates=[];
 const context=vm.createContext({residentRecoveryReason,testMocksEnabled:false,AbortController,state,signInReadinessOwner:null,operation:null,active:null,cloud:{},expired:()=>false,errorMessage:e=>e.message,residentCloudFlow:()=>false,runQueuedResidentRebind:()=>{},runQueuedSignInReturn:()=>{},update:next=>{Object.assign(state,next);updates.push({...state});}});
 vm.runInContext(code,context);return {state,updates,context,run:(...args)=>context.work(...args)};
}
test('background account restore never opens the chooser and clears its loading status',async()=>{
 const f=fixture();let finish;const pending=f.run('Checking your Cloud account…',()=>new Promise(resolve=>finish=resolve),true,true);
 assert.equal(f.state.busy,true);assert.equal(f.state.open,false);finish();await pending;
 assert.equal(f.state.busy,false);assert.equal(f.state.open,false);assert.equal(f.state.message,'');assert.equal(f.state.error,'');assert.ok(f.updates.every(row=>!row.open));
});
test('failed background restore opens compact Cloud account recovery',async()=>{
 const f=fixture();await f.run('Checking your Cloud account…',async()=>{throw Error('Account temporarily unavailable');},true,true);
 assert.equal(f.state.open,true);assert.equal(f.state.purpose,'cloud-account');assert.equal(f.state.error,'Account temporarily unavailable');assert.equal(f.state.busy,false);
});
test('explicitly opened settings remain open when background restore finishes',async()=>{
 const f=fixture();let finish;const pending=f.run('Checking your Cloud account…',()=>new Promise(resolve=>finish=resolve),true,true);f.state.open=true;f.state.purpose='cloud-account';finish();await pending;
 assert.equal(f.state.open,true);assert.equal(f.state.purpose,'cloud-account');assert.equal(f.state.busy,false);
});
test('cancelled background restore does not reopen a dismissed panel',async()=>{
 const f=fixture();await f.run('Checking your Cloud account…',async signal=>{f.context.operation.abort();signal.throwIfAborted();},true,true);
 assert.equal(f.state.open,false);assert.equal(f.state.error,'');assert.equal(f.state.busy,false);
});
test('explicit connection operations retain their visible dialog',async()=>{
 const f=fixture();await f.run('Signing in…',async()=>{});assert.equal(f.state.open,true);assert.equal(f.state.purpose,'agent');assert.equal(f.state.busy,false);
});

// Execute the actual startup branch with an environment-fenced host store. The
// resident gate owns account/plan/history restoration for explicit dev:cloud.
const startupStart=source.indexOf('  async initialize() {');
const startupEnd=source.indexOf('  /** Test mocks and the flag-off web preview',startupStart);
assert.ok(startupStart>=0&&startupEnd>startupStart);
const restoreStart=source.indexOf('async function restoreOptionalBrowserCloudAccount('),restoreEnd=source.indexOf('\nexport const connectionController',restoreStart);
assert.ok(restoreStart>=0&&restoreEnd>restoreStart);
const startupCode=stripTypeScriptTypes(source.slice(restoreStart,restoreEnd)+'\n'+source.slice(startupStart,startupEnd).trim().replace(/^async initialize\(\)/,'async function initialize()').replace(/,$/,''),{mode:'transform'});
function startupFixture({resident=false,android=false,environment='production'}={}){
 const state={open:false,error:''},reads=[];let gates=0;
 const context=vm.createContext({startup:null,state,epoch:0,operation:null,browserDevProfile:false,privateLocalPreviewEnabled:false,browserCloudResidentEnabled:resident,isAndroid:android,URLSearchParams,location:{search:''},selection:()=>({kind:'resident'}),update:next=>Object.assign(state,next),cloudCredentialStore:{acceptsReferences:!android,read:async env=>{reads.push(env);if(env!==environment)throw Error('Cloud development connection unavailable.');return null;}},work:async(_label,run)=>{try{await run(new AbortController().signal);}catch(error){state.error=error.message;state.open=true;}},webCloudUnavailable:()=>false,residentQa:()=>true,startResidentGate:async()=>{gates++;await context.cloudCredentialStore.read(environment);},settleResidentAfterStartup:()=>{}});
 vm.runInContext(startupCode,context);return {state,reads,run:()=>context.initialize(),gates:()=>gates};
}
test('explicit staging Cloud reload reaches resident restoration without reading production credentials',async()=>{
 const f=startupFixture({resident:true,environment:'staging'});await f.run();
 assert.deepEqual(f.reads,['staging']);assert.equal(f.gates(),1);assert.equal(f.state.error,'');assert.equal(f.state.open,false);assert.equal(f.state.startupResolved,true);
});
test('ordinary browser startup retains optional production credential discovery',async()=>{
 const f=startupFixture();await f.run();assert.deepEqual(f.reads,['production','production']);assert.equal(f.gates(),1);assert.equal(f.state.error,'');
});
test('native startup continues directly through its resident restoration',async()=>{
 const f=startupFixture({android:true});await f.run();assert.deepEqual(f.reads,['production']);assert.equal(f.gates(),1);assert.equal(f.state.error,'');
});
