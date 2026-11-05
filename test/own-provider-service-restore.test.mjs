import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=source.indexOf('let ownCloudServiceRestore:');
const end=source.indexOf('/** `admitted`:',start);
assert.ok(start>=0&&end>start);
const code=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
function fixture({credential={credentialId:'cloud-A',credentialReference:'ref-A'},verify}={}){
 const calls=[],selected={},session={};
 const box={active:selected,state:{session,providerStatus:{selected:true,provider:'cerebras'}},epoch:1,appRequests:new Set(),AbortController,DOMException,setTimeout,clearTimeout,service:null,
  ownProviderSelected:()=>box.state.providerStatus.selected,residentEnvironment:()=> 'production',makeCloud:environment=>({environment}),
  cloudCredentialStore:{read:async()=>{calls.push('credential');return credential;}},
  verifyService:async(client,signal,expected)=>{calls.push({client,expected});signal.throwIfAborted();if(verify)await verify(box,signal);signal.throwIfAborted();box.service={identity:{credentialId:expected.credentialId}};box.state.cloudAccount={userId:'owner-A'};},
  detachService:()=>{calls.push('detach');box.service=null;box.state.cloudAccount=null;}};
 vm.createContext(box);vm.runInContext(code+';globalThis.run=restoreOwnProviderCloudServices;',box);return{box,calls};
}
test('own inference restores a saved Cloud service using the exact credential without changing the provider',async()=>{
 const {box,calls}=fixture();await box.run();assert.equal(box.state.cloudAccount.userId,'owner-A');assert.equal(box.state.providerStatus.provider,'cerebras');assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),{client:{environment:'production'},expected:{credentialId:'cloud-A',credentialReference:'ref-A'}});assert.equal(box.appRequests.size,0);
});
test('no saved Cloud account or a pending recovery does not start optional authentication',async()=>{
 const empty=fixture({credential:null});await empty.box.run();assert.deepEqual(empty.calls,['credential']);
 const removed=fixture({credential:null});removed.box.service={identity:{credentialId:'old'}};await removed.box.run();assert.ok(removed.calls.includes('detach'));assert.equal(removed.box.state.providerStatus.selected,true);
 const recovery=fixture();recovery.box.state.residentRecoveryReason='blocked';await recovery.box.run();assert.deepEqual(recovery.calls,[]);
});
test('Cloud identity failure retains own inference and the stored credential',async()=>{
 const {box,calls}=fixture({verify:async()=>{throw Error('Cloud unavailable');}});await box.run();assert.equal(box.state.providerStatus.selected,true);assert.equal(box.state.cloudAccount,undefined);assert.ok(!calls.includes('detach'));assert.equal(box.appRequests.size,0);
});
test('a retired owner cannot publish a late optional Cloud identity',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const {box}=fixture({verify:async()=>pending});const run=box.run();await new Promise(resolve=>setImmediate(resolve));box.epoch++;for(const controller of box.appRequests)controller.abort();box.state={session:{},providerStatus:{selected:false}};release();await run;assert.equal(box.state.cloudAccount,undefined);assert.equal(box.appRequests.size,0);
});
test('Cloud service restoration starts only after the resident is active and never enters Cloud inference admission',()=>{
 const connect=source.slice(source.indexOf('async function connectResident('),source.indexOf('async function connectCloud('));assert.ok(connect.indexOf('void restoreOwnProviderCloudServices()')>connect.indexOf("activate({kind:'resident'"));assert.ok(connect.includes('if(residentCloudFlow()&&!ownProvider)'));
 const recheck=source.slice(source.indexOf('async function recheckResidentPlan('),source.indexOf('/** Bind or unbind Eliza Cloud inference'));
 assert.ok(recheck.indexOf('if(ownProviderSelected())')<recheck.indexOf('await admitCloudResident('));assert.ok(recheck.includes('state.residentRecoveryReason'));
});


test('an older optional service failure cannot detach a newer successful check',async()=>{
 let reject,checks=0;const pending=new Promise((_,no)=>{reject=no;});
 const {box,calls}=fixture({verify:async()=>{if(++checks===1)await pending;}});
 const first=box.run();await new Promise(resolve=>setImmediate(resolve));
 await box.run();const service=box.service;reject(Error('older failed'));await first;
 assert.equal(box.service,service);assert.equal(box.state.cloudAccount.userId,'owner-A');assert.ok(!calls.includes('detach'));
});

