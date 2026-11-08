import test from 'node:test';
import assert from 'node:assert/strict';
import {runStartupPermissionsCoordinatorRefinement} from '../specs/quint/refinement/application/startup-permissions-coordinator.mjs';

test('actual permission coordinator traces refine the bounded walkthrough model', {timeout:180000}, async () => {
  const result = await runStartupPermissionsCoordinatorRefinement();
  assert.equal(result.receipt.passed, true);
  assert.equal(result.receipt.inputsUnchanged, true);
  assert.equal(result.receipt.driverInputsBound, true);
  assert.equal(result.receipt.observedFields.length, 19);
  for (const name of ['credential-change-held-completion', 'credential-change-held-rejection',
    'stale-completion-keeps-newer-busy', 'stale-rejection-keeps-newer-busy',
    'same-turn-owner-completion', 'same-turn-owner-rejection',
    'deferred-effect-owner-completion', 'deferred-effect-owner-rejection',
    'deferred-effect-disabled-completion', 'deferred-effect-disabled-rejection',
    'null-result-while-old-platform-call-is-pending', 'required-flow-dismissal-is-blocked']) {
    assert(result.scenarios.some(scenario => scenario.name === name), name);
  }
  assert(result.obligations.length > 0);
});
