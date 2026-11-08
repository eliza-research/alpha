import assert from 'node:assert/strict';
import test from 'node:test';
import {checkFactWriteDedupeRefinement} from '../specs/quint/legacy/core/check-fact-write-dedupe-refinement.mjs';

test('real AgentRuntime and PGlite refine both fact-write dedupe profiles', async () => {
  const {receipts, sourceBoundaries, obligations} = await checkFactWriteDedupeRefinement();
  assert.deepEqual(receipts.map(receipt => [receipt.model, receipt.traces]), [
    ['CoreFactWriteDedupe', 6], ['CoreFactWriteDedupePrefilled', 6],
  ]);
  assert.ok(receipts.every(receipt => receipt.driverInputsBound && receipt.observedFields.includes('observed.seen')));
  assert.deepEqual(sourceBoundaries, {
    pool: [{newerCount: 119, reused: true, rows: 1}, {newerCount: 120, reused: false, rows: 2}],
    separateRuntimeRows: 2, failureReleasesTail: true, independentRoomWrites: true,
  });
  assert.ok(obligations.length > 0);
});
