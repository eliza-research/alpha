import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkSharePanelAdmission} from '../specs/quint/refinement/application/share-panel-admission.mjs';

test('device sharing admits one platform chooser and never chooses a fallback', {timeout: 120000}, async () => {
  const result = await checkSharePanelAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(result.passed, true);
  assert.equal(result.traces, 3);
});
