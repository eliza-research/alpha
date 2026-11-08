import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// Real rendered Settings over the real connection controller; only the Android IPC boundary is
// synthetic. No runtime, provider key, model request or external account is used.
const SYNTHETIC_KEY = 'synthetic-provider-key-7f3a9c0e5b';
const REMOTE = 'https://agent.example.test';
const REDACTION = {
  // The fixture resident uses its own Cerebras key (residentInference 'direct').
  resident: 'Messages and selected content go to Cerebras with your key. Secret and contact identifiers are swapped first; names and free text are not.',
  agent: 'Depends on your agent',
  offline: 'No remote agent connected; no hosted inference requests',
};
// Former fixture activity rows and claims must never be presented as this phone's history.
const fixtureActivity = [/Drafted a reply to Maya/, /Filed Jordan's term sheet/, /Moved Gym to 7:30 PM/, /Summarized 14 emails/, /Ran Morning brief/, /Redaction receipt saved/, /Booked Nopa/, /\b\d+ today\b/];
const forbidden = [/Redaction on/, /Identifiers replaced/, /Pre-egress redaction is not connected/];

type Scenario = 'resident' | 'remote' | 'offline';
async function nativeStub(page: Page, scenario: Scenario, options: { strayKeyInStatus?: boolean; proposals?: boolean; locationAccess?: 'approximate' | 'precise'; providerStatus?: { provider: string; model: string; voiceConfigured?: boolean } } = {}) {
  await installResidentAgentPlugin(page);
  await page.addInitScript(({ scenario, key, remote, strayKeyInStatus, proposals, locationAccess, providerStatus }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    const future = Date.now() + 86_400_000;
    if (scenario === 'remote') store.set('remote:' + remote, JSON.stringify({ origin: remote, token: 'remote-session-token', identityId: 'fixture-owner', sessionId: 'remote-session-token', expiresAt: future }));
    try {
      if (!sessionStorage.getItem('privacy-fixture-seeded')) {
        sessionStorage.setItem('privacy-fixture-seeded', '1');
        localStorage.setItem('alpha.connection.selection.v1', JSON.stringify(scenario === 'remote' ? { kind: 'remote', origin: remote } : scenario === 'offline' ? { kind: 'offline' } : { kind: 'none' }));
      }
    } catch { /* storage-blocked runs are covered elsewhere */ }
    // The native credential slot holds the provider key; only providerStatus may describe it.
    const provider = { key, name: providerStatus?.provider ?? 'cerebras', model: providerStatus?.model ?? 'qwen-3.8-27b', voiceConfigured: providerStatus?.voiceConfigured === true };
    w.privacyFixture = { calls: [] as unknown[], unexpected: [] as string[] };
    const agent = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId: 'fixture-agent' });
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaNotifications', methods: methods(['status','crossAppStatus','addListener','removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'Agent', methods: agent.methods(['getStatus', 'start', 'stop', 'request', 'providerStatus']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite','secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['list']) },
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        { name: 'AlphaDevice', methods: methods(['snapshot']) },
      ],
      nativeCallback: agent.nativeCallback,
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaNotifications') return {permissionGranted:true,appEnabled:true};
        if (plugin === 'AlphaVoiceCloud') return {microphone:'granted'};
        const f = w.privacyFixture;
        const respond = (value: unknown) => { f.calls.push({ plugin, method, input, value }); return value; };
        if (plugin === 'Agent') {
          const owned = agent.answer(method, input); if (owned) return respond(owned);
          if (method === 'getStatus') return respond({ packaged: true, state: 'stopped', serviceActive: false, socketListening: false });
          if (method === 'start') return respond({ state: 'ready' });
          if (method === 'stop') return respond({ state: 'stopping' });
          if (method === 'providerStatus') return respond({ provider: provider.name, configured: true, model: provider.model, voiceConfigured: provider.voiceConfigured, ...(strayKeyInStatus ? { apiKey: provider.key, key: provider.key } : {}) });
          if (method === 'request') {
            let body: any;
            if (input.path === '/api/auth/me') body = { identity: { kind: 'owner', id: 'fixture-owner' }, access: { role: 'OWNER', mode: 'session' } };
            else if (input.path === '/api/agents') body = { agents: [{ id: 'fixture-agent', name: 'Resident fixture', status: 'running' }] };
            else if (input.path === '/api/client-devices/register') body = { installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] };
            else if (input.path === '/api/conversations') body = { conversations: [] };
            else if (input.path === '/api/workflow/status') body = { status: 'unavailable' };
            else if (input.path === '/api/client-devices/proposals' && proposals) body = { proposals: [] };
            else return respond({ status: 404, body: '{}' });
            return respond({ status: 200, body: JSON.stringify(body) });
          }
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return respond({ value: store.get(input.slot) ?? null });
          if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return respond({status:'conflict'});if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return respond({status:'saved'});}
          if (method === 'secureWrite') { store.set(input.slot, input.value); return respond({}); }
          if (method === 'secureRemove') { store.delete(input.slot); return respond({}); }
          if (method === 'request') {
            const url = new URL(input.url);
            if (url.origin !== remote) return respond({ status: 404, data: {} });
            if (url.pathname === '/api/auth/me') return respond({ status: 200, data: { identity: { kind: 'owner', id: 'fixture-owner', displayName: 'Owner' }, session: { kind: 'machine', id: 'remote-session-token', expiresAt: future }, access: { role: 'OWNER', mode: 'session' } } });
            if (url.pathname === '/api/agents') return respond({ status: 200, data: { agents: [{ id: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', name: 'Remote fixture', status: 'running' }] } });
            return respond({ status: 404, data: {} });
          }
          if (['cancel', 'addListener', 'removeListener', 'pauseNotificationCollection'].includes(method)) return respond({});
        }
        if (plugin === 'AlphaActionJournal' && method === 'list') return respond({ entries: [] });
        if (plugin === 'AlphaDevice' && method === 'snapshot') return respond({ permissions: { Location: !!locationAccess }, locationAccess: locationAccess ?? 'none' });
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return respond({ launcher: false, version: 'fixture' });
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation');
      },
    };
  }, { scenario, key: SYNTHETIC_KEY, remote: REMOTE, strayKeyInStatus: !!options.strayKeyInStatus, proposals: !!options.proposals, locationAccess: options.locationAccess, providerStatus: options.providerStatus });
}

