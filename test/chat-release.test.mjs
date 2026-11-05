import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Where a released chat sheet goes: the dependency-free decision region of the gesture adapter.
// Real pointers are in test/browser/full-chat-grabber.spec.ts.
const source = readFileSync('apps/app/src/prototype/chat-overlay-motion-adapter.ts', 'utf8');
const region = source.slice(source.indexOf('// chat-release:begin'), source.indexOf('// chat-release:end'));
assert.ok(region.length > 200, 'chat-release region is present');
const m = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(region, { mode: 'transform' })).toString('base64'));

const release = (height, options = {}) => m.chatRelease({ mode: 'sheet', direction: 'down', height, floor: 90, full: 915, flick: false, ...options });

test('an open sheet rests where it is released, in either direction', () => {
  for (const direction of ['up', 'down']) for (const height of [211, 400, 794])
    assert.deepEqual(release(height, { direction }), { chat: 'sheet', height });
});

test('a release near the collapsed form collapses and near the top goes full screen', () => {
  for (const direction of ['up', 'down']) {
    assert.deepEqual(release(210, { direction }), { chat: 'hidden' });
    assert.deepEqual(release(795, { direction }), { chat: 'full' });
  }
});

test('a flick on the sheet jumps to the end it points at, wherever it was released', () => {
  assert.deepEqual(release(400, { direction: 'up', flick: true }), { chat: 'full' });
  assert.deepEqual(release(400, { direction: 'down', flick: true }), { chat: 'hidden' });
});

test('from the collapsed form a pull up opens and a pull down dismisses', () => {
  const input = { mode: 'input', direction: 'up' };
  assert.deepEqual(release(400, input), { chat: 'sheet', height: 400 });
  assert.deepEqual(release(122, input), { chat: 'sheet' }, 'a short pull opens at the remembered height');
  assert.deepEqual(release(400, { ...input, flick: true }), { chat: 'sheet' });
  assert.deepEqual(release(850, input), { chat: 'full' });
  assert.deepEqual(release(0, { mode: 'input', direction: 'down' }), { chat: 'hidden' });
});

test('on a short screen the zones shrink and still leave room to rest', () => {
  assert.deepEqual(release(195, { full: 300 }), { chat: 'sheet', height: 195 });
  assert.deepEqual(release(120, { full: 300 }), { chat: 'hidden' });
  assert.deepEqual(release(260, { full: 300 }), { chat: 'full' });
});

test('release speed comes from the end of the drag and is zero after a hold', () => {
  const brisk = [{ y: 600, t: 0 }, { y: 500, t: 50 }, { y: 400, t: 100 }];
  assert.equal(m.releaseVelocity(brisk, 110), 2);
  assert.equal(m.releaseVelocity(brisk, 400), 0, 'the finger stopped before lifting');
  assert.equal(m.releaseVelocity([{ y: 400, t: 100 }, { y: 600, t: 150 }], 155), -4);
  assert.equal(m.releaseVelocity([{ y: 400, t: 0 }], 5), 0);
  assert.equal(m.releaseVelocity([], 5), 0);
});
