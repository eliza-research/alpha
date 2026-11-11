import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNativeUpdateComposition} from '../specs/quint/refinement/native/update-composition.mjs';

// Seven complete programs retain their 120-second checker fuses; include JVM setup and cleanup.
test('native readiness, durable pause and resident lease compose through exact update settlement', {timeout: 900000}, async () => {
  const {receipt, skipped} = await checkNativeUpdateComposition([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces + skipped.length, 7);
  assert.ok(receipt.traces >= 6);
  if (skipped.length) assert.equal(skipped[0].mode, 'ambiguous-terminal-sync');
});
