import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkEmbeddingSqlRefinement} from '../specs/quint/legacy/core/check-embedding-sql-refinement.mjs';

test('authenticated historical PGlite fragments replay width rejection and the translated provenance counterexample', async () => {
  const receipt = await checkEmbeddingSqlRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 2);
  assert.equal(receipt.checkpoints, 13);
});
