import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserHostedResultNotice} from '../specs/quint/refinement/application/browser-hosted-result-notice.mjs';

test('the browser hosted ledger refines exact published results, redaction and tap readback', {timeout: 120000}, async () => {
  const {receipt} = await checkBrowserHostedResultNotice([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.observedFields.length, 13);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
