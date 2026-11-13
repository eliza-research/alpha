// Flag-off Android renderer (the APK path) after a brand-new account verifies its email code (owner
// report 2026-10-30): the seven access steps open at once while the resident agent restarts with the new
// key behind them, and nothing says AI is off or shows billing while it starts. Synthetic native
// outcomes only; no device, Steward, Eliza Cloud, runtime or account is real.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { flagOffAndroid, button, fenceNetwork, openYourAgent } from './flag-off-android';
import { residentStub, stub, setStub } from './resident-stub';
import { recordStartupFrames, expectNoHomeBeforePrompt, startupLoading } from './helpers/startup-frames';

const account = { token: 'post-sign-in-key', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', email: 'new-owner@example.invalid', balance: 5 };
const STEPS = ['Notifications', 'Microphone', 'Camera', 'Location', 'Calendar', 'Photos', 'Files'];
/** Starting-state copy the owner reported: none of it may show while the agent merely starts. */
const STARTING_SLOP = ['AI is off', 'Checking your code', 'Checking code', 'Eliza Cloud credits', 'Manage billing', 'AI connection isn’t confirmed yet'];
const starts = (page: Page) => stub(page, s => s.order.filter((entry: string) => entry === 'Agent.start').length) as Promise<number>;
async function shot(page: Page, info: TestInfo, name: string) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' }); }

/** A fresh phone: no Cloud key, setup not done. `window.postSignIn.hold` holds the next agent start;
 * `window.postSignIn.admission` holds the next identity read (the account admission after the code). */
async function freshPhone(page: Page, access: {image?: boolean; holdLocation?: boolean} = {}) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { freshAccess: true });
  await residentStub(page, { nativeSignIn: true, emptyKeystore: true, accounts: [account] });
  await page.addInitScript((access: {image?: boolean; holdLocation?: boolean}) => {
    const w = window as any, previous = w.Capacitor.nativePromise;
    const granted: Record<string, boolean> = Object.fromEntries(['notifications', 'microphone', 'camera', 'location', 'calendar', 'photos', 'files'].map(key => [key, !!access.image]));
    const accessPort = w.imageAccess = { requests: [] as string[], held: [] as (() => void)[], released: false, releaseLocation() {this.released = true; this.held.splice(0).forEach(resolve => resolve());} };
    if (access.image) w.Capacitor.PluginHeaders.push({name: 'AlphaTelephony', methods: [{name: 'imageCapability', rtype: 'promise'}]});
    const ports: Record<string, string[]> = { DailyApps: ['checkPermissions', 'requestPermissions'], AlphaVoiceCloud: ['checkPermissions', 'requestPermissions'], ElizaLocation: ['checkPermissions', 'requestPermissions'], AlphaCalendar: ['checkPermissions', 'requestAccess'], AlphaPhotoLibrary: ['scope', 'requestAccess'], AlphaFiles: ['storageState', 'storageRequestAccess'] };
    for (const [name, methods] of Object.entries(ports)) {
      let header = w.Capacitor.PluginHeaders.find((row: any) => row.name === name);
      if (!header) w.Capacitor.PluginHeaders.push(header = { name, methods: [] });
      for (const method of methods) if (!header.methods.some((row: any) => row.name === method)) header.methods.push({ name: method, rtype: 'promise' });
    }
    const hold = w.postSignIn = { hold: false, held: false, release: null as null | (() => void), admission: false, admit: null as null | (() => void) };
    w.Capacitor.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'AlphaTelephony' && method === 'imageCapability') return {version: 1, image: true, feature: 'fixture.image'};
      if (access.holdLocation && !accessPort.released && plugin === 'ElizaLocation' && method === 'checkPermissions') await new Promise<void>(resolve => accessPort.held.push(resolve));
      // The restart with the new key takes as long as a first boot (about 27 s on the owner's run).
      if (plugin === 'Agent' && method === 'start' && hold.hold) { hold.hold = false; hold.held = true; await new Promise<void>(resolve => { hold.release = resolve; }); }
      // A funded organization-credit account: no subscription, a positive balance (the owner's account mode).
      const path = plugin === 'AlphaConnection' && method === 'request' ? new URL(input.url).pathname : '';
      if (path === '/api/v1/user' && hold.admission) { hold.admission = false; await new Promise<void>(resolve => { hold.admit = resolve; }); }
      if (path === '/api/v1/billing/limits')
        return { status: 200, data: { success: true, data: { schemaVersion: 2, v2: { subscription: { status: 'not_applicable', reason: 'no_organization_subscription' },
          balance: { status: 'available', source: 'organizations', observedAt: new Date().toISOString(), value: { balance: { value: '5.00', unit: 'usd', currency: 'USD' }, revision: '1' } } } } } };
      const key = plugin === 'AlphaNotifications' ? 'notifications' : plugin === 'AlphaVoiceCloud' ? 'microphone' : plugin === 'DailyApps' ? 'camera' : plugin === 'ElizaLocation' ? 'location' : plugin === 'AlphaCalendar' ? 'calendar' : plugin === 'AlphaPhotoLibrary' ? 'photos' : plugin === 'AlphaFiles' ? 'files' : null;
      if (key && (method === 'requestPermissions' || method === 'requestAccess' || method === 'storageRequestAccess')) { accessPort.requests.push(plugin + '.' + method); granted[plugin === 'DailyApps' ? input.permissions[0] : key] = true; return {}; }
      if (plugin === 'AlphaNotifications' && method === 'status') return { permissionGranted: granted.notifications, appEnabled: granted.notifications };
      if (plugin === 'AlphaFiles' && method === 'storageState') return {status: 'ready', access: granted.files ? 'granted' : 'denied', volumes: []};
      if (plugin === 'AlphaPhotoLibrary' && method === 'scope') return { scope: granted.photos ? 'selected' : 'denied', locked: false };
      if (plugin === 'AlphaFiles' && method === 'storageState') return {status: 'ready', access: granted.files ? 'granted' : 'denied'};
      if (plugin === 'AlphaFiles' && method === 'storageRequestAccess') { granted.files = true; return {status: 'ready', access: 'granted'}; }
      if (key && method === 'checkPermissions') return key === 'location' ? { location: granted.location ? 'granted' : 'prompt', accuracy: granted.location ? 'approximate' : 'none' } : { [key]: granted[key] ? 'granted' : 'prompt' };
      return previous(plugin, method, input);
    };
  }, access);
  await page.goto('/');
  await setStub(page, { nextToken: account.token });
  await expect.poll(() => starts(page), { timeout: 30_000 }).toBe(1);
  const welcome = page.locator('[role="main"].alpha-cloud-sign-in');
  await expect(welcome.getByRole('textbox', { name: 'Email', exact: true })).toBeEnabled({ timeout: 30_000 });
  // The harness has no native Browser plugin, so Home's first bookmark read reports that once; let
  // the toast pass so the screenshots show only the sign-in sequence.
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return { foreign, welcome };
}
/** Explicit synthetic email code; the account admission after it and the agent's restart are held. */
async function verifyHeld(page: Page, welcome: ReturnType<Page['locator']>, info: TestInfo) {
  await welcome.getByRole('textbox', { name: 'Email', exact: true }).fill(account.email);
  await welcome.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(welcome.getByLabel('Code',{exact:true})).toBeVisible();
  await shot(page, info, '01-enter-code');
  await page.evaluate(() => { Object.assign((window as any).postSignIn, { hold: true, admission: true }); });
  await welcome.getByLabel('Code',{exact:true}).fill('123456');
  await welcome.getByRole('button', { name: 'Verify', exact: true }).click();
  // The code is verified: the code check has ended while the account is admitted.
  await expect.poll(() => page.evaluate(() => !!(window as any).postSignIn.admit), { timeout: 15_000 }).toBe(true);
  await expect(welcome.getByRole('button', { name: 'Signing in', exact: true })).toBeDisabled();
  await shot(page, info, '02-code-verified-signing-in');
  expect(await page.locator('body').innerText()).not.toContain('Checking');
  expect(await starts(page)).toBe(1);
  await page.evaluate(() => (window as any).postSignIn.admit());
  await expect.poll(() => page.evaluate(() => (window as any).postSignIn.held), { timeout: 15_000 }).toBe(true);
}

