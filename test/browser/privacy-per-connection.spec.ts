import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// Real rendered Settings over the real connection controller; only the Android IPC boundary is
// synthetic. No runtime, provider key, model request or external account is used.
const SYNTHETIC_KEY = 'synthetic-provider-key-7f3a9c0e5b';
const REMOTE = 'https://agent.example.test';
const REDACTION = {
  resident: 'Secret and contact identifiers are swapped before hosted inference; names and free text are not covered',
  agent: 'Depends on the selected agent; not reported',
  offline: 'No remote agent connected; no hosted inference requests',
};
// Former fixture activity rows and claims must never be presented as this phone's history.
const fixtureActivity = [/Drafted a reply to Maya/, /Filed Jordan's term sheet/, /Moved Gym to 7:30 PM/, /Summarized 14 emails/, /Ran Morning brief/, /Redaction receipt saved/, /Booked Nopa/, /\b\d+ today\b/];
const forbidden = [/Redaction on/, /Identifiers replaced/, /Pre-egress redaction is not connected/];

type Scenario = 'resident' | 'remote' | 'offline';
async function nativeStub(page: Page, scenario: Scenario, options: { strayKeyInStatus?: boolean; proposals?: boolean; locationAccess?: 'approximate' | 'precise'; providerStatus?: { provider: string; model: string } } = {}) {
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
    const provider = { key, name: providerStatus?.provider ?? 'cerebras', model: providerStatus?.model ?? 'qwen-3.8-27b' };
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
        { name: 'AlphaDevice', methods: methods(['snapshot','openSettings']) },
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
          if (method === 'providerStatus') return respond({ provider: provider.name, configured: true, selected: provider.name === 'cerebras', voiceConfigured: false, model: provider.model, ...(strayKeyInStatus ? { apiKey: provider.key, key: provider.key } : {}) });
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
        if (plugin === 'AlphaDevice' && method === 'openSettings') return respond({ status: 'opened', page: input.page });
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
    if (!await page.locator('.alpha-connection-scrim').isVisible()) {
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      await page.getByRole('button', {name: 'Agent', exact: true}).click();
    }
    await page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true }).click();
  }
  if (scenario === 'remote') await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
}
async function openSettings(page: Page, tab: string) {
  if (await page.locator('html').getAttribute('data-active-view') !== 'settings')
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

async function privacyContract(page: Page) {
  return page.evaluate(async () => {
    const {egressPrivacy} = await import('/src/prototype/native-adapter.ts');
    const {connectionController} = await import('/src/runtime/connection-ui.tsx');
    return egressPrivacy(connectionController.getSnapshot()).sub;
  });
}
async function openAgent(page: Page) {
  if (await page.locator('html').getAttribute('data-active-view') !== 'settings')
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Agent', exact: true}).click();
  return page.locator('.alpha-connection');
}
async function assertNoInventedActivity(page: Page) {
  const text = await page.locator('body').innerText();
  for (const claim of forbidden) expect(text).not.toMatch(claim);
  for (const row of fixtureActivity) expect(text).not.toMatch(row);
}

for (const scenario of ['resident', 'remote', 'offline'] as const) test(`current Settings and privacy contract reflect the ${scenario} connection`, async ({page}) => {
  await nativeStub(page, scenario);
  await connect(page, scenario);
  expect(await privacyContract(page)).toBe(REDACTION[scenario === 'remote' ? 'agent' : scenario]);
  await openSettings(page, 'AI provider');
  const provider = page.getByRole('dialog', {name: 'AI provider', exact: true});
  // This dialog reports the phone's saved provider independently of a remote/offline selection.
  await expect(provider.getByRole('button', {name: 'Own API keys', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(provider.getByText('Cerebras · Voice off', {exact: true})).toBeVisible();
  await assertNoInventedActivity(page);
  await provider.getByRole('button', {name: 'Close AI provider settings', exact: true}).click();
  // The slim Settings design delegates provider state to its dialog and exposes no old pages.
  for (const name of ['Privacy & data', 'Models', 'Activity']) await expect(page.getByRole('button', {name, exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'About', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Export diagnostics', exact: true})).toBeVisible();
  await assertNoInventedActivity(page);
  const fixture = await page.evaluate(() => (window as any).privacyFixture);
  expect(fixture.unexpected.filter((name: string) => name.startsWith('Agent.'))).toEqual([]);
});

test('the Cloud provider selection does not present a raw provider path', async ({page}) => {
  await nativeStub(page, 'resident', {providerStatus: {provider: 'elizacloud', model: 'cerebras/qwen-3.8-27b'}});
  await connect(page, 'resident');
  await openSettings(page, 'AI provider');
  const provider = page.getByRole('dialog', {name: 'AI provider', exact: true});
  await expect(provider.getByRole('button', {name: 'Cloud', exact: true})).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('body').innerText()).not.toContain('cerebras/');
});

test('provider key never reaches current Settings, bridge payloads or test output', async ({page}, info) => {
  await nativeStub(page, 'resident', {strayKeyInStatus: true});
  await connect(page, 'resident');
  const console: string[] = [];
  page.on('console', message => console.push(message.text()));
  await openSettings(page, 'AI provider');
  await expect(page.getByText('Cerebras · Voice off', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Close AI provider settings', exact: true}).click();
  await page.getByRole('button', {name: 'About', exact: true}).click();
  expect(await privacyContract(page)).toBe(REDACTION.resident);
  const statusCalls = await page.evaluate(() => (window as any).privacyFixture.calls.filter((call: any) => call.plugin === 'Agent' && call.method === 'providerStatus').length);
  expect(statusCalls).toBeGreaterThan(0);
  const dump = await rendererDump(page) + '\n' + console.join('\n');
  const output = info.outputPath('renderer-dump.txt');
  writeFileSync(output, dump);
  expect(readFileSync(output, 'utf8').includes(SYNTHETIC_KEY)).toBe(false);
  expect(dump).not.toContain('synthetic-provider-key');
});

test('offline Agent has no invented action history and Settings has no Workflow runs row', async ({page}) => {
  await nativeStub(page, 'offline');
  await connect(page, 'offline');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Workflow runs', exact: true})).toHaveCount(0);
  const panel = await openAgent(page);
  await expect(panel.getByRole('button', {name: 'Refresh actions', exact: true})).toHaveCount(0);
  await assertNoInventedActivity(page);
  expect(await privacyContract(page)).toBe(REDACTION.offline);
});

const proposalReads = (page: Page) => page.evaluate(() => (window as any).privacyFixture.calls.filter((call: any) => call.plugin === 'Agent' && call.input?.path === '/api/client-devices/proposals').length);
for (const proposals of [true, false]) test(`Agent reads action history only after an explicit ${proposals ? 'successful' : 'failed'} refresh`, async ({page}) => {
  await nativeStub(page, 'resident', {proposals});
  await connect(page, 'resident');
  const panel = await openAgent(page);
  const history = panel.locator('details').filter({has: page.locator('summary').filter({hasText: 'Phone action history'})});
  await history.locator('summary').click();
  expect(await panel.innerText()).not.toContain('No phone actions recorded');
  const before = await proposalReads(page);
  await history.getByRole('button', {name: 'Refresh actions', exact: true}).click();
  await expect.poll(() => proposalReads(page)).toBeGreaterThan(before);
  if (!proposals) await expect(panel.getByText(/request failed/i)).toBeVisible();
  await assertNoInventedActivity(page);
  expect(await page.evaluate(async () => (await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().actionHistory)).toEqual([]);
  expect(await page.evaluate(() => (window as any).residentAgent.state.unexpected)).toEqual([]);
});

for (const locationAccess of ['approximate', 'precise'] as const) test(`App permissions delegates the native ${locationAccess} location grant to Android`, async ({page}) => {
  await nativeStub(page, 'offline', {locationAccess});
  await connect(page, 'offline');
  await openSettings(page, 'App permissions');
  await expect.poll(() => page.evaluate(() => (window as any).privacyFixture.calls.filter((call: any) => call.plugin === 'AlphaDevice' && call.method === 'openSettings').map((call: any) => call.input))).toEqual([{page: 'privacy'}]);
  expect(await privacyContract(page)).toBe(REDACTION.offline);
});