test('a changed service object and credential reference survive a delayed old failure',async()=>{
 let reject;const pending=new Promise((_,no)=>{reject=no;});const {box,calls}=fixture({verify:async()=>pending});
 box.service={identity:{credentialId:'cloud-A'},credentialReference:'ref-A'};
 const old=box.run();await new Promise(resolve=>setImmediate(resolve));
 const fresh={identity:{credentialId:'cloud-A'},credentialReference:'ref-B'};box.service=fresh;
 reject(Error('old failed'));await old;assert.equal(box.service,fresh);assert.ok(!calls.includes('detach'));
});


test('a delayed absent credential read cannot clear a newly adopted service',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const {box,calls}=fixture();
 box.service={identity:{credentialId:'old'}};box.cloudCredentialStore.read=()=>pending;
 const check=box.run();const fresh={identity:{credentialId:'new'}};box.service=fresh;
 resolve(null);await check;assert.equal(box.service,fresh);assert.ok(!calls.includes('detach'));
});


test('foreground own-mode checks never refresh a prior Cloud inference plan, and recovery blocks all checks',()=>{
 const start=source.indexOf('  recheckPlanOnReturn('),end=source.indexOf('  /**',start);
 const method=stripTypeScriptTypes('const controller={'+source.slice(start,end)+'};globalThis.check=controller.recheckPlanOnReturn;',{mode:'transform'});
 let services=0;const box={residentCloudFlow:()=>true,operation:null,sending:null,state:{busy:false,session:{}},Date,planManagementReturn:false,lastPlanRecheck:0,PLAN_RECHECK_INTERVAL_MS:1,ownProviderSelected:()=>true,restoreOwnProviderCloudServices:()=>{services++;},ownCloudServiceRestore:null,networkLostUnder:null,planCheckScope:()=>'scope',residentBinding:'cloud',entitlementRefresher:{refreshNow(){throw Error('Old Cloud plan must not be used');}}};
 vm.createContext(box);vm.runInContext(method,box);box.check();assert.equal(services,1);box.state.residentRecoveryReason='blocked';box.planManagementReturn=true;box.check();assert.equal(services,1);
});

// The network's return with the owner's own provider, through the real return check and Cloud
// services restore: the provider stands for the plan check scope, so a services read that fails
// offline (and detaches the account) keeps the return, and no Cloud request is made while signed out.
const returnCode=stripTypeScriptTypes([
 ...source.match(/^(function planCheckScope\(|let networkLostUnder\b|let planRecheck\b).*$/gm),
 'globalThis.controller={'+source.slice(source.indexOf('  recheckPlanOnReturn('),source.indexOf('  /**',source.indexOf('  recheckPlanOnReturn(')))+source.slice(source.indexOf('  networkChanged('),source.indexOf('  openCloudAccount('))+'};',
].join('\n'),{mode:'transform'});
function returning(options){
 const restore=fixture(options),{box}=restore;
 Object.assign(box,{residentCloudFlow:()=>true,operation:null,sending:null,Date,planManagementReturn:false,lastPlanRecheck:-Infinity,PLAN_RECHECK_INTERVAL_MS:60000,residentBinding:'unbound',update:patch=>{Object.assign(box.state,patch);},retractReadiness(){}});
 Object.assign(box.state,{busy:false,inferenceOffline:false});
 vm.runInContext(returnCode,box);
 return {...restore,settled:()=>new Promise(resolve=>setImmediate(resolve)),reads:()=>restore.calls.map(call=>typeof call==='string'?call:'verify')};
}
test('own inference signed out of Cloud: a network return reads only the stored sign-in, never Cloud',async()=>{
 const {box,settled,reads}=returning({credential:null});
 box.controller.recheckPlanOnReturn();await settled();
 box.controller.networkChanged(false);box.controller.networkChanged(true);box.controller.recheckPlanOnReturn();await settled();
 assert.deepEqual(reads(),['credential','credential']);
});
test('own inference: a Cloud services read that fails offline and detaches the account keeps the network return',async()=>{
 const {box,settled,reads}=returning({verify:async box=>{if(box.state.inferenceOffline)throw Error('Connection request failed');}});
 box.service={identity:{credentialId:'cloud-A'},credentialReference:'ref-A'};box.state.cloudAccount={credentialId:'cloud-A'};
 box.controller.networkChanged(false);box.controller.recheckPlanOnReturn();await settled();
 assert.deepEqual(reads(),['credential','verify','detach']);
 box.controller.networkChanged(true);box.controller.recheckPlanOnReturn();await settled();
 assert.deepEqual(reads(),['credential','verify','detach','credential','verify']);
 assert.equal(box.state.cloudAccount.userId,'owner-A');
});
