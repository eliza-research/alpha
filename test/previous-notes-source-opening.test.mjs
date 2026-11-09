import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPreviousNotesSourceOpening} from '../specs/quint/refinement/application/previous-notes-source-opening.mjs';
import {previousNotesSourceOpeningFixture} from './fixtures/previous-notes-source-opening.mjs';

test('a retired Previous Notes open cannot report success from a later epoch', async () => {
  const f = previousNotesSourceOpeningFixture();
  await f.choose('legacy');
  await f.choose('canonical');
  assert.deepEqual(f.inspect(), {toasts: [], cancellations: ['selected', 'selected'], rows: [], aborts: [1]});
  await f.choose('legacy');
  await f.settle(3, 'saved');
  await f.settle(3, 'target');
  await f.settle(1, 'saved');
  const state = f.observe();
  assert.equal(state.rows, 3);
  assert.deepEqual(state.finished, [[2, true], [3, true], [1, false]]);
});

test('Previous Notes source selection and read admission refine their Quint model', {timeout: 120000}, async () => {
  const receipt = await checkPreviousNotesSourceOpening([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 14);
});
