import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkRoomHandlerQueueRefinement} from '../specs/quint/legacy/core/check-room-handler-queue-refinement.mjs';

test('current room queue follows both translated ownership and admission profiles', async () => {
  const receipts = await checkRoomHandlerQueueRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => [receipt.passed, receipt.traces, receipt.checkpoints]), [
    [true, 3, 50],
    [true, 1, 22],
  ]);
});
