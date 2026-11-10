import { test, expect } from '@playwright/test';
import { returnToApps } from './app-navigation';
import { calendarUnavailable, failBrowserCalendarReads, openBrowserCalendar, restoreBrowserCalendarReads } from './helpers/browser-calendar';
import { installHomeCalendar, refreshHomeCalendar } from './helpers/home-calendar';
// Development lane. The development profile's inbox reports through the same attention summary a
// mail provider adapter uses, which exercises the connected Home state; the calendar failure is a
// real browser-calendar read failure. home-attention.production.spec.ts covers the flag-off build.

// Archived and deleted unread rows do not count, and reading the visible one clears the count for good.
test('Home attention opens the local Inbox and tracks unread mail through reload', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('alpha.dev.app.inbox')) localStorage.setItem('alpha.dev.app.inbox', JSON.stringify({ mails: [{ id: 'visible', name: 'Reader', ini: 'R', email: 'reader@example.test', acct: 'personal', k: 1, time: 'Now', unread: true, subj: 'Visible unread', body: 'Local body' }, { id: 'archived', name: 'Reader', ini: 'R', acct: 'personal', unread: true, arch: true, subj: 'Archived unread' }, { id: 'deleted', name: 'Reader', ini: 'R', acct: 'personal', unread: true, del: true, subj: 'Deleted unread' }], sent: [], localDrafts: [] })); });
  await page.goto('/?mode=dev');
  const home = page.getByRole('region', { name: 'Home', exact: true });
  const attention = home.getByRole('button', { name: 'Open Inbox: 1 unread email', exact: true });
  await expect(attention).toContainText('1');
  await attention.click();
  await page.getByRole('button', { name: 'Unread, Reader, Visible unread', exact: true }).click();
  await expect(page.getByText('Local body', { exact: true }).last()).toBeVisible();
  await returnToApps(page);
  await expect(home.locator('[data-alpha-home-inbox]')).toHaveCount(0);
  await page.reload();
  await expect(home.locator('[data-alpha-home-inbox]')).toHaveCount(0);
  await home.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'inbox');
});

test('a failed device-calendar read leaves no stale Home event and recovers in Calendar', async ({ page }) => {
  test.slow(); // Chooses the browser calendar in Calendar first.
  await page.goto('/');
  // Home's agenda reads the calendar chosen in Calendar (Agent Calendar by default); this case is
  // about a device-calendar read failure, so it chooses the test-mocks browser calendar first.
  await openBrowserCalendar(page);
  await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts'),begin=Date.now()+3600000;await new BrowserCalendar().save({calendarId:'local',title:'Recoverable browser event',begin,end:begin+1800000,allDay:false,creationId:crypto.randomUUID()});window.dispatchEvent(new Event('alpha:calendar-preferences'));});
  await returnToApps(page);
  const card = page.locator('[data-alpha-home-calendar]');
  await expect(card).toContainText('Recoverable browser event');
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    const proto = BrowserCalendar.prototype as any;
    (window as any).__calendarList = proto.list;
    proto.list = () => Promise.reject(Error('Calendar storage unavailable'));
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
  await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    (BrowserCalendar.prototype as any).list = (window as any).__calendarList;
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
  await expect(card).toContainText('Recoverable browser event');
  await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
  await expect(page.getByText('Recoverable browser event',{exact:true}).first()).toBeVisible();
});

test('a failed Agent Calendar read leaves no stale Home event and retries when Calendar opens', async ({ page }) => {
  await page.goto('/');const event={title:'Recoverable agent event',startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+5400000).toISOString()};await installHomeCalendar(page,event);
  const card = page.locator('[data-alpha-home-calendar]');
  await expect(card).toContainText(event.title);
  await refreshHomeCalendar(page,{fail:true});
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).homeCalendarFixture.fail=false);
  // Opening Calendar is the explicit retry and reads the agent calendar again.
  const before = await page.evaluate(()=>(window as any).homeCalendarFixture.requests.length);
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
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
  const order = await home.locator('[data-alpha-home-layout] > .scr').first().getByRole('button').evaluateAll(list => list.map(el => el.hasAttribute('data-alpha-home-inbox') ? 'inbox' : el.hasAttribute('data-alpha-home-brief') ? 'brief' : 'other'));
  expect(order.indexOf('brief')).toBe(order.indexOf('inbox') + 1);
});
test('with only missed records the brief stays empty, and the attention items stay', async ({ page }) => {
  await page.goto('/?mode=dev');
  const home = page.getByRole('region', { name: 'Home', exact: true });
  await remember(page, [
    { cursor: 1, runId: 'run-missed', completedAt: new Date(Date.now() - 3_600_000).toISOString(), status: 'missed', output: { status: 'missed', text: 'The scheduled time was missed. No backlog was executed.' }, error: null },
    { cursor: 2, runId: 'run-unavailable', completedAt: new Date(Date.now() - 1_800_000).toISOString(), status: 'unavailable', output: { status: 'unavailable', text: 'The source was not available.' }, error: null }]);
  await expect(home.getByRole('button', { name: /^Open Inbox: \d+ unread emails?$/ })).toHaveCount(1);
  await expect(home.locator('[data-alpha-home-brief]')).toHaveCount(0);
  await expect(home).not.toContainText(/scheduled time was missed|Did not run/);
});
