import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleAccessPublication} from '../specs/quint/refinement/application/google-access-publication.mjs';

test('Google access corrective publication retains the document lock and original failure', async () => {
  const {receipt} = await checkGoogleAccessPublication([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 5);
  assert.equal(receipt.checkpoints, 29);
});
