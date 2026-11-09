import assert from 'node:assert/strict';
import test from 'node:test';
import {shadeNoticeQuestionFixture} from './fixtures/shade-notice-question.mjs';

test('an uninterrupted own notice question reaches the draft after its dialog closes', async () => {
  const f = shadeNoticeQuestionFixture();
  try {
    f.ask('a');await f.approve();
    assert.equal(f.requests.length, 1);
    await f.finish(0);
    assert.match(f.drafts[0], /Saved a/);
  } finally {f.close();}
});

for (const condition of ['successor', 'reopened shade', 'lock', 'foreground loss']) {
  test(`an old own notice read stays silent after ${condition}`, async () => {
    const f = shadeNoticeQuestionFixture();
    try {
      f.ask('a');await f.approve();
      assert.equal(f.requests.length, 1);
      if (condition === 'successor') f.ask('b');
      if (condition === 'reopened shade') {await f.set({shade: false});await f.set({shade: true});}
      if (condition === 'lock') await f.set({screen: 'lock'});
      if (condition === 'foreground loss') {await f.visibility(true);await f.visibility(false);}
      await f.finish(0);
      assert.deepEqual(f.drafts, []);
      assert.deepEqual(f.toasts, []);
      if (condition === 'successor') assert.match(f.content(), /Saved b/);
    } finally {f.close();}
  });
}
