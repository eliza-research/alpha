import {seedCompletedAccessSetup} from './flag-off-android';
import { completeAccessSetup } from './flag-off-android';
import { test, expect, type Page } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// B-13 on the FLAG-OFF bundle with the Android bridge stubbed (docs/core-loop-audit.md).
//
// On Android an agent calendar proposal is reviewed twice: first as a card in the conversation,
// rendered by this renderer, then in a native dialog owned by the pinned Calendar plugin
// (vendor/eliza plugin-native-calendar), which the stub stands in for. This file asserts the half
// the renderer owns: the card states the title, the exact time in the event's zone, the zone, the
// calendar and what happens to attendees; nothing reaches the native plugin before Approve; and
// Approve hands over exactly the reviewed operation, once.
//
// Evidence boundary: source/test evidence for the shipped renderer. The agent, its proposal store,
// the action journal and the Calendar plugin are in-page fixtures. The native dialog's own text
// (calendar display name, time, location, description) is not rendered here and is not evidence
// of anything; CalendarAgentCrudInstrumentedTest is the emulator gate for it.
const AGENT = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });
// Fixed instants in a zone that is not the browser's, so the card has to show the event's zone.
const fields = { title: 'Venue booking call', description: 'From the venue meeting note', location: 'Main hall', start: '2027-03-01T05:00:00.000Z', end: '2027-03-01T06:00:00.000Z', timeZone: 'Asia/Tokyo' };
const operation = { type: 'calendar_create_local', fields };
const card = [
  'Create event',
  '“Venue booking call”',
  'March 1, 2027 at 2:00 PM GMT+9 – March 1, 2027 at 3:00 PM GMT+9 (Asia/Tokyo)',
  'Calendar: the calendar kept on this phone. No account calendar is changed.',
  'Attendees: none. No invitations are sent.',
  'Location: Main hall',
  'From the venue meeting note',
];

