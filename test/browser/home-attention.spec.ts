import { test, expect } from '@playwright/test';
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

test('a failed calendar read shows the retry state instead of neutral copy, then recovers', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-alpha-layer="home"] .scr > button').first();
  await expect(card).toContainText('No upcoming events');
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    const proto = BrowserCalendar.prototype as any;
    (window as any).__calendarList = proto.list;
    proto.list = () => Promise.reject(Error('Calendar storage unavailable'));
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  await expect(card).toHaveAttribute('aria-label', 'Open your calendar');
  await expect(card).toContainText('Calendar unavailable');
  await expect(card).not.toContainText(/from this browser/);
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    (BrowserCalendar.prototype as any).list = (window as any).__calendarList;
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  await expect(card).toContainText('No upcoming events');
});

// A retained brief sits beside the attention items without replacing them.
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
  const order = await home.locator('[data-alpha-home-layout] > .scr').first().getByRole('button').evaluateAll(list => list.map(el => el.hasAttribute('data-alpha-home-inbox') ? 'inbox' : el.hasAttribute('data-alpha-home-brief') ? 'brief' : 'other'));
  expect(order.indexOf('brief')).toBe(order.indexOf('inbox') + 1);
});
