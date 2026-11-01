import {openRetainedCalendarSource} from './helpers/browser-calendar';
import {installCanonicalCalendarFixture} from './helpers/canonical-calendar';
// J04 on the FLAG-OFF bundle with the Android bridge stubbed: an event read from the device
// CalendarService, its location handed to Maps with no Maps provider configured, an explicit hand-off to
// an installed map app, and Back to event restoring that same event.
//
// The stub is flag-off-android.ts, read-only; this file adds a location to its provider rows and
// the DailyApps capabilities/perform methods through one more init script at the same boundary.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The stub is not
// CalendarProvider, DailyAppsPlugin, an installed map app, a WebView or a device. Whether a map app
// opens on a phone is device acceptance, not shown here.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const LOCATION = 'Pier 4, Harbour Road';
const TITLE = 'Ferry inspection';

/** Separate compatibility case for an older installation's retained native authority. */
async function openAndroidCalendars(page: Page) {
  await openRetainedCalendarSource(page, 'android-native');
}
const calendarReads=(page:Page)=>page.evaluate(()=>(window as any).canonicalCalendarAccessibility.requests as Array<{path:string;method:string}>);

/** Adds the event location and an installed map app (DailyApps.capabilities/perform) to the stub. */
async function mapsApp(page: Page, location: string) {
  await page.addInitScript(location => {
    const w = window as any, base = w.Capacitor, f = w.flagOff;
    const record = w.j04 = { performs: [] as unknown[], lists: [] as unknown[], capabilities: 0 };
    base.PluginHeaders = base.PluginHeaders.map((plugin: any) => plugin.name === 'DailyApps' ? { ...plugin, methods: [...plugin.methods, { name: 'capabilities', rtype: 'promise' }, { name: 'perform', rtype: 'promise' }] } : plugin);
    const native = base.nativePromise;
    base.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'DailyApps' && method === 'capabilities') { record.capabilities++; return { platform: 'android', actions: [{ action: 'maps', available: true, mode: 'intent' }] }; }
      if (plugin === 'DailyApps' && method === 'perform') { f.calls.push(plugin + '.' + method); record.performs.push(structuredClone(input)); return { status: 'opened' }; }
      const result = await native(plugin, method, input);
      if (plugin === 'AlphaCalendar' && method === 'list') { record.lists.push({ begin: input.begin, end: input.end }); if (result?.events) result.events = result.events.map((row: any) => ({ ...row, location })); }
      return result;
    };
  }, location);
}
const j04 = (page: Page) => page.evaluate(() => (window as any).j04 as { performs: unknown[]; lists: Array<{ begin: number; end: number }>; capabilities: number });

test('an event location opens unconfigured Maps, hands off to an installed map app only on tap, and Back to event restores the same event', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await fenceNetwork(page);
  // Two hours ahead, but always today: the Calendar list opens on today, so a run after 22:00 keeps the event on it.
  const begin = (() => { const now = new Date(), at = new Date(now); at.setHours(at.getHours() + 2, 0, 0, 0); if (at.getDate() !== now.getDate()) { at.setTime(now.getTime()); at.setHours(22, 0, 0, 0); } return at.getTime(); })();
  await flagOffAndroid(page);
  await mapsApp(page, LOCATION);
  await installCanonicalCalendarFixture(page,{eventTitle:TITLE,location:LOCATION,begin,end:begin+1_800_000});
  await residentHome(page);

  await button(page,'Calendar').click();
  await page.getByRole('button', { name: new RegExp(`^${TITLE},`) }).first().click();
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
  await button(page, LOCATION).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  await expect(page.getByRole('textbox', { name: 'Search places', exact: true })).toHaveValue(LOCATION);

  // No provider: the notice says so, and no route, ETA or Directions is invented.
  const maps = page.getByRole('region', { name: 'Maps' });
  await expect(maps.locator('[data-alpha-maps-status]')).toContainText(/Maps provider/);
  await expect(button(page, 'Directions')).toHaveCount(0);
  await expect(maps).not.toContainText(/\b\d+\s*min\b|\bETA\b|Arrive|route to/i);
  await expect(button(page, 'Back to event')).toBeVisible();

  // The hand-off is offered, but rendering, the capability read and Back never perform it.
  const handoff = button(page, 'Open in maps app');
  await expect(handoff).toBeVisible();
  expect((await j04(page)).performs).toEqual([]);
  expect((await j04(page)).capabilities).toBeGreaterThan(0);
  await handoff.click();
  await expect.poll(async () => (await j04(page)).performs).toEqual([{ action: 'maps', query: LOCATION }]);
  await expect(maps.locator('[data-alpha-maps-status] [role="status"]')).toHaveText('Opened in your maps app. Review the place there.');

  // Back to event reads that exact event again and restores it.
  const before = (await calendarReads(page)).length;
  await button(page, 'Back to event').click();
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'calendar');
  expect((await calendarReads(page)).slice(before).some(row=>{const url=new URL(row.path,'http://fixture.invalid');return row.method==='GET'&&url.pathname==='/api/lifeops/calendar/feed'&&Date.parse(url.searchParams.get('timeMin')!)===begin-1&&Date.parse(url.searchParams.get('timeMax')!)===begin+1;})).toBe(true);
  expect(await harness(page,f=>f.calendar.lists)).toBe(0);
  expect((await j04(page)).performs).toHaveLength(1);

  // Opening Maps again from the same event and reloading performs nothing more.
  await button(page, LOCATION).click();
  await expect(handoff).toBeVisible();
  expect((await j04(page)).performs).toHaveLength(1);
  // The record is per page load: after the reload nothing may perform the hand-off again.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', /.+/);
  await expect(handoff).toHaveCount(0);
  expect((await j04(page)).performs ?? []).toEqual([]);

  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign.filter(request => request.includes('10.0.2.2'))).toEqual([]);
  expect(foreign).toEqual([]);
});

