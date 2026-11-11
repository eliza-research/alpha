import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserTabLifecycle} from '../specs/quint/refinement/application/browser-tab-lifecycle.mjs';

test('the browser adapter tab code follows every BrowserTabLifecycle trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserTabLifecycle();
  assert.equal(receipt.traces, 71);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['hydrate', 'openTab', 'setEditing', 'pick', 'navigateStart', 'restoredShown', 'createSettles', 'navigateSettles', 'closeTab', 'nativeTabOpened', 'nativeTabClosed'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
