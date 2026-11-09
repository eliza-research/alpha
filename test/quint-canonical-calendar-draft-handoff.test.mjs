import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCanonicalCalendarDraftHandoff} from '../specs/quint/refinement/application/canonical-calendar-draft-handoff.mjs';

test('mounted Note and scan handoffs match canonical Calendar draft admission', {timeout: 420_000}, async () => {
  const receipt = await checkCanonicalCalendarDraftHandoff([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 5);
  assert.equal(receipt.checkpoints, 44);
});
