import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCanonicalCalendarDraft} from '../specs/quint/refinement/application/canonical-calendar-draft.mjs';

test('canonical Calendar draft ownership matches actual editor and durable-store transitions', {timeout: 120000}, async () => {
  const receipt = await checkCanonicalCalendarDraft([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.checkpoints, 121);
});
