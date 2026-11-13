import assert from 'node:assert/strict';
import test from 'node:test';
import {checkActionSettlementRefinement} from '../specs/quint/legacy/core/check-action-settlement-refinement.mjs';

test('core action settlement follows CoreActionSettlement and its outcome profile', {timeout: 360000}, async () => {
  const receipts = await checkActionSettlementRefinement();
  assert.deepEqual(receipts.map(receipt => receipt.model).sort(), ['CoreActionSettlement', 'CoreActionSettlementOutcomes']);
  for (const receipt of receipts) assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged, receipt.model);
});