// LOOP-B: a Calendar event drafted from a note keeps its link to the note on Android. Device calendar
// row ids are provider-assigned and reused, so the link is keyed by the creationId Alpha saves the
// event with, which the pinned reader returns on listed events (elizaOS/eliza#35912); the draft no
// longer warns that it will not link back. The draft is placed in the Calendar view's state as the note hand-off
// (voice-adapter draftFromNote) leaves it; the Keystore-encrypted note and retained audio that lead
// there are not stubbed here. Renderer evidence only.
test('a retained native-authority event draft from a note no longer says it will not link back; nothing is saved or linked before Save', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { calendar: { access: 'granted', calendars: [{ id: '7', name: 'Harbour team', account: 'owner@example.invalid' }], events: [] } });
  await residentHome(page);
  await openAndroidCalendars(page);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'calendar');
  const draft = (origin: boolean) => page.evaluate(origin => {
    const root = document.getElementById('root') as any, key = Object.keys(root).find(name => name.startsWith('__reactContainer$'))!;
    const pending = [root[key]];
    const form = { id: null, title: 'Synthetic follow-up', off: 1, t: 9, d: 1, where: '', video: false, who: [], repeat: 'none', notes: 'Synthetic action item', creationId: crypto.randomUUID(), separateCreation: false, cal: 'native:local', alert: null,
      ...(origin ? { origin: { version: 1, noteId: 'synthetic-note', audioId: 'synthetic-audio', revision: 'a'.repeat(64) } } : {}) };
    while (pending.length) {
      const fiber = pending.pop();
      if (typeof fiber?.stateNode?.vset === 'function') { fiber.stateNode.vset('calendar', { form, open: null, month: null, day: 1 }); return; }
      if (fiber?.sibling) pending.push(fiber.sibling);
      if (fiber?.child) pending.push(fiber.child);
    }
    throw Error('No phone shell');
  }, origin);
  const notice = page.locator('[data-alpha-note-link-notice]');
  await draft(false);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Synthetic follow-up');
  await expect(notice).toHaveCount(0);
  await draft(true);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Synthetic follow-up');
  await expect(notice).toHaveCount(0);
  // Guests, video or an alert hand the save to Android Calendar, which records no Alpha creationId.
  await page.evaluate(() => {
    const root = document.getElementById('root') as any, key = Object.keys(root).find(name => name.startsWith('__reactContainer$'))!;
    const pending = [root[key]];
    while (pending.length) {
      const fiber = pending.pop();
      if (typeof fiber?.stateNode?.vget === 'function' && typeof fiber.stateNode.vset === 'function') { const form = fiber.stateNode.vget('calendar').form; fiber.stateNode.vset('calendar', { form: { ...form, alert: 10 } }); return; }
      if (fiber?.sibling) pending.push(fiber.sibling);
      if (fiber?.child) pending.push(fiber.child);
    }
    throw Error('No phone shell');
  });
  await expect(notice).toHaveText('This event will not link back to the note on this phone.');
  // Neither draft saves or links anything before Save.
  expect(await harness(page, f => f.calls.filter((call: string) => /AlphaCalendar\.save|compareExchange/.test(call)))).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