async function connect(page: Page, scenario: Scenario) {
  await page.goto('/');
  if (scenario === 'resident') {
    // Wait until boot settles on one of the two states before choosing.
    const scrim = page.locator('.alpha-connection-scrim'), opener = page.getByRole('button', { name: 'Agent connection', exact: true });
    await expect(scrim.or(opener).filter({ visible: true }).first()).toBeVisible();
    if (!await scrim.isVisible()) await opener.click();
    await page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true }).click();
  }
  if (scenario === 'remote') await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
}
async function openSettings(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  await page.getByRole('button', { name: tab, exact: true }).click();
}
async function rendererDump(page: Page) {
  return page.evaluate(() => {
    const storage = (area: Storage) => { try { return JSON.stringify(Object.entries(area)); } catch { return ''; } };
    return [document.documentElement.outerHTML, storage(localStorage), storage(sessionStorage), JSON.stringify((window as any).privacyFixture?.calls?.map((call: any) => call.input) ?? [])].join('\n');
  });
}

const cases: Array<{ scenario: Scenario; redaction: string; model: string }> = [
  { scenario: 'resident', redaction: REDACTION.resident, model: 'Cerebras · qwen-3.8-27b' },
  { scenario: 'remote', redaction: REDACTION.agent, model: 'Not reported' },
  { scenario: 'offline', redaction: REDACTION.offline, model: 'Not reported' },
];
for (const { scenario, redaction, model } of cases) test(`Privacy, Models and About report the ${scenario} connection honestly`, async ({ page }) => {
  await nativeStub(page, scenario);
  await connect(page, scenario);
  await openSettings(page, 'Privacy & data');
  await expect(page.getByText(redaction, { exact: true })).toBeVisible();
  let text = await page.locator('body').innerText();
  for (const claim of forbidden) expect(text).not.toMatch(claim);
  for (const other of Object.values(REDACTION)) if (other !== redaction) expect(text).not.toContain(other);
  for (const row of fixtureActivity) expect(text).not.toMatch(row);

  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.locator('.st-page, body').getByText(model, { exact: true }).first()).toBeVisible();
  text = await page.locator('body').innerText();
  if (scenario !== 'resident') expect(text).not.toContain('Cerebras · ');

  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByText(model, { exact: true }).first()).toBeVisible();
  const fixture = await page.evaluate(() => (window as any).privacyFixture);
  expect(fixture.unexpected.filter((name: string) => name.startsWith('Agent.'))).toEqual([]);
});

test('the Eliza Cloud route names Qwen on Cerebras with one label in Models and About', async ({ page }) => {
  await nativeStub(page, 'resident', { providerStatus: { provider: 'elizacloud', model: 'cerebras/qwen-3.8-27b' } });
  await connect(page, 'resident');
  const label = 'Eliza Cloud · qwen-3.8-27b (Cerebras)';
  await openSettings(page, 'Models');
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  // The raw provider path is never shown.
  expect(await page.locator('body').innerText()).not.toContain('cerebras/');
});

