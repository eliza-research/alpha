import { test, expect, type Page } from '@playwright/test';
// Development lane with a native-plugin stub: the page sees an Android Capacitor bridge whose
// ElizaSystem launcher answers and `launcherAppsChanged` events come from this file. The stub's inventory is the
// "device": tests add and remove entries there, never in the renderer. No Android package manager,
// work profile or HOME role is involved; LauncherAppsInstrumentedTest and
// LauncherHomeInstrumentedTest cover the Android side, and a phone covers acceptance.

type App = { packageName: string; label: string; activityName?: string; user?: string; profile?: string; locked?: boolean; icon?: string };
type Refusal = { message: string; code: string; remove?: boolean };

async function nativeStub(page: Page, apps: App[], refusals: Record<string, Refusal> = {}, emptyHome = true) {
  await page.addInitScript(({ apps, refusals, emptyHome }) => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
    // Native-shortcut scenarios choose an empty Home explicitly; fresh-default coverage opts out.
    if (emptyHome && !sessionStorage.getItem('stub.homeChoice')) {
      localStorage.setItem('alpha.launcher.favorites.v1', JSON.stringify({version:2,keys:[],defaultPolicy:'alpha-apps'}));
      sessionStorage.setItem('stub.homeChoice','1');
    }
    const w = window as any; w.nativeCalls = []; w.androidBridge = {};
    // The device inventory survives a reload of the page (sessionStorage), like a real phone's.
    const saved = sessionStorage.getItem('stub.device');
    const device = w.device = { apps: saved ? JSON.parse(saved) : apps, refusals, failList: false };
    const persist = () => sessionStorage.setItem('stub.device', JSON.stringify(device.apps));
    const key = (app: any) => app.packageName + (app.activityName ? '/' + app.activityName : '') + (app.user ? '#' + app.user : '');
    const listeners: Record<string, (data: unknown) => void> = {};
    w.deviceChange = (next: any[], notify: boolean) => { device.apps = next; persist(); if (notify) listeners['ElizaSystem:launcherAppsChanged']?.({ reason: 'changed' }); };
    w.deviceListening = () => !!listeners['ElizaSystem:launcherAppsChanged'];
    const plugins: Record<string, string[]> = {
      ElizaSystem: ['listLauncherApps', 'launchApp', 'resolveDefaultApp', 'openDefaultApp', 'getBuildInfo', 'getLocaleInfo', 'getLaunchInfo'],
      DeviceApps: ['platformCapabilities'],
      DailyApps: ['surfaceInfo', 'requestPermissions', 'closeAssistant'],
      AlphaNotifications: ['status', 'list'],
      AlphaVoiceCloud: ['checkPermissions', 'requestPermissions'],
      AlphaDevice: ['openSettings'],
    };
    const answer = (plugin: string, method: string, options: any) => {
      if (plugin === 'ElizaSystem') {
        if (method === 'listLauncherApps') { if (device.failList) throw Error('Package manager unavailable'); return { apps: device.apps }; }
        if (method === 'launchApp') {
          const refusal = device.refusals[key(options)];
          if (refusal) {
            if (refusal.remove) { device.apps = device.apps.filter((app: any) => key(app) !== key(options)); persist(); }
            throw Object.assign(Error(refusal.message), { code: refusal.code });
          }
          if (!device.apps.some((app: any) => key(app) === key(options))) throw Object.assign(Error('This app is no longer installed.'), { code: 'not-installed' });
          return {};
        }
        if (method === 'resolveDefaultApp') return { role: 'dial', available: false };
        if (method === 'getBuildInfo') return { launcher: true, version: 'stub' };
        if (method === 'getLaunchInfo') return { assistant: false };
        if (method === 'getLocaleInfo') return { locale: 'en-US', hour24: false };
        return {};
      }
      if (plugin === 'DailyApps' && method === 'surfaceInfo') return { assistant: false, developmentBuild: true, topInset: 0, bottomInset: 0 };
      if (plugin === 'AlphaNotifications' && method === 'status') return { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud' && method === 'checkPermissions') return { microphone: 'granted' };
      return {};
    };
    const cap: any = w.Capacitor = {
      Plugins: {},
      PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: [...methods, 'addListener', 'removeListener'].map(m => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback: (plugin: string, method: string, options: any, callback: (data: unknown) => void) => {
        w.nativeCalls.push({ plugin, method, options });
        if (method === 'addListener' && options?.eventName && typeof callback === 'function') listeners[`${plugin}:${options.eventName}`] = callback;
        return 'stub-callback';
      },
      nativePromise: async (plugin: string, method: string, options: any) => { w.nativeCalls.push({ plugin, method, options }); return answer(plugin, method, options); },
    };
    for (const name of Object.keys(plugins)) cap.Plugins[name] = { addListener: () => ({ remove: async () => {} }) };
  }, { apps, refusals, emptyHome });
}
/** Shared launcher calls on ElizaSystem, by their old short names (list, launch). */
const calls = (page: Page, method: string) => page.evaluate(method => (window as any).nativeCalls.filter((c: any) => c.plugin === 'ElizaSystem' && c.method === method).map((c: any) => c.options ?? null), ({ list: 'listLauncherApps', launch: 'launchApp' } as Record<string, string>)[method] ?? method);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SETTINGS: App = { packageName: 'com.android.settings', activityName: 'com.android.settings.Settings', label: 'Settings', icon: PNG };
const NOTES_A: App = { packageName: 'org.example.notes', activityName: 'org.example.notes.Main', label: 'Notes', icon: PNG };
const NOTES_B: App = { packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch', label: 'Notes', icon: PNG2 };
const SUITE_MAIL: App = { packageName: 'com.vendor.suite', activityName: 'com.vendor.suite.MailActivity', label: 'Suite' };
const SUITE_CAL: App = { packageName: 'com.vendor.suite', activityName: 'com.vendor.suite.CalendarActivity', label: 'Suite' };
const WORK_NOTES: App = { packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch', label: 'Notes', user: '10', profile: 'work', locked: true };
const CLOCK: App = { packageName: 'com.android.deskclock', activityName: 'com.android.deskclock.DeskClock', label: 'Clock' };
const ALL = [SETTINGS, NOTES_A, NOTES_B, SUITE_MAIL, SUITE_CAL, WORK_NOTES, CLOCK];

async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}
const names = (list: ReturnType<Page['locator']>) => list.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));

