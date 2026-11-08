import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runEmbeddingStoreIdentityRefinement} from '../specs/quint/refinement/services/embedding-store-identity.mjs';

test('actual embedding probe preserves the prior store on read failure and fences uncertain writes', async () => {
  const {receipts: [receipt]} = await runEmbeddingStoreIdentityRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.checkpoints, 139);
});
