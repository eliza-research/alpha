import test from 'node:test';
import assert from 'node:assert/strict';
import {runApplicationRefinement} from '../specs/quint/refinement/application/index.mjs';

test('application source observations match bounded Quint component and coordinator traces', {timeout: 600000}, async () => {
  const result = await runApplicationRefinement();
  assert.equal(result.receipts.length, 21);
  assert.equal(new Set(result.receipts.map(receipt => receipt.coverageModel || receipt.model)).size, 20);
  assert.ok(result.receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
  assert.ok(Array.isArray(result.obligations), 'remaining obligations accompany the bounded evidence');
});
