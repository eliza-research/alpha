import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {scheduledTaskControlsFixture} from './fixtures/scheduled-task-controls.mjs';
import {checkScheduledTaskControls} from '../specs/quint/refinement/application/scheduled-task-controls.mjs';

for (const result of ['wrong-id', 'missing-id', 'wrong-skipped-id']) {
  test(`a fire receipt with ${result} leaves the exact request unconfirmed`, async () => {
    const fixture = await scheduledTaskControlsFixture();
    fixture.open();
    fixture.click('Run now');
    fixture.confirm();
    await fixture.wait();
    await fixture.answer(result);
    const state = fixture.observe();
    assert.equal(state.locked, true);
    assert.equal(state.message, 'Unknown');
    assert.equal(state.intents.length, 1);
    assert.equal(state.sends.length, 1);
  });
}

test('a terminal manual schedule offers only Reopen', async () => {
  const fixture = await scheduledTaskControlsFixture({kind: 'manual', status: 'completed'});
  fixture.open();
  assert.deepEqual(fixture.observe().actions.map(action => action.label), ['Reopen']);
});

test('a confirmed schedule absence closes detail even if an unrelated list failed', async () => {
  const fixture = await scheduledTaskControlsFixture();
  fixture.open();
  fixture.click('Run now');
  fixture.confirm();
  await fixture.wait();
  fixture.catalog('missing-partial');
  await fixture.answer('exact');
  assert.equal(fixture.observe().detail, false);
});

test('a failed schedule-source refresh retains detail with its changes disabled', async () => {
  const fixture = await scheduledTaskControlsFixture();
  fixture.open();
  fixture.catalog('failed');
  await fixture.refresh();
  const state = fixture.observe();
  assert.equal(state.detail, true);
  assert.ok(state.actions.length > 0);
  assert.ok(state.actions.every(action => action.disabled));
  assert.equal(state.sends.length, 0);
});

test('actual scheduled-task controls refine their reviewed request model', {timeout: scaledTimeout(60_000)}, async () => {
  const receipt = await checkScheduledTaskControls();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 20);
});
