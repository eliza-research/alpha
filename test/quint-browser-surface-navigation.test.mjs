import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserSurfaceNavigation} from '../specs/quint/refinement/application/browser-surface-navigation.mjs';

test('the web browser surface follows every BrowserSurfaceNavigation trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserSurfaceNavigation();
  assert.equal(receipt.traces, 48);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['create', 'navigate', 'back', 'forward', 'reload', 'stop', 'frameLoad', 'close'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
