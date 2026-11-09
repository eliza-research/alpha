import assert from 'node:assert/strict';
import test from 'node:test';
import {notice, shadeRowCustodyFixture} from './fixtures/shade-row-custody.mjs';

async function loaded() {
  const fixture = shadeRowCustodyFixture();
  await fixture.poll();
  await fixture.finishPoll(1, [notice('a')]);
  fixture.capture(1);
  return fixture;
}

test('a held poll cannot publish into a later visit to the shade', async () => {
  const f = await loaded();
  await f.poll();
  f.set({shade: false});
  f.set({shade: true});
  await f.finishPoll(2, [notice('b')]);
  assert.deepEqual(f.observe().items.map(row => row.id), ['a']);
});

test('retained open and swipe handlers refuse a replaced exact row', async () => {
  const f = await loaded();
  await f.poll();
  await f.finishPoll(2, [notice('a', '2')]);
  await f.act(1, 'open', 'a');
  await f.act(1, 'dismiss', 'a');
  assert.deepEqual(f.observe().operations, []);
  assert.equal(f.observe().selection, null);
});

test('a retained Clear All cannot acquire newly rendered targets', async () => {
  const f = await loaded();
  await f.poll();
  await f.finishPoll(2, [notice('b')]);
  await f.act(1, 'clear');
  assert.deepEqual(f.observe().operations, []);
});

test('the locked or retired shade cannot dispatch a retained row', async () => {
  const f = await loaded();
  f.set({screen: 'lock'});
  await f.act(1, 'open', 'a');
  f.set({screen: 'home'});
  await f.act(1, 'open', 'a');
  assert.deepEqual(f.observe().operations, []);
});

test('a late clear result from a retired visit does not publish or refresh', async () => {
  const f = await loaded();
  await f.act(1, 'clear');
  f.set({shade: false});
  f.set({shade: true});
  await f.finishOperation(1, 'unavailable');
  assert.equal(f.observe().reads, 1);
  assert.deepEqual(f.observe().toasts, []);
});
