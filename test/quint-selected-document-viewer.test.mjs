import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSelectedDocumentViewer} from '../specs/quint/refinement/application/selected-document-viewer.mjs';

test('the selected document preview follows every SelectedDocumentViewer trace', {timeout: 240000}, async () => {
  const receipt = await checkSelectedDocumentViewer();
  assert.equal(receipt.traces, 48);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['openViewer', 'closeViewer', 'closeAgain', 'back', 'hide', 'show', 'deviceChange'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
