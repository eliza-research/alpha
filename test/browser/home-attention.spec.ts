import { test, expect } from '@playwright/test';
import { returnToApps } from './app-navigation';
import { openBrowserCalendar } from './helpers/browser-calendar';
import { installHomeCalendar, refreshHomeCalendar } from './helpers/home-calendar';
// Development lane. The development profile's inbox reports through the same attention summary a
// mail provider adapter uses, which exercises the connected Home state; the calendar failure is a
// real browser-calendar read failure. home-attention.production.spec.ts covers the flag-off build.

test('the explicit development fixture reports unread email and opens Inbox', async ({ page }) => {
  await page.goto('/?mode=dev');
  const home=page.getByRole('region',{name:'Home',exact:true});
  await expect(home.getByRole('button',{name:/^Open Inbox: \d+ unread emails?$/})).toHaveCount(1);
  await home.getByRole('button',{name:'Inbox',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','inbox');
});

test('a failed calendar read draws no card instead of neutral copy, then recovers', async ({ page }) => {
  test.slow(); // Chooses the browser calendar in Calendar first.
  await page.goto('/');
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts'), date = new Date(Date.now() + 2 * 86400000); date.setHours(9, 30, 0, 0);
    await new BrowserCalendar().save({ calendarId: 'local', title: 'Synthetic attention event', begin: date.getTime(), end: date.getTime() + 1800000, allDay: false, creationId: crypto.randomUUID() });
  });
  await page.reload();
  // Home's agenda reads the calendar chosen in Calendar (Agent Calendar by default); this case is
  // about a device-calendar read failure, so it chooses the test-mocks browser calendar first.
  await openBrowserCalendar(page);
  await returnToApps(page);
  const home = page.getByRole('region', { name: 'Home', exact: true }), card = home.locator('[data-alpha-home-calendar]');
  await expect(card).toContainText('Synthetic attention event');
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    const proto = BrowserCalendar.prototype as any;
    (window as any).__calendarList = proto.list;
    proto.list = () => Promise.reject(Error('Calendar storage unavailable'));
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  // A failed read has nothing to show (docs/daily-overview.md): no card, and no failure copy.
  await expect(card).toHaveCount(0);
  await expect(home.locator('[data-alpha-home-date]')).toBeVisible();
  await expect(home).not.toContainText(/Calendar unavailable|from this browser/);
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    (BrowserCalendar.prototype as any).list = (window as any).__calendarList;
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  await expect(card).toContainText('Synthetic attention event');
});

test('a failed Agent Calendar read draws no card and recovers only after Calendar is opened', async ({ page }) => {
  await page.goto('/');
  const event = { title: 'Synthetic agent attention event', startAt: new Date(Date.now() + 86400000).toISOString(), endAt: new Date(Date.now() + 90000000).toISOString() };
  await installHomeCalendar(page, event);
  const home = page.getByRole('region', { name: 'Home', exact: true }), card = home.locator('[data-alpha-home-calendar]');
  await expect(card).toContainText(event.title);
  await refreshHomeCalendar(page,{fail:true});
  await expect(card).toHaveCount(0);
  await expect(home).not.toContainText(/Calendar unavailable|Nothing planned|No upcoming|from this browser/);
  await page.evaluate(()=>(window as any).homeCalendarFixture.fail=false);
  // Opening Calendar, here from its app tile, is the retry: it reads the agent calendar again.
  const before = await page.evaluate(()=>(window as any).homeCalendarFixture.requests.length);
  await home.locator('[data-alpha-home-apps]').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
  await expect.poll(()=>page.evaluate(()=>(window as any).homeCalendarFixture.requests.length)).toBeGreaterThan(before);
  await returnToApps(page);
  await expect(card).toContainText(event.title);
});

// A retained brief sits beside the attention items without replacing them; a record of an
// occurrence that did not run is never shown as a brief.
const remember = (page: import('@playwright/test').Page, rows: unknown[]) => page.evaluate(async rows => { (await import('/src/runtime/hosted-digests.ts')).rememberRetainedDigests(rows as any, 'Synthetic agent'); }, rows);
test('a retained brief appears next to the attention items, which keep their count', async ({ page }) => {
  await page.goto('/?mode=dev');
  const home = page.getByRole('region', { name: 'Home', exact: true });
  const attention = home.getByRole('button', { name: /^Open Inbox: \d+ unread emails?$/ });
  await expect(attention).toHaveCount(1);
  const name = await attention.getAttribute('aria-label');
  await remember(page, [{ cursor: 1, runId: 'run-brief', completedAt: new Date(Date.now() - 3_600_000).toISOString(), status: 'succeeded', output: { summary: 'Synthetic brief beside attention.' } }]);
  const brief = home.locator('[data-alpha-home-brief]');
  await expect(brief).toContainText('Latest brief');
  await expect(brief).toContainText('Synthetic brief beside attention.');
  // The attention card is unchanged and the brief card follows it in the same row.
  await expect(attention).toHaveAttribute('aria-label', name!);
  const order = await home.locator('.home-card-row').getByRole('button').evaluateAll(list => list.map(el => el.hasAttribute('data-alpha-home-inbox') ? 'inbox' : el.hasAttribute('data-alpha-home-brief') ? 'brief' : 'other'));
  expect(order.indexOf('brief')).toBe(order.indexOf('inbox') + 1);
});
test('with only missed records there is no brief card, and the attention items stay', async ({ page }) => {
  await page.goto('/?mode=dev');
  const home = page.getByRole('region', { name: 'Home', exact: true });
  await remember(page, [
    { cursor: 1, runId: 'run-missed', completedAt: new Date(Date.now() - 3_600_000).toISOString(), status: 'missed', output: { status: 'missed', text: 'The scheduled time was missed. No backlog was executed.' }, error: null },
    { cursor: 2, runId: 'run-unavailable', completedAt: new Date(Date.now() - 1_800_000).toISOString(), status: 'unavailable', output: { status: 'unavailable', text: 'The source was not available.' }, error: null }]);
  await expect(home.getByRole('button', { name: /^Open Inbox: \d+ unread emails?$/ })).toHaveCount(1);
  await expect(home.locator('[data-alpha-home-brief]')).toHaveCount(0);
  await expect(home).not.toContainText(/Latest brief|scheduled time was missed|Did not run/);
});
