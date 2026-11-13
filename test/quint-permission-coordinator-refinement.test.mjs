import test from 'node:test';
import assert from 'node:assert/strict';
import {runStartupPermissionsCoordinatorRefinement} from '../specs/quint/refinement/application/startup-permissions-coordinator.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('actual permission coordinator traces refine the bounded walkthrough model', {timeout:scaledTimeout(180000)}, async () => {
  const result = await runStartupPermissionsCoordinatorRefinement();
  assert.equal(result.receipt.passed, true);
  assert.equal(result.receipt.inputsUnchanged, true);
  assert.equal(result.receipt.driverInputsBound, true);
  assert.equal(result.receipt.observedFields.length, 20);
  for (const name of ['credential-change-held-completion', 'credential-change-held-rejection',
    'stale-completion-keeps-newer-busy', 'stale-rejection-keeps-newer-busy',
    'same-turn-owner-completion', 'same-turn-owner-rejection',
    'deferred-effect-owner-completion', 'deferred-effect-owner-rejection',
    'deferred-effect-disabled-completion', 'deferred-effect-disabled-rejection',
    'null-result-while-old-platform-call-is-pending', 'required-flow-dismissal-is-blocked',
    'image-initial-platform-grants-require-no-requests', 'image-ungranted-location-stops-until-platform-readback',
    'image-completed-settings-target-remains-explicit']) {
    assert(result.scenarios.some(scenario => scenario.name === name), name);
  }
  assert(result.obligations.length > 0);
});
