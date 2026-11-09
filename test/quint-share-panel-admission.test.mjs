import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkSharePanelAdmission} from '../specs/quint/refinement/application/share-panel-admission.mjs';

test('the exact Share panel dispatches each admitted destination at most once after close', {timeout: 120000}, async () => {
  const result = await checkSharePanelAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(result.passed, true);
  assert.equal(result.traces, 11);
});
