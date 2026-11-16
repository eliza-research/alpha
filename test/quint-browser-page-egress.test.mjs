import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkBrowserPageEgress} from '../specs/quint/refinement/application/browser-page-egress.mjs';

test('the installed Browser page actions follow every BrowserPageEgress trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkBrowserPageEgress();
  console.log(JSON.stringify(receipt));
  assert.equal(receipt.traces, 56);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['startLoad', 'commit', 'loadFails', 'hide', 'show', 'leaveBrowser', 'returnToBrowser', 'startShare', 'shareDelayEnds', 'nativeShareSettles', 'shareEmail', 'copyLink', 'toggleBookmark'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});

test('mounted web Browser bookmarks follow BrowserPageEgress at the real storage boundary', {timeout: scaledTimeout(240000)}, async () => {
  const {checkBrowserWebBookmarks} = await import('../specs/quint/refinement/application/browser-web-bookmarks.mjs');
  const receipt = await checkBrowserWebBookmarks(fileURLToPath(import.meta.url));
  assert.equal(receipt.traces, 3);
  assert.equal(receipt.checkpoints, 13);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
});
