import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBookmarksHydration} from '../specs/quint/refinement/application/bookmarks-hydration.mjs';

test('the browser adapter bookmark queue follows every BookmarksHydration trace', {timeout: 240000}, async () => {
  const receipt = await checkBookmarksHydration();
  assert.equal(receipt.traces, 48);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['requestRefresh', 'requestSave', 'readSettles', 'writeSettles', 'externalChange', 'damage', 'repair', 'dispose'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
