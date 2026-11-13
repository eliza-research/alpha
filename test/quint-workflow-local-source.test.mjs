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
import {checkWorkflowAuthoring,checkWorkflowNoticeTaps} from '../specs/quint/refinement/services/workflow-local-source.mjs';
test("partial source contract: real workflow authoring custody refines bounded local draft schedules",async()=>{const r=await checkWorkflowAuthoring();assert.equal(r.passed,true);assert.equal(r.driverInputsBound,true);assert.ok(r.traces>=6&&r.checkpoints>=25);});
test("partial source contract: real run-tap handler keeps one open through consume retry and repeated events",async()=>{const r=await checkWorkflowNoticeTaps();assert.equal(r.passed,true);assert.equal(r.driverInputsBound,true);assert.ok(r.traces>=3&&r.checkpoints>=18);});
test("partial source contract: authoring source canary cannot edit pending identity",async()=>{await assert.rejects(checkWorkflowAuthoring([],{mutant:'pending-edit'}),/Pending save must lock draft editing/);});
test("partial source contract: notice source canary cannot forget the opened token",async()=>{await assert.rejects(checkWorkflowNoticeTaps([],{mutant:'forget-opened-tap'}),/Source\/model trace mismatch|Failed consume must not reopen a run/);});
