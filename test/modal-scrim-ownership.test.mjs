import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {observeModalScrim} from './fixtures/modal-scrim-chromium.mjs';

test('a modal retires an older raised-composer scrim press and its compatibility fallback', {timeout:scaledTimeout(60000)}, async () => {
  const rows = await observeModalScrim();
  const uninterrupted = rows.filter(row => row.name.startsWith('uninterrupted') || row.name.startsWith('unrelated'));
  for (const row of uninterrupted) {
    assert.equal(row.held.chat, 'input', row.name);
    assert.equal(row.afterWait.chat, 'hidden', row.name+' lowers the dock');
    assert.equal(row.afterWait.press, null, row.name);
  }
  assert.equal(rows.find(row=>row.name==='uninterrupted-mouse').released.chat, 'hidden');
  const touch = rows.find(row=>row.name==='uninterrupted-touch').released;
  assert.equal(touch.chat, 'hidden');
  assert.ok(touch.seen.some(event=>event.trusted && event.pointerType==='touch'));
  assert.equal(rows.find(row=>row.name==='uninterrupted-compatibility-click').compatibility.chat, 'hidden');
  assert.ok(rows.find(row=>row.wrongPointer).wrongPointer.press?.released, 'A reported wrong pointer cannot consume the release');
  const unrelated = rows.find(row=>row.name==='unrelated-nonmodal-timeout');
  assert.ok(unrelated.opened.press && !unrelated.opened.topLayer, 'Unrelated inert and nonmodal open preserve the press');
  const modals = rows.filter(row => !uninterrupted.includes(row) && row.opened);
  for (const row of modals) {
    assert.equal(row.opened.active, 'modal-target', row.name);
    assert.equal(row.opened.inputFocused, false, row.name);
    assert.equal(row.afterClose.activations, 0, row.name);
    assert.equal(row.afterClose.draft, 'Retain this draft', row.name);
  }
  assert.deepEqual(modals.map(row => ({
    name: row.name, pressRetired: row.opened.press === null, captureReleased: !row.opened.captured,
    chatAfterWait: row.afterWait.chat, chatAfterClose: row.afterClose.chat,
  })), modals.map(({name}) => ({name, pressRetired:true, captureReleased:true,
    chatAfterWait:'input', chatAfterClose:'input'})));
  for (const row of rows.filter(row=>row.sameTask)) {
    assert.equal(row.sameTask.press, null, row.name);
    assert.equal(row.afterWait.chat, 'input', row.name);
    assert.equal(row.afterWait.activations, 0, row.name);
  }
  const fresh = rows.find(row=>row.fresh).fresh;
  assert.equal(fresh.chat, 'hidden', 'A fresh pointer owns its own release');
  assert.equal(fresh.press, null);
  const replacement = rows.find(row=>row.rearmed);
  assert.equal(replacement.afterWait.press?.id, 7);
  assert.ok(replacement.afterWait.press?.released, 'The retired deadline cannot settle a newer press with the same pointer ID');
  assert.equal(replacement.fresh.chat, 'hidden');
  assert.equal(replacement.fresh.press, null);
});