test('APK path: a verified email code goes straight to the seven access steps while the agent restarts', async ({ page }, info) => {
  test.setTimeout(150_000);
  const { foreign, welcome } = await freshPhone(page);
  await verifyHeld(page, welcome, info);
  const setup = page.locator('dialog.alpha-startup-permissions');
  await setup.getByRole('heading', { name: 'Access', exact: true }).waitFor({ timeout: 5_000 }).catch(() => {});
  await shot(page, info, '03-after-code-agent-starting');
  // The provider is bound to the new key and the agent is starting; setup does not wait for it.
  await expect(setup.getByRole('heading', { name: 'Access', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).postSignIn.held && !!(window as any).postSignIn.release)).toBe(true);
  expect(await stub(page, s => s.order.some((entry: string) => entry.startsWith('configureCloudProvider')))).toBe(true);
  await expect(welcome).toHaveCount(0);
  const starting = await page.locator('body').innerText();
  for (const text of STARTING_SLOP) expect(starting).not.toContain(text);
  for (const name of STEPS) { await expect(setup.locator('[aria-current=step]', { hasText: name })).toBeVisible(); await setup.getByRole('button', { name: 'Allow', exact: true }).click(); }
  await expect(setup.getByRole('heading', { name: 'All set', exact: true })).toBeVisible();
  await shot(page, info, '04-all-set-agent-starting');
  for (const text of STARTING_SLOP) expect(await setup.innerText()).not.toContain(text);
  await setup.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(setup).toHaveCount(0);
  // Settings › Agent connection while it starts: Starting…, never "Not available".
  const settings = await openYourAgent(page);
  await expect(settings.getByText('Starting', { exact: true })).toHaveCount(2);
  await expect(settings.getByText('Not available', { exact: true })).toHaveCount(0);
  await shot(page, info, '05-agent-connection-while-starting');
  await page.evaluate(() => (window as any).postSignIn.release());
  await expect(settings.getByText('Running', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(settings.getByText('Eliza Cloud', { exact: true })).toBeVisible();
  await shot(page, info, '06-agent-connection-running');
  expect(await starts(page)).toBe(2);
  expect(foreign).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(button(page, 'Notes')).toBeVisible();
});

test('APK path: a signed-in start with access setup left to do opens it directly, with no Home while the account is checked', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { freshAccess: true });
  await residentStub(page, { accounts: [account] });
  await recordStartupFrames(page);
  // The account read at startup is held until released.
  await page.addInitScript(() => {
    const w = window as any, previous = w.Capacitor.nativePromise; w.admission = { admit: null };
    w.Capacitor.nativePromise = async (plugin: string, method: string, input: any) => { if (plugin === 'AlphaConnection' && method === 'request' && new URL(input.url).pathname === '/api/v1/user' && !w.admission.admit) await new Promise<void>(resolve => { w.admission.admit = resolve; }); return previous(plugin, method, input); };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as any).admission.admit), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
  const hiddenShell=page.locator('[data-alpha-startup-shell]');
  await expect(hiddenShell).toHaveAttribute('inert','');
  await expect(hiddenShell).toHaveCSS('opacity','0');
  await expect(page.getByRole('region',{name:'Home',exact:true})).toHaveCount(0);
  await expect(startupLoading(page)).toBeVisible();
  await page.evaluate(() => (window as any).admission.admit());
  await expect(page.locator('dialog.alpha-startup-permissions').getByRole('heading', { name: 'Access', exact: true })).toBeFocused({ timeout: 30_000 });
  await expect(startupLoading(page)).toHaveCount(0);
  await expectNoHomeBeforePrompt(page);
  expect(foreign).toEqual([]);
});

