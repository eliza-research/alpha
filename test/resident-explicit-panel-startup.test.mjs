import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const file=process.env.CONTROLLER_SOURCE||'apps/app/src/runtime/connection-ui.tsx';
const text=readFileSync(file,'utf8');
const source=stripTypeScriptTypes(text.slice(text.indexOf('async function connectResident('),text.indexOf('async function connectCloud(')),{mode:'strip'});
for(const purpose of ['plan','cloud-account','agent'])test(`resident completion retains the explicit ${purpose} surface and refusal`,async()=>{
 let ready;const connection=new Promise(resolve=>ready=resolve);const state={purpose:'agent',open:false};let restored=0;
 const admission={binding:'unbound',notice:{open:true,error:'Eliza Cloud returned plan status for a different account. Sign in again.'}};
 const box={state,residentCloudFlow:()=>true,admitCloudResident:async()=>admission,testMocksEnabled:false,update:patch=>Object.assign(state,patch),applyResidentBinding:async()=>({binding:'unbound'}),localAgentPackaged:async()=>true,LocalAgentProtocol:class{origin='https://synthetic.invalid';async connect(){await connection;return {session:{ownerId:'owner',agentId:'agent'},name:'Alpha'};}},workflowPresentationProtocol:async()=>1,isAndroid:true,secureConnectionStore:{read:async()=>{throw Error('No synthetic device enrollment');}},actionJournal:{},actionScope:async()=> 'scope',save:()=>{},activate:()=>{state.open=false;},restoreSavedHistory:async()=>{restored++;},refreshActionReview:async()=>{},AbortController,console};
 vm.runInNewContext(source+';globalThis.run=connectResident;',box);
 const pending=box.run(new AbortController().signal);
 await new Promise(resolve=>setImmediate(resolve));
 state.purpose=purpose;state.open=true;ready();await pending;
 assert.equal(state.purpose,purpose,'finishing startup must not replace an explicit account/plan panel');
 assert.equal(state.open,true);assert.match(state.error,/different account/);assert.equal(state.residentInference,'unavailable');assert.equal(restored,1);
});
