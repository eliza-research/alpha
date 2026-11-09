import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNativeUpdateStaging} from '../specs/quint/refinement/native/update-staging.mjs';

test('native update review, file custody and staging match real source', {timeout: 120000}, async () => {
  const {receipt, skipped} = await checkNativeUpdateStaging([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces + skipped.length, 14);
  assert.ok(receipt.traces >= 13);
  if (skipped.length) assert.equal(skipped[0].mode, 'cache-delete-refused');
});