async function residentAgent(page: Page, operation: unknown, capabilities: string[]) {
  await installResidentAgentPlugin(page);
  await page.addInitScript(({ agentId, operation, capabilities }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    const future = Date.now() + 86_400_000, account = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    store.set('cloud:production', JSON.stringify({ token: 'synthetic-cloud-key', credentialId: account, expiresAt: future }));
    const f = w.declineFixture = { decisions: [] as string[], reconciliations: [] as unknown[], effects: 0, journal: [] as string[], unexpected: [] as string[], proposals: [] as any[], installationId: '', calendar: [] as any[], receipts: [] as any[], entry: null as any, lists: 0 };
    const resident = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId, unexpected: f.unexpected });
    const proposal = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
      id, digest: 'a'.repeat(64), state, expiresAt: new Date(future).toISOString(),
      subjectUserId: 'fixture-owner', requestedBy: agentId, action: 'device_action',
      payload: { action: 'device_action', version: 1, installationId: f.installationId, enrollmentId: 'fixture-enrollment', operation },
      ...extra,
    });
    // One synthetic resident agent: authenticated identity, device enrollment and proposal store.
    const agent = (method: string, path: string, body: any, headers: Record<string, string>): { status: number; data: unknown } => {
      const ok = (data: unknown) => ({ status: 200, data });
      if (path === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Decline fixture', status: 'running' }] });
      if (path === '/api/client-devices/register') {
        f.installationId = headers['X-Eliza-Device-Id'];
        f.proposals = [proposal('fixture-calendar', 'pending')];
        return ok({ installationId: f.installationId, enrollmentId: 'fixture-enrollment', capabilities });
      }
      if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
      if (path === '/api/conversations') return ok({ conversations: [] });
      if (path === '/api/client-devices/proposals') { f.lists++; return ok({ proposals: f.proposals }); }
      const match = /^\/api\/client-devices\/proposals\/([^/]+)\/(decision|reconciliation|claim|receipt)$/.exec(path);
      if (match && method === 'POST') {
        const item = f.proposals.find(p => p.id === match[1]);
        if (!item || body.digest !== item.digest) return { status: 409, data: {} };
        if (match[2] === 'decision') {
          f.decisions.push(body.decision);
          if (item.state !== 'pending') return { status: 409, data: {} };
          item.state = body.decision === 'approve' ? 'approved' : 'rejected';
        } else if (match[2] === 'claim') {
          if (item.state !== 'approved') return { status: 409, data: {} };
          item.state = 'executing'; item.execution = { attemptId: 'fixture-attempt' };
        } else if (match[2] === 'receipt') {
          if (item.state !== 'executing' || body.attemptId !== 'fixture-attempt') return { status: 409, data: {} };
          f.receipts.push(body.receipt); item.state = body.receipt.outcome === 'applied' ? 'succeeded' : 'failed';
        } else return { status: 409, data: {} };
        return ok({ proposal: item, digest: item.digest });
      }
      f.unexpected.push(method + ' ' + path);
      return { status: 404, data: {} };
    };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaDeletions', methods: methods(['pending']) },
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        { name: 'Agent', methods: resident.methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'list', 'get']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'AlphaCalendar', methods: methods(['requestAccess', 'executeAgent', 'cancelAgent', 'calendars', 'range', 'listAlerts', 'prepareAgentSource', 'addListener', 'removeListener']) },
      ],
      nativeCallback: resident.nativeCallback,
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'decline-fixture' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') {
          f.journal.push(method);
          if (method === 'list') return { entries: f.entry ? [structuredClone(f.entry)] : [] };
          if (method === 'get') return { entry: f.entry ? structuredClone(f.entry) : null };
          if (method === 'reserve') { if (f.entry) return { created: false, entry: structuredClone(f.entry) }; f.entry = { ...structuredClone(input), phase: 'reserved' }; return { created: true, entry: structuredClone(f.entry) }; }
          if (method === 'markApplying') { Object.assign(f.entry, { phase: 'applying', attemptId: input.attemptId }); return {}; }
          if (method === 'finish') { Object.assign(f.entry, { phase: 'terminal', status: input.status, summary: input.summary, result: input.result }); return {}; }
          throw Error('Unexpected journal effect');
        }
        // The native Calendar plugin: Android shows its own review dialog inside executeAgent. The
        // stub records exactly what the renderer handed over and answers as an approved save.
        if (plugin === 'AlphaCalendar') {
          if (method === 'requestAccess') return { status: 'granted' };
          if (method === 'executeAgent') { f.calendar.push(structuredClone(input)); return { status: 'applied', result: { version: 1, kind: input.operation.type, sourceId: '7', eventId: '42', revision: 'c'.repeat(64) } }; }
          if (method === 'cancelAgent') return { status: 'cancelled' };
          if (method === 'calendars') return { calendars: [] };
          if (method === 'range') return { events: [], truncated: false };
          if (method === 'listAlerts') return { items: [] };
          return {};
        }
        if (plugin === 'Agent') {
          const owned = resident.answer(method, input); if (owned) return owned;
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'providerStatus') return { provider: 'cerebras', configured: true, model: 'qwen-3.8-27b' };
          if (method === 'request') {
            const result = agent(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {});
            return { status: result.status, body: JSON.stringify(result.data) };
          }
          return {};
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
          if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); return { status: 'saved' }; }
          if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
          if (method === 'secureRemove') { store.delete(input.slot); return {}; }
          if (method === 'request') {
            const path = new URL(input.url).pathname;
            if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id: account } } };
            if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
            if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
            f.unexpected.push('cloud ' + path); return { status: 404, data: {} };
          }
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation');
      },
    };
  }, { agentId: AGENT, operation, capabilities });
}
const fixture = (page: Page) => page.evaluate(() => {
  const f = (window as any).declineFixture;
  return { decisions: f.decisions as string[], journal: f.journal as string[], states: f.proposals.map((p: any) => [p.id, p.state]) as [string, string][], unexpected: f.unexpected as string[], journalIdentity: {scope:f.entry?.scope,proposalId:f.entry?.proposalId}, calendar: f.calendar as { operation: unknown; operationId: string; journalIdentity: {scope:string;proposalId:string} }[], receipts: f.receipts as any[] };
});
async function connected(page: Page) {
  await page.goto('/');
  // Development builds offer an explicit start; production starts the funded resident agent itself.
  const start = page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true });
  await expect.poll(async () => await start.isVisible().catch(() => false) || await page.evaluate(() => (window as any).declineFixture.installationId !== ''), { timeout: 30_000 }).toBe(true);
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect.poll(() => page.evaluate(() => (window as any).declineFixture.installationId), { timeout: 30_000 }).not.toBe('');
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);
}

