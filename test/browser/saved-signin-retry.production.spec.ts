import {seedCompletedAccessSetup} from './flag-off-android';
import {completeAccessSetup} from './flag-off-android';
import { test, expect, type Page } from '@playwright/test';

// A Cloud sign-in kept on the phone after a restart, under decision P-43 (resident agent always
// present). An older build's "local apps without AI" choice is stored; it now reads as the resident.
// The resident starts by itself at app start and the kept sign-in is tried once to bind inference.
// Both panels that offer the sign-in (Settings › Agent connection and the one Inbox opens, "Connect
// Eliza Cloud") show the same state: a sign-in Cloud could not be reached is offered as "Retry saved
// connection" with what failed, a sign-in Cloud rejects is reported as no longer valid and not offered
// again, and an admitted one binds inference. The agent runs in every case and only on the device.
//
// Flag-off production bundle with the Android bridge stubbed. The stub is not the native plugins,
// the keystore or Eliza Cloud; the Android run is test-native-restart.mjs inbox on an emulator.
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });
type Mode = 'offline' | 'rejected' | 'funded';
type Call = { plugin: string; method: string; path?: string; url?: string };

async function boot(page: Page, mode: Mode) {
  await page.addInitScript(mode => {
    const w = window as any; w.androidBridge = {}; w.residentCalls = [];
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    // The state an older build's restart leaves: local apps chosen, and a sign-in still in the keystore.
    if (!sessionStorage.getItem('saved-signin-fixture')) { sessionStorage.setItem('saved-signin-fixture', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline', localApps: true })); }
    const values: Record<string, string> = w.savedSignInSlots = { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 600000 }) };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = { PluginHeaders: [
      { name: 'DeviceApps', methods: methods(['buildInfo']) },
      { name: 'Agent', methods: methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'clearProvider', 'providerStatus', 'request']) },
      { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
      { name: 'AlphaCloudSignIn', methods: methods(['status', 'startEmail', 'verifyEmail', 'cancel', 'addListener', 'removeListener']) },
      { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
      { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
    ], nativePromise: async (plugin: string, method: string, input: any) => {
      w.residentCalls.push({ plugin, method, path: input?.path, url: input?.url });
      if (plugin === 'AlphaCloudSignIn') {
        if (method === 'status') return { active: false, inApp: true, email: true, google: false };
        if (method === 'startEmail') return { attemptId: '33333333-3333-4333-8333-333333333333', expiresAt: Date.now() + 600000, resendAt: Date.now() + 60000 };
        if (method === 'verifyEmail') throw Error('This fixture never completes sign-in');
        return {};
      }
      if (plugin === 'DeviceApps') return { launcher: false, version: 'saved-signin-fixture' };
      if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
      if (plugin === 'Agent') {
        if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
        if (method === 'clearProvider') return { configured: false };
        if (method === 'providerStatus') return { provider: 'elizacloud', configured: false };
        if (method === 'request') {
          const body = input.path === '/api/auth/me' ? { identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } }
            : input.path === '/api/agents' ? { agents: [{ id, name: 'Alpha', status: 'running' }] }
            : input.path === '/api/conversations' ? { conversations: [] } : {};
          return { status: 200, body: JSON.stringify(body) };
        }
        return {};
      }
      if (method === 'secureRead') return { value: values[input.slot] ?? null };
      if (method === 'secureWrite') { values[input.slot] = input.value; return {}; }
      if (method === 'secureRemove') { delete values[input.slot]; return {}; }
      if (method === 'request') {
        // No network: every Cloud request fails before an answer.
        if (mode === 'offline') throw Error('Connection request failed');
        const path = new URL(input.url).pathname;
        // Cloud no longer accepts the kept sign-in.
        if (mode === 'rejected') return { status: 401, data: { error: 'unauthorized' } };
        if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
        if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
        if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
        if (path === '/api/v1/eliza/google/accounts') return { status: 200, data: { accounts: [] } };
        throw Error('Unexpected Cloud route: ' + path);
      }
      return {};
    } };
  }, mode);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  // P-43: the resident starts by itself. Only a sign-in Cloud rejects opens the sign-in dialog.
  await expect.poll(() => agentCalls(page)).toContain('start');
  if (mode === 'funded') await completeAccessSetup(page);
  if (mode !== 'rejected') await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await selection(page)).toEqual({ kind: 'resident' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).residentCalls as Call[]);