for (const voiceConfigured of [false, true]) test(`own keys name Cerebras${voiceConfigured ? ' and Cartesia for voice' : ' and no voice service'} on Privacy`, async ({ page }) => {
  await nativeStub(page, 'resident', { providerStatus: { provider: 'cerebras', model: 'qwen-3.8-27b', voiceConfigured } });
  await connect(page, 'resident');
  await openSettings(page, 'Privacy & data');
  await expect(page.getByText('Uses your Cerebras key', { exact: true })).toBeVisible();
  await expect(page.getByText(/go to Cerebras with your key/)).toBeVisible();
  await expect(page.getByText(voiceConfigured ? 'Messages and selected content, to Cerebras; voice to Cartesia' : 'Messages and selected content, to Cerebras', { exact: true })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Eliza Cloud');
  expect(text.includes('Voice recordings and reply text go to Cartesia with your key, without identifier swap.')).toBe(voiceConfigured);
  if (!voiceConfigured) expect(text).not.toContain('Cartesia');
  expect(await rendererDump(page)).not.toContain(SYNTHETIC_KEY);
});

test('provider key never reaches renderer state, bridge payloads or test output', async ({ page }, info) => {
  // Defence in depth: even a bridge that returned extra fields must not surface the key.
  await nativeStub(page, 'resident', { strayKeyInStatus: true });
  await connect(page, 'resident');
  const console: string[] = [];
  page.on('console', message => console.push(message.text()));
  await openSettings(page, 'Models');
  await expect(page.getByText('Cerebras · qwen-3.8-27b', { exact: true }).first()).toBeVisible();
  for (const tab of ['About', 'Privacy & data']) {
    await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  await expect(page.getByText(REDACTION.resident, { exact: true })).toBeVisible();
  const statusCalls = await page.evaluate(() => (window as any).privacyFixture.calls.filter((call: any) => call.plugin === 'Agent' && call.method === 'providerStatus').length);
  expect(statusCalls).toBeGreaterThan(0);
  const dump = await rendererDump(page) + '\n' + console.join('\n');
  const output = info.outputPath('renderer-dump.txt');
  writeFileSync(output, dump);
  // "grep" the written test output, not just the in-memory string.
  expect(readFileSync(output, 'utf8').includes(SYNTHETIC_KEY)).toBe(false);
  expect(dump).not.toContain('synthetic-provider-key');
});

test('Activity shows an empty connect state and no Workflow runs row', async ({ page }) => {
  await page.goto('/');
  await openSettings(page, 'Privacy & data');
  await expect(page.getByText(REDACTION.offline, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Connect your remote agent to see activity', { exact: true })).toBeVisible();
  const text = await page.locator('body').innerText();
  for (const row of fixtureActivity) expect(text).not.toMatch(row);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  await expect(page.getByRole('button', { name: 'Workflow runs', exact: true })).toHaveCount(0);
});

test('Privacy & data has no Workflow runs row: runs live in the Workflows app', async ({ page }) => {
  await page.goto('/');
  await openSettings(page, 'Privacy & data');
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workflow runs', exact: true })).toHaveCount(0);
});

const proposalReads = (page: Page) => page.evaluate(() => (window as any).privacyFixture.calls.filter((call: any) => call.plugin === 'Agent' && call.input?.path === '/api/client-devices/proposals').length);
for (const proposals of [true, false]) test(`resident Activity shows history only after an explicit ${proposals ? 'successful' : 'failed'} read`, async ({ page }) => {
  await nativeStub(page, 'resident', { proposals });
  await connect(page, 'resident');
  await openSettings(page, 'Privacy & data');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const app = page.locator('[data-alpha-layer="app"]');
  // Opening Activity must not pop the connection panel or claim an unread history is empty.
  const unread = app.getByText('Phone action history', { exact: true });
  await expect(unread).toBeVisible();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  expect(await app.innerText()).not.toContain('No phone actions recorded');
  const before = await proposalReads(page);
  await app.getByRole('button', { name: 'Load phone action history', exact: true }).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(1);
  await expect.poll(() => proposalReads(page)).toBeGreaterThan(before);
  if (!proposals) await expect(page.locator('.alpha-connection').getByText(/request failed/i)).toBeVisible();
  await page.getByRole('button', { name: 'Close connection settings' }).first().click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  if (proposals) await expect(app.getByText('No phone actions recorded', { exact: true })).toBeVisible();
  else { await expect(unread).toBeVisible(); await expect(app.getByRole('button', { name: 'Load phone action history', exact: true })).toBeVisible(); expect(await app.innerText()).not.toContain('No phone actions recorded'); }
  const text = await page.locator('body').innerText();
  for (const row of fixtureActivity) expect(text).not.toMatch(row);
  expect(text).not.toContain('Connect your remote agent to see activity');
  expect(await page.evaluate(() => (window as any).residentAgent.state.unexpected)).toEqual([]);
});

for (const locationAccess of ['approximate', 'precise'] as const) test(`Privacy shows the native ${locationAccess} location grant without losing connection disclosure`, async ({ page }) => {
  await nativeStub(page, 'offline', { locationAccess });
  await connect(page, 'offline');
  await openSettings(page, 'Privacy & data');
  await expect(page.getByText(locationAccess === 'precise' ? 'Precise location allowed' : 'Approximate location allowed', { exact: true })).toBeVisible();
  await expect(page.getByText(REDACTION.offline, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
});
