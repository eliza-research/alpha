import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const initialize=section('  async initialize() {','  /** Test mocks and the flag-off web preview only:');
const work=section('async function work(', '/** Start (or restart) the resident.');
const helper=source.includes('async function restoreOptionalBrowserCloudAccount(')?section('async function restoreOptionalBrowserCloudAccount(', 'export const connectionController ='):'';
const code=stripTypeScriptTypes(work+'\n'+helper+'\nglobalThis.controller={'+initialize+'};',{mode:'transform'});
const credential={credentialId:'fixture-id',credentialReference:'browser-cloud-reference:fixture'};
function fixture({values=[credential,credential],choice={kind:'resident'},attachFails=false,android=false,profile=false,cloudResident=false,accepts=true,search='',readChoice,testMocks=false}={}){
 const calls=[],history={messages:[{id:'retained',text:'Exact retained history'}]};let context;
 const state={open:false,error:'',busy:false,history,cloudAccount:null};
 context=vm.createContext({state,epoch:1,startup:null,operation:null,active:null,residentStartInBackground:false,privateLocalPreviewEnabled:true,
  browserDevProfile:profile,browserCloudResidentEnabled:cloudResident,isAndroid:android,testMocksEnabled:testMocks,
  update:patch=>Object.assign(state,patch),AbortController,DOMException,URLSearchParams,location:{search},residentRecoveryReason:()=>undefined,errorMessage:error=>error.message,expired:()=>false,
  runQueuedResidentRebind(){},runQueuedSignInReturn(){},residentCloudFlow:()=>false,settleResidentAfterStartup(){},selection:()=>context.choice,choice,
  connectResident:async()=>{calls.push('attach');if(attachFails)throw Error('Private owner unavailable');context.active={kind:'resident'};state.session={ownerId:'local-owner'};},
  cloudCredentialStore:{acceptsReferences:accepts,read:async environment=>{assert.equal(environment,'production');calls.push('read');if(readChoice)readChoice(context);return values[Math.min(calls.filter(x=>x==='read').length-1,values.length-1)]??null;},write(){throw Error('No credential write');},clear(){throw Error('No credential clear');}},
  makeCloud:environment=>({environment}),verifyService:async(client,_signal,expected)=>{calls.push('verify');assert.equal(client.environment,'production');assert.deepEqual({...expected},credential);context.service={identity:{credentialId:credential.credentialId}};state.cloudAccount={credentialId:credential.credentialId};},
  service:null,retire(){throw Error('No agent retirement');},connectDevelopment(){throw Error('No development profile adoption');},beginSignIn(){throw Error('No auth replay');},
 });
 vm.runInContext(code,context);return {calls,state,history,context,initialize:()=>context.controller.initialize()};
}
test('private owner attaches first, then validates the persisted Cloud reference and restores account state once',async()=>{
 const f=fixture();await f.initialize();assert.deepEqual(f.calls,['attach','read','read','verify']);assert.equal(f.state.cloudAccount.credentialId,credential.credentialId);assert.equal(f.state.history,f.history);assert.equal(f.state.session.ownerId,'local-owner');await f.initialize();assert.equal(f.calls.length,4);
});
test('an empty optional Cloud store does not reopen sign-in or disturb the private owner',async()=>{
 const f=fixture({values:[null]});await f.initialize();assert.deepEqual(f.calls,['attach','read']);assert.equal(f.state.open,false);assert.equal(f.state.cloudAccount,null);assert.equal(f.context.active.kind,'resident');assert.equal(f.state.history,f.history);
});
test('a replaced reference with the same credential ID cannot publish the old Cloud account',async()=>{
 const f=fixture({values:[credential,{...credential,credentialReference:'browser-cloud-reference:replacement'}]});await f.initialize();assert.deepEqual(f.calls,['attach','read','read']);assert.match(f.state.error,/Cloud account changed/);assert.equal(f.state.cloudAccount,null);assert.equal(f.context.active.kind,'resident');assert.equal(f.state.history,f.history);
});
// `npm run dev` sets the preview flag with test mocks on (scripts/dev-local.mjs): a page loaded while the
// agent restarts attaches in the background, so the failed attach (a 503) leaves the sheet closed.
test('npm run dev: a failed startup attach leaves the sheet closed and the agent recovering, with test mocks on',async()=>{
 const f=fixture({attachFails:true,testMocks:true});await f.initialize();assert.deepEqual(f.calls,['attach']);
 assert.equal(f.state.open,false);assert.equal(f.state.kind,'recovering');assert.equal(f.state.busy,false);assert.match(f.state.error,/Private owner unavailable/);
});
test('failed private attachment never starts unrelated Cloud discovery',async()=>{
 const f=fixture({attachFails:true});await f.initialize();assert.deepEqual(f.calls,['attach']);assert.match(f.state.error,/Private owner unavailable/);assert.equal(f.state.cloudAccount,null);
});
for(const [name,options]of [['offline',{choice:{kind:'offline'}}],['native',{android:true}],['development profile',{profile:true}],['Cloud resident',{cloudResident:true}],['non-reference store',{accepts:false}],['mock mode',{search:'?mode=mock'}]])test(`existing ${name} fence remains`,async()=>{
 const f=fixture(options);await f.initialize();assert.deepEqual(f.calls,['attach']);assert.equal(f.state.cloudAccount,null);
});
test('a changed credential ID on the second read cannot be adopted',async()=>{
 const f=fixture({values:[credential,{...credential,credentialId:'replacement'}]});await f.initialize();assert.deepEqual(f.calls,['attach','read','read']);assert.match(f.state.error,/Cloud account changed/);assert.equal(f.state.cloudAccount,null);
});
test('an owner epoch change on the second read stops verification',async()=>{
 let reads=0;const f=fixture({readChoice:context=>{if(++reads===2)context.epoch++;}});await f.initialize();assert.deepEqual(f.calls,['attach','read','read']);assert.equal(f.state.cloudAccount,null);assert.equal(f.context.active.kind,'resident');
});
for(const change of ['epoch','choice','panel'])test(`an owner choice during discovery prevents late Cloud adoption: ${change}`,async()=>{
 const f=fixture({readChoice:context=>{if(change==='epoch')context.epoch++;if(change==='choice')context.choice={kind:'offline'};if(change==='panel')context.state.open=true;}});await f.initialize();assert.deepEqual(f.calls,['attach','read']);assert.equal(f.state.cloudAccount,null);assert.equal(f.context.active.kind,'resident');
});
