// MVP-19 on the FLAG-OFF bundle: one run from a scheduled-digest result to the Home brief card,
// and the canonical Agent Calendar ownership boundary on the Home card.
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
  // Execution details are a readable run summary, never the agent's raw output (owner decision 2026-10-30).
  const morning = list.locator('#hosted-result-run-morning');
  await morning.getByText('Execution details', { exact: true }).click();
  await expect(morning.locator('details p')).toHaveText(/^Started .+\. Finished .+\.$/);
  await expect(morning.locator('details pre')).toHaveCount(0);
  await expect(morning).not.toContainText('SYNTHETIC_RAW_SOURCE_456');
  await expect(morning).not.toContainText('"nodeId"');
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

// ---- Canonical Agent Calendar owns the Home card; native provider rows cannot replace its authority. ----
const calendarCard = (page: Page) => page.locator('[data-alpha-home-calendar]');
const soon = () => { const begin = Date.now() + 3_600_000; return { begin, end: begin + 1_800_000 }; };
async function canonicalHome(page: Page, mode: 'event' | 'empty' | 'wrong-owner') {
  await flagOffAndroid(page, { calendar: { access: 'granted', calendars: [{ id: '7', name: 'Private device calendar' }], events: [{ id: '42', calendarId: '7', title: 'Device-only event', ...soon() }] } });
  await page.addInitScript(mode => {
    const w = window as any, base = w.Capacitor.nativePromise;
    const now = Date.now(), startAt = new Date(now + 3_600_000).toISOString(), endAt = new Date(now + 5_400_000).toISOString();
    const event = { id: 'canonical-event', externalId: 'canonical-event', agentId: mode === 'wrong-owner' ? 'another-agent' : '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', provider: 'eliza', side: 'owner', calendarId: 'agent-calendar', grantId: 'fixture-grant', connectorAccountId: 'fixture-account', title: 'Agent calendar meeting', description: '', location: '', status: 'confirmed', startAt, endAt, isAllDay: false, timezone: 'UTC', htmlLink: null, conferenceLink: null, organizer: null, attendees: [], metadata: {}, syncedAt: new Date(now - 7_200_000).toISOString(), updatedAt: new Date(now - 7_200_000).toISOString() };
    w.canonicalHomeReads = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin !== 'Agent' || method !== 'request' || !input.path.startsWith('/api/lifeops/calendar/')) return base(plugin, method, input);
      if (input.method !== 'GET') throw Error('Home calendar fixture forbids writes');
      const url = new URL(input.path, location.origin); w.canonicalHomeReads.push(url.pathname);
      const chosen = mode === 'empty' ? null : event;
      let data;
      if (url.pathname === '/api/lifeops/calendar/feed') data = { calendarId: 'agent-calendar', events: chosen ? [chosen] : [], source: 'cache', state: 'complete', sources: [], timeMin: url.searchParams.get('timeMin'), timeMax: url.searchParams.get('timeMax'), syncedAt: event.syncedAt };
      else if (url.pathname === '/api/lifeops/calendar/calendars') data = { calendars: [{provider: 'eliza', side: 'owner', grantId: 'fixture-grant', connectorAccountId: 'fixture-account', accountEmail: null, calendarId: 'agent-calendar', summary: 'Agent Calendar', description: null, primary: true, accessRole: 'owner', backgroundColor: null, foregroundColor: null, timeZone: 'UTC', selected: true, includeInFeed: true, selectionVersion: 0}] };
      else if (url.pathname === '/api/lifeops/calendar/next-context') data = { event: chosen, readScope: { selection: 'next_event', timeMin: new Date(now).toISOString(), timeMax: new Date(now + 86_400_000).toISOString(), exhaustive: false }, calendarFeedState: 'complete', calendarSources: [], startsAt: chosen?.startAt ?? null, startsInMinutes: chosen ? 60 : null, attendeeCount: 0, attendeeNames: [], location: null, conferenceLink: null, preparationChecklist: [], linkedMailState: 'unavailable', linkedMailError: null, linkedMail: [] };
      else throw Error('Unexpected canonical Home route');
      return { status: 200, body: JSON.stringify(data) };
    };
  }, mode);
  await residentHome(page);
}

test('Home renders the canonical agent event without borrowing device names or inventing a fresh device read', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await canonicalHome(page, 'event');
  const card = calendarCard(page);
  await expect(card).toContainText('Agent calendar meeting');
  // The shared agenda card names the event, its day and its time, as it does for device calendars.
  await expect(card).toHaveAccessibleName(/^Open calendar event: Agent calendar meeting, \w{3}, \w{3} \d{1,2}, (All day|\d{1,2}:\d{2})/);
  await expect(card).not.toContainText(/Device-only event|Private device calendar/);
  await expect(card).not.toHaveAttribute('aria-description', /Read|device/);
  await card.click();
  await expect(page.getByRole('region', {name: 'Calendar', exact: true})).toContainText('Agent calendar meeting');
  expect(await harness(page, f => f.calendar.requests)).toBe(0);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a verified empty Agent Calendar does not substitute device events', async ({ page }) => {
  await canonicalHome(page, 'empty');
  await expect(calendarCard(page)).toContainText('Nothing planned');
  await expect(calendarCard(page)).not.toContainText(/Device-only event|Private device calendar/);
  expect(await harness(page, f => f.calendar.requests)).toBe(0);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('Calendar settings retain canonical Home authority even when native device events exist', async ({ page }) => {
  await canonicalHome(page, 'event');
  const card = calendarCard(page);
  await expect(card).toContainText('Agent calendar meeting');
  const before = await harness(page, f => f.calendar.lists);
  await button(page, 'Settings').click();
  await button(page, 'Calendar').click();
  const settings = page.locator('[data-settings-page="Calendar"]');
  // The current product has one Calendar; native rows remain covered by native/retained-source tests.
  await expect(settings.getByRole('button', {name:'Android calendars',exact:true})).toHaveCount(0);
  await expect(settings.getByRole('button', {name:'Agent Calendar',exact:true})).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(card).toContainText('Agent calendar meeting');
  await expect(card).not.toContainText(/Device-only event|Private device calendar/);
  expect(await harness(page, f => f.calendar.lists)).toBe(before);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('an event from another agent is not presented as this agent’s next event or as a verified empty calendar', async ({ page }) => {
  await canonicalHome(page, 'wrong-owner');
  // A refused read is a failure with retry, never a verified empty calendar.
  await expect(calendarCard(page)).toContainText('Calendar unavailable');
  await expect(calendarCard(page).locator('[data-alpha-home-calendar-source]')).toHaveText('Open Calendar to retry');
  await expect(calendarCard(page)).toHaveAttribute('aria-description', /another agent.*Open Calendar to retry\.$/);
  await expect(calendarCard(page)).not.toContainText(/Agent calendar meeting|Device-only event|No upcoming events/);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});
