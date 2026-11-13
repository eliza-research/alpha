import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {notesTrashReadFixture} from './fixtures/notes-trash-read.mjs';
import {checkNotesTrashReadPublication} from '../specs/quint/refinement/application/notes-trash-read-publication.mjs';

test('a superseded Trash read cannot repaint a newer result', async () => {
  const f = await notesTrashReadFixture();
  f.chooseSource('legacy');
  f.signal();
  f.signal();
  await f.complete(2, 'second');
  await f.complete(1, 'first');
  assert.deepEqual(f.observe().rows, ['second']);
  assert.equal(f.observe().writes, 1);
});

test('a held Trash error cannot publish after a source switch and return', async () => {
  const f = await notesTrashReadFixture();
  f.chooseSource('legacy');
  f.signal();
  f.chooseSource('canonical');
  f.chooseSource('legacy');
  await f.complete(1, 'error');
  assert.equal(f.observe().error, false);
  assert.equal(f.observe().writes, 0);
});

test('actual Previous Notes Trash read publication refines Quint', {timeout: scaledTimeout(60_000)}, async () => {
  const receipt = await checkNotesTrashReadPublication();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 7);
});
