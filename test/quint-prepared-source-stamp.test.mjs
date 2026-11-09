import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPreparedSourceStamp} from '../specs/quint/refinement/services/prepared-source-stamp.mjs';

test('prepared runtime stamp retains exact source and backup custody', async () => {
  const receipt = await checkPreparedSourceStamp([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 10);
});
