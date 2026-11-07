import { returnToApps } from './app-navigation';
import { test, expect, type Page } from '@playwright/test';

// Settings → Password manager over the shared plugin-native-passwords contract.
// The development vault exists only with ELIZA_DEV_ALLOW_TEST_MOCKS=1 on the development
// server (?mode=dev); native cases use a controlled Capacitor boundary. All values synthetic.
const SECRET_MARKERS = ['synthetic-dev-', 'typed-synthetic-Z9q', 'abcdefghjkmnpqrstuvw'];

async function devVault(page: Page) {
  await page.goto('/?mode=dev');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
}
async function agentContext(page: Page) {
  return page.evaluate(async () => { const { alphaClient } = await import('/src/runtime/alpha-client.ts'); return alphaClient.getState().context; });
}
async function noSecretOutsideDialogs(page: Page) {
  const exposed = await page.evaluate(markers => {
    const text = document.body.innerText;
    const fields = [...document.querySelectorAll('input')].map(input => (input as HTMLInputElement).value).join('\n');
    const stored = [...Array(localStorage.length).keys()].map(i => localStorage.getItem(localStorage.key(i)!) || '').join('\n') + [...Array(sessionStorage.length).keys()].map(i => sessionStorage.getItem(sessionStorage.key(i)!) || '').join('\n');
    return markers.filter(marker => text.includes(marker) || fields.includes(marker) || stored.includes(marker));
  }, SECRET_MARKERS);
  expect(exposed).toEqual([]);
}

