import { returnToApps } from './app-navigation';
import { test, expect, type Page } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser, journal orchestration,
// foreground review dialogs and the browser's in-app calendar store. The agent's HTTP routes
// and the two native bridges (connection, journal) are synthetic. This does not exercise
// Android CalendarProvider, the calendar permission dialog, multiple accounts or a real agent.
test.use({ timezoneId: 'America/New_York' });

type Mode = 'share' | 'all-day' | 'free' | 'cancel-choice' | 'cancel-result' | 'changed-during-review' | 'left-during-review' | 'other-zone' | 'not-offered';
const TITLES = ['PRIVATE_DENTIST_TITLE', 'PRIVATE_BIRTHDAY_TITLE', 'PRIVATE_OUTSIDE_TITLE', 'PRIVATE_ADDED_TITLE'];

async function connect(page: Page, mode: Mode) {
  await page.addInitScript((mode) => {
    const w = window as any, store = new Map();
    const agentId = '12345678-1234-4234-8234-123456789abc';
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const fixture = w.availabilityFixture = { posts: 0, decisions: 0, claims: 0, receipts: [] as any[], journal: [] as string[], retained: null as any, proposal: null as any, sent: null as any, capabilityHeader: '', window: { start: start.toISOString(), end: end.toISOString() } };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite', 'secureCompareExchange', 'secureRemove']) },
        { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'get', 'list']) },
      ],
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaActionJournal') {
          fixture.journal.push(method);
          if (method === 'reserve') { w.availabilityEntry = { ...structuredClone(input), phase: 'reserved' }; return { created: true, entry: structuredClone(w.availabilityEntry) }; }
          if (method === 'markApplying') { Object.assign(w.availabilityEntry, { phase: 'applying', attemptId: input.attemptId }); return {}; }
          if (method === 'get') return { entry: w.availabilityEntry ? structuredClone(w.availabilityEntry) : null };
          if (method === 'list') return { entries: w.availabilityEntry ? [structuredClone(w.availabilityEntry)] : [] };
          if (method === 'finish') { fixture.retained = structuredClone(input); Object.assign(w.availabilityEntry, structuredClone(input), { phase: 'terminal' }); return {}; }
          throw Error('Unexpected journal call');
        }
        if (plugin !== 'AlphaConnection') throw Error('Unexpected native effect');
        if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
        if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); return { status: 'saved' }; }
        if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
        if (method === 'secureRemove') { store.delete(input.slot); return {}; }
        if (method === 'cancel') return {};
        const pathname = new URL(input.url).pathname;
        const ok = (data: any) => ({ status: 200, data });
        if (pathname === '/api/auth/status') return ok({ required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'availability-fixture', expiresAt: Date.now() + 60000 });
        if (pathname === '/api/auth/pair') return ok({ token: 'synthetic-session', identityId: 'fixture-owner', access: 'owner', instanceId: 'availability-fixture' });
        if (input.headers.Authorization !== 'Bearer synthetic-session') throw Error('Unpaired request');
        if (pathname === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', displayName: 'Fixture owner', kind: 'owner' }, session: { id: 'synthetic-session', kind: 'machine', expiresAt: Date.now() + 600000 }, access: { role: 'OWNER', mode: 'session' } });
        if (pathname === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Availability fixture', status: 'running' }] });
        if (pathname === '/api/client-devices/register') {
          w.availabilityInstallation = input.headers['X-Eliza-Device-Id'];
          return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: ['reminders.local-record.v1', ...(mode === 'not-offered' ? [] : ['calendar.availability-read.v1'])] });
        }
        if (pathname === '/api/workflow/status') return ok({});
        if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
        if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
          fixture.posts++; fixture.capabilityHeader = input.headers['X-Eliza-Device-Capabilities'];
          const sent = JSON.parse(input.body); fixture.sent = sent;
          const timeZone = mode === 'other-zone' ? 'Asia/Tokyo' : sent.metadata.clientDevice.context.timeZone;
          fixture.proposal = { id: 'fixture-proposal', digest: 'a'.repeat(64), state: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString(), subjectUserId: 'fixture-owner', requestedBy: agentId, action: 'device_action', payload: { action: 'device_action', version: 1, installationId: w.availabilityInstallation, enrollmentId: 'fixture-enrollment', operation: { type: 'calendar_availability', start: fixture.window.start, end: fixture.window.end, timeZone } } };
          return ok({ text: 'I can check that on your phone. Review the request there.', agentName: 'Availability fixture' });
        }
        if (pathname === '/api/client-devices/proposals') return ok({ proposals: fixture.proposal ? [fixture.proposal] : [] });
        const body = input.body ? JSON.parse(input.body) : {};
        if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
          if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
          if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; return ok({ proposal: { ...fixture.proposal, state: 'approved' }, digest: fixture.proposal.digest }); }
          if (pathname.endsWith('/claim')) { fixture.claims++; fixture.proposal = { ...fixture.proposal, state: 'executing', execution: { attemptId: 'fixture-attempt' } }; return ok({ proposal: fixture.proposal, digest: fixture.proposal.digest }); }
          if (pathname.endsWith('/receipt')) { fixture.receipts.push(structuredClone(body.receipt)); fixture.proposal = { ...fixture.proposal, state: body.receipt.outcome === 'applied' ? 'succeeded' : 'failed' }; return ok({ proposal: fixture.proposal, digest: fixture.proposal.digest }); }
        }
        throw Error('Unexpected fixture route ' + pathname);
      },
    };
  }, mode);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  await page.getByText('Local development agent', { exact: true }).click();
  const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
  await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
  await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
  await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
  await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
}
/** Saves through the product's in-app calendar plugin. Titles exist only to prove they never leave. */
async function saveEvent(page: Page, title: string, offsetHours: number, hours: number, allDay = false) {
  await page.evaluate(async ({ title, offsetHours, hours, allDay }) => {
    const { registerPlugin } = await import('/src/platform-plugins.ts');
    const calendar = registerPlugin<any>('AlphaCalendar'), start = Date.parse((window as any).availabilityFixture.window.start);
    const local = new Date(start), civil = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
    const begin = allDay ? civil : start + offsetHours * 3600000, end = allDay ? civil + 86400000 : begin + hours * 3600000;
    const saved = await calendar.save({ title, body: 'PRIVATE_BODY', location: 'PRIVATE_PLACE', begin, end, allDay, calendarId: 'local', creationId: crypto.randomUUID(), separateCreation: true });
    if (saved.status !== 'saved') throw Error('Fixture event was not saved: ' + saved.status);
  }, { title, offsetHours, hours, allDay });
}
const fixture = (page: Page) => page.evaluate(() => (window as any).availabilityFixture);

