import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeCrashJournal} from '../specs/quint/refinement/native/crash-journal.mjs';

test('partial source contract: native problem-log workers and durable retention refine authenticated app source', async () => {
  const {receipt}=await checkNativeCrashJournal();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,12);
  assert.equal(receipt.observedFields.length,12);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
