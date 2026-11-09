import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkBrowserCloudRequestCustody} from '../specs/quint/refinement/services/browser-cloud-request-custody.mjs';

test('browser Cloud retains the exact active request across duplicate rejection and late completion', async () => {
  const receipt = await checkBrowserCloudRequestCustody([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 3);
  assert.equal(receipt.checkpoints, 25);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
});
