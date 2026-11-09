import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCanonicalNotificationTapAdmission} from '../specs/quint/refinement/application/canonical-notification-tap-admission.mjs';

test('canonical notification taps preserve current renderer commit and exact native token custody', {timeout: 60000}, async () => {
  const receipt = await checkCanonicalNotificationTapAdmission();
  assert.equal(receipt.traceInputs.length, 8);
  assert.equal(receipt.observedFields.length, 21);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
