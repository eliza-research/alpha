import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPluginLifecycleRefinement} from '../specs/quint/legacy/core/check-plugin-lifecycle-refinement.mjs';

test('original plugin lifecycle profiles refine selected runtime ownership schedules', {timeout: 120000}, async () => {
  const {receipts, mismatches} = await checkPluginLifecycleRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => receipt.model),
    ['CorePluginLifecycle', 'CorePluginLifecycleRegister', 'CorePluginLifecycleServices']);
  assert.deepEqual(receipts.map(receipt => receipt.traces), [2, 2, 2]);
  assert.ok(receipts.every(receipt => receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged));
  assert.deepEqual(mismatches.map(receipt => receipt.name),
    ['PluginRegistrationRollbackVisibility', 'PluginRuntimeStopLookup']);
  assert.ok(mismatches.every(receipt => !receipt.passed && receipt.driverInputsBound
    && receipt.results[0].kind === 'observation-mismatch'));
});
