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
      ElizaSystem: ['listLauncherApps', 'launchApp', 'resolveDefaultApp', 'openDefaultApp', 'openAppInfo', 'getBuildInfo', 'getLocaleInfo', 'getLaunchInfo'],
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

/** Home's icons in order, by label (edit mode renames the buttons to their removal). */
const homeOrder = (page: Page) => page.locator('[data-alpha-home-apps] [data-alpha-home-key]').evaluateAll(nodes => nodes.map(node => node.closest('[data-mobile-shell-tile]')!.querySelector('[data-mobile-shell-tile-label]')!.textContent));
const names = (list: ReturnType<Page['locator']>) => list.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
/** The drawer's tiles in order, by accessible name. */
const tiles = (drawer: ReturnType<Page['locator']>) => names(drawer.locator('[data-launcher-app] > button'));
/** Long press: the platform's context-menu gesture on that tile or icon. */
const longPress = (target: ReturnType<Page['locator']>) => target.click({ button: 'right' });
async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('fresh Alpha Home shows core apps and loads installed apps only in Apps', async ({ page }) => {
  await nativeStub(page, ALL, {}, false);
  await page.goto('/');
  for (const name of ['Inbox', 'Calendar', 'Camera', 'Photos', 'Notes', 'Settings'])
    await expect(page.getByRole('button', {name, exact: true})).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'Clock', exact: true})).toHaveCount(0);
  expect(await calls(page, 'list')).toHaveLength(0);
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole('button', {name: 'Open Clock', exact: true})).toHaveCount(1);
  // Only installed Android entries; Alpha's Settings stays on Home and is not repeated here.
  await expect(drawer.getByRole('button', {name: 'Open Settings', exact: true})).toHaveCount(1);
  await expect(drawer.getByRole('button', {name: /Alpha Phone/})).toHaveCount(0);
  await expect(drawer.getByRole('button', {name: 'Open Inbox', exact: true})).toHaveCount(0);
  expect(await calls(page, 'list')).toHaveLength(1);
  await drawer.getByRole('button', {name: 'Open Clock', exact: true}).click();
  await expect.poll(() => calls(page, 'launch')).toEqual([{packageName: CLOCK.packageName, activityName: CLOCK.activityName}]);
  await drawer.getByRole('button', {name: 'Open Settings', exact: true}).click();
  await expect.poll(() => calls(page, 'launch')).toHaveLength(2);
  expect((await calls(page, 'launch'))[1]).toEqual({packageName: SETTINGS.packageName, activityName: SETTINGS.activityName});
});

test('same-label apps are separate tiles and each opens exactly its own component and profile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await nativeStub(page, ALL, { 'com.vendor.notes/com.vendor.notes.Launch#10': { message: 'Work apps are paused or locked. Turn on work apps in Android, then try again.', code: 'profile-locked' } });
  await page.goto('/');
  const drawer = await openDrawer(page);
  // Alphabetical 4-column grid; two packages, two activities of one package and a work copy share labels.
  await expect.poll(() => tiles(drawer)).toEqual(['Open Clock', 'Open Notes (com.vendor.notes)', 'Open Notes (Work · locked)', 'Open Notes (org.example.notes)', 'Open Settings', 'Open Suite (CalendarActivity)', 'Open Suite (MailActivity)']);
  const columns = await drawer.locator('[data-launcher-app]').evaluateAll(nodes => new Set(nodes.slice(0, 4).map(node => Math.round(node.getBoundingClientRect().top))).size);
  expect(columns).toBe(1);
  await expect(drawer.getByRole('button', { name: 'Open Notes', exact: true })).toHaveCount(0);
  // Each tile shows its own icon, not one chosen by label.
  await expect(drawer.getByRole('button', { name: 'Open Notes (org.example.notes)', exact: true }).locator('img')).toHaveAttribute('src', PNG);
  await expect(drawer.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true }).locator('img')).toHaveAttribute('src', PNG2);
  await expect(drawer.getByRole('button', { name: 'Open Suite (MailActivity)', exact: true }).locator('img')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('apps-grid.png') });

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

