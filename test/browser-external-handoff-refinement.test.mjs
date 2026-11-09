import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserExternalHandoff} from '../specs/quint/refinement/application/browser-external-handoff.mjs';
import {browserExternalHandoffFixture} from './fixtures/browser-external-handoff.mjs';

test('a private approval cannot authorize dispatch after the same page is recommitted during presentation', async () => {
  const fixture = await browserExternalHandoffFixture({privateTab: true});
  await fixture.start();
  await fixture.update();
  await fixture.review(true);
  assert.equal(fixture.observe().phase, 'present');
  fixture.navigate(true);
  await fixture.update();
  assert.deepEqual(fixture.observe().launches, []);
  assert.deepEqual(fixture.observe().errors, ['changed']);
  await fixture.update();
});

test('a normal external handoff cannot dispatch after its view leaves during presentation', async () => {
  const fixture = await browserExternalHandoffFixture();
  await fixture.start();
  assert.equal(fixture.observe().phase, 'present');
  fixture.leave(true);
  await fixture.update();
  assert.deepEqual(fixture.observe().launches, []);
  assert.deepEqual(fixture.observe().errors, ['changed']);
  await fixture.update();
});

test('returning to the same tab cannot revive the preceding Browser visit handoff', async () => {
  const fixture = await browserExternalHandoffFixture({privateTab: true});
  await fixture.start();
  await fixture.update();
  await fixture.review(true);
  fixture.leave(true);
  fixture.leave(false);
  await fixture.update();
  assert.deepEqual(fixture.observe().launches, []);
  assert.deepEqual(fixture.observe().errors, ['changed']);
  await fixture.update();
});

test('a virtual lock cannot dispatch an external browser behind the lock screen', async () => {
  const fixture = await browserExternalHandoffFixture();
  await fixture.start();
  fixture.lock(true);
  await fixture.update();
  assert.deepEqual(fixture.observe().launches, []);
  assert.deepEqual(fixture.observe().errors, ['changed']);
  await fixture.update();
});

test('actual browser external dispatch refines the exact page handoff model', {timeout: 120000}, async () => {
  const receipt = await checkBrowserExternalHandoff([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 16);
});