test('Android: the proposal card states time zone, calendar and attendees, and Approve hands over exactly the reviewed operation once', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await residentAgent(page, operation, ['calendar.create.v1']);
  await connected(page);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('button',{name:'Expand chat',exact:true}).click();
  await expect.poll(async()=> (await page.locator('[data-alpha-layer="conversation"]').boundingBox())?.height??0).toBeGreaterThan(700);
  const approve = page.getByText('Create event', { exact: true });
  await expect(approve).toBeVisible({ timeout: 20_000 });
  // The whole reviewed text, line for line, in the conversation.
  await expect(page.getByText(card.slice(1).join('\n'), { exact: true })).toBeVisible();
  await expect(page.getByText(card.slice(1).join('\n'), { exact: true })).toHaveCSS('white-space','pre-wrap');
  await expect(page.locator('.alpha-action-review button > span').first()).toBeHidden();
  await testInfo.attach('calendar-action-review',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  // Nothing has reached the native Calendar plugin or the journal.
  let state = await fixture(page);
  expect(state.calendar).toEqual([]);
  expect(state.decisions).toEqual([]);
  expect(state.journal.filter(m => ['reserve', 'markApplying', 'finish'].includes(m))).toEqual([]);

  await approve.dblclick();
  const completed = page.getByText(`Created event “Venue booking call” — ${card[2]}.`, { exact: true });
  await expect(completed).toBeVisible({ timeout: 20_000 });
  await expect(completed).toHaveCount(1);
  await expect(page.locator('.alpha-action-review')).toHaveCount(0);
  state = await fixture(page);
  // One native request binds the reviewed operation to its reserved journal identity.
  expect(state.calendar).toHaveLength(1);
  expect(state.calendar[0].operation).toEqual(operation);
  expect(Object.keys(state.calendar[0]).sort()).toEqual(['journalIdentity', 'operation', 'operationId']);
  expect(state.calendar[0].journalIdentity).toEqual(state.journalIdentity);
  expect(state.calendar[0].journalIdentity.proposalId).toBe('fixture-calendar');
  expect(state.calendar[0].journalIdentity.scope).toEqual(expect.any(String));
  expect(state.decisions).toEqual(['approve']);
  expect(state.states).toEqual([['fixture-calendar', 'succeeded']]);
  expect(state.receipts).toEqual([expect.objectContaining({ outcome: 'applied', result: { version: 1, kind: 'calendar_create_local', sourceId: '7', eventId: '42', revision: 'c'.repeat(64) } })]);
  // The renderer shows no second review of its own on Android: the native dialog is the second review.
  await expect(page.getByRole('dialog', { name: 'Review calendar change' })).toHaveCount(0);
  // A reload does not run it again.
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).declineFixture.installationId), { timeout: 30_000 }).not.toBe('');
  expect((await fixture(page)).calendar).toEqual([]);
});

test('Android: declining the calendar proposal hands nothing to the Calendar plugin', async ({ page }) => {
  test.setTimeout(90_000);
  await residentAgent(page, operation, ['calendar.create.v1']);
  await connected(page);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect(page.getByText('Create event', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Cancel Keep things as they are\./ }).click();
  await expect(page.getByText('Declined. No phone action was performed.', { exact: true })).toBeVisible({ timeout: 20_000 });
  const state = await fixture(page);
  expect(state.calendar).toEqual([]);
  expect(state.states).toEqual([['fixture-calendar', 'rejected']]);
  expect(state.journal.filter(m => ['reserve', 'markApplying', 'finish'].includes(m))).toEqual([]);
  await expect(page.getByText('Create event', { exact: true })).toHaveCount(0);
});

test('Android: a calendar proposal from an agent that has not negotiated Calendar creation is never offered for approval', async ({ page }) => {
  test.setTimeout(90_000);
  await residentAgent(page, operation, []);
  await connected(page);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  // The phone has read the agent's proposals; the unsupported one gets no approval control.
  await expect.poll(() => page.evaluate(() => (window as any).declineFixture.lists), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Create event', { exact: true })).toHaveCount(0);
  const state = await fixture(page);
  expect(state.calendar).toEqual([]);
  expect(state.decisions).toEqual([]);
  expect(state.states).toEqual([['fixture-calendar', 'pending']]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