test('long-pressing an app offers Add to Home and App info; Home order persists across a cold start', async ({ page }, info) => {
  await nativeStub(page, ALL);
  await page.goto('/');
  let drawer = await openDrawer(page);
  for (const name of ['Settings', 'Notes (com.vendor.notes)', 'Clock']) {
    const tile = drawer.getByRole('button', { name: `Open ${name}`, exact: true });
    await longPress(tile);
    const menu = drawer.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Add to Home', 'App info']);
    // The long press opened the menu only.
    expect(await calls(page, 'launch')).toEqual([]);
    await menu.getByRole('menuitem', { name: 'Add to Home', exact: true }).click();
    // Adding returns to Home, where the app now is.
    await expect(drawer).toHaveCount(0);
    if (name !== 'Clock') drawer = await openDrawer(page);
  }
  await expect.poll(() => homeOrder(page)).toEqual(['Settings', 'Notes', 'Clock']);
  drawer = await openDrawer(page);
  // An app already on Home says so; App info opens Android's screen for exactly that entry.
  await longPress(drawer.getByRole('button', { name: 'Open Clock', exact: true }));
  await expect(drawer.getByRole('menuitem', { name: 'On Home', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('apps-menu.png') });
  await drawer.getByRole('menuitem', { name: 'App info', exact: true }).click();
  await expect.poll(() => calls(page, 'openAppInfo')).toEqual([{ packageName: CLOCK.packageName, activityName: CLOCK.activityName }]);
  await expect(drawer.getByRole('menu')).toHaveCount(0);
  // Back closes an open menu before the drawer.
  await longPress(drawer.getByRole('button', { name: 'Open Settings', exact: true }));
  await expect(drawer.getByRole('menu')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));
  await expect(drawer.getByRole('menu')).toHaveCount(0);
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.launcher.favorites.v1') || 'null'))).toEqual({ version: 2, defaultPolicy: 'alpha-apps', keys: [
    'com.android.settings/com.android.settings.Settings', 'com.vendor.notes/com.vendor.notes.Launch', 'com.android.deskclock/com.android.deskclock.DeskClock' ] });

  // Cold start: same Home, same order, and a Home icon opens its exact component.
  await page.reload();
  await expect.poll(() => homeOrder(page)).toEqual(['Settings', 'Notes', 'Clock']);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect.poll(() => calls(page, 'launch')).toEqual([{ packageName: 'com.vendor.notes', activityName: 'com.vendor.notes.Launch' }]);
});

