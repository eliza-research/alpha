import { test, expect, type Page } from '@playwright/test';
// Development lane with a native-plugin stub: the page sees an Android Capacitor bridge whose
// ElizaSystem launcher, AlphaNotifications and AlphaVoiceCloud answers come from this file. No Android
// device, package manager or permission prompt is involved; LauncherHomeInstrumentedTest covers
// the real launcher APK holding HOME.

type Stub = { apps?: unknown; failLaunch?: string[]; dial?: unknown; notifications?: { permissionGranted: boolean; appEnabled: boolean }; microphone?: string; assistant?: boolean };

async function nativeStub(page: Page, stub: Stub) {
  await page.addInitScript((stub: Stub) => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
    const w = window as any; w.nativeCalls = w.nativeCalls || []; w.androidBridge = {};
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
        if (method === 'listLauncherApps') return { apps: stub.apps ?? [] };
        if (method === 'launchApp') { if ((stub.failLaunch || []).includes(options?.packageName)) throw Error('Activity not found'); return {}; }
        if (method === 'resolveDefaultApp') return stub.dial ?? { role: 'dial', available: false };
        if (method === 'getBuildInfo') return { launcher: true, version: 'stub' };
        if (method === 'getLaunchInfo') return { assistant: stub.assistant === true };
        if (method === 'getLocaleInfo') return { locale: 'en-US', hour24: false };
        return {};
      }
      if (plugin === 'DailyApps' && method === 'surfaceInfo') return { assistant: false, developmentBuild: true, topInset: 0, bottomInset: 0 };
      if (plugin === 'AlphaNotifications' && method === 'status') return stub.notifications ?? { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud' && method === 'checkPermissions') return { microphone: stub.microphone ?? 'granted' };
      return {};
    };
    const cap: any = w.Capacitor = {
      Plugins: {},
      PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: [...methods, 'addListener', 'removeListener'].map(m => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback: (plugin: string, method: string, options: any) => { w.nativeCalls.push({ plugin, method, options }); return 'stub-callback'; },
      nativePromise: async (plugin: string, method: string, options: any) => { w.nativeCalls.push({ plugin, method, options }); return answer(plugin, method, options); },
    };
    for (const name of Object.keys(plugins)) cap.Plugins[name] = { addListener: () => ({ remove: async () => {} }) };
  }, stub);
}
const calls = (page: Page, plugin: string, method: string) => page.evaluate(([plugin, method]) => (window as any).nativeCalls.filter((c: any) => c.plugin === plugin && c.method === method).map((c: any) => c.options ?? null), [plugin, method]);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('Apps lists Android entries with icons and launches by package', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await nativeStub(page, {
    apps: [
      { packageName: 'com.android.settings', label: 'Settings', icon: PNG },
      { packageName: 'org.example.broken', label: 'Broken app' },
      { packageName: 'org.example.bad-icon', label: 'Bad icon', icon: 'javascript:alert(1)' },
      { packageName: 'com.android.settings', label: 'Settings duplicate' },
    ],
    failLaunch: ['org.example.broken'],
    dial: { role: 'dial', available: true, packageName: 'com.android.dialer', label: 'Phone by Example' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  await expect(drawer.getByRole('button', { name: 'Open Settings', exact: true })).toBeVisible();
  // Icons are requested on Android; an entry with an unsafe icon or a duplicate package is dropped.
  expect(await calls(page, 'ElizaSystem', 'listLauncherApps')).toEqual([{ icons: true }]);
  await expect(drawer.getByRole('button', { name: 'Open Bad icon', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Open Settings duplicate', exact: true })).toHaveCount(0);
  // Installed apps only, without a count; Alpha's views are on Home.
  await expect.poll(() => drawer.locator('[data-launcher-app] > button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Open Broken app', 'Open Settings']);
  await expect(drawer.getByText(/\d+ apps?$/)).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Open Settings', exact: true }).locator('img')).toHaveAttribute('src', PNG);

  // Only Android's installed inventory appears, even when a default dialer was resolved.
  await expect(drawer.getByRole('button', { name: /^Open Phone/ })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Open Calendar', exact: true })).toHaveCount(0);
  expect(await calls(page, 'ElizaSystem', 'openDefaultApp')).toEqual([]);

  // Search, then launch by package name only.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('sett');
  await drawer.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await expect.poll(() => calls(page, 'ElizaSystem', 'launchApp')).toEqual([{ packageName: 'com.android.settings' }]);

  // A failed launch is reported in place and nothing is retried.
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('broken');
  await drawer.getByRole('button', { name: 'Open Broken app', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText(/^Broken app could not be opened\./);
  expect(await calls(page, 'ElizaSystem', 'launchApp')).toHaveLength(2);
  await page.screenshot({ path: info.outputPath('native-drawer.png') });
  expect(errors).toEqual([]);
});

test('an empty installed-app list says so and offers no Phone shortcut without a dialer', async ({ page }) => {
  await nativeStub(page, { apps: [], dial: { role: 'dial', available: false } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  await expect(drawer.getByText('No apps', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open Calendar', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: /^Open Phone/ })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close apps', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
});

test('typing a search while the installed-app list is still loading still shows the results', async ({ page }) => {
  await nativeStub(page, { apps: [{ packageName: 'com.android.settings', label: 'Settings' }, { packageName: 'com.android.chrome', label: 'Chrome' }] });
  // Hold the list read until the user has typed.
  await page.addInitScript(() => {
    const w = window as any; const original = w.Capacitor.nativePromise;
    w.Capacitor.nativePromise = (plugin: string, method: string, options: any) => plugin === 'ElizaSystem' && method === 'listLauncherApps'
      ? new Promise(resolve => { w.releaseList = () => resolve(original(plugin, method, options)); }) : original(plugin, method, options);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  const list = drawer.locator('[data-installed-apps-scroll]');
  await expect(list).toHaveAttribute('aria-busy', 'true');
  await drawer.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('chr');
  await page.evaluate(() => (window as any).releaseList());
  await expect(drawer.getByRole('button', { name: 'Open Chrome', exact: true })).toBeVisible();
  await expect(list).not.toHaveAttribute('aria-busy', 'true');
});

test('required denied notification remains pending after cold start without repeating a prompt',async({page})=>{
 await nativeStub(page,{notifications:{permissionGranted:false,appEnabled:false},microphone:'granted'});
 await page.goto('/');const panel=page.locator('dialog.alpha-startup-permissions');await expect(panel).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Set up Alpha access',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Allow',exact:true}).click();
 await expect.poll(()=>calls(page,'DailyApps','requestPermissions')).toEqual([{permissions:['notifications']}]);
 await expect(panel.getByRole('button',{name:'Open Android settings',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:/Skip|Not now|Back/})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(panel).toBeVisible();await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Set up Alpha access',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Open Android settings',exact:true})).toBeVisible();
 expect(await calls(page,'DailyApps','requestPermissions')).toEqual([]);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')!))).toEqual({version:4,status:'pending',step:0});
});

test('an Activity opened with the alpha.assistant extra renders chat and Close only', async ({ page }) => {
  // Notifications are denied, so a normal start would show the startup permission panel.
  await nativeStub(page, { assistant: true, notifications: { permissionGranted: false, appEnabled: false } });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/alpha-assistant-surface/);
  const close = page.getByRole('button', { name: 'Close assistant', exact: true });
  await expect(close).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: 'Set up Alpha access', exact: true })).toHaveCount(0);
  await close.click();
  await expect.poll(() => calls(page, 'DailyApps', 'closeAssistant')).toHaveLength(1);
});
