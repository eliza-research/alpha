import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';

// A provider-key reveal, edit or removal holds the connection operation slot. A native sign-in
// return, a sign-in-incomplete notice or a plan rebind that arrives meanwhile waits behind it, and
// must be serviced when the key request releases the slot, as after any other connection step.
// Runs the shipped key-manager and queue code.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to);};
const code=stripTypeScriptTypes([
  between("async function manageProviderKey(action:'reveal'",'/** P-43: a startup path'),
  between('/** A native sign-in return that arrived while','async function remoteIdentity('),
  'globalThis.manageProviderKey=manageProviderKey;',
  `globalThis.connectionController={signInReturned(value){${between('    if (operation) { queuedSignInReturn = value; return; }','    if (outcome.status ===')}returned.push(value);},${between('  signInIncomplete(value: unknown) {','  /**\n   * The Cloud sign-in hand-off')}};`,
].join('\n'),{mode:'strip'});
const STATUS={mode:'cloud',revision:'fixture-next',keys:{text:{configured:true},voice:{configured:true}}};

function harness({fail=false}={}){
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const request=async()=>{await gate;if(fail)throw Error('offline');return STATUS;};
  const box={AbortController,operation:null,sending:null,epoch:1,signInReadinessOwner:null,providerStatusGeneration:0,
    returned:[],rebinds:0,retries:0,state:{open:false,signIn:null,message:'',error:'',busy:false,startupResolved:true},
    update:patch=>Object.assign(box.state,patch),signInFailureMessage:code=>`failure:${code}`,
    anyAbortSignal:signals=>AbortSignal.any(signals),
    revealLocalProviderKey:async()=>{await gate;if(fail)throw Error('offline');return {key:'text',revision:'fixture',shown:true,hidesAfterMs:30000};},
    editLocalProviderKeys:request,removeLocalProviderKey:request,localProviderStatus:async()=>STATUS,
    restartAfterProviderChange:async()=>{throw Error('An inactive key change must not restart');},
    residentCloudFlow:()=>true,rebindResident(){},residentRebindBlocked:()=>!!box.operation||!!box.sending,
    residentRebindQueue:{pending:false,resume(){this.pending=false;box.rebinds++;return Promise.resolve();}},
    scheduleResidentAutoRetry(){box.retries++;},
  };
  vm.createContext(box);vm.runInContext(code,box);
  const manage=action=>box.manageProviderKey(action,'text','fixture',new AbortController().signal,'synthetic-key');
  return {box,manage,release};
}

for(const action of ['reveal','edit','remove']){
  test(`a sign-in return queued behind a key ${action} is handled when the request ends`,async()=>{
    const {box,manage,release}=harness(),value={status:'signed-in'};
    const pending=manage(action);
    assert.ok(box.operation,'the key request holds the operation slot');
    await box.connectionController.signInReturned(value);
    assert.deepEqual(box.returned,[],'waits behind the key request');
    release();await pending;
    assert.equal(box.operation,null);assert.equal(box.state.busy,false);
    assert.deepEqual(box.returned,[value],'handled once the slot is free');
    box.runQueuedSignInReturn();assert.equal(box.returned.length,1,'handled once');
  });
}

test('a rebind and an incomplete-sign-in notice queued behind a key request run when it ends',async()=>{
  const {box,manage,release}=harness();
  const pending=manage('edit');
  box.residentRebindQueue.pending=true;
  box.connectionController.signInIncomplete({code:'app-link-unverified'});
  assert.equal(box.state.error,'');assert.equal(box.rebinds,0);
  release();await pending;
  assert.equal(box.rebinds,1,'the waiting rebind resumed');
  assert.equal(box.state.error,'failure:app-link-unverified');assert.equal(box.state.open,true);
  assert.equal(box.retries,1,'recovery retry is reconsidered as after any step');
});

test('a failed key request still services the work queued behind it',async()=>{
  const {box,manage,release}=harness({fail:true}),value={status:'signed-in'};
  const pending=manage('reveal');
  await box.connectionController.signInReturned(value);
  release();await assert.rejects(pending,/Couldn’t show this key/);
  assert.deepEqual(box.returned,[value]);
});

test('with nothing queued the release runs nothing',async()=>{
  const {box,manage,release}=harness();
  const pending=manage('remove');release();await pending;
  assert.deepEqual(box.returned,[]);assert.equal(box.rebinds,0);assert.equal(box.state.providerStatus,STATUS);
});