test('a long-press menu on a tile at the bottom edge of a full drawer is shown whole, not clipped by the scroller', async ({ page }) => {
  const many: App[] = Array.from({ length: 40 }, (_, i) => ({ packageName: `org.example.app${String(i).padStart(2, '0')}`, activityName: 'Main', label: `App ${String(i).padStart(2, '0')}` }));
  await nativeStub(page, many);
  await page.goto('/');
  const drawer = await openDrawer(page);
  const scroller = drawer.locator('[data-installed-apps-scroll]');
  const tile = drawer.locator('[data-launcher-app]').nth(32);
  // Scroll so this tile's row ends just above the scroller's bottom edge: no room for a menu below it.
  await tile.evaluate(node => { const scroller = node.closest('[data-installed-apps-scroll]') as HTMLElement; scroller.scrollTop += node.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - 4); });
  await tile.locator('> button').dispatchEvent('contextmenu');
  const menu = drawer.getByRole('menu');
  await expect(menu).toBeVisible();
  const inside = await menu.evaluate(node => { const room = node.closest('[data-installed-apps-scroll]')!.getBoundingClientRect(), box = node.getBoundingClientRect(); return box.top >= room.top - 1 && box.bottom <= room.bottom + 1; });
  expect(inside, 'the whole menu is inside the scroller').toBe(true);
  await menu.getByRole('menuitem', { name: 'App info', exact: true }).dispatchEvent('click');
  await expect.poll(() => calls(page, 'openAppInfo')).toHaveLength(1);
  expect(await scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
});
test('Home edit mode removes and rearranges icons, "+" restores hidden views, and Done persists', async ({ page }, info) => {
  await nativeStub(page, ALL, {}, false);
  await page.goto('/');
  const start = await homeOrder(page);
  const [first] = start;
  expect(start).toContain('Calendar');
  // Holding a Home icon enters edit mode and opens nothing.
  const held = page.getByRole('button', { name: first, exact: true });
  const box = (await held.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  const done = page.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeVisible();
  const add = page.getByRole('button', { name: 'Add to Home', exact: true });
  await expect(add).toBeDisabled();
  // Apps is not offered while editing; each icon is named for its removal.
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Calendar from Home', exact: true })).toHaveCount(1);
  // The "−" sits on the icon's corner and icons wiggle (Alpha's edit-mode stylesheet is applied).
  expect(await page.locator('[data-alpha-home-key="alpha:calendar"] [data-alpha-home-remove]').evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  expect(await page.locator('[data-alpha-home-key="alpha:calendar"]').evaluate(el => getComputedStyle(el).animationName)).toBe('alpha-wiggle');
  // A tap on an icon itself opens nothing and removes nothing; its "−" removes it.
  await page.getByRole('button', { name: 'Remove Calendar from Home', exact: true }).click();
  await expect.poll(() => homeOrder(page)).toEqual(start);
  await page.locator('[data-alpha-home-key="alpha:calendar"] [data-alpha-home-remove]').click();
  const left = start.filter(name => name !== 'Calendar');
  await expect.poll(() => homeOrder(page)).toEqual(left);
  // Arrow keys move the focused icon.
  await page.getByRole('button', { name: `Remove ${left[1]} from Home`, exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await homeOrder(page)).slice(0, 2)).toEqual([left[1], left[0]]);
  // Dragging an icon onto another's place moves it there.
  const icons = page.locator('[data-alpha-home-apps] [data-mobile-shell-tile]');
  const from = (await icons.nth(0).boundingBox())!, to = (await icons.nth(2).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await homeOrder(page)).slice(0, 3)).toEqual([left[0], left[2], left[1]]);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await page.screenshot({ path: info.outputPath('home-edit.png') });
  await add.click();
  const sheet = page.getByRole('dialog', { name: 'Add to Home', exact: true });
  await expect(sheet.getByRole('button')).toHaveText(['Calendar']);
  await sheet.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(async () => (await homeOrder(page)).at(-1)).toBe('Calendar');
  await done.click();
  await expect(done).toHaveCount(0);
  // Taps open again after Done, and the arrangement survives a cold start.
  const arranged = await homeOrder(page);
  await page.reload();
  await expect.poll(() => homeOrder(page)).toEqual(arranged);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'calendar');
});