const cloudRequests = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'AlphaConnection' && call.method === 'request').map(call => new URL(call.url!).pathname);
const agentCalls = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'Agent').map(call => call.method);
const selection = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.selection.v1') || 'null'));

test('an unreachable saved sign-in remains on the mandatory page and can be retried without replacing its key',async({page})=>{
  await boot(page,'offline');
  const gate=page.getByRole('main',{name:'Sign in',exact:true});await expect(gate).toBeVisible();
  await expect(gate.getByRole('button',{name:'Retry saved connection',exact:true})).toBeEnabled();
  await expect(gate).not.toContainText(/Signed in|Credits available/);
  const starts=(await agentCalls(page)).filter(call=>call==='start').length;
  await gate.getByRole('button',{name:'Retry saved connection',exact:true}).click();
  await expect.poll(async()=>(await agentCalls(page)).filter(call=>call==='start').length).toBeGreaterThan(starts);
  await expect(gate).toBeVisible();expect(await agentCalls(page)).not.toContain('configureCloudProvider');
  expect(await selection(page)).toEqual({kind:'resident'});
});

test('saved connection retry stays reachable after backing out of sign-in or cancelling a code',async({page})=>{
  await page.route('https://**',route=>route.abort());
  await boot(page,'offline');
  const gate=page.getByRole('main',{name:'Sign in',exact:true});
  const key=await page.evaluate(()=>(window as any).savedSignInSlots['cloud:production']);
  await gate.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true}).click();
  await expect(gate.getByRole('form',{name:'Sign in with email'})).toBeVisible();
  await gate.getByRole('button',{name:'Back',exact:true}).click();
  await expect(gate.getByRole('button',{name:'Retry saved connection',exact:true})).toBeVisible();
  await expect(gate.getByRole('form',{name:'Sign in with email'})).toHaveCount(0);

  await gate.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true}).click();
  await gate.getByLabel('Email',{exact:true}).fill('return@example.invalid');
  await gate.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(gate.getByRole('form',{name:'Enter your email code'})).toBeVisible();
  await gate.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await expect(gate.getByRole('button',{name:'Retry saved connection',exact:true})).toBeVisible();
  await expect(gate.getByRole('form',{name:'Enter your email code'})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).savedSignInSlots['cloud:production'])).toBe(key);
  expect(await agentCalls(page)).not.toContain('configureCloudProvider');
  expect((await calls(page)).filter(call=>call.plugin==='AlphaCloudSignIn'&&call.method==='verifyEmail')).toEqual([]);
});

test('a kept sign-in Cloud rejects is reported as no longer valid in the sign-in dialog that opens by itself; the agent keeps running', async ({ page }) => {
  await boot(page, 'rejected');
  // Every Alpha Phone needs an Eliza Cloud account: the sign-in dialog opens and cannot be dismissed.
  const dialog = page.getByRole('main', { name: 'Sign in',exact:true });
  await expect(dialog.getByText('Your Cloud sign-in has expired. Sign in with Cloud again.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Close connection settings', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.alpha-cloud-account-summary')).toHaveCount(0);
  await expect.poll(() => agentCalls(page)).toContain('start');
  expect(await agentCalls(page)).not.toContain('configureCloudProvider');
});

test('a kept sign-in Cloud admits binds inference at start and runs the on-device agent only', async ({ page }) => {
  await boot(page, 'funded');
  // Identity and plan status were read. Once signed in, Inbox may read its Gmail accounts. No
  // Cloud-hosted agent is listed, provisioned or restored and no remote session is opened.
  await expect.poll(() => agentCalls(page)).toContain('configureCloudProvider');
  const paths = await cloudRequests(page);
  expect(paths).toEqual(expect.arrayContaining(['/api/v1/user', '/api/v1/billing/limits']));
  expect(paths.filter(path => !['/api/v1/user', '/api/v1/subscription/entitlement', '/api/v1/billing/limits', '/api/v1/eliza/google/accounts'].includes(path))).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Agent connection/ }).click();
  const dialog = page.getByRole('region', { name: 'Settings',exact:true });
  await expect(dialog.getByText('Running on this device', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Eliza Cloud',{exact:true})).toBeVisible();
  expect((await selection(page))?.kind).toBe('resident');
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
