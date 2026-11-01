import { cloudStorageSlot } from '../../apps/app/src/runtime/cloud-deployment.generated';
import {seedCompletedAccessSetup} from './flag-off-android';
import { test, expect, type Page, type Route } from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
import { openYourAgent, completeAccessSetup } from './flag-off-android';
// Flag-off production bundle only. Android cases stub the Capacitor bridge in a desktop browser and
// saved remote selections must never reconnect. Nothing here contacts
// Eliza Cloud, a deployed agent, an Android device or the native AlphaConnection plugin; those
// stay real-service and device acceptance.

const SELECTION = 'alpha.connection.selection.v1', CLOUD_SERVICE = 'alpha.connection.cloud-service.v1';
const origin = 'https://agent.example.test';
const owner = '0f1b6c2e-8f43-4c8a-9a52-5b7e0e1a1f11', agent = '7d4e0c1a-2b3c-4d5e-8f60-718293a4b5c6';
const token = 'synthetic-machine-session';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

/** Aborts and records every request that leaves the preview server. */
async function fenceNetwork(page: Page, serve?: (route: Route) => Promise<unknown> | unknown) {
  const foreign: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (serve && url.origin === origin) return serve(route);
    foreign.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  return foreign;
}

type RevokeMode = 'revoked' | 'unsupported' | 'failed' | 'refused-in-body' | 'not-revoked-status' | 'no-content' | 'unauthorized' | 'server-error' | 'cancelled';
interface NativeCall { plugin: string; method: string; slot?: string; url?: string; http?: string; authorization?: string; path?: string }
interface AndroidOptions { selection?: unknown; remoteCredential?: boolean; cloudCredential?: boolean; balance?: number; revoke?: RevokeMode; packaged?: boolean; start?: 'reject' | 'starting' }
/** Production Android as the renderer sees it: resident Agent plugin plus AlphaConnection storage and transport. */
async function android(page: Page, options: AndroidOptions) {
  await installResidentAgentPlugin(page);
  await page.addInitScript(({ options, SELECTION, origin, owner, token }) => {
    const w = window as any; w.androidBridge = {}; w.nativeCalls = [];
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    const resident = w.residentAgent = w.createResidentAgentPlugin({ owner: () => id, agentId: id });
    // Secure slots survive reload like Keystore-backed storage; the selection is seeded once.
    const values: Record<string, string> = JSON.parse(sessionStorage.getItem('secure-fixture') || 'null') ?? {
      ...(options.remoteCredential ? { [`remote:${origin}`]: JSON.stringify({ origin, token, identityId: owner, sessionId: token, expiresAt: Date.now() + 3_600_000 }) } : {}),
      ...(options.cloudCredential ? { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id }) } : {}),
    };
    const persist = () => sessionStorage.setItem('secure-fixture', JSON.stringify(values));
    if (!sessionStorage.getItem('secure-fixture')) { persist(); if (options.selection) localStorage.setItem(SELECTION, JSON.stringify(options.selection)); }
    w.secureValues = () => ({ ...values });
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = { PluginHeaders: [
        { name: 'AlphaDeletions', methods: methods(['pending']) },
      { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
      { name: 'Agent', methods: resident.methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'clearProvider', 'providerStatus', 'request']) },
      { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
      { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
      { name: 'AlphaHostedResults', methods: methods(['disableBackground']) },
      { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
      // P-43: a running resident's hosted background delivery is retired on sign-out.
      { name: 'AlphaHostedResults', methods: methods(['disableBackground']) },
    ], nativeCallback: resident.nativeCallback, nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
      w.nativeCalls.push({ plugin, method, slot: input?.slot, url: input?.url, http: input?.method, authorization: input?.headers?.Authorization, path: input?.path });
      if (plugin === 'AlphaHostedResults') return {};
      if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'connection-boundaries' };
      if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
      if (plugin === 'AlphaHostedResults' && method === 'disableBackground') return {};
      if (plugin === 'Agent') {
        const owned = resident.answer(method, input); if (owned) return owned;
        if (method === 'getStatus') return { packaged: options.packaged !== false, state: 'stopped', serviceActive: false, socketListening: false };
        // A held unbind lets a test cancel sign-out before any revocation request is issued.
        if (method === 'clearProvider') { if (w.holdStop) await new Promise<void>(resolve => { w.releaseStop = resolve; }); return { configured: false }; }
        if (method === 'providerStatus') return { provider: 'elizacloud', configured: false };
        // A packaged runtime whose start fails, or that answers but is not running yet.
        if (method === 'start' && options.start === 'reject') throw Error('Local agent failed to start.');
        if (method === 'request') {
          const body = input.path === '/api/auth/me' ? { identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } }
            : input.path === '/api/agents' ? { agents: [{ id, name: 'Alpha', status: options.start === 'starting' ? 'starting' : 'running' }] }
            : input.path === '/api/conversations' ? { conversations: [] } : {};
          return { status: 200, body: JSON.stringify(body) };
        }
        return {};
      }
      if (method === 'secureRead') return { value: values[input.slot] ?? null };
      if (method === 'secureWrite') { values[input.slot] = input.value; persist(); return {}; }
      if (method === 'secureRemove') { delete values[input.slot]; persist(); return {}; }
      if (method === 'secureCompareExchange') { if ((values[input.slot] ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) delete values[input.slot]; else values[input.slot] = input.value; persist(); return { status: 'saved' }; }
      if (method === 'request') {
        const url = new URL(input.url);
        // Only the fixed Cloud authority answers; any other host is a transport failure.
        if (url.origin !== 'https://api.eliza.app') throw Error('Connection request failed');
        if (url.pathname === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
        if (url.pathname === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Entitlement route absent: the billing snapshot answers.
        // `balance` > 0 stands for an account holding an active plan; otherwise the account has no plan.
        if (url.pathname === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: (options.balance ?? 0) > 0 ? { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } : { status: 'not_applicable', reason: 'no_organization_subscription' } } } } };
        if (url.pathname === '/api/v1/api-keys/current' && input.method === 'DELETE') {
          if (options.revoke === 'failed') throw Error('Connection request failed');
          if (options.revoke === 'revoked') return { status: 200, data: { success: true, status: 'revoked', credentialId: id, revokedAt: new Date().toISOString() } };
          // Success statuses that do not confirm a revocation, and refusals, are never reported as revoked.
          if (options.revoke === 'refused-in-body') return { status: 200, data: { success: false, error: 'synthetic refusal' } };
          if (options.revoke === 'not-revoked-status') return { status: 200, data: { success: true, status: 'active', credentialId: id } };
          if (options.revoke === 'no-content') return { status: 204, data: null };
          if (options.revoke === 'unauthorized') return { status: 401, data: { success: false } };
          if (options.revoke === 'server-error') return { status: 500, data: {} };
          return { status: 405, data: {} };
        }
        throw Error('Unexpected Cloud route: ' + url.pathname);
      }
      return {};
    } };
  }, { options, SELECTION, origin, owner, token });
}
const nativeCalls = (page: Page) => page.evaluate(() => (window as any).nativeCalls as NativeCall[]);
const secureValues = (page: Page) => page.evaluate(() => (window as any).secureValues() as Record<string, string>);
const remoteSlot = `remote:${origin}`;
/** No pairing, restore or credential mutation reached the saved remote agent. */
function expectRemoteUntouched(calls: NativeCall[]) {
  expect(calls.filter(call => call.url?.startsWith(origin) || call.url?.includes('/api/auth/pair'))).toEqual([]);
  // The saved remote credential is not read, written or removed.
  expect(calls.filter(call => call.slot?.startsWith('remote:'))).toEqual([]);
}

