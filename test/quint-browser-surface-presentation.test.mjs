import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserSurfacePresentation} from '../specs/quint/refinement/application/browser-surface-presentation.mjs';

test('the browser adapter page presentation follows every BrowserSurfacePresentation trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserSurfacePresentation();
  assert.equal(receipt.traces, 49);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['poll', 'withdraw', 'answer', 'forget', 'enterBrowser', 'leaveBrowser', 'setOverlay', 'setAppHidden', 'tabCreated', 'dispose'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
