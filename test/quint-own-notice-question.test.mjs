import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, createDriver, runOwnNoticeQuestionReplay} from '../specs/quint/refinement/application/own-notice-question.mjs';

// OwnNoticeQuestion model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against reviewOwnNoticeQuestion and its review sheet in a JSDOM window.
test('the own-notification question review follows every OwnNoticeQuestion model trace', {timeout: 240000}, async () => {
  const receipt = await runOwnNoticeQuestionReplay();
  assert.equal(receipt.traces, 89);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['open', 'noticeChanged', 'dismiss', 'chooseCompose', 'abort', 'recheckSettles', 'consumeSettles'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});

// The model enables chooseCompose only for a current notification: the sheet itself refuses the
// hand-over of one that changed, stays open and asks nothing of the publisher.
test('choosing to compose for a changed notification leaves the review open and spends nothing', async () => {
  const driver = createDriver(compile());
  try {
    await driver.open(true); driver.noticeChanged(); await driver.chooseCompose();
    assert.deepEqual(driver.observe(), {phase: 'review', current: false, composing: false, ended: false, closedCalls: 0,
      consumed: 0, released: 0, composed: 0, report: 'none'});
  } finally { driver.close(); }
});