for (const legacy of [{ name: 'remote agent', selection: { kind: 'remote', origin } }, { name: 'local development agent', selection: { kind: 'local', origin } }, { name: 'Cloud agent', selection: { kind: 'cloud', environment: 'production', agentId: agent, ownerId: owner } }]) {
  test(`production Android never pairs or restores a saved ${legacy.name} and keeps its credential`, async ({ page }) => {
    const foreign = await fenceNetwork(page);
    await android(page, { selection: legacy.selection, remoteCredential: true });
    await page.goto('/');
    // P-43: the resident starts in place of the saved agent, signed out. Every Alpha Phone needs an
    // Eliza Cloud account, so the sign-in dialog opens and cannot be dismissed while the agent runs.
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    const saved = await secureValues(page);
    const welcome = page.getByRole('main', { name: 'Welcome to Alpha.',exact:true });
    await expect(welcome).toBeVisible();
    // The retired route has no entry: no address, code or connect control, and no fake remote state.
    await expect(welcome.getByLabel('Agent HTTPS address')).toHaveCount(0);
    await expect(welcome.getByLabel('Pairing code')).toHaveCount(0);
    await expect(welcome.getByRole('button', { name: /Connect (remote|local) agent/ })).toHaveCount(0);
    await expect(welcome.getByText(/Remote agent|Connected ·/)).toHaveCount(0);
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    // Every Alpha Phone signs in to Eliza Cloud: no local-only bypass and no close while signed out.
    await expect(welcome.getByRole('button', { name: 'Use local apps without AI', exact: true })).toHaveCount(0);
    await expect(welcome.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    await expect(welcome.getByRole('form', { name: 'Sign in with email', exact: true })).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Close connection settings', exact: true })).toHaveCount(0);
    expectRemoteUntouched(await nativeCalls(page));
    expect((await secureValues(page))[remoteSlot]).toBe(saved[remoteSlot]);
    // #406: the saved hosted choice becomes the resident agent and is kept aside, not deleted.
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual({ kind: 'resident' });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.legacy-hosted-selection.v1')!))).toEqual([legacy.selection]);
    await page.reload();
    await expect(page.getByRole('main', { name: 'Welcome to Alpha.',exact:true })).toBeVisible();
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    const calls = await nativeCalls(page);
    expectRemoteUntouched(calls);
    // Signed out and offline: no transport request of any kind. The resident agent always runs on
    // the phone (owner directive 2026-10-13), without Cloud AI until the owner signs in.
    expect(calls.filter(call => call.plugin === 'AlphaConnection' && call.method === 'request')).toEqual([]);
    expect(calls.filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    expect(calls.filter(call => call.plugin === 'Agent').map(call => call.method)).not.toContain('configureCloudProvider');
    expect((await secureValues(page))[remoteSlot]).toBe(saved[remoteSlot]);
    expect(foreign).toEqual([]);
  });
}

test('production Android with a Cloud sign-in starts the resident agent instead of a saved remote agent', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await android(page, { selection: { kind: 'remote', origin }, remoteCredential: true, cloudCredential: true, balance: 5 });
  await page.goto('/');
  await completeAccessSetup(page);
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await nativeCalls(page);
  expectRemoteUntouched(calls);
  const agentCalls = calls.filter(call => call.plugin === 'Agent').map(call => call.method);
  expect(agentCalls).toContain('configureCloudProvider');
  // Cloud authorizes the provider (identity, plan) and account services; it is never the agent runtime.
  const routes = [...new Set(calls.filter(call => call.plugin === 'AlphaConnection' && call.method === 'request').map(call => new URL(call.url!).origin + new URL(call.url!).pathname))];
  expect(routes).toEqual(expect.arrayContaining(['https://api.eliza.app/api/v1/billing/limits', 'https://api.eliza.app/api/v1/user']));
  expect(routes).not.toContain('https://api.eliza.app/api/v1/credits/balance');
  expect(routes.filter(route => !route.startsWith('https://api.eliza.app/api/v1/') || /\/(agents|personal|conversations|messages)(\/|$)/.test(route))).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual({ kind: 'resident' });
  expect((await secureValues(page))[remoteSlot]).toContain(token);
  expect(foreign).toEqual([]);
});

test('production Android without a packaged agent says so and does not advertise retired routes', async ({ page }) => {
  await fenceNetwork(page);
  await android(page, { cloudCredential: true, balance: 5, packaged: false });
  await page.goto('/');
  await completeAccessSetup(page);
  // A developer build without the runtime opens no gate; Your agent says so, with Retry, never an offline mode.
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  const dialog = await openYourAgent(page);
  const alert = dialog.getByText('This developer build does not include the on-device agent.',{exact:true});
  await expect(alert).toHaveText('This developer build does not include the on-device agent.');
  await expect(alert).not.toContainText(/remote agent|pair/i);
  await expect(dialog.getByText('Not running', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use local apps without AI', exact: true })).toHaveCount(0);
  expect((await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).not.toContain('start');
});

for (const [start, text] of [['reject', 'Local agent failed to start.'], ['starting', 'The local agent is still starting. Try again when it is ready.']] as const) {
  test(`production Android with credits whose resident ${start === 'reject' ? 'fails to start' : 'is still starting'} recovers with a retry, never "no agent"`, async ({ page }) => {
    const foreign = await fenceNetwork(page);
    await android(page, { cloudCredential: true, balance: 5, start });
    await page.goto('/');
    await completeAccessSetup(page);
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    // P-43: a failed start opens no gate; Your agent shows Not running with Retry and the failure.
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
    const dialog = await openYourAgent(page);
    await expect(dialog.getByText('Not running', { exact: true })).toBeVisible();
    await expect(dialog.getByText(text,{exact:true})).toContainText(text);
    await expect(dialog.getByText(text,{exact:true})).not.toContainText(/pair/i);
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Use local apps without AI', exact: true })).toHaveCount(0);
    const calls = await nativeCalls(page);
    // The resident is the only selection, and no conversation was created or read.
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual({ kind: 'resident' });
    expect(calls.filter(call => call.path?.startsWith('/api/conversations'))).toEqual([]);
    // Retry starts once more, on the owner's tap; it fails the same way.
    const starts = calls.filter(call => call.plugin === 'Agent' && call.method === 'start').length;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent' && call.method === 'start').length).toBe(starts + 1);
    await expect(dialog.getByText(text,{exact:true})).toContainText(text);
    expect((await nativeCalls(page)).filter(call => call.path?.startsWith('/api/conversations'))).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

for (const mode of ['revoked', 'unsupported', 'failed', 'refused-in-body', 'not-revoked-status', 'no-content', 'unauthorized', 'server-error', 'cancelled'] as const) {
  test(`production Android Cloud sign-out states only the revocation that happened: ${mode}`, async ({ page }) => {
    const foreign = await fenceNetwork(page);
    // Plan state never stops the resident (P-43). Open account settings explicitly to sign out.
    await android(page, { cloudCredential: true, balance: 5, revoke: mode });
    await page.goto('/');
    await completeAccessSetup(page);
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
    await expect.poll(async () => (await nativeCalls(page)).filter(call => call.plugin === 'Agent').map(call => call.method)).toContain('start');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Eliza Cloud account & plan',exact:true }).click();
    await expect(page.getByRole('button', { name: 'Sign out of Eliza Cloud', exact: true })).toBeVisible();
    const before = (await nativeCalls(page)).length;
    if (mode === 'cancelled') await page.evaluate(() => { (window as any).holdStop = true; });
    await page.getByRole('button', { name: 'Sign out of Eliza Cloud', exact: true }).click();
    if (mode === 'cancelled') {
      // Cancel while Cloud AI is still being unbound: sign-out still removes the local key.
      await page.waitForFunction(() => typeof (window as any).releaseStop === 'function');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(() => { (window as any).holdStop = false; (window as any).releaseStop(); });
    }
    // This bridge has no sign-in readiness service. Its automatic refusal must not erase
    // the completed sign-out receipt or turn an unconfirmed revocation into success.
    await expect(page.getByRole('alert').filter({hasText:'Eliza Cloud sign-in is unavailable right now. Try again.'})).toBeVisible();
    const status = page.locator('.alpha-connection').getByRole('status').filter({ hasText: /Signed out|sign-in token was removed/ });
    if (mode === 'revoked') await expect(status).toContainText('Signed out of Eliza Cloud. This sign-in was revoked.');
    else {
      await expect(status).toContainText('The sign-in token was removed here; Eliza Cloud did not confirm revoking it.');
      await expect(page.getByText(/was revoked/)).toHaveCount(0);
    }
    const calls = await nativeCalls(page);
    const revocations = calls.filter(call => call.http === 'DELETE');
    // One attempt, to the fixed self-revocation route, presenting only the key being revoked.
    // A cancelled sign-out sends none. The key is presented to no other host in any outcome.
    expect(revocations.map(call => [call.url, call.authorization])).toEqual(mode === 'cancelled' ? [] : [['https://api.eliza.app/api/v1/api-keys/current', 'Bearer synthetic-cloud-key']]);
    expect(calls.filter(call => call.authorization && !call.url?.startsWith('https://api.eliza.app/'))).toEqual([]);
    // This sign-out unbinds Cloud AI (native stops a process holding the key) before the key is
    // revoked, and the local key is always removed. The agent itself keeps running afterwards.
    const stop = calls.findIndex((call, index) => index >= before && call.plugin === 'Agent' && call.method === 'clearProvider');
    expect(stop).toBeGreaterThan(-1);
    expect(calls.slice(before).some(call => call.plugin === 'AlphaHostedResults' && call.method === 'disableBackground')).toBe(true);
    if (mode !== 'cancelled') expect(stop).toBeLessThan(calls.indexOf(revocations[0]));
    expect(await secureValues(page)).not.toHaveProperty('cloud:production');
    await expect(page.getByRole('main', { name: 'Welcome to Alpha.', exact: true }).getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    // P-43: sign-out unbinds inference only; the resident restarted and the outcome says so.
    if (mode !== 'cancelled') await expect(status).toContainText('Your agent is running. Sign in to Cloud to turn AI back on.');
    await expect.poll(async () => (await nativeCalls(page)).slice(before).filter(call => call.plugin === 'Agent' && call.method === 'start').length).toBeGreaterThan(0);
    await page.reload();
    // Signed out after a restart: the sign-in dialog opens by itself while the resident runs.
    await expect(page.getByRole('main', { name: 'Welcome to Alpha.', exact: true })).toBeVisible();
    expect((await nativeCalls(page)).filter(call => call.plugin === 'AlphaConnection' && call.method === 'request')).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

const legacyWeb: Array<{ name: string; selection?: unknown; service?: string; alert?: RegExp; status?: RegExp }> = [
  { name: 'mock selection', selection: { kind: 'mock' }, status: /connects to real agents only/ },
  { name: 'Cloud staging service', selection: { kind: 'none' }, service: 'staging' },
  { name: 'Cloud staging agent', selection: { kind: 'cloud', environment: 'staging', agentId: agent, ownerId: owner }, service: 'staging' },
  { name: 'Cloud production agent', selection: { kind: 'cloud', environment: 'production', agentId: agent, ownerId: owner }, service: 'production', alert: /Eliza Cloud does not accept sign-in requests from this web page/ },
  { name: 'Cloud production service', selection: { kind: 'none' }, service: 'production' },
  { name: 'plain-HTTP local agent', selection: { kind: 'local', origin: 'http://127.0.0.1:9' } },
  { name: 'development profile', selection: { kind: 'development', profile: 'local' } },
  { name: 'on-device agent', selection: { kind: 'resident' }, alert: /The local agent is unavailable here\. Alpha runs its agent on the phone; this preview needs the local agent\./ },
];
for (const legacy of legacyWeb) {
  test(`the web build opens the chooser signed out for a saved ${legacy.name}`, async ({ page }) => {
    const foreign = await fenceNetwork(page);
    await page.addInitScript(({ legacy, SELECTION, CLOUD_SERVICE }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      if (legacy.selection) localStorage.setItem(SELECTION, JSON.stringify(legacy.selection));
      if (legacy.service) localStorage.setItem(CLOUD_SERVICE, legacy.service);
    }, { legacy, SELECTION, CLOUD_SERVICE });
    await page.goto('/');
    const chooser = page.locator('.alpha-connection');
    await expect(chooser.getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
    await expect(chooser.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    // Nothing is connected, no sign-in is offered or implied and no mock or development surface opens.
    await expect(chooser.getByText(/Connected ·/)).toHaveCount(0);
    await expect(chooser.getByRole('button', { name: 'Disconnect agent', exact: true })).toHaveCount(0);
    await expect(chooser.getByText(/Sign in again|Sign in with Eliza Cloud to continue|sign in with Eliza Cloud,/i)).toHaveCount(0);
    await expect(chooser.getByText('Development connections', { exact: true })).toHaveCount(0);
    await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    expect(await page.evaluate(key => localStorage.getItem(key), CLOUD_SERVICE)).toBeNull();
    await chooser.getByRole('button', { name: 'Open local apps', exact: true }).click();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
    // A-27 interim: the web preview runs no agent; it keeps the choice to open its local apps.
    expect(await page.evaluate(key => localStorage.getItem(key) ?? '', SELECTION)).toBe(JSON.stringify({ kind: 'offline' }));
    expect(foreign).toEqual([]);
  });
}

// Browser secret store as the web build writes it: database alpha-connection-secrets.v1, object stores
// "keys" and "slots", one {iv,data} record per slot. Records here are synthetic bytes, never a real key.
const SECRETS = 'alpha-connection-secrets.v1';
const slotRecords = (page: Page) => page.evaluate(async name => {
  if (!(await indexedDB.databases()).some(database => database.name === name)) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
  try {
    if (!db.objectStoreNames.contains('slots')) return {};
    const store = db.transaction('slots', 'readonly').objectStore('slots');
    const all = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [keys, values] = await Promise.all([all(store.getAllKeys()), all(store.getAll())]);
    return Object.fromEntries(keys.map((key, index) => [String(key), [...new Uint8Array(values[index].iv), ...new Uint8Array(values[index].data)].join(',')]));
  } finally { db.close(); }
}, SECRETS);
const CURRENT_CLOUD_SLOT = cloudStorageSlot('cloud:production');
const KEPT_SLOTS = [`remote:${origin}`, 'remote:https://second-agent.example.test', 'device:installation', 'cloud-runtime:synthetic', 'cloud:production', 'cloud:staging', cloudStorageSlot('cloud:staging'), 'cloud-deployment:other:cloud:production'];
// Stand-ins for other data this origin holds (notes, unsent drafts); the keys are synthetic so the app does not interpret them.
const LOCAL_DATA = { 'synthetic.notes': '{"notes":[{"id":"n1","text":"Synthetic note"}]}', 'synthetic.assistant-draft': 'Synthetic unsent draft', 'synthetic.workflow-draft': '{"prompt":"Synthetic workflow draft"}' };
for (const saved of [
  { name: 'a saved Cloud agent', selection: { kind: 'cloud', environment: 'production', agentId: agent, ownerId: owner }, service: 'production' as string | null },
  { name: 'a saved Cloud service', selection: { kind: 'none' }, service: 'production' as string | null },
  // Round 3 already removed the marker and selection here; the key it left behind is removed on the next start.
  { name: 'a Cloud key left by an earlier sign-out', selection: { kind: 'none' }, service: null as string | null },
  // Round 4: an offline choice returned before the sign-out, so its Cloud marker and key stayed for good.
  { name: 'a saved Cloud service behind an offline choice', selection: { kind: 'offline' }, service: 'production' as string | null, offline: true },
]) {
  test(`the web build's forced sign-out removes the stored Cloud key and nothing else: ${saved.name}`, async ({ page }) => {
    const foreign = await fenceNetwork(page);
    // Seed from a static file of the same origin, before the app has run.
    await page.goto('/build-flags.json');
    await page.evaluate(async ({ saved, SELECTION, CLOUD_SERVICE, SECRETS, CURRENT_CLOUD_SLOT, KEPT_SLOTS, LOCAL_DATA }) => {
      localStorage.setItem(SELECTION, JSON.stringify(saved.selection));
      if (saved.service) localStorage.setItem(CLOUD_SERVICE, saved.service);
      for (const [key, value] of Object.entries(LOCAL_DATA)) localStorage.setItem(key, value);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(SECRETS, 1);
        open.onupgradeneeded = () => { open.result.createObjectStore('keys'); open.result.createObjectStore('slots'); };
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      const tx = db.transaction('slots', 'readwrite');
      [CURRENT_CLOUD_SLOT, ...KEPT_SLOTS].forEach((slot, index) => tx.objectStore('slots').put({ iv: new Uint8Array(12).fill(index + 1), data: new Uint8Array(24).fill(index + 101).buffer }, slot));
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    }, { saved, SELECTION, CLOUD_SERVICE, SECRETS, CURRENT_CLOUD_SLOT, KEPT_SLOTS, LOCAL_DATA });
    const before = (await slotRecords(page))!;
    expect(Object.keys(before).sort()).toEqual([CURRENT_CLOUD_SLOT, ...KEPT_SLOTS].sort());
    await page.goto('/');
    const chooser = page.locator('.alpha-connection');
    const offline = 'offline' in saved;
    // The offline choice is kept and opens no chooser; every other case requires a choice.
    if (!offline) await expect(chooser.getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
    await expect.poll(async () => Object.keys((await slotRecords(page))!).sort()).toEqual([...KEPT_SLOTS].sort());
    // Remote-agent, device and other slots keep their exact bytes; notes and drafts are untouched.
    const { [CURRENT_CLOUD_SLOT]: removed, ...kept } = before;
    expect(removed).toBeTruthy();
    expect(await slotRecords(page)).toEqual(kept);
    expect(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(LOCAL_DATA))).toEqual(LOCAL_DATA);
    expect(await page.evaluate(key => localStorage.getItem(key), CLOUD_SERVICE)).toBeNull();
    // #406: a saved Cloud agent becomes the resident agent and is kept aside; other choices are unchanged.
    const hostedChoice = (saved.selection as { kind: string }).kind === 'cloud';
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual(hostedChoice ? { kind: 'resident' } : saved.selection);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.legacy-hosted-selection.v1') || 'null'))).toEqual(hostedChoice ? [saved.selection] : null);
    await expect(chooser.getByText(/Connected ·/)).toHaveCount(0);
    // A later start changes nothing further, and no request left the page at any point.
    await page.reload();
    if (offline) await expect(chooser).toHaveCount(0);
    else await expect(chooser.getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
    expect(await slotRecords(page)).toEqual(kept);
    expect(foreign).toEqual([]);
  });
}

test('the web build\'s forced sign-out does not create a secret store in a browser that never had one', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await page.addInitScript(({ SELECTION, CLOUD_SERVICE }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(SELECTION, JSON.stringify({ kind: 'none' })); localStorage.setItem(CLOUD_SERVICE, 'production');
  }, { SELECTION, CLOUD_SERVICE });
  await page.goto('/');
  await expect(page.locator('.alpha-connection').getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLOUD_SERVICE)).toBeNull();
  await page.waitForTimeout(500);
  expect(await slotRecords(page)).toBeNull();
  expect(foreign).toEqual([]);
});

// Production no longer offers remote pairing. Protocol-level wrong-owner, expired-session,
// revocation and history tests remain in scripts/test-remote-protocol.mjs and
// scripts/test-connection-history.mjs as explicitly non-product development infrastructure.

test('automatic agent startup stays quiet while local apps remain usable',async({page})=>{
  await android(page,{cloudCredential:true,balance:5});
  await page.addInitScript(()=>{
    const w=window as any,bridge=w.Capacitor,original=bridge.nativePromise;
    bridge.nativePromise=(plugin:string,method:string,input:any)=>{
      if(plugin==='Agent'&&method==='start')return new Promise(resolve=>{w.agentStartHeld=true;w.releaseAgentStart=()=>resolve(original(plugin,method,input));});
      return original(plugin,method,input);
    };
  });
  await page.goto('/');
  // Optional setup waits for startup to settle; local apps remain usable meanwhile.
  await expect(page.locator('.alpha-startup-permissions')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).agentStartHeld)).toBe(true);
  await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
  await expect(page.getByText('Your agent is starting…',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByText('Your agent is starting…',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as any).releaseAgentStart());
  await completeAccessSetup(page);
});

test('transient startup storage failures recover without flashing global notices',async({page})=>{
  await android(page,{cloudCredential:true,balance:5});
  await page.addInitScript(()=>{
    const w=window as any,bridge=w.Capacitor,original=bridge.nativePromise;
    w.startupStorage={pending:0,drafts:0,flashes:[]};
    bridge.nativePromise=(plugin:string,method:string,input:any)=>{
      if(plugin==='AlphaDeletions'&&method==='pending'&&++w.startupStorage.pending<=2)return Promise.reject(Error('Storage is opening'));
      if(plugin==='AlphaConnection'&&method==='secureRead'&&input?.slot?.startsWith('assistant-draft:')&&++w.startupStorage.drafts===1)return Promise.reject(Error('Storage is opening'));
      return original(plugin,method,input);
    };
    new MutationObserver(()=>{
      const text=document.body?.textContent||'';
      if(/Pending deletion status is unavailable|Opening local draft|Local draft could not/.test(text))w.startupStorage.flashes.push(text);
    }).observe(document,{subtree:true,childList:true,characterData:true});
  });
  await page.goto('/');
  await completeAccessSetup(page);
  await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).startupStorage.pending)).toBeGreaterThanOrEqual(3);
  await expect.poll(()=>page.evaluate(()=>(window as any).startupStorage.drafts)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(()=>(window as any).startupStorage.flashes)).toEqual([]);
});

test('an unavailable deletion receipt status does not block account settings controls', async ({ page }) => {
  await android(page, { cloudCredential: true, balance: 5, revoke: 'revoked' });
  await page.goto('/');
  await completeAccessSetup(page);
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  await page.evaluate(() => {
    const bridge = (window as any).Capacitor, original = bridge.nativePromise;
    bridge.nativePromise = (plugin: string, method: string, input: unknown) => {
      if (plugin === 'AlphaDeletions' && method === 'pending') return Promise.reject(Error('Receipt store unavailable'));
      return original(plugin, method, input);
    };
    window.dispatchEvent(new Event('alpha:deletions-changed'));
  });
  const notice = page.getByRole('complementary', { name: 'Pending deletions' });
  await expect(notice).toContainText('Pending deletion status is unavailable');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Eliza Cloud account & plan',exact:true }).click();
  const signout = page.getByRole('button', { name: 'Sign out of Eliza Cloud', exact: true });
  // Force geometric overlap without forcing the click: informational text must not consume it.
  await signout.evaluate(button => {
    const banner = document.querySelector<HTMLElement>('.alpha-deletion-undo')!, rect = button.getBoundingClientRect();
    Object.assign(banner.style, { top: `${rect.top}px`, left: `${rect.left}px`, right: 'auto', bottom: 'auto', width: `${rect.width}px` });
  });
  await signout.click();
  await expect(page.locator('.alpha-connection').getByRole('status').filter({ hasText: 'Signed out of Eliza Cloud. This sign-in was revoked.' })).toBeVisible();
  await expect(notice).toContainText('Pending deletion status is unavailable');
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
