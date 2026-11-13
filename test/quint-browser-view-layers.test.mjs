import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserViewLayers} from '../specs/quint/refinement/application/browser-view-layers.mjs';

test('the installed Browser view follows every BrowserViewLayers trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserViewLayers();
  console.log(JSON.stringify(receipt));
  assert.equal(receipt.traces, 51);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['toggleMenu', 'openTabs', 'closeTabs', 'openLibrary', 'showLibrary', 'closeLibrary', 'startEdit', 'escapeEdit', 'submitAddress', 'newTab', 'pick', 'closeCard', 'openFind', 'closeFind', 'popupOpened', 'fullscreen', 'back'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
