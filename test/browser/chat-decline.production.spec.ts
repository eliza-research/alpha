import {seedCompletedAccessSetup} from './flag-off-android';
import { completeAccessSetup } from './flag-off-android';
import { test, expect, type Page } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// Flag-off product surfaces: the packaged resident agent behind a funded Eliza Cloud account, over
// a synthetic Android IPC boundary. The agent, its proposal store and the action journal are
// in-page fixtures; no provider, real account, credential or device effect is used.
const AGENT = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';

async function residentAgent(page: Page, seed: 'pending' | 'reconcile') {
  await installResidentAgentPlugin(page);
  await page.addInitScript(({ agentId, seed }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    const future = Date.now() + 86_400_000, account = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    store.set('cloud:production', JSON.stringify({ token: 'synthetic-cloud-key', credentialId: account, expiresAt: future }));
    const f = w.declineFixture = { decisions: [] as string[], reconciliations: [] as unknown[], effects: 0, journal: [] as string[], unexpected: [] as string[], proposals: [] as any[], installationId: '' };
    const resident = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId, unexpected: f.unexpected });
    const proposal = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
      id, digest: (id === 'fixture-reconcile' ? 'b' : 'a').repeat(64), state, expiresAt: new Date(future).toISOString(),
      subjectUserId: 'fixture-owner', requestedBy: agentId, action: 'device_action',
      payload: { action: 'device_action', version: 1, installationId: f.installationId, enrollmentId: 'fixture-enrollment', operation: { type: 'create_note', title: id === 'fixture-reconcile' ? 'Reconcile fixture note' : 'Declined fixture note', body: 'Synthetic fixture only' } },
      ...extra,
    });
    // One synthetic resident agent: authenticated identity, device enrollment and proposal store.
    const agent = (method: string, path: string, body: any, headers: Record<string, string>): { status: number; data: unknown } => {
      const ok = (data: unknown) => ({ status: 200, data });
      if (path === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Decline fixture', status: 'running' }] });
      if (path === '/api/client-devices/register') {
        f.installationId = headers['X-Eliza-Device-Id'];
        f.proposals = [seed === 'reconcile' ? proposal('fixture-reconcile', 'reconciliation_required', { execution: { attemptId: 'fixture-attempt' } }) : proposal('fixture-decline', 'pending')];
        return ok({ installationId: f.installationId, enrollmentId: 'fixture-enrollment', capabilities: [] });
      }
      if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
      if (path === '/api/conversations') return ok({ conversations: [] });
      if (path === '/api/client-devices/proposals') return ok({ proposals: f.proposals });
      const match = /^\/api\/client-devices\/proposals\/([^/]+)\/(decision|reconciliation|claim|receipt)$/.exec(path);
      if (match && method === 'POST') {
        const item = f.proposals.find(p => p.id === match[1]);
        if (!item || body.digest !== item.digest) return { status: 409, data: {} };
        if (match[2] === 'decision') {
          f.decisions.push(body.decision);
          if (body.decision !== 'reject' || item.state !== 'pending') return { status: 409, data: {} };
          item.state = 'rejected';
        } else if (match[2] === 'reconciliation') {
          f.reconciliations.push({ attemptId: body.attemptId, resolution: body.resolution });
          if (item.state !== 'reconciliation_required' || body.attemptId !== 'fixture-attempt') return { status: 409, data: {} };
          item.state = body.resolution?.outcome === 'not_applied' ? 'not_applied' : 'succeeded';
        } else { f.effects++; return { status: 409, data: {} }; }
        return ok({ proposal: item, digest: item.digest });
      }
      f.unexpected.push(method + ' ' + path);
      return { status: 404, data: {} };
    };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        { name: 'Agent', methods: resident.methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'list', 'get']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
      ],
      nativeCallback: resident.nativeCallback,
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'decline-fixture' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') {
          f.journal.push(method);
          if (method === 'list') return { entries: [] };
          if (method === 'get') return { entry: null };
          throw Error('Unexpected journal effect');
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
  }, { agentId: AGENT, seed });
}
const fixture = (page: Page) => page.evaluate(() => {
  const f = (window as any).declineFixture;
  return { decisions: f.decisions, reconciliations: f.reconciliations, effects: f.effects, journal: f.journal, states: f.proposals.map((p: any) => [p.id, p.state]), unexpected: f.unexpected };
});
async function connected(page: Page, options: { review?: boolean } = {}) {
  await page.goto('/');
  // Development builds offer an explicit start; production starts the funded resident agent itself.
  const start = page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true });
  await expect.poll(async () => await start.isVisible().catch(() => false) || await page.evaluate(() => (window as any).declineFixture.installationId !== ''), { timeout: 30_000 }).toBe(true);
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect.poll(() => page.evaluate(() => (window as any).declineFixture.installationId), { timeout: 30_000 }).not.toBe('');
  // Review history is retained for Activity without opening an automatic modal.
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);
}

test('a proposal is declined from its chat card and the agent records the rejection', async ({ page }) => {
  test.setTimeout(90_000);
  await residentAgent(page, 'pending');
  await connected(page);
  // A pending proposal is recovered into the conversation for review; nothing is sent.
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await expect(page.getByText('Create note', { exact: true })).toBeVisible({ timeout: 20_000 });
  const decline = page.getByRole('button', { name: /^Cancel Keep things as they are\./ });
  await expect(decline).toBeVisible();
  await decline.click();
  const declined = page.getByText('Declined. No phone action was performed.', { exact: true });
  await expect(declined).toBeVisible({ timeout: 20_000 });
  await expect(declined).toHaveCount(1);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  // Server state reads back as rejected; nothing was claimed, journaled or executed.
  const state = await fixture(page);
  expect(state.states).toEqual([['fixture-decline', 'rejected']]);
  expect(state.decisions).toEqual(['reject']);
  expect(state.effects).toBe(0);
  expect(state.journal.filter((m: string) => ['reserve', 'markApplying', 'finish'].includes(m))).toEqual([]);
  // The declined card has no approval or decline action left.
  await expect(page.getByRole('button', { name: /^Cancel Keep things as they are\./ })).toHaveCount(0);
  await expect(page.getByText('Create note', { exact: true })).toHaveCount(0);
});

test('Activity reconciles a reconciliation-required entry as not applied', async ({ page }) => {
  test.setTimeout(90_000);
  await residentAgent(page, 'reconcile');
  await connected(page, { review: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Privacy & data', { exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const app = page.locator('[data-alpha-layer="app"]');
  // Background proposal recovery stays passive. Activity loads its history only
  // when the owner asks, before any reconciliation decision is available.
  await app.getByRole('button', { name: 'Load phone action history', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Refresh phone action history', exact: true })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Load phone action history', exact: true })).toHaveCount(0);
  await expect(app.getByText('Needs your review', { exact: true })).toBeVisible();
  await expect(app.getByRole('button', { name: 'It happened', exact: true })).toBeVisible();
  await app.getByRole('button', { name: 'It did not happen', exact: true }).click();
  await expect.poll(async () => (await fixture(page)).states).toEqual([['fixture-reconcile', 'not_applied']]);
  const state = await fixture(page);
  expect(state.reconciliations).toEqual([{ attemptId: 'fixture-attempt', resolution: { confirmed: true, outcome: 'not_applied' } }]);
  expect(state.effects).toBe(0);
  expect(state.decisions).toEqual([]);
  expect(state.journal.filter((m: string) => ['reserve', 'markApplying', 'finish'].includes(m))).toEqual([]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