test('fresh Alpha Home shows core apps and loads installed apps only in Apps', async ({ page }) => {
  await nativeStub(page, ALL, {}, false);
  await page.goto('/');
  for (const name of ['Inbox', 'Calendar', 'Camera', 'Photos', 'Notes', 'Settings'])
    await expect(page.getByRole('button', {name, exact: true})).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'Clock', exact: true})).toHaveCount(0);
  expect(await calls(page, 'list')).toHaveLength(0);
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole('button', {name: 'Open Clock', exact: true})).toHaveCount(1);
  await expect(drawer.getByRole('button', {name: 'Open Settings', exact: true})).toHaveCount(1);
  await expect(drawer.getByRole('button', {name: 'Open Settings (Alpha Phone)', exact: true})).toHaveCount(0);
  await expect(drawer.getByRole('button', {name: 'Open Calendar', exact: true})).toHaveCount(0);
  await expect(drawer.getByRole('button', {name: 'Open Settings (alpha:settings)', exact: true})).toHaveCount(0);
  expect(await calls(page, 'list')).toHaveLength(1);
  await drawer.getByRole('button', {name: 'Open Clock', exact: true}).click();
  await expect.poll(() => calls(page, 'launch')).toEqual([{packageName: CLOCK.packageName, activityName: CLOCK.activityName}]);
  await drawer.getByRole('button', {name: 'Close Apps', exact: true}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  expect(await calls(page, 'launch')).toEqual([{packageName: CLOCK.packageName, activityName: CLOCK.activityName}]);
});

