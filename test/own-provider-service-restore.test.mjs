import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=source.indexOf('async function restoreOwnProviderCloudServices(');
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
