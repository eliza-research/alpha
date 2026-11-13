import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkKeyboardFocus} from '../specs/quint/refinement/application/keyboard-focus.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: KeyboardFocus retains its original source schedules', {timeout: 240000}, async () => {
  const receipt = await checkKeyboardFocus([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'KeyboardFocus');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
