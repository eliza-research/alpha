import { test, expect } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';
// Rendered provider section over a synthetic native Agent bridge. No key reaches Cerebras: the
// native check is simulated here and covered by LocalAgentProviderInstrumentedTest on Android.

async function stubAgent(page: import('@playwright/test').Page, cloud = false) {
  await installResidentAgentPlugin(page);
  await page.addInitScript((cloud: boolean) => {
    const w = window as any; w.androidBridge = {};
    const f = w.providerFixture = { saved: null as null | { model: string }, configures: [] as any[], clears: 0, stops: 0, reject: '' };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: name==='addListener'?'callback':'promise' }));
    const agent = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'provider-owner', agentId: 'provider-agent' });
    // Eliza Cloud reports the same Qwen model with its Cerebras vendor prefix.
    const status = () => cloud ? { provider: 'elizacloud', configured: true, model: 'cerebras/qwen-3.8-27b' } : f.saved ? { provider: 'cerebras', configured: true, model: 'qwen-3.8-27b' } : { provider: 'cerebras', configured: false };
    w.Capacitor = {
      PluginHeaders: [
        { name: 'Agent', methods: agent.methods(['getStatus', 'start', 'stop', 'request', 'providerStatus', 'prepareProviderConfiguration', 'configureProvider', 'cancelProviderConfiguration', 'clearProvider']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        // Removing a key while the resident runs retires its background delivery (e15f0b735 starts it on save).
        { name: 'AlphaHostedResults', methods: methods(['disableBackground', 'pendingResult', 'status', 'addListener', 'removeListener']) },
      ],
      nativeCallback: (plugin: string, method: string, input: any, callback: (value: unknown) => void) => plugin === 'Agent' ? agent.nativeCallback(plugin, method, input, callback) : 'provider-fixture-listener',
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'provider-fixture' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaConnection') return method === 'secureRead' ? { value: null } : {};
        if (plugin === 'AlphaHostedResults') return {};
        if (plugin === 'Agent') {
          const owned = agent.answer(method, input); if (owned) return owned;
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'start') return { state: 'ready' };
          if (method === 'request') {
            const body = input.path === '/api/auth/me' ? { identity: { kind: 'owner', id: 'provider-owner' }, access: { role: 'OWNER', mode: 'session' } }
              : input.path === '/api/agents' ? { agents: [{ id: 'provider-agent', name: 'Provider fixture', status: 'running' }] }
              : input.path === '/api/conversations' ? { conversations: [] }
              : input.path === '/api/client-devices/register' ? { installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'provider-enrollment', capabilities: [] }
              : null;
            return { status: body ? 200 : 404, body: JSON.stringify(body ?? {}) };
          }
          if (method === 'providerStatus') return status();
          // Cancellable provider setup, as AlphaLocalAgentPlugin exposes it since e15f0b735.
          if (method === 'prepareProviderConfiguration') return { requestId: 'provider-request-' + (f.configures.length + f.clears + 1) };
          if (method === 'cancelProviderConfiguration') return {};
          if (method === 'configureProvider') { f.configures.push(input); if (f.reject) throw new Error(f.reject); f.saved = { model: input.model }; return status(); }
          if (method === 'clearProvider') { f.clears++; f.saved = null; return { provider: 'cerebras', configured: false }; }
          if (method === 'stop') { f.stops++; return { state: 'stopping' }; }
        }
        throw new Error(`Unexpected native call ${plugin}.${method}`);
      },
    };
  }, cloud);
}

test('provider status, pinned model, verified save and confirmed key removal', async ({ page }) => {
  await stubAgent(page);
  await page.goto('/');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await chooser.getByText('Model provider', { exact: true }).click();
  await expect(chooser.getByText('Not configured', { exact: true })).toBeVisible();
  // The model is fixed; there is no editable model field.
  await expect(chooser.getByLabel('Model')).toHaveCount(0);
  await expect(chooser.getByText('Model: qwen-3.8-27b', { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as any).providerFixture.reject = 'Cerebras did not accept this key. It was not saved.'; });
  await chooser.getByLabel('Cerebras API key').fill('synthetic-rejected-key');
  await chooser.getByRole('button', { name: 'Save provider', exact: true }).click();
  await expect(chooser.getByRole('alert')).toContainText('Cerebras did not accept this key');
  await expect(chooser.getByText('Not configured', { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as any).providerFixture.reject = ''; });
  await chooser.getByLabel('Cerebras API key').fill('synthetic-accepted-key');
  await chooser.getByRole('button', { name: 'Save provider', exact: true }).click();
  // Since e15f0b735 a verified key selects own keys and starts the agent with them at once, which
  // closes the chooser; reopening it shows the saved provider.
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Agent connection/ }).click();
  await chooser.getByText('Model provider', { exact: true }).click();
  await expect(chooser.getByText('Configured · Cerebras · qwen-3.8-27b', { exact: true })).toBeVisible();
  await expect(chooser.getByLabel('Cerebras API key')).toHaveValue('');
  const configures = await page.evaluate(() => (window as any).providerFixture.configures);
  expect(configures.map((item: any) => item.model)).toEqual(['qwen-3.8-27b', 'qwen-3.8-27b']);

  await chooser.getByRole('button', { name: 'Remove key…', exact: true }).click();
  await expect(chooser.getByText(/Remove the saved Cerebras key from this phone\?/)).toBeVisible();
  await chooser.getByRole('button', { name: 'Keep key', exact: true }).click();
  expect(await page.evaluate(() => (window as any).providerFixture.clears)).toBe(0);
  await chooser.getByRole('button', { name: 'Remove key…', exact: true }).click();
  await chooser.getByRole('button', { name: 'Remove key', exact: true }).click();
  // The running agent holds the key: removal stops it, clears the key, and restarts it with AI off,
  // which closes the chooser again.
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).providerFixture.clears)).toBe(1);
  expect(await page.evaluate(() => (window as any).providerFixture.stops)).toBe(1);
  await page.getByRole('button', { name: /Agent connection/ }).click();
  await chooser.getByText('Model provider', { exact: true }).click();
  await expect(chooser.getByText('Not configured', { exact: true })).toBeVisible();
  await expect(chooser.getByRole('button', { name: 'Remove key…', exact: true })).toHaveCount(0);
  // Nothing in the page carries the key.
  expect(await page.content()).not.toContain('synthetic-accepted-key');
});

test('the chooser names the Eliza Cloud model as Settings does', async ({ page }) => {
  await stubAgent(page, true);
  await page.goto('/');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await chooser.getByText('Model provider', { exact: true }).click();
  await expect(chooser.getByText('Configured · Cloud · qwen-3.8-27b (Cerebras)', { exact: true })).toBeVisible();
});

for(const cloud of [false,true])test(`native Models shows on-device voice and actual provider admission: ${cloud?'configured':'unconfigured'}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await stubAgent(page,cloud);await page.goto('/');
 await page.locator('.alpha-connection').getByRole('button',{name:'Start local agent',exact:true}).click();
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Models',exact:true}).click();
 await expect(page.getByText('Conversation uses the selected agent. Voice runs on this device.',{exact:true})).toBeVisible();
 await expect(page.getByText('On this device',{exact:true}).first()).toBeVisible();
 await expect(page.getByText(cloud?'Eliza Cloud':'Not configured',{exact:true})).toBeVisible();
 if(cloud)await expect(page.getByText('Eliza Cloud · qwen-3.8-27b (Cerebras)',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).providerFixture.configures)).toEqual([]);
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);
});