test('same-label apps are separate entries and each opens exactly its own component and profile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await nativeStub(page, ALL, { 'com.vendor.notes/com.vendor.notes.Launch#10': { message: 'Work apps are paused or locked. Turn on work apps in Android, then try again.', code: 'profile-locked' } });
  await page.goto('/');
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole('status').first()).toHaveText('7 apps');
  // Two different packages, two activities of one package and a work copy all share labels.
  for (const name of ['Open Notes (org.example.notes)', 'Open Notes (com.vendor.notes)', 'Open Notes (Work · locked)', 'Open Suite (MailActivity)', 'Open Suite (CalendarActivity)', 'Open Settings', 'Open Clock'])
    await expect(drawer.getByRole('button', { name, exact: true })).toHaveCount(1);
  await expect(drawer.getByRole('button', { name: 'Open Notes', exact: true })).toHaveCount(0);
  // Each row shows its own icon, not one chosen by label.
  await expect(drawer.getByRole('button', { name: 'Open Notes (org.example.notes)', exact: true }).locator('img')).toHaveAttribute('src', PNG);
  await expect(drawer.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true }).locator('img')).toHaveAttribute('src', PNG2);
  await expect(drawer.getByRole('button', { name: 'Open Suite (MailActivity)', exact: true }).locator('img')).toHaveCount(0);
  await expect(drawer).toHaveCSS('opacity','1');
  await page.screenshot({ path: info.outputPath('duplicate-labels.png'), animations:'disabled' });

  await drawer.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true }).click();
  await drawer.getByRole('button', { name: 'Open Suite (CalendarActivity)', exact: true }).click();
  await expect.poll(() => calls(page, 'launch')).toEqual([
    { packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch' },
    { packageName: 'com.vendor.suite', activityName: 'com.vendor.suite.CalendarActivity' },
  ]);
  await expect(drawer.getByRole('alert')).toHaveCount(0);

  // The locked work copy is asked for by profile and its refusal is shown; the personal copy is not opened instead.
  await drawer.getByRole('button', { name: 'Open Notes (Work · locked)', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Notes could not be opened. Work apps are paused or locked. Turn on work apps in Android, then try again.');
  expect((await calls(page, 'launch')).slice(2)).toEqual([{ packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch', user: '10' }]);
  expect(errors).toEqual([]);
});

test('favorites and their order persist across a cold start and follow the exact entry', async ({ page }, info) => {
  await nativeStub(page, ALL);
  await page.goto('/');
  let drawer = await openDrawer(page);
  await expect(drawer.getByRole('region', { name: 'Favorites', exact: true })).toHaveCount(0);
  for (const name of ['Settings', 'Notes (com.vendor.notes)', 'Clock']) {
    const star = drawer.getByRole('button', { name: `Add ${name} to favorites`, exact: true });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
  }
  const favorites = drawer.getByRole('region', { name: 'Favorites', exact: true });
  const order = () => names(favorites.getByRole('button', { name: /^Open / }));
  await expect.poll(order).toEqual(['Open Settings', 'Open Notes (com.vendor.notes)', 'Open Clock']);
  // The other Notes and the work copy are not favorites.
  await expect(drawer.getByRole('button', { name: 'Add Notes (org.example.notes) to favorites', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(drawer.getByRole('button', { name: 'Add Notes (Work · locked) to favorites', exact: true })).toHaveCount(1);
  await expect(favorites.getByRole('button', { name: 'Move Settings earlier', exact: true })).toBeDisabled();
  await expect(favorites.getByRole('button', { name: 'Move Clock later', exact: true })).toBeDisabled();
  await favorites.getByRole('button', { name: 'Move Clock earlier', exact: true }).click();
  await favorites.getByRole('button', { name: 'Move Clock earlier', exact: true }).click();
  await expect.poll(order).toEqual(['Open Clock', 'Open Settings', 'Open Notes (com.vendor.notes)']);
  await favorites.getByRole('button', { name: 'Move Settings later', exact: true }).click();
  await expect.poll(order).toEqual(['Open Clock', 'Open Notes (com.vendor.notes)', 'Open Settings']);
  await page.screenshot({ path: info.outputPath('favorites.png') });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.launcher.favorites.v1') || 'null'))).toEqual({ version: 2, defaultPolicy: 'alpha-apps', keys: [
    'com.android.deskclock/com.android.deskclock.DeskClock', 'com.vendor.notes/com.vendor.notes.Launch', 'com.android.settings/com.android.settings.Settings' ] });
  // Searching shows only matches, without the Favorites section.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('clo');
  await expect(favorites).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Remove Clock from favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Cold start: same favorites, same order, and a favorite opens its exact component.
  await page.reload();
  drawer = await openDrawer(page);
  await expect.poll(order).toEqual(['Open Clock', 'Open Notes (com.vendor.notes)', 'Open Settings']);
  await favorites.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true }).click();
  await expect.poll(() => calls(page, 'launch')).toEqual([{ packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch' }]);
  await favorites.getByRole('button', { name: 'Remove Clock from favorites', exact: true }).click();
  await expect.poll(order).toEqual(['Open Notes (com.vendor.notes)', 'Open Settings']);
  await page.reload();
  drawer = await openDrawer(page);
  await expect.poll(order).toEqual(['Open Notes (com.vendor.notes)', 'Open Settings']);
});

test('an open drawer follows installs and removals, and a removed favorite is not shown', async ({ page }) => {
  await nativeStub(page, [SETTINGS, NOTES_A, CLOCK]);
  await page.goto('/');
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole('status').first()).toHaveText('3 apps');
  await expect.poll(() => page.evaluate(() => (window as any).deviceListening())).toBe(true);
  await drawer.getByRole('button', { name: 'Add Clock to favorites', exact: true }).click();
  await drawer.getByRole('button', { name: 'Add Settings to favorites', exact: true }).click();
  const favorites = drawer.getByRole('region', { name: 'Favorites', exact: true });
  await expect(favorites.getByRole('button', { name: /^Open / })).toHaveCount(2);
  // The Favorites region holds only favorites; the full list has its own heading after it.
  await expect(favorites.getByRole('heading')).toHaveText(['Favorites']);
  await expect(drawer.getByRole('heading', { name: 'Apps', exact: true })).toHaveCount(1);
  await expect(drawer.getByRole('heading', { name: 'All apps', exact: true })).toHaveCount(1);

  // Android reports a removal: the entry and its favorite leave without reopening the drawer,
  // and without a loading state replacing the list.
  await page.evaluate(([settings, notes]) => (window as any).deviceChange([settings, notes], true), [SETTINGS, NOTES_A]);
  await expect(drawer.getByRole('button', { name: 'Open Clock', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('status').first()).toHaveText('2 apps');
  await expect.poll(() => names(favorites.getByRole('button', { name: /^Open / }))).toEqual(['Open Settings']);
  await expect(drawer.getByText('Reading installed apps…', { exact: true })).toHaveCount(0);

  // An install appears; a second app with an existing label becomes distinguishable at once.
  // Android announces one install as several changes; the device is read once for the burst.
  const readsBefore = (await calls(page, 'list')).length;
  await page.evaluate(apps => { for (let i = 0; i < 3; i++) (window as any).deviceChange(apps, true); }, [SETTINGS, NOTES_A, NOTES_B, CLOCK]);
  await expect(drawer.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open Notes (org.example.notes)', exact: true })).toBeVisible();
  expect((await calls(page, 'list')).length).toBe(readsBefore + 1);
  // The reinstalled favorite returns to its saved place.
  await expect.poll(() => names(favorites.getByRole('button', { name: /^Open / }))).toEqual(['Open Clock', 'Open Settings']);

  // A change Android did not announce is picked up when Alpha returns to the foreground.
  await page.evaluate(apps => (window as any).deviceChange(apps, false), [SETTINGS]);
  await expect(drawer.getByRole('status').first()).toHaveText('4 apps');
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await expect(drawer.getByRole('status').first()).toHaveText('1 app');

  // Saved native shortcuts also follow inventory changes while the drawer is closed.
  await drawer.getByRole('button', { name: 'Close Apps', exact: true }).click();
  const reads = (await calls(page, 'list')).length;
  await page.evaluate(apps => (window as any).deviceChange(apps, true), [SETTINGS, CLOCK]);
  await expect.poll(async () => (await calls(page, 'list')).length).toBe(reads + 1);
  await openDrawer(page);
  // Clock returns to Favorites without a duplicate in the inventory list.
  await expect(drawer.getByRole('button', { name: 'Open Clock', exact: true })).toHaveCount(1);
  await expect(drawer.getByRole('status').first()).toHaveText('2 apps');
});

test('an app removed or disabled behind a stale row reports why and leaves the list', async ({ page }) => {
  await nativeStub(page, [SETTINGS, NOTES_A, CLOCK], {
    'org.example.notes/org.example.notes.Main': { message: 'This app is no longer installed.', code: 'not-installed', remove: true },
    'com.android.deskclock/com.android.deskclock.DeskClock': { message: 'This app is disabled. Enable it in Android settings to open it.', code: 'disabled', remove: true },
  });
  await page.goto('/');
  const drawer = await openDrawer(page);
  await drawer.getByRole('button', { name: 'Open Notes', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Notes could not be opened. This app is no longer installed.');
  // The stale row is gone after the refusal; the reason stays visible and nothing else was opened.
  await expect(drawer.getByRole('button', { name: 'Open Notes', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('status').first()).toHaveText('2 apps');
  await drawer.getByRole('button', { name: 'Open Clock', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Clock could not be opened. This app is disabled. Enable it in Android settings to open it.');
  await expect(drawer.getByRole('button', { name: 'Open Clock', exact: true })).toHaveCount(0);
  expect(await calls(page, 'launch')).toHaveLength(2);
  // Still on Home with the drawer open: a refusal is never presented as an opened app.
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect(drawer).toBeVisible();
  // A new search drops the old error.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('set');
  await expect(drawer.getByRole('alert')).toHaveCount(0);
});

test('a failed refresh clears the list instead of leaving a stale one, and HOME closes the drawer', async ({ page }) => {
  await nativeStub(page, [SETTINGS, CLOCK]);
  await page.goto('/');
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole('status').first()).toHaveText('2 apps');
  await page.evaluate(() => { (window as any).device.failList = true; (window as any).deviceChange((window as any).device.apps, true); });
  await expect(drawer.getByText('Installed apps could not be read.', { exact: true })).toBeVisible();
  // The failed native inventory leaves no stale app entries in Apps.
  await expect(drawer.getByRole('button', { name: /^Open / })).toHaveCount(0);
  await page.evaluate(() => { (window as any).device.failList = false; });
  await drawer.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Open Settings', exact: true })).toBeVisible();

  // Returning with HOME after opening an app lands on Home with the drawer closed and the search cleared.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('set');
  await drawer.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await expect.poll(() => calls(page, 'launch')).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await openDrawer(page);
  await expect(drawer.getByRole('searchbox', { name: 'Search apps', exact: true })).toHaveValue('');
  await expect(drawer.getByRole('status').first()).toHaveText('2 apps');
});
