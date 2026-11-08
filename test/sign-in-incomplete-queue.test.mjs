import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';

// spec-cloud-sign-in-F02: native retains one signInIncomplete across a process restart and delivers
// it while startup runs. Startup's own work() cleared it, so the owner saw nothing. It now waits for
// startup to settle and says that Alpha restarted. Runs the shipped controller code.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to);};
const code=stripTypeScriptTypes([
  between('/** A native sign-in return that arrived while','function runQueuedResidentRebind('),
  `globalThis.connectionController={signInReturned:value=>returned.push(value),${between('  signInIncomplete(value: unknown) {','  /**\n   * The Cloud sign-in hand-off')}};`,
].join('\n'),{mode:'strip'});
const RESTARTED='Alpha restarted before your sign-in finished. Sign in again.';

function harness(state){
  const box={operation:null,epoch:1,returned:[],state:{open:false,signIn:null,message:'',error:'',...state},
    update:patch=>Object.assign(box.state,patch),signInFailureMessage:code=>`failure:${code}`};
  vm.createContext(box);vm.runInContext(code,box);
  return box;
}
const incomplete={code:'app-link-unverified'};

test('an incomplete return delivered during startup waits for it and says Alpha restarted',()=>{
  const box=harness({startupResolved:false});
  box.operation={};
  box.connectionController.signInIncomplete(incomplete);
  assert.deepEqual({open:box.state.open,error:box.state.error},{open:false,error:''},'nothing shown while startup runs');
  // Startup's work() ends and clears its error; the queued notice is still pending.
  box.operation=null;box.update({error:''});box.runQueuedSignInReturn();
  assert.equal(box.state.error,'','not before startup has settled');
  box.update({startupResolved:true});box.runQueuedSignInReturn();
  assert.deepEqual({open:box.state.open,error:box.state.error},{open:true,error:RESTARTED});
  box.update({error:''});box.runQueuedSignInReturn();
  assert.equal(box.state.error,'','shown once');
});

test('one arriving before startup work begins is queued as well',()=>{
  const box=harness({startupResolved:false});
  box.connectionController.signInIncomplete(incomplete);
  assert.equal(box.state.error,'');
  box.update({startupResolved:true});box.runQueuedSignInReturn();
  assert.equal(box.state.error,RESTARTED);
});

test('after startup an idle phone shows it at once; during another step it waits, with the usual copy',()=>{
  const idle=harness({startupResolved:true,signIn:{step:'google',environment:'production'}});
  idle.connectionController.signInIncomplete(incomplete);
  assert.deepEqual({error:idle.state.error,signIn:{...idle.state.signIn}},{error:'failure:app-link-unverified',signIn:{step:'choose',environment:'production'}});
  const busy=harness({startupResolved:true});busy.operation={};
  busy.connectionController.signInIncomplete(incomplete);
  assert.equal(busy.state.error,'');
  busy.operation=null;busy.runQueuedSignInReturn();
  assert.equal(busy.state.error,'failure:app-link-unverified');
});

test('other codes are ignored',()=>{
  const box=harness({startupResolved:true});
  box.connectionController.signInIncomplete({code:'other'});box.connectionController.signInIncomplete(null);
  box.runQueuedSignInReturn();
  assert.equal(box.state.error,'');
});

test('native storage refusal survives pending startup and keeps its specific recovery message',()=>{
 const box=harness({startupResolved:false,signIn:{step:'google',environment:'production'}});
 box.operation={};box.connectionController.signInIncomplete({code:'storage'});
 assert.equal(box.state.error,'');
 box.operation=null;box.update({startupResolved:true});box.runQueuedSignInReturn();
 assert.equal(box.state.error,'failure:storage');
 assert.equal(box.state.signIn.step,'choose');
 box.update({error:''});box.runQueuedSignInReturn();assert.equal(box.state.error,'');
});
test('an idle native storage refusal is shown without starting a credential write',()=>{
 const box=harness({startupResolved:true});box.connectionController.signInIncomplete({code:'storage'});
 assert.equal(box.state.error,'failure:storage');assert.deepEqual(box.returned,[]);
});


test('a queued storage refusal cannot replace a newer sign-in step',()=>{
 const box=harness({startupResolved:true,signIn:{step:'google',environment:'production'}});
 box.operation={};box.connectionController.signInIncomplete({code:'storage'});
 const next={step:'code',environment:'production',attemptId:'new-attempt'};box.state.signIn=next;
 box.operation=null;box.runQueuedSignInReturn();
 assert.equal(box.state.signIn,next);assert.equal(box.state.open,false);assert.equal(box.state.error,'');
});
test('a queued storage refusal cannot reopen a replaced connection',()=>{
 const box=harness({startupResolved:true,signIn:{step:'google',environment:'production'}});
 box.operation={};box.connectionController.signInIncomplete({code:'storage'});box.epoch++;
 box.operation=null;box.runQueuedSignInReturn();assert.equal(box.state.open,false);assert.equal(box.state.error,'');
});
test('a same-owner storage refusal is shown once after its operation releases',()=>{
 const box=harness({startupResolved:true,signIn:{step:'google',environment:'production'}});
 box.operation={};box.connectionController.signInIncomplete({code:'storage'});
 box.operation=null;box.runQueuedSignInReturn();assert.equal(box.state.error,'failure:storage');
 box.update({error:''});box.runQueuedSignInReturn();assert.equal(box.state.error,'');
});