test('APK path: a saved sign-in that cannot reach Cloud at startup shows Home without waiting for the agent to start', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { accounts: [account] });
  // Cloud is unreachable (503 on the account read) and the agent start is held.
  await page.addInitScript(() => {
    const w = window as any, previous = w.Capacitor.nativePromise; w.firstStart = { release: null };
    w.Capacitor.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'AlphaConnection' && method === 'request' && new URL(input.url).pathname === '/api/v1/user') return { status: 503, data: {} };
      if (plugin === 'Agent' && method === 'start' && !w.firstStart.release) await new Promise<void>(resolve => { w.firstStart.release = resolve; });
      return previous(plugin, method, input);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Home', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(startupLoading(page)).toHaveCount(0);
  await expect(page.locator('.alpha-connection')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(window as any).firstStart.release)).toBe(true);
  await page.evaluate(() => (window as any).firstStart.release());
  expect(foreign).toEqual([]);
});


test('AOSP image: granted startup access reaches Ready without permission prompts or taps', async ({page}, info) => {
  test.setTimeout(150_000);
  const {foreign, welcome} = await freshPhone(page, {image: true});
  await verifyHeld(page, welcome, info);
  const setup = page.locator('dialog.alpha-startup-permissions');
  await expect(setup.getByRole('heading', {name: 'All set', exact: true})).toBeVisible();
  await expect(setup.locator('.alpha-permission-rows')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).imageAccess.requests)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1') || 'null'))).toEqual({version: 4, status: 'completed', step: 7});
  await setup.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(setup).toHaveCount(0);
  await page.evaluate(() => (window as any).postSignIn.release());
  expect(foreign).toEqual([]);
});

test('AOSP image: a stalled startup status exposes Checking and Skip without requesting access', async ({page}, info) => {
  test.setTimeout(150_000);
  await page.clock.install();
  const {foreign, welcome} = await freshPhone(page, {image: true, holdLocation: true});
  await verifyHeld(page, welcome, info);
  const setup = page.locator('dialog.alpha-startup-permissions');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1') || 'null')?.step)).toBe(3);
  await expect(setup).toHaveCount(0);
  await page.clock.fastForward(20_000);
  await expect(setup.locator('[aria-current=step]', {hasText: 'Location'})).toBeVisible();
  await expect(setup.getByRole('button', {name: 'Checking', exact: true})).toBeDisabled();
  await setup.getByRole('button', {name: 'Skip', exact: true}).click();
  await expect(setup.getByRole('heading', {name: 'All set', exact: true})).toBeVisible();
  await page.evaluate(() => {(window as any).imageAccess.releaseLocation(); (window as any).postSignIn.release();});
  expect(await page.evaluate(() => (window as any).imageAccess.requests)).toEqual([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1') || 'null'));
  expect(saved).toEqual({version: 4, status: 'completed', step: 7, choices: ['continued', 'continued', 'continued', 'skipped', 'continued', 'continued', 'continued']});
  expect(foreign).toEqual([]);
});
