import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkEmbeddingSqlRefinement} from '../specs/quint/legacy/core/check-embedding-sql-refinement.mjs';

test('actual PGlite embedding writes reject stale provenance and preserve width rejection', async () => {
  const receipt = await checkEmbeddingSqlRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 2);
  assert.equal(receipt.checkpoints, 13);
});
