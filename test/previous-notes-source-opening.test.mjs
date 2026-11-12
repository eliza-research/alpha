import assert from 'node:assert/strict';
import test from 'node:test';
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
