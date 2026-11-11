import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCanonicalCalendarEditorClose} from '../specs/quint/refinement/application/canonical-calendar-editor-close.mjs';

test('Calendar Back and legacy draft component contracts match the retained editor model', {timeout: 420_000}, async () => {
  const receipt = await checkCanonicalCalendarEditorClose([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.checkpoints, 75);
});
