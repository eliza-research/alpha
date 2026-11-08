import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkResidentLiveness} from '../specs/quint/refinement/application/resident-liveness.mjs';

test('resident liveness checks and restart replies retain the originating epoch', async () => {
  const {receipt} = await checkResidentLiveness([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.checkpoints, 38);
});
