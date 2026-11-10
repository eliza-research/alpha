import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAppUpdateCandidate} from '../specs/quint/refinement/services/app-update-candidate.mjs';
import {fileURLToPath} from 'node:url';

test('unsigned candidate CLI results refine version floors, exact attempts and immutable evidence', {timeout: 120000}, async () => {
  const result = await checkAppUpdateCandidate([fileURLToPath(import.meta.url)]);
  assert.equal(result.passed, true);
  assert.equal(result.inputsUnchanged, true);
  assert.equal(result.driverInputsBound, true);
  assert.equal(result.traces, 14);
  assert.ok(result.checkpoints >= 40);
});
