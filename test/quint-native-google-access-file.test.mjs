import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runNativeGoogleAccessFileRefinement} from '../specs/quint/refinement/services/native-google-access-file.mjs';

test('the actual JVM access file and loopback host refine private file admission and recovery', async () => {
  const {receipts: [receipt]} = await runNativeGoogleAccessFileRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.checkpoints, 66);
  assert.ok(receipt.observedFields.includes('s.snapshot'));
});
