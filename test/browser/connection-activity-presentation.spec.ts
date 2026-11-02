import { test, expect } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';
// Real Settings Activity over the real connection controller and DeviceActions; only the Android
// IPC boundary is synthetic. No runtime, model or account is used and no action is performed.

test('Activity presents recorded phone actions in plain language with reconcile controls', async ({ page }) => {
  await installResidentAgentPlugin(page);
  await page.addInitScript(() => {
    const w = window as any; w.androidBridge = {};
    const store = new Map<string, string>();
    const f = w.activityFixture = { installationId: '', reconciliations: [] as unknown[] };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const agent = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId: 'fixture-agent', providerStatus: {provider: 'elizacloud', configured: false} });
    const proposal = (id: string, state: string, operation: unknown) => ({ id, subjectUserId: 'fixture-owner', requestedBy: 'fixture-agent', action: 'device_action', state, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), digest: 'a'.repeat(64),
      payload: { action: 'device_action', version: 1, installationId: f.installationId, enrollmentId: 'fixture-enrollment', operation } });
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'Agent', methods: agent.methods(['getStatus', 'start', 'stop', 'request']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener']) },
        { name: 'AlphaActionJournal', methods: methods(['list']) },
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
      ],
      nativeCallback: agent.nativeCallback,
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'activity-fixture' };
        if (plugin === 'AlphaActionJournal') return { entries: [{ scope: 'any', proposalId: 'note-proposal', operationId: 'op-1', operationHash: 'h', record: {}, phase: 'applying', applyingAt: Date.UTC(2026, 9, 8, 15, 30) }] };
        if (plugin === 'Agent') {
          const owned = agent.answer(method, input); if (owned) return owned;
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'start' || method === 'stop') return { state: method === 'start' ? 'ready' : 'stopping' };
          let body: any = {};
          if (input.path === '/api/auth/me') body = { identity: { kind: 'owner', id: 'fixture-owner' }, access: { role: 'OWNER', mode: 'session' } };
          else if (input.path === '/api/agents') body = { agents: [{ id: 'fixture-agent', name: 'Resident fixture', status: 'running' }] };
          else if (input.path === '/api/client-devices/register') { f.installationId = input.headers['X-Eliza-Device-Id']; body = { installationId: f.installationId, enrollmentId: 'fixture-enrollment', capabilities: [] }; }
          else if (input.path === '/api/conversations') body = { conversations: [] };
          else if (input.path === '/api/client-devices/proposals') body = { proposals: [
            proposal('note-proposal', 'reconciliation_required', { type: 'create_note', title: 'Groceries', body: 'Milk and eggs' }),
            proposal('pending-note', 'pending', { type: 'create_note', title: 'Call back', body: 'Tomorrow' }),
          ] };
          else return { status: 404, body: '{}' };
          return { status: 200, body: JSON.stringify(body) };
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
          if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); return { status: 'saved' }; }
          if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
          if (method === 'secureRemove') { store.delete(input.slot); return {}; }
          return {};
        }
        throw new Error(`Unexpected native call ${plugin}.${method}`);
      },
    };
  });
  await page.goto('/');
  if (!await page.locator('.alpha-connection-scrim').isVisible()) await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  await page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true }).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Privacy & data', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const app = page.locator('[data-alpha-layer="app"]');
  await app.getByRole('button', { name: 'Load phone action history', exact: true }).click();
  const panel = page.locator('.alpha-connection');
  // The uncertain action opens with its reconcile controls in the connection panel.
  await expect(panel.getByText('Create note', { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'I verified it happened', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reject proposal', exact: true })).toBeVisible();
  expect(await panel.innerText()).not.toContain('{"type"');
  await page.getByRole('button', { name: 'Close connection settings' }).first().click();
  await expect(app.getByText(/Create note · “Groceries” · Needs your review · this phone: applying/)).toBeVisible();
  await expect(app.getByText(/Create note · “Call back” · Waiting for your review · not dispatched by this phone/)).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('{"type"');
  expect(text).not.toContain('"title"');
  expect(await page.evaluate(() => (window as any).residentAgent.state.unexpected)).toEqual([]);
});
