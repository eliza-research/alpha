import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAndroidGzipAssetStage} from '../specs/quint/refinement/services/android-gzip-asset-stage.mjs';

test('Android gzip protection and byte verification preserve the published asset', async () => {
  const receipt = await checkAndroidGzipAssetStage([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 6);
});
