import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleConsentAdmission} from '../specs/quint/refinement/application/google-consent-admission.mjs';

test('mounted Google consent retains only verified current readbacks and grant tiers', {timeout: 120000}, async () => {
  const receipt = await checkGoogleConsentAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 16);
  assert.equal(receipt.checkpoints, 100);
});
