// MVP-19 on the FLAG-OFF bundle: one run from a scheduled-digest result to the Home brief card,
// and the device calendar name on the Home calendar card.
//
// Digest results enter the way they do on a phone, through the connected resident agent:
//  - `native`: the Android result inbox (AlphaHostedResults) commits what the agent produced and
//    the renderer reads its retained history, the normal route on Android;
//  - `renderer`: background delivery could not be configured, so the renderer reads the agent's
//    result page over the bridge, commits each result to the secure store and acknowledges it.
// From there the shipped digest panel publishes the newest result that ran and Home renders it.
// Nothing is placed in the retained-result store or the renderer by the test.
//
// Evidence boundary: source/test evidence for the flag-off renderer with the Android bridge
// stubbed (test/browser/flag-off-android.ts). The stub is not the resident runtime, its scheduler,
// HostedDeliveryWorker, the native inbox journal or CalendarProvider, and no digest ran: the rows
// are synthetic results in the agent's wire shape. Not APK, emulator, device or real-provider
// acceptance.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, AGENT_NAME } from './flag-off-android';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const home = (page: Page) => page.getByRole('region', { name: 'Home', exact: true });
const brief = (page: Page) => home(page).locator('[data-alpha-home-brief]');
/** The app's "Read/Ran <when>" wording for an instant: the time today, otherwise the date too. */
const when = (page: Page, at: number) => page.evaluate(at => {
  const clean = (text: string) => text.replace(/[  ]/g, ' '), date = new Date(at);
  const time = clean(date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  return date.toDateString() === new Date().toDateString() ? time : `${clean(date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))} ${time}`;
}, at);
/** One occurrence as the agent's result page returns it. */
const result = (cursor: number, runId: string, completed: number, extra: Record<string, unknown>) => {
  const iso = (value: number) => new Date(value).toISOString();
  return { cursor, runId, workflowId: 'workflow-morning', workflowVersionId: 'version-1', templateVersion: 'hosted-digest-1', scheduledAt: iso(completed - 60_000),
    source: { observedAt: iso(completed - 60_000), expiresAt: iso(completed + 86_400_000) }, startedAt: iso(completed - 30_000), completedAt: iso(completed), error: null, ...extra };
};
/** The agent has new occurrences; the phone comes back online, which is when the app syncs. */
async function deliver(page: Page, rows: unknown[]) {
  const before = await harness(page, f => f.digests.syncs + f.digests.pages);
  await page.evaluate(rows => { (window as any).flagOff.digests.results.push(...rows); (window as any).flagOff.persist(); window.dispatchEvent(new Event('online')); }, rows);
  await expect.poll(() => harness(page, f => f.digests.syncs + f.digests.pages), { timeout: 20_000 }).toBeGreaterThan(before);
}

for (const route of ['native', 'renderer'] as const) test(`a digest result from the agent reaches the Home brief card (${route} result inbox): attributed, timed by its run, and never replaced by an occurrence that did not run`, async ({ page }, info) => {
  test.setTimeout(150_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: route });
  await residentHome(page);
  // The first sync finds no result: there is no card and no placeholder brief.
  await expect.poll(() => harness(page, f => f.digests.syncs + f.digests.pages), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(brief(page)).toHaveCount(0);
  await expect(home(page)).not.toContainText(/Morning brief|No brief yet|Latest brief/);

  // 1. A run finishes. Its summary is the typed-steps text; the step payload is source material.
  const now = Date.now(), ranAt = now - 2 * 3_600_000;
  await deliver(page, [result(1, 'run-morning', ranAt, { status: 'finished', output: [{ nodeId: 'typed-steps', runId: 'run-morning', text: 'Synthetic brief: two meetings and one reply to send.', steps: [{ id: 'source', text: 'SYNTHETIC_RAW_SOURCE_456' }] }] })]);
  const card = brief(page);
  await expect(card).toBeVisible({ timeout: 20_000 });
  const ran = await when(page, ranAt);
  await expect(card).toContainText('Latest brief');
  await expect(card.locator('.home-brief-title')).toHaveText('Synthetic brief: two meetings and one reply to send.');
  // Source attribution is the connected agent; freshness is when the run completed, not when it was read.
  await expect(card.locator('.home-brief-status')).toHaveText(`${AGENT_NAME} · Ran ${ran}`);
  await expect(card).toHaveAccessibleName(`Open scheduled digests. Latest brief from ${AGENT_NAME}, ran ${ran}: Synthetic brief: two meetings and one reply to send.`);
  await expect(card).toHaveAttribute('data-alpha-home-brief-failed', 'false');
  expect(await page.evaluate(() => document.body.innerText.includes('SYNTHETIC_RAW_SOURCE_456'))).toBe(false);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`home-brief-${route}.png`), animations: 'disabled' });

  // 2. Later occurrences that the agent recorded without running them: a missed time, an
  // overlapping run and a source that was not available. They are newer than the brief and must
  // not replace it or count as a run.
  await deliver(page, [
    result(2, 'run-missed', now - 3_600_000, { status: 'missed', output: { status: 'missed', text: 'The scheduled time was missed. No backlog was executed.' } }),
    result(3, 'run-overlap', now - 1_800_000, { status: 'overlap', output: { status: 'overlap', text: 'An earlier run was still active.' } }),
    result(4, 'run-unavailable', now - 1_500_000, { status: 'unavailable', output: { status: 'unavailable', text: 'The source was not available.' } })]);
  await card.click();
  const list = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  // The list received all three records (so the card had every chance to show them) and labels them honestly.
  await expect(list.locator('#hosted-result-run-missed')).toContainText('Missed — not run', { timeout: 20_000 });
  await expect(list.locator('#hosted-result-run-overlap')).toContainText('Skipped — an earlier run was still active');
  await expect(list.locator('#hosted-result-run-unavailable')).toContainText('Not run — source unavailable');
  await expect(list.locator('#hosted-result-run-morning')).toContainText('Synthetic brief: two meetings and one reply to send.');
  await button(page, 'Close scheduled digests').click();
  await expect(card.locator('.home-brief-title')).toHaveText('Synthetic brief: two meetings and one reply to send.');
  await expect(card.locator('.home-brief-status')).toHaveText(`${AGENT_NAME} · Ran ${ran}`);
  await expect(card).not.toContainText(/missed|Did not run|earlier run|not available/i);
  await expect(card).toHaveAttribute('data-alpha-home-brief-failed', 'false');

  // 3. A newer run replaces it, with its own completion time.
  const secondAt = now - 600_000;
  await deliver(page, [result(5, 'run-evening', secondAt, { status: 'finished', output: { summary: 'Synthetic evening brief: nothing left open.' } })]);
  await expect(card.locator('.home-brief-title')).toHaveText('Synthetic evening brief: nothing left open.', { timeout: 20_000 });
  await expect(card.locator('.home-brief-status')).toHaveText(`${AGENT_NAME} · Ran ${await when(page, secondAt)}`);

  // 4. A newer failed run is shown as a failure with the agent's own error text.
  const failedAt = now - 120_000;
  await deliver(page, [result(6, 'run-failed', failedAt, { status: 'failed', output: null, error: 'Synthetic source expired' })]);
  await expect(card).toHaveAttribute('data-alpha-home-brief-failed', 'true', { timeout: 20_000 });
  await expect(card.locator('.home-brief-title')).toHaveText('Synthetic source expired');
  await expect(card.locator('.home-brief-status')).toHaveText(`${AGENT_NAME} · Failed ${await when(page, failedAt)}`);

  // The harness counters start again when the page reloads, so what the first session asked of the
  // agent is checked here: showing and opening the card started or changed no schedule, and on the
  // native route the renderer never read the agent's result page itself.
  const firstSession = await harness(page, f => ({ refused: f.digests.refused as string[], runs: f.digests.runs, pages: f.digests.pages, configured: f.digests.configured.length, unexpected: f.unexpected }));
  expect(firstSession.refused).toEqual([]);
  expect(firstSession.runs).toBe(0);
  expect(firstSession.unexpected).toEqual([]);
  if (route === 'native') { expect(firstSession.configured).toBeGreaterThan(0); expect(firstSession.pages).toBe(0); }
  else { expect(firstSession.configured).toBe(0); expect(firstSession.pages).toBeGreaterThan(0); }

  // 5. The retained result survives a restart of the renderer and is shown again for the same agent.
  await page.reload();
  await expect(brief(page)).toHaveAttribute('data-alpha-home-brief-failed', 'true', { timeout: 30_000 });
  await expect(brief(page).locator('.home-brief-title')).toHaveText('Synthetic source expired');

  // After the reload, too, nothing was started or changed on the agent.
  const state = await harness(page, f => ({ refused: f.digests.refused as string[], runs: f.digests.runs, pages: f.digests.pages, acks: f.digests.acks, configured: f.digests.configured.length, inbox: f.digests.inbox.length, unexpected: f.unexpected }));
  expect(state.refused).toEqual([]);
  expect(state.runs).toBe(0);
  if (route === 'native') {
    // The Android inbox was bound to the resident agent and is the only reader of the agent's results.
    expect(state.configured).toBeGreaterThan(0);
    expect(state.pages).toBe(0);
    expect(state.inbox).toBe(6);
  } else {
    // The renderer committed each page before acknowledging it, in cursor order.
    expect(state.configured).toBe(0);
    expect(state.acks).toEqual([1, 4, 5, 6]);
  }
  await expectNoDevelopmentSurface(page);
  expect(state.unexpected).toEqual([]);
  expect(foreign).toEqual([]);
});

