// The accessibility sweep (MVP-48, renderer part) must keep visiting every retained view. A view
// added to the MVP without a state in the sweep, or a state dropped from it, fails here instead
// of quietly leaving a screen unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocking, format } from './browser/accessibility-audit.ts';

test('both sweeps fail on a cut app title and allow a clamped preview', () => {
  const found = format([
    { rule: 'text-truncated', target: '[app] <h1 class="title" data-alpha-app-title="">Calendar and reminders</h1>' },
    { rule: 'text-truncated', target: '[app] <p class="preview">A long message preview that ends in an ellipsis</p>' },
    { rule: 'clipped', target: '[app] <button>Save</button>' },
  ]);
  assert.deepEqual(blocking(found), [found[0], found[2]]);
});

