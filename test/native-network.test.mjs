import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeNetwork} from '../apps/app/src/runtime/native-network.ts';

test('only an explicit native connected fact determines connectivity', async () => {
  for (const connected of [true, false]) assert.equal(await readNativeNetwork(async () => ({connected, internetValidated: !connected})), connected);
  for (const value of [undefined, null, {}, {internetValidated: false}, {connected: 'false'}, {wifiActive: false, cellularActive: false}]) {
    assert.equal(await readNativeNetwork(async () => value), undefined);
  }
});
test('failed and timed-out local observations stay unknown and do not wait for a late result', async () => {
  assert.equal(await readNativeNetwork(async () => {throw Error('Native bridge unavailable');}), undefined);
  let resolve;
  assert.equal(await readNativeNetwork(() => new Promise(done => {resolve = done;}), undefined, 1), undefined);
  resolve({connected: false});
});
test('cancellation settles promptly and a late native result cannot replace it', async () => {
  const controller = new AbortController(); let resolve;
  const pending = readNativeNetwork(() => new Promise(done => {resolve = done;}), controller.signal);
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  resolve({connected: true});
  let reads = 0;
  assert.throws(() => readNativeNetwork(async () => {reads++;}, controller.signal), {name: 'AbortError'});
  assert.equal(reads, 0);
});
