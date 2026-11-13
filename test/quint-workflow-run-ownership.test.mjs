// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {captureInputs,checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {workflowOwnershipTraces} from '../specs/quint/refinement/services/workflow-run-ownership.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

const sources=['apps/app/src/prototype/workflow-adapter.ts','specs/quint/refinement/services/workflow-run-ownership.mjs','specs/quint/refinement/services/support.mjs','test/quint-workflow-run-ownership.test.mjs'];
test("partial source contract: durable run ownership follows storage-refusal and recovery model transitions",{timeout:scaledTimeout(120000)},async()=>{
  const driverHashes=captureInputs(sources),traces=await workflowOwnershipTraces();
  const receipt=await checkTraces({model:'WorkflowExecution',id:'WorkflowExecutionOwnership',sources,driverHashes,traces,scope:'bounded-component',assumptions:['The unchanged ownership helper runs over a controlled localStorage port. Agent acceptance, caller acknowledgment, rendering, physical durability and concurrent processes remain separate.']});
  assert.equal(receipt.passed,true);assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.traces,7);
});

test("partial source contract: ownership observations reject eviction of an earlier unfinished run",async()=>{
  const capped=source=>{const changed=source.replace('JSON.stringify(next):null','JSON.stringify(next.slice(-200)):null');assert.notEqual(changed,source,'Retention mutation must reach the real helper');return changed;};
  await assert.rejects(workflowOwnershipTraces({rewrite:capped}),/200 !== 202/);
});

test("partial source contract: two-context observations reject ownership mutations that bypass their shared lock",async()=>{
  const unlocked=source=>{const changed=source.replace(/\blocks\.request\(RUN_ACCOUNTS,\s*\{mode:['"]exclusive['"]\},/,'((callback)=>Promise.resolve(callback()))(');assert.notEqual(changed,source,'Lock mutation must reach the real helper');return changed;};
  await assert.rejects(workflowOwnershipTraces({rewrite:unlocked}),/other-request/);
});
