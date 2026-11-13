import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleBrowserReturnClaim} from '../specs/quint/refinement/native/google-browser-return-claim.mjs';

test('partial source contract: the exact native Google browser result owns its claim across both grace timers', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkGoogleBrowserReturnClaim([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 23);
  assert.equal(receipt.checkpoints, 121);
});
