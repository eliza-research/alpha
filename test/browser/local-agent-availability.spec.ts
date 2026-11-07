import { test, expect } from '@playwright/test';

// Actual renderer/chooser and controller, synthetic native packaging boundary.
// Never starts a runtime, sends a real key, signs in, or calls a remote service.
for (const mode of ['checking', 'unavailable', 'available'] as const) {
  test(`native local-agent packaging: ${mode}`, async ({ page }) => {
    await page.addInitScript(mode => {
      const w = window as any;
      w.androidBridge = {};
      const store = new Map();
      w.packagingFixture = { saved: 0, started: 0, requests: 0, keys: [] as string[] };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      w.Capacitor = {
        PluginHeaders: [
          { name: 'Agent', methods: methods(['getStatus', 'configureProvider', 'start']) },
          { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite','secureCompareExchange', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
          { name: 'AlphaHostedResults', methods: methods(['disableBackground','addListener','removeListener','pendingResult','status']) },
          { name: 'AlphaActionJournal', methods: methods(['list']) },
          { name: 'DeviceApps', methods: methods(['buildInfo']) },
        ],
        nativePromise: async (plugin: string, method: string, input: any) => {
          if (plugin === 'Agent') {
            if (method === 'getStatus') {
              if (mode === 'checking') return new Promise(resolve => { w.releasePackaging = resolve; });
              return { packaged: mode === 'available', state: 'stopped' };
            }
            if (method === 'configureProvider') { w.packagingFixture.saved++; w.packagingFixture.keys.push(input.apiKey); return { configured: true }; }
            if (method === 'start') { w.packagingFixture.started++; throw Error('Runtime start is outside this fixture'); }
          }
          if (plugin === 'AlphaConnection') {
            if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
            if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
            if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
            if (method === 'secureRemove') { store.delete(input.slot); return {}; }
            if (['cancel','addListener','removeListener','pauseNotificationCollection'].includes(method)) return {};
            w.packagingFixture.requests++; throw Error('No live request is permitted');
          }
          if (plugin === 'AlphaHostedResults' && ['disableBackground','addListener','removeListener','pendingResult','status'].includes(method)) return {};
          if (plugin === 'AlphaActionJournal' && method === 'list') return { entries: [] };
          if (plugin === 'DeviceApps' && method === 'buildInfo') return { launcher: false, version: 'fixture' };
          throw Error('Unexpected native operation: ' + plugin + '.' + method);
        },
      };
    }, mode);
    await page.goto('/');
    // Initial native launch may open automatically; otherwise use the product control.
    if (!await page.locator('.alpha-connection-scrim').isVisible())
      await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
    await expect(page.locator('.alpha-connection-scrim')).toBeVisible();
    const chooser = page.locator('.alpha-connection');
    const start = chooser.getByRole('button', { name: 'Start local agent', exact: true });
    if (mode === 'checking') {
      await expect(chooser.getByText('Checking local agent availability…')).toBeVisible();
      await expect(start).toBeDisabled();
      await expect(chooser.getByLabel('Cerebras API key')).toHaveCount(0);
    } else if (mode === 'unavailable') {
      await expect(chooser.getByText('The local agent is unavailable in this version.', { exact: false })).toBeVisible();
      await expect(start).toBeDisabled();
      await expect(chooser.getByLabel('Cerebras API key')).toHaveCount(0);
    } else {
      await expect(start).toBeEnabled();
      await chooser.locator('summary').filter({ hasText: /^Model provider$/ }).click();
      await chooser.getByLabel('Cerebras API key').fill('synthetic-e2e-key');
      await chooser.getByRole('button', { name: 'Save provider', exact: true }).click();
      await expect(chooser.getByText('Provider saved. Start or restart the local agent to use it.')).toBeVisible();
      await expect(chooser.getByLabel('Cerebras API key')).toHaveValue('');
    }
    await chooser.locator('summary').filter({ hasText: /^Remote agent$/ }).click();
    await expect(chooser.getByLabel('Agent HTTPS address')).toBeEditable();
    await expect(chooser.getByRole('button', { name: 'Connect remote agent', exact: true })).toBeEnabled();
    await chooser.locator('summary').filter({ hasText: /^Development Cloud agent infrastructure$/ }).click();
    await expect(chooser.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).packagingFixture)).toEqual({
      saved: mode === 'available' ? 1 : 0, started: 0, requests: 0,
      keys: mode === 'available' ? ['synthetic-e2e-key'] : [],
    });
    await chooser.locator('summary').filter({ hasText: /^Mock mode$/ }).click();
    await chooser.getByRole('button', { name: 'Enter mock mode', exact: true }).click();
    await expect(page).toHaveURL(/mode=mock/);
    await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
    await expect(page.getByText('Mock mode · simulated data and actions')).toBeVisible();
  });
}