test('an open drawer follows installs and removals, and a removed Home app is not shown', async ({ page }) => {
  await nativeStub(page, [SETTINGS, NOTES_A, CLOCK]);
  await page.goto('/');
  const drawer = await openDrawer(page);
  await expect.poll(() => tiles(drawer)).toEqual(['Open Clock', 'Open Notes', 'Open Settings']);
  await expect.poll(() => page.evaluate(() => (window as any).deviceListening())).toBe(true);
  for (const name of ['Clock', 'Settings']) {
    await longPress(drawer.getByRole('button', { name: `Open ${name}`, exact: true }));
    await drawer.getByRole('menuitem', { name: 'Add to Home', exact: true }).click();
    if (name === 'Clock') await openDrawer(page);
  }
  await expect.poll(() => homeOrder(page)).toEqual(['Clock', 'Settings']);
  await openDrawer(page);

  // Android reports a removal: the entry and its Home icon leave without reopening the drawer,
  // and without a loading state replacing the list.
  await page.evaluate(([settings, notes]) => (window as any).deviceChange([settings, notes], true), [SETTINGS, NOTES_A]);
  await expect(drawer.getByRole('button', { name: 'Open Clock', exact: true })).toHaveCount(0);
  await expect.poll(() => tiles(drawer)).toEqual(['Open Notes', 'Open Settings']);
  await expect.poll(() => homeOrder(page)).toEqual(['Settings']);

  // An install appears; a second app with an existing label becomes distinguishable at once.
  // Android announces one install as several changes; the device is read once for the burst.
  const readsBefore = (await calls(page, 'list')).length;
  await page.evaluate(apps => { for (let i = 0; i < 3; i++) (window as any).deviceChange(apps, true); }, [SETTINGS, NOTES_A, NOTES_B, CLOCK]);
  await expect(drawer.getByRole('button', { name: 'Open Notes (com.vendor.notes)', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open Notes (org.example.notes)', exact: true })).toBeVisible();
  expect((await calls(page, 'list')).length).toBe(readsBefore + 1);
  // The reinstalled Home app returns to its saved place.
  await expect.poll(() => homeOrder(page)).toEqual(['Clock', 'Settings']);

  // A change Android did not announce is picked up when Alpha returns to the foreground.
  await page.evaluate(apps => (window as any).deviceChange(apps, false), [SETTINGS]);
  await expect.poll(() => tiles(drawer)).toHaveLength(4);
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await expect.poll(() => tiles(drawer)).toEqual(['Open Settings']);

  // Saved native shortcuts also follow inventory changes while the drawer is closed.
  await drawer.getByRole('button', { name: 'Close apps', exact: true }).click();
  const reads = (await calls(page, 'list')).length;
  await page.evaluate(apps => (window as any).deviceChange(apps, true), [SETTINGS, CLOCK]);
  await expect.poll(async () => (await calls(page, 'list')).length).toBe(reads + 1);
  await expect.poll(() => homeOrder(page)).toEqual(['Clock', 'Settings']);
  await openDrawer(page);
  await expect.poll(() => tiles(drawer)).toEqual(['Open Clock', 'Open Settings']);
});

test('an app removed or disabled behind a stale tile reports why and leaves the grid', async ({ page }) => {
  await nativeStub(page, [SETTINGS, NOTES_A, CLOCK], {
    'org.example.notes/org.example.notes.Main': { message: 'This app is no longer installed.', code: 'not-installed', remove: true },
    'com.android.deskclock/com.android.deskclock.DeskClock': { message: 'This app is disabled. Enable it in Android settings to open it.', code: 'disabled', remove: true },
  });
  await page.goto('/');
  const drawer = await openDrawer(page);
  await drawer.getByRole('button', { name: 'Open Notes', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Notes could not be opened. This app is no longer installed.');
  // The stale tile is gone after the refusal; the reason stays visible and nothing else was opened.
  await expect(drawer.getByRole('button', { name: 'Open Notes', exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Open Clock', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Clock could not be opened. This app is disabled. Enable it in Android settings to open it.');
  await expect(drawer.getByRole('button', { name: 'Open Clock', exact: true })).toHaveCount(0);
  expect(await calls(page, 'launch')).toHaveLength(2);
  await expect.poll(() => tiles(drawer)).toEqual(['Open Settings']);
  // Still on Home with the drawer open: a refusal is never presented as an opened app.
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect(drawer).toBeVisible();
  // A new search drops the old error.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('set');
  await expect(drawer.getByRole('alert')).toHaveCount(0);
});

test('a failed refresh clears the grid instead of leaving a stale one, and HOME closes the drawer', async ({ page }) => {
  await nativeStub(page, [SETTINGS, CLOCK]);
  await page.goto('/');
  const drawer = await openDrawer(page);
  await expect.poll(() => tiles(drawer)).toEqual(['Open Clock', 'Open Settings']);
  await page.evaluate(() => { (window as any).device.failList = true; (window as any).deviceChange((window as any).device.apps, true); });
  await expect(drawer.getByText('Apps could not be read.', { exact: true })).toBeVisible();
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
  await expect.poll(() => tiles(drawer)).toEqual(['Open Clock', 'Open Settings']);
});
