import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {runWorkflowLifecycleChangeCase1, runWorkflowLifecycleChangeWalks, checkWorkflowLifecycleAccountSwitch}=await import('../specs/quint/refinement/services/workflow-lifecycle-change-replay.mjs');

test('the real workflow adapter follows every step of the lifecycle model scenarios', {timeout: scaledTimeout(240000)}, async () => runWorkflowLifecycleChangeCase1(undefined));

test('the real workflow adapter follows random lifecycle model walks step by step', {timeout: scaledTimeout(280000)}, async () => runWorkflowLifecycleChangeWalks());

test('the lifecycle replay rejects keeping the old drawing on an account switch', {timeout: scaledTimeout(120000)}, async () => {
  await assert.rejects(checkWorkflowLifecycleAccountSwitch(code => {
    const guard = 'if(next!==session||switched||connectionController.getSnapshot().open)';
    assert.ok(code.includes(guard));
    return code.replace(guard, 'if(next!==session||connectionController.getSnapshot().open)');
  }), /Account switch must retire the previous workflow drawing/);
});
