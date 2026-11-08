import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runEmbeddingStoreIdentityRefinement} from '../specs/quint/refinement/services/embedding-store-identity.mjs';

test('actual embedding probe preserves model identity and exposes partial resize failure', async () => {
  const {receipts: [receipt]} = await runEmbeddingStoreIdentityRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.checkpoints, 51);
});
