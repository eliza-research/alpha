import assert from 'node:assert/strict';
import test from 'node:test';
import {retainedReminderTapFixture} from './fixtures/retained-reminder-tap.mjs';
import {checkRetainedReminderTapAdmission} from '../specs/quint/refinement/application/retained-reminder-tap-admission.mjs';

test('the retained reminder is consumed after an uninterrupted exact detail render', async () => {
  const f = await retainedReminderTapFixture();
  await f.deliver();
  assert.equal(f.observe().waiting, true);
  assert.deepEqual(f.observe().attempts, []);
  await f.commit();
  assert.deepEqual(f.observe().consumed, ['original-token']);
});

for (const [field, value] of [['chooser', true], ['sensitive', true], ['form', true], ['foreground', false]]) {
  test(`the retained reminder survives ${field} changing during render`, async () => {
    const f = await retainedReminderTapFixture();
    await f.deliver();
    await f.set(field, value);
    assert.equal(f.observe().detail, true);
    await f.commit();
    assert.deepEqual(f.observe().attempts, []);
    assert.equal(f.observe().pending, 'original-token');
  });
}

test('the retained reminder adapter refines the Quint render admission boundary', async () => {
  const receipt = await checkRetainedReminderTapAdmission();
  assert.equal(receipt.traces, 8);
});