for (const mode of ['share', 'all-day', 'free', 'cancel-choice', 'cancel-result', 'changed-during-review', 'left-during-review', 'other-zone', 'not-offered'] as const) {
  test(`foreground Calendar availability: ${mode}`, async ({ page }) => {
    await connect(page, mode);
    if (mode !== 'free') await saveEvent(page, TITLES[0], 9, 1);
    if (mode === 'all-day') await saveEvent(page, TITLES[1], 0, 24, true);
    // Outside the asked window: never part of the answer.
    await saveEvent(page, TITLES[2], 30, 1);
    await returnToApps(page);
    const input = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
    await input.fill('Am I free tomorrow?'); await input.press('Enter');
    await expect.poll(async () => (await fixture(page)).posts).toBe(1);
    const asked = await fixture(page);
    // The request itself carries no calendar content, and the capability is sent only when offered.
    for (const title of TITLES) expect(JSON.stringify(asked.sent)).not.toContain(title);
    expect(asked.capabilityHeader.split(',').includes('calendar.availability-read.v1')).toBe(mode !== 'not-offered');
    expect(asked.sent.metadata.clientDevice.context.timeZone).toBe('America/New_York');
    const approve = page.getByText('Check availability', { exact: true });

    if (mode === 'other-zone' || mode === 'not-offered') {
      // The pending action is named with the reason it cannot be reviewed; it is never approvable.
      await expect(page.getByText(mode === 'other-zone' ? /Check availability: This availability check used a different time zone\. Ask again from this phone\./ : /An agent action could not be shown on this phone\. This action was not negotiated with this agent/).last()).toBeVisible();
      await expect(approve).toHaveCount(0);
      const after = await fixture(page);
      expect(after.decisions).toBe(0); expect(after.receipts).toEqual([]); expect(after.journal).not.toContain('reserve');
      return;
    }
    await expect(page.getByText(/Only busy times are shared with the agent, not event titles or details/).last()).toBeVisible();
    await approve.click();

    const choose = page.getByRole('dialog', { name: 'Choose calendars to check' });
    await expect(choose).toBeVisible();
    const check = choose.getByRole('button', { name: 'Check these calendars', exact: true });
    const box = choose.getByRole('checkbox', { name: 'In this app · Saved on this device' });
    // Nothing is preselected and nothing can be read until the owner ticks a calendar.
    await expect(box).not.toBeChecked(); await expect(check).toBeDisabled();
    await expect(choose.getByRole('status')).toHaveText('Choose at least one calendar.');
    for (const title of TITLES) await expect(choose).not.toContainText(title);

    const failedReceipt = async (pattern: RegExp) => {
      await expect.poll(async () => (await fixture(page)).receipts.length).toBe(1);
      const after = await fixture(page);
      expect(after.receipts[0].outcome).toBe('failed'); expect(after.receipts[0].result).toBeUndefined();
      expect(after.retained.status).toBe('failed'); expect(after.retained.summary).toMatch(pattern);
      expect(after.retained.result.foregroundResult).toBeUndefined();
      for (const title of TITLES) expect(JSON.stringify([after.receipts, after.retained])).not.toContain(title);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    if (mode === 'cancel-choice') {
      await choose.getByRole('button', { name: 'Cancel', exact: true }).click();
      await failedReceipt(/cancelled\. No calendar was read\. Nothing was shared\./);
      return;
    }
    await box.check();
    await expect(choose.getByRole('status')).toHaveText('1 calendar chosen.');
    await check.click();

    const result = page.getByRole('dialog', { name: 'Review availability to share' });
    await expect(result).toBeVisible();
    await expect(result.getByRole('heading')).toHaveText(mode === 'free' ? 'You are free' : 'You are busy');
    await expect(result.getByRole('listitem')).toHaveCount(mode === 'free' ? 0 : mode === 'all-day' ? 2 : 1);
    if (mode === 'all-day') await expect(result.getByRole('listitem').first()).toContainText('all day');
    // The owner sees times only; titles, notes and places are not read into the review.
    for (const hidden of [...TITLES, 'PRIVATE_BODY', 'PRIVATE_PLACE']) await expect(result).not.toContainText(hidden);
    await expect(result).toContainText('Read from: In this app · Saved on this device.');
    await expect(result).toContainText('Calendar names, event titles and details stay on this phone.');
    expect((await fixture(page)).receipts).toEqual([]);

    if (mode === 'cancel-result') {
      await result.getByRole('button', { name: 'Cancel', exact: true }).click();
      await failedReceipt(/Availability check cancelled\. Nothing was shared\./);
      return;
    }
    if (mode === 'left-during-review') {
      // Leaving the app during the review closes it; it never counts as approval.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(async () => (await fixture(page)).retained?.status).toBeTruthy();
      const left = await fixture(page);
      // The journal records that nothing was shared; no result is retained or uploaded.
      expect(left.retained.status).not.toBe('succeeded');
      expect(left.retained.result.foregroundResult).toBeUndefined();
      for (const receipt of left.receipts) { expect(receipt.outcome).not.toBe('applied'); expect(receipt.result).toBeUndefined(); }
      expect(JSON.stringify([left.receipts, left.retained])).not.toContain('"busy"');
      return;
    }
    if (mode === 'changed-during-review') {
      await saveEvent(page, TITLES[3], 13, 1);
      await result.getByRole('button', { name: 'Share with agent', exact: true }).click();
      await failedReceipt(/Your calendar changed during this review/);
      return;
    }
    await result.getByRole('button', { name: 'Share with agent', exact: true }).click();
    await expect.poll(async () => (await fixture(page)).receipts.length).toBe(1);
    const done = await fixture(page), start = Date.parse(done.window.start), iso = (at: number) => new Date(at).toISOString();
    const timed = { start: iso(start + 9 * 3600000), end: iso(start + 10 * 3600000), allDay: false, tentative: false };
    const expected = {
      version: 1, kind: 'calendar_availability', window: { start: done.window.start, end: done.window.end, timeZone: 'America/New_York' }, calendarCount: 1,
      status: mode === 'free' ? 'free' : 'busy', transparentIgnored: 0,
      busy: mode === 'free' ? [] : mode === 'all-day' ? [{ start: done.window.start, end: done.window.end, allDay: true, tentative: false }, timed] : [timed],
    };
    expect(done.receipts[0].outcome).toBe('applied');
    // The uploaded receipt is exactly the reviewed result, and the journal retains the same value.
    expect(done.receipts[0].result).toEqual(expected);
    expect(done.retained.result.foregroundResult).toEqual(expected);
    const shared = JSON.stringify([done.receipts, done.retained]);
    for (const hidden of [...TITLES, 'PRIVATE_BODY', 'PRIVATE_PLACE', 'In this app', 'Saved on this device']) expect(shared).not.toContain(hidden);
    expect(Object.keys(done.receipts[0].result).sort()).toEqual(['busy', 'calendarCount', 'kind', 'status', 'transparentIgnored', 'version', 'window']);
    await expect(page.getByText(mode === 'free' ? /Shared that you are free in this window, from 1 calendar you chose/ : /Shared \d busy times? from 1 calendar you chose/).last()).toBeVisible();
    expect(done.decisions).toBe(1); expect(done.claims).toBe(1);
    expect(done.journal.filter((name: string) => name === 'reserve').length).toBe(1);
    expect(done.journal.filter((name: string) => name === 'finish').length).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

// Exercise the actual in-app provider contract as well as the executor: an empty local
// store is free, but loss of its freshness marker at either bridge read is unknown.
test('empty browser calendar requires freshness evidence on both reads', async ({ page }) => {
  await page.goto('/');
  const outcomes = await page.evaluate(async () => {
    const { BrowserCalendar } = await import('/src/browser/calendar.ts');
    const { executeCalendarAvailability } = await import('/src/runtime/calendar-availability.ts');
    const calendar = new BrowserCalendar(), timeZone = 'America/New_York';
    const operation = { type: 'calendar_availability' as const, start: '2026-10-13T04:00:00.000Z', end: '2026-10-14T04:00:00.000Z', timeZone };
    const results = [];
    for (const missingAt of [0, 1, 2]) {
      let reads = 0;
      const provider = {
        requestWorkflowReadAccess: () => calendar.requestWorkflowReadAccess(),
        availabilitySources: (input: {timeZone:string}) => calendar.availabilitySources(input),
        readAvailability: async (input: any) => {
          const result = await calendar.readAvailability(input);
          return ++reads === missingAt ? { ...result, freshness: undefined } : result;
        },
      };
      results.push(await executeCalendarAvailability(provider, operation, timeZone, new AbortController().signal, () => {}, {
        chooseCalendars: async (sources: readonly any[]) => sources.map(source => source.id),
        confirmResult: async () => true,
      }, () => timeZone));
    }
    return results;
  });
  expect(outcomes[0].status).toBe('succeeded');
  expect(outcomes[0].foregroundResult?.status).toBe('free');
  for (const outcome of outcomes.slice(1)) {
    expect(outcome.status).toBe('failed');
    expect(outcome.foregroundResult).toBeUndefined();
    expect(outcome.summary).toContain('availability is unknown');
  }
});
