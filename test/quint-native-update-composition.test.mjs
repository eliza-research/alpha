import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNativeUpdateComposition} from '../specs/quint/refinement/native/update-composition.mjs';

test('partial source contract: native readiness, final offer and durable pause compose through exact update settlement', {timeout: scaledTimeout(900000)}, async () => {
  const {receipt, skipped} = await checkNativeUpdateComposition([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces + skipped.length, 9);
  assert.ok(receipt.traces >= 8);
  if (skipped.length) assert.equal(skipped[0].mode, 'ambiguous-terminal-sync');
});
