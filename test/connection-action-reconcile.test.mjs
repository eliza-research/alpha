import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';

// MS-024-F01: the owner's "It happened" / "It did not happen" answer re-reads action history. A
// connection change during that read (plan change, sign-in, provider change) must not write the
// retired connection's rows into the new one. Runs the shipped connectionController.reconcile.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to);};
const reconcile=stripTypeScriptTypes(`globalThis.controller={${between('  async reconcile(entryId','  async reconcileAction(')}};`,{mode:'strip'});

function harness(read){
  const reconciled=[],old={actions:{reconcile:async(id,outcome)=>{reconciled.push([id,outcome]);}}};
  const box={epoch:1,active:old,state:{actionHistory:[{id:'old-1'},{id:'old-2'}]},AbortController,
    update:patch=>Object.assign(box.state,patch),readActionHistory:read};
  vm.createContext(box);vm.runInContext(reconcile,box);
  return {box,old,reconciled};
}

test('a history read that resolves after the connection changed writes nothing',async()=>{
  let release;const {box,reconciled}=harness(()=>new Promise(resolve=>{release=resolve;}));
  const done=box.controller.reconcile('old-1',true);
  await new Promise(resolve=>setImmediate(resolve));
  // A plan change retires the connection and activates a new one while the read is in flight.
  box.epoch++;box.active={actions:{}};box.state.actionHistory=[{id:'new-1'}];
  release([{id:'old-1',state:'completed'},{id:'old-2'}]);
  await done;
  assert.deepEqual(reconciled,[['old-1','applied']]);
  assert.deepEqual(box.state.actionHistory,[{id:'new-1'}]);
});

test('a failed read after the connection changed does not filter the new history either',async()=>{
  let fail;const {box}=harness(()=>new Promise((_,reject)=>{fail=reject;}));
  const done=box.controller.reconcile('new-1',false);
  await new Promise(resolve=>setImmediate(resolve));
  box.epoch++;box.state.actionHistory=[{id:'new-1'}];
  fail(Error('offline'));await done;
  assert.deepEqual(box.state.actionHistory,[{id:'new-1'}]);
});

test('on the same connection the read replaces the history, or drops the answered row when it fails',async()=>{
  const fresh=[{id:'old-1',state:'completed'}];
  const ok=harness(async()=>fresh);await ok.box.controller.reconcile('old-1',true);
  assert.equal(ok.box.state.actionHistory,fresh);
  const failed=harness(async()=>{throw Error('offline');});await failed.box.controller.reconcile('old-1',true);
  assert.deepEqual(failed.box.state.actionHistory,[{id:'old-2'}]);
});
