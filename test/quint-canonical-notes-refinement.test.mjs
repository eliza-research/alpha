import test from 'node:test';
import assert from 'node:assert/strict';
import {runCanonicalNotesRefinement} from '../specs/quint/refinement/services/notes-store/index.mjs';

test('actual Notes mutations refine raw, visible and committed identities', {timeout: 240000}, async () => {
  const result = await runCanonicalNotesRefinement();
  assert.equal(result.receipts.length, 1);
  assert.ok(result.obligations.length > 0);
});
