import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {compilePhotosWindow} from '../specs/quint/refinement/application/photos-window.mjs';
import {checkPhotosOwnedAlbumDialog, createOwnedAlbumFixture} from '../specs/quint/refinement/application/photos-owned-album-dialog.mjs';
import {tick} from '../specs/quint/refinement/application/support.mjs';

const sources = [fileURLToPath(import.meta.url)];
const fixture = async () => createOwnedAlbumFixture(await compilePhotosWindow(sources));

test('a retained save cannot rename the replacement album', async () => {
  const t = await fixture();
  try {
    const old = await t.open('a');
    old.close();
    await t.open('b');
    old.save();
    await tick();
    assert.deepEqual(t.calls.map(call => call.payload), []);
  } finally {await t.close();}
});

test('retained name and close controls cannot act on the replacement dialog', async () => {
  const t = await fixture();
  try {
    const old = await t.open('a');
    old.close();
    await t.open('b');
    old.onName({target: {value: 'stale'}});
    assert.equal((await t.f.render()).am?.name, 'B');
    old.close();
    assert.equal((await t.f.render()).am?.name, 'B');
  } finally {await t.close();}
});

test('a retained save cannot dispatch after the same dialog enters Delete confirmation', async () => {
  const t = await fixture();
  try {
    const old = await t.open('a');
    old.askDelete();
    assert.equal((await t.f.render()).am.confirming, true);
    old.save();
    await tick();
    assert.deepEqual(t.calls.map(call => call.payload), []);
  } finally {await t.close();}
});

test('rendered Photos album controls refine scoped mutation admission and settlement', {timeout: 180_000}, async () => {
  const receipt = await checkPhotosOwnedAlbumDialog(sources);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 10);
});
