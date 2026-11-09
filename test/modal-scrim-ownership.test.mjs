import assert from 'node:assert/strict';
import test from 'node:test';
import {observeModalScrim} from './fixtures/modal-scrim-chromium.mjs';

test('a modal retires an older raised-composer scrim press and its compatibility fallback', {timeout:60000}, async () => {
  const rows = await observeModalScrim();
  const uninterrupted = rows.find(row => row.name === 'uninterrupted-delayed-click');
  assert.equal(uninterrupted.held.chat, 'input');
  assert.equal(uninterrupted.afterWait.chat, 'hidden', 'An uninterrupted compatibility release still lowers the dock');
  assert.equal(uninterrupted.afterWait.press, null);
  const modals = rows.filter(row => row !== uninterrupted);
  for (const row of modals) {
    assert.equal(row.opened.active, 'modal-target', row.name);
    assert.equal(row.afterClose.activations, 0, row.name);
    assert.equal(row.afterClose.draft, 'Retain this draft', row.name);
  }
  assert.deepEqual(modals.map(row => ({
    name: row.name, pressRetired: row.opened.press === null, captureReleased: !row.opened.captured,
    chatAfterWait: row.afterWait.chat, chatAfterClose: row.afterClose.chat,
  })), modals.map(({name}) => ({name, pressRetired:true, captureReleased:true,
    chatAfterWait:'input', chatAfterClose:'input'})));
});