test('with only occurrences that did not run, Home shows no brief card', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOffAndroid(page, { digests: 'native' });
  await residentHome(page);
  await expect.poll(() => harness(page, f => f.digests.syncs), { timeout: 30_000 }).toBeGreaterThan(0);
  const now = Date.now();
  await deliver(page, [
    result(1, 'run-missed', now - 3_600_000, { status: 'missed', output: { status: 'missed', text: 'The scheduled time was missed. No backlog was executed.' } }),
    result(2, 'run-unavailable', now - 1_800_000, { status: 'unavailable', output: { status: 'unavailable', text: 'The source was not available.' } })]);
  // Proof that the records arrived: the list shows them. Home still has no brief.
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  const list = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  await expect(list.locator('#hosted-result-run-missed')).toContainText('Missed — not run', { timeout: 20_000 });
  await expect(list.locator('#hosted-result-run-unavailable')).toContainText('Not run — source unavailable');
  await button(page, 'Close scheduled digests').click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect(brief(page)).toHaveCount(0);
  await expect(home(page)).not.toContainText(/scheduled time was missed|Did not run|Latest brief/);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

// ---- Device calendar name on the Home calendar card ----
const calendarCard = (page: Page) => page.locator('[data-alpha-home-calendar]');
const origin = (page: Page) => calendarCard(page).locator('[data-alpha-home-calendar-origin]');
// The calendar's name is no longer drawn on the card (docs/ui-refresh-2026-11); it leads the accessible description.
const named = (page: Page, name: string) => expect(calendarCard(page)).toHaveAttribute('aria-description', new RegExp(`^${name}\\. Read `));
const dateLine = (page: Page) => page.locator('[data-alpha-home-date]');
const soon = () => { const begin = Date.now() + 3_600_000; return { begin, end: begin + 1_800_000 }; };
/** The phone leaves and returns to the app; Calendar reads the provider again. */
async function resume(page: Page) {
  const before = await harness(page, f => f.calendar.lists);
  await harness(page, f => f.emit('DailyApps', 'appResumed'));
  await expect.poll(() => harness(page, f => f.calendar.lists), { timeout: 20_000 }).toBeGreaterThan(before);
}

test('the Home calendar card names the device calendar its event was read from, follows a rename, and never shows a name it did not just read', async ({ page }, info) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { calendar: { access: 'granted', calendars: [{ id: '7', name: 'Harbour team', account: 'owner@example.invalid' }, { id: '8', name: 'Family', account: 'owner@example.invalid' }], events: [{ id: '42', calendarId: '7', title: 'Quay inspection', ...soon() }] } });
  await residentHome(page);
  const card = calendarCard(page);
  await expect(card).toContainText('Quay inspection', { timeout: 20_000 });
  await expect(origin(page)).toHaveCount(0);
  await named(page, 'Harbour team');
  await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-description', /^Harbour team\. Read \d{1,2}:\d{2}.* from calendars on this device$/);
  await page.screenshot({ path: info.outputPath('home-calendar-name.png'), animations: 'disabled' });

  // Renamed in Android Calendar: the next read carries the new name; the old one is gone.
  await harness(page, f => { f.calendar.calendars[0].name = 'Harbour crew'; });
  await resume(page);
  await named(page, 'Harbour crew');
  await expect(card).not.toContainText('Harbour team');

  // Unknown calendar: the event's calendar is not among the calendars the read returned (for
  // example it was removed while the instance was still listed). No other calendar's name is used.
  await harness(page, f => { f.calendar.calendars = f.calendar.calendars.filter((row: any) => row.id !== '7'); });
  await resume(page);
  // No calendar name is borrowed or invented for an event whose calendar the read did not return.
  await expect(card).toContainText('Quay inspection');
  await expect(card).toHaveAttribute('aria-description', /^Read \d{1,2}:\d{2}.* from calendars on this device$/);
  await expect(card).not.toContainText(/Harbour|Family/);

  // A calendar the provider reports without a display name is named as unnamed, not guessed.
  await harness(page, f => { f.calendar.calendars.push({ id: '7', account: 'owner@example.invalid' }); });
  await resume(page);
  await named(page, 'Unnamed calendar');

  // Permission revoked in Android settings: nothing left to show, so no card; the date line returns.
  await harness(page, f => { f.calendar.access = 'not-granted'; });
  await resume(page);
  await expect(card).toHaveCount(0);
  await expect(dateLine(page)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Home', exact: true })).not.toContainText(/Quay inspection|Unnamed calendar|Harbour/);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('calendar permission denied: Home says access is off and shows no event, calendar name or read time', async ({ page }) => {
  test.setTimeout(120_000);
  // The provider holds a named calendar and an event, but READ_CALENDAR is not granted and the
  // user refuses the request.
  await flagOffAndroid(page, { calendar: { access: 'not-granted', request: 'denied', calendars: [{ id: '7', name: 'Harbour team', account: 'owner@example.invalid' }], events: [{ id: '42', calendarId: '7', title: 'Quay inspection', ...soon() }] } });
  await residentHome(page);
  const card = calendarCard(page);
  // Before any request there is nothing to show: no card, and nothing was requested on the user's behalf.
  await expect(dateLine(page)).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveCount(0);
  expect(await harness(page, f => f.calendar.requests)).toBe(0);
  await button(page, 'Settings').click();
  await button(page, 'Calendars').click();
  await button(page, 'Refresh calendars').click();
  await expect.poll(() => harness(page, f => f.calendar.requests)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  // Refused: still nothing to show on Home.
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Home', exact: true })).not.toContainText(/Quay inspection|Harbour team/);

  // Granting it later (the user allows the request) shows the event with its calendar's name.
  await harness(page, f => { f.calendar.request = 'granted'; });
  await button(page, 'Settings').click();
  await button(page, 'Calendars').click();
  await button(page, 'Refresh calendars').click();
  await expect.poll(() => harness(page, f => f.calendar.requests)).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(card).toContainText('Quay inspection', { timeout: 20_000 });
  await named(page, 'Harbour team');
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('the Home calendar card shows when the provider read completed, not when Home first drew its rows', async ({ page }) => {
  test.setTimeout(120_000);
  // The read finishes, then the app's follow-up work (pending creations) takes two minutes before
  // Home can draw the rows. The card must name the read, not the draw.
  await page.clock.install();
  await flagOffAndroid(page, { calendar: { access: 'granted', calendars: [{ id: '7', name: 'Harbour team', account: 'owner@example.invalid' }], events: [{ id: '42', calendarId: '7', title: 'Quay inspection', ...soon() }] } });
  await page.addInitScript(() => {
    const w = window as any, base = w.Capacitor, native = base.nativePromise;
    const record = w.readTiming = { completed: [] as number[], held: 0 };
    base.nativePromise = async (plugin: string, method: string, input: any) => {
      const result = await native(plugin, method, input);
      if (plugin === 'AlphaCalendar' && method === 'list' && result?.status === 'ready') record.completed.push(Date.now());
      if (plugin === 'AlphaCalendar' && method === 'pendingCreations' && record.held++ === 0) await new Promise(resolve => setTimeout(resolve, 120_000));
      return result;
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).readTiming.held), { timeout: 30_000 }).toBeGreaterThan(0);
  const completed = await page.evaluate(() => (window as any).readTiming.completed[0] as number);
  await page.clock.fastForward('02:01');
  const card = calendarCard(page);
  await expect(card).toContainText('Quay inspection', { timeout: 20_000 });
  const drawnAt = await page.evaluate(() => Date.now());
  expect(drawnAt - completed).toBeGreaterThanOrEqual(120_000);
  await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-description',`Harbour team. Read ${await when(page, completed)} from calendars on this device`);
  expect(await when(page, completed)).not.toBe(await when(page, drawnAt));
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});
