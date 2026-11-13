import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

async function review(fixture) {
  await fixture.settings();
  const review = fixture.button('Review saved events');
  await review.waitFor();
  return review;
}
async function holdReview(fixture, button, stage) {
  const id = await fixture.invoke('hold', stage);
  await button.click();
  await fixture.page.waitForFunction(id => window.quintCalendar.held(id), id);
  return id;
}
async function complete(fixture, gate, attempt) {
  await fixture.invoke('release', gate);
  await fixture.page.waitForFunction(attempt => !!window.quintCalendar.snapshot().attempts[attempt - 1]?.result, attempt);
  return fixture.snapshot();
}
const home = fixture => fixture.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
const back = fixture => fixture.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));

test('mounted saved-event approval owns the exact Calendar review and Settings visit', {timeout: scaledTimeout(240_000)}, async t => {
  const browser = await startMountedCalendar();
  try {
    await t.test('same-account replacement cannot finish the old marker admission', async () => {
      const f = await browser.page({legacyTitle: 'Earlier event A'});
      try {
        const button = await review(f);
        const raw = await f.invoke('raw');
        const gate = await holdReview(f, button, 'marker-read');
        await f.invoke('switchPort', 'owner-a', 'session-b');
        await f.status('transition-required', 'session-b');
        const before = await f.snapshot();
        const late = await complete(f, gate, 1);
        assert.equal(late.writes.length, 0, 'Retired session cannot dispatch a retention marker');
        assert.deepEqual(late.notices, before.notices, 'Retired session cannot publish into replacement Settings');
        assert.deepEqual(late.refreshes, before.refreshes);
        assert.equal(await f.invoke('raw'), raw);
        await button.click();
        await f.status('ready', 'session-b');
        const accepted = await f.snapshot();
        assert.equal(accepted.writes.length, 1);
        assert.equal(accepted.writes[0].committed, true);
        assert.equal(accepted.writes[0].value.fingerprint, accepted.fingerprint);
        assert.equal(await f.invoke('raw'), raw);
      } finally { await f.close(); }
    });
    await t.test('late old completion leaves a newer owner attempt active', async () => {
      const f = await browser.page({legacyTitle: 'Earlier event B'});
      try {
        const button = await review(f);
        const first = await holdReview(f, button, 'marker-read');
        await f.invoke('switchPort', 'owner-b', 'session-b');
        await f.status('transition-required', 'session-b');
        const second = await holdReview(f, button, 'marker-read');
        const before = await f.snapshot();
        const late = await complete(f, first, 1);
        assert.deepEqual(late.notices, before.notices, 'Old owner error stays off replacement Settings');
        assert.deepEqual(late.refreshes, before.refreshes);
        await button.click();
        assert.equal((await f.snapshot()).attempts.length, 2, 'Old completion cannot release the new admission');
        await complete(f, second, 2);
        await f.status('ready', 'session-b');
        assert.equal((await f.snapshot()).writes.length, 1);
      } finally { await f.close(); }
    });
    await t.test('Back retires the visit even when the same Settings page returns', async () => {
      const f = await browser.page({legacyTitle: 'Earlier event C'});
      try {
        const button = await review(f);
        const gate = await holdReview(f, button, 'marker-read');
        await back(f);
        await button.waitFor({state: 'hidden'});
        await f.button('Calendar').click();
        await button.waitFor();
        const before = await f.snapshot();
        const late = await complete(f, gate, 1);
        assert.equal(late.writes.length, 0, 'Retired view cannot dispatch a marker after reentry');
        assert.deepEqual(late.refreshes, before.refreshes);
        assert.deepEqual(late.notices, before.notices);
        await button.click();
        await f.status('ready', 'session-a');
      } finally { await f.close(); }
    });
    await t.test('a committed marker stays stored while the replaced caller settles silently', async () => {
      const f = await browser.page({legacyTitle: 'Earlier event D'});
      try {
        const button = await review(f);
        const raw = await f.invoke('raw');
        const gate = await holdReview(f, button, 'committed-marker');
        assert.equal((await f.snapshot()).markers.length, 1);
        await f.invoke('switchPort', 'owner-b', 'session-b');
        await f.status('transition-required', 'session-b');
        const before = await f.snapshot();
        const late = await complete(f, gate, 1);
        assert.deepEqual(late.notices, before.notices, 'A stale committed result cannot publish a new toast');
        assert.deepEqual(late.refreshes, before.refreshes);
        assert.deepEqual(late.markers, before.markers);
        assert.equal(await f.invoke('raw'), raw);
        await home(f);
      } finally { await f.close(); }
    });
  } finally { await browser.close(); }
});