test('development vault: unlock, search, add, generate, edit and delete without exposing secrets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await devVault(page);
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await expect(page.getByText('Other password providers', { exact: true })).toBeVisible();
  // The agent observation is paused for the whole password surface.
  expect((await agentContext(page)).sensitive).toBe(true);
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Library account', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search passwords' }).fill('library');
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Library account', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search passwords' }).fill('');

  await page.getByRole('button', { name: 'Add password', exact: true }).click();
  await expect(page.getByText('New password', { exact: true }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Shop');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('buyer@example.test');
  await page.getByRole('textbox', { name: 'Add website', exact: true }).fill('http://shop.example.test');
  await page.locator('input[aria-label="Password"]').fill('typed-synthetic-Z9q');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Use an HTTPS website address.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Add website', exact: true }).fill('https://Shop.Example.test/login?next=1');
  // A rejected save clears nothing the user still needs except the password, which is re-entered.
  await page.locator('input[aria-label="Password"]').fill('typed-synthetic-Z9q');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Password saved.', { exact: true })).toBeVisible();
  const shop = page.getByRole('button', { name: 'Open Shop', exact: true });
  await expect(shop).toContainText('buyer@example.test · shop.example.test');
  await noSecretOutsideDialogs(page);

  await shop.click();
  await expect(page.getByText('Edit password', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove shop.example.test', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate a strong password', exact: true }).click();
  await page.getByRole('button', { name: 'Length: 32', exact: true }).click();
  await expect(page.getByText(/^32 characters, generated (on this phone|in this app) when you save$/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved with a new 32-character password.', { exact: true })).toBeVisible();
  await noSecretOutsideDialogs(page);

  // Reveal is a separate, dismissible surface; the value never enters the page itself.
  await shop.click();
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  const reveal = page.getByRole('dialog', { name: 'Development vault secret' });
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(reveal).toHaveCount(0);
  await noSecretOutsideDialogs(page);

  await page.getByRole('button', { name: 'Delete password', exact: true }).click();
  await page.getByRole('button', { name: 'Tap again to delete', exact: true }).click();
  await expect(page.getByText('Password deleted.', { exact: true })).toBeVisible();
  await expect(shop).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('development vault locks when leaving and reports autofill selection only after readback', async ({ page }) => {
  await devVault(page);
  await expect(page.getByText('None selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set as autofill service', exact: true }).click();
  await expect(page.getByText('Confirm Alpha Phone passwords in Android, then return here.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh autofill status', exact: true }).click();
  await expect(page.getByText('Alpha Phone passwords', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await expect.poll(async () => (await agentContext(page)).sensitive).toBe(false);
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toHaveCount(0);
});

test('browser build without the development profile offers no simulated vault', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
  await expect(page.getByText('Available in the Android app', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock passwords', exact: true })).toHaveCount(0);
});

async function nativeVault(page: Page, options: { leak?: boolean; selected?: string; damaged?: boolean; transfer?: boolean } = {}) {
  await page.addInitScript(({ leak, selected, damaged, transfer }) => {
    const w = window as any; w.androidBridge = {}; localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
    const f = w.vaultFixture = { calls: [] as any[], locked: true, damaged: !!damaged, selected: selected || 'none', entries: [
      { id: 'n1', label: 'Bank app', username: 'holder@example.test', updatedAt: 1, bindings: [{ kind: 'android', facet: `android://${'ab'.repeat(32)}@com.example.bank`, display: 'Bank (com.example.bank)' }] },
    ] as any[], listeners: {} as any, transferCode: 'locked' };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = { PluginHeaders: [
      {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
      {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
      ...(transfer ? [{ name: 'ElizaPasswordTransfer', methods: methods(['exportVault', 'importVault']) }] : []),
      { name: 'ElizaPasswords', methods: methods(['status', 'unlock', 'lock', 'list', 'save', 'remove', 'reset', 'reveal', 'copy', 'openAutofillSettings']) },
      { name: 'AlphaDevice', methods: methods(['snapshot', 'openPasswordProvider']) },
      { name: 'AlphaConnection', methods: methods(['secureRead', 'addListener', 'removeListener']) },
      { name: 'AlphaHostedResults', methods: methods(['status', 'pendingResult', 'addListener', 'removeListener']) },
      { name: 'Agent', methods: methods(['getStatus']) },
      { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
      { name: 'DailyApps', methods: [...methods(['surfaceInfo', 'removeListener']), { name: 'addListener', rtype: 'callback' }] },
    ], nativeCallback: (plugin: string, method: string, input: any, callback: any) => { f.listeners[input.eventName] ??= []; f.listeners[input.eventName].push(callback); return 'listener'; },
    nativePromise: async (plugin: string, method: string, input: any) => {
      if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
      if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
      if (plugin === 'ElizaPasswordTransfer') { f.calls.push({ method, input }); f.locked = true; throw Object.assign(new Error('synthetic-dev-transfer-error'), { code: f.transferCode }); }
      if (plugin === 'ElizaPasswords') {
        f.calls.push({ method, input });
        if (method === 'status') return { available: true, locked: f.locked, unlockRemainingMs: f.locked ? 0 : 50000, unlockSeconds: 60, biometric: true, autofill: { supported: true, selected: f.selected } };
        if (method === 'unlock') { f.locked = false; return { unlocked: true, unlockRemainingMs: 58000 }; }
        if (method === 'lock') { f.locked = true; return { locked: true }; }
        if (method === 'list' && f.damaged) { f.locked = true; throw Object.assign(new Error('Saved passwords can no longer be decrypted on this device'), { code: 'key-invalidated' }); }
        if (method === 'reset') { if (f.locked) throw Object.assign(new Error('Unlock saved passwords first'), { code: 'locked' }); if (!f.damaged) throw Object.assign(new Error('Saved passwords are not damaged'), { code: 'invalid' }); f.damaged = false; f.entries = []; return { reset: true }; }
        if (method === 'list') { if (f.locked) throw Object.assign(new Error('Unlock saved passwords first'), { code: 'locked' }); return { entries: leak ? f.entries.map((e: any) => ({ ...e, password: 'synthetic-dev-leak' })) : f.entries }; }
        if (method === 'copy') return { copied: true, clearsAfterMs: 45000 };
        if (method === 'openAutofillSettings') return { status: 'opened', destination: 'autofill-picker' };
        return {};
      }
      if (plugin === 'AlphaDevice' && method === 'snapshot') return { passwordProvider: { installation: 'absent', selection: 'none', support: 'available' } };
      if (method === 'secureRead') return { value: null };
      if (plugin === 'Agent') return { packaged: false, state: 'unavailable' };
      if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'fixture' };
      return {};
    } };
  }, options);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
}

test('native vault: Android unlock, app bindings, copy and autofill picker with status readback', async ({ page }) => {
  await nativeVault(page, { transfer: true });
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  const bank = page.getByRole('button', { name: 'Open Bank app', exact: true });
  await expect(bank).toContainText('holder@example.test · Bank (com.example.bank)');
  await bank.click();
  await expect(page.getByText('App · verified publisher', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy password', exact: true }).click();
  await expect(page.getByText('Copied. We try to clear it after 45 s, or when you return to the app.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Password manager', exact: true }).click();
  await page.getByRole('button', { name: 'Set as autofill service', exact: true }).click();
  // Opening Android's confirmation is not a selection; only the readback changes the status.
  await expect(page.getByText('None selected', { exact: true })).toBeVisible();
  await page.evaluate(() => { const f = (window as any).vaultFixture; f.selected = 'this-app'; for (const callback of f.listeners.appResumed || []) callback({}); });
  await expect(page.getByText('Alpha Phone passwords', { exact: true }).last()).toBeVisible();
  const calls = await page.evaluate(() => (window as any).vaultFixture.calls.map((c: any) => c.method));
  expect(calls).toEqual(expect.arrayContaining(['status', 'unlock', 'list', 'copy', 'openAutofillSettings']));
  // Proton Pass remains an alternative provider on the same page.
  await expect(page.getByText('Other password providers', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get Proton Pass from Proton', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Export passwords', exact: true }).click();
  await expect(page.getByText('Export did not complete. The selected file may contain passwords; delete it if you do not need it.', { exact: true })).toBeVisible();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await expect(bank).toHaveCount(0);
  await noSecretOutsideDialogs(page);
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await page.evaluate(() => { (window as any).vaultFixture.transferCode = 'cancelled'; });
  await page.getByRole('button', { name: 'Import passwords', exact: true }).click();
  await expect(page.getByText('Import did not complete. Check saved passwords before trying again.', { exact: true })).toBeVisible();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await expect(bank).toHaveCount(0);
  await noSecretOutsideDialogs(page);
});

test('native vault whose key was lost can only be deleted after confirmation and a fresh unlock', async ({ page }) => {
  await nativeVault(page, { damaged: true });
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByText('Cannot be decrypted on this phone', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved passwords can no longer be decrypted on this device.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add password', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete saved passwords and start over', exact: true }).click();
  // The first tap only arms the action; nothing is deleted yet.
  expect(await page.evaluate(() => (window as any).vaultFixture.calls.filter((c: any) => c.method === 'reset').length)).toBe(0);
  await page.getByRole('button', { name: 'Tap again to delete all saved passwords', exact: true }).click();
  await expect(page.getByText('Saved passwords were deleted. You can add new ones.', { exact: true })).toBeVisible();
  const calls: string[] = await page.evaluate(() => (window as any).vaultFixture.calls.map((c: any) => c.method));
  // Reset follows its own unlock, never the earlier one that discovered the damage.
  expect(calls.slice(calls.lastIndexOf('reset') - 1, calls.lastIndexOf('reset') + 1)).toEqual(['unlock', 'reset']);
  await expect(page.getByRole('button', { name: 'Add password', exact: true })).toBeVisible();
  await expect(page.getByText('No saved passwords', { exact: true })).toBeVisible();
});

test('native response carrying a secret is refused before anything renders', async ({ page }) => {
  await nativeVault(page, { leak: true });
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByText('Saved passwords are unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Bank app', exact: true })).toHaveCount(0);
  await noSecretOutsideDialogs(page);
});

test('outbound capture: vault work sends no request containing typed or stored values', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => outbound.push(`${request.url()}\n${request.postData() || ''}`));
  await page.addInitScript(() => {
    const w = window as any; w.capturedBeacons = [] as string[];
    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon) navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => { w.capturedBeacons.push(String(url) + String(data ?? '')); return beacon(url, data); };
    w.consoleText = '';
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) { const original = console[level].bind(console); console[level] = (...args: unknown[]) => { w.consoleText += args.map(String).join(' ') + '\n'; original(...args); }; }
  });
  await devVault(page);
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await page.getByRole('button', { name: 'Add password', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Outbound probe');
  await page.getByRole('textbox', { name: 'Add website', exact: true }).fill('probe.example.test');
  await page.locator('input[aria-label="Password"]').fill('typed-synthetic-Z9q');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Password saved.', { exact: true })).toBeVisible();
  // Agent turns are refused while the vault is open, so nothing can be observed or sent.
  const refused = await page.evaluate(async () => {
    const { alphaClient } = await import('/src/runtime/alpha-client.ts');
    return alphaClient.getState().context.sensitive;
  });
  expect(refused).toBe(true);
  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  const leaked = await page.evaluate(markers => {
    const w = window as any; const text = (w.consoleText || '') + (w.capturedBeacons || []).join('\n');
    return markers.filter(marker => text.includes(marker));
  }, SECRET_MARKERS);
  expect(leaked).toEqual([]);
  expect(outbound.filter(entry => SECRET_MARKERS.some(marker => entry.includes(marker)))).toEqual([]);
});

test('leaving Settings for another view locks the development vault', async ({ page }) => {
  await devVault(page);
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await import('/src/passwords/password-manager.ts')).passwordManagerHoldsEntries())).toBe(true);
  await returnToApps(page);
  await expect.poll(async () => (await agentContext(page)).view).not.toBe('settings');
  // Locked and forgotten as soon as Settings is left, not only when it is reopened.
  expect(await page.evaluate(async () => (await import('/src/passwords/password-manager.ts')).passwordManagerHoldsEntries())).toBe(false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
});
