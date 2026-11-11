import { test, expect, type Page } from '@playwright/test';
// Development lane with a native-plugin stub: the page sees an Android Capacitor bridge whose
// ElizaSystem launcher, AlphaNotifications and AlphaVoiceCloud answers come from this file. No Android
// device, package manager or permission prompt is involved; LauncherHomeInstrumentedTest covers
// the real launcher APK holding HOME.

type Stub = { apps?: unknown; failLaunch?: string[]; dial?: unknown; notifications?: { permissionGranted: boolean; appEnabled: boolean }; microphone?: string; assistant?: boolean; launchAssistant?: boolean; update?: {activationId:string;bridgeId:string;mounted?:boolean} };

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
      Agent: ['getStatus', 'setGoogleAgentAccess'],
      AlphaDevice: ['openSettings', ...(stub.update ? ['updateState','activateUpdate','continueUpdate'] : [])],
    };
    if (stub.update) {
      const {mounted, ...update} = stub.update;
      w.updateState = mounted ? {bridgeId:update.bridgeId,pending:false} : {...update,pending:true,phase:'preparing'};
      w.updateSlots = new Map();
      plugins.AlphaConnection = ['secureRead','secureCompareExchange'];
    }
    const answer = async (plugin: string, method: string, options: any) => {
      if (plugin === 'Agent' && method === 'setGoogleAgentAccess') return {};
      if (plugin === 'Agent' && method === 'getStatus') return {packaged:false,state:'stopped',serviceActive:false,socketListening:false};
      if (plugin === 'AlphaDevice' && method === 'updateState') return structuredClone(w.updateState);
      if (plugin === 'AlphaConnection' && method === 'secureRead') {
        if (options.slot.startsWith('assistant-draft:v1:')) await w.holdDraftRead;
        return {value:w.updateSlots.get(options.slot)??null};
      }
      if (plugin === 'AlphaConnection' && method === 'secureCompareExchange') {
        if ((w.updateSlots.get(options.slot)??null)!==options.expectedValue) return {status:'conflict'};
        w.updateSlots.set(options.slot,options.value);
        return {status:'saved'};
      }
      if (plugin === 'ElizaSystem') {
        if (method === 'listLauncherApps') return { apps: stub.apps ?? [] };
        if (method === 'launchApp') { if ((stub.failLaunch || []).includes(options?.packageName)) throw Error('Activity not found'); return {}; }
        if (method === 'resolveDefaultApp') return stub.dial ?? { role: 'dial', available: false };
        if (method === 'getBuildInfo') return { launcher: true, version: 'stub' };
        if (method === 'getLaunchInfo') return { assistant: stub.launchAssistant === true };
        if (method === 'getLocaleInfo') return { locale: 'en-US', hour24: false };
        return {};
      }
      if (plugin === 'DailyApps' && method === 'surfaceInfo') return { assistant: stub.assistant === true, developmentBuild: true, topInset: 0, bottomInset: 0 };
      if (plugin === 'AlphaNotifications' && method === 'status') return stub.notifications ?? { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud' && method === 'checkPermissions') return { microphone: stub.microphone ?? 'granted' };
      return {};
    };
    const cap: any = w.Capacitor = {
      Plugins: {},
      PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: [...methods, 'addListener', 'removeListener'].map(m => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback: (plugin: string, method: string, options: any, callback: (value: unknown) => void) => {
        w.nativeCalls.push({ plugin, method, options });
        if (plugin === 'AlphaDevice' && options?.eventName === 'alphaUpdateReady') w.notifyUpdateReady=callback;
        return 'stub-callback';
      },
      nativePromise: async (plugin: string, method: string, options: any) => { w.nativeCalls.push({ plugin, method, options }); return answer(plugin, method, options); },
    };
    for (const name of Object.keys(plugins)) cap.Plugins[name] = { addListener: () => ({ remove: async () => {} }) };
  }, stub);
}
const calls = (page: Page, plugin: string, method: string) => page.evaluate(([plugin, method]) => (window as any).nativeCalls.filter((c: any) => c.plugin === plugin && c.method === method).map((c: any) => c.options ?? null), [plugin, method]);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('a new Android WebView holds Home until its update settles', async ({page}) => {
  const update = {activationId:'11111111-2222-4333-8444-555555555555',bridgeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  await nativeStub(page,{update});
  await page.goto('/');
  await expect.poll(() => calls(page,'AlphaDevice','activateUpdate')).toEqual([{...update,ready:true}]);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
  expect(await calls(page,'ElizaSystem','getBuildInfo')).toEqual([]);
  await expect(page.getByRole('button',{name:'Continue update'})).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    w.updateState = {...w.updateState,phase:'paused',canContinue:true};
  });
  await page.getByRole('button',{name:'Continue update'}).click();
  expect(await calls(page,'AlphaDevice','continueUpdate')).toEqual([update]);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    w.updateState = {...w.updateState,pending:false,outcome:'canceled'};
  });
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
  expect(await calls(page,'AlphaDevice','activateUpdate')).toEqual([{...update,ready:true}]);
});

test('a mounted Android WebView freezes input and waits for draft readback before update', async ({page}) => {
  const update = {activationId:'22222222-2222-4333-8444-555555555555',bridgeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  await nativeStub(page,{update:{...update,mounted:true}});
  await page.goto('/');
  const input = page.getByRole('textbox',{name:'Ask Alpha',exact:true});
  await input.fill('Keep this draft');
  await expect.poll(() => page.evaluate(() => [...(window as any).updateSlots.values()].some(value => typeof value==='string'&&value.includes('Keep this draft')))).toBe(true);
  await page.evaluate(async update => {
    const w = window as any;
    const {connectionController}=await import('/src/runtime/connection-ui.tsx');
    w.updateReconnects=0;
    connectionController.captureAppUpdateReconnect=()=>async stillSettled=>{if(stillSettled())w.updateReconnects++;};
    w.holdDraftRead = new Promise(resolve => { w.releaseDraftRead = resolve; });
    w.updateState = {...update,pending:true,phase:'preparing'};
    w.notifyUpdateReady(w.updateState);
  }, update);
  const dialog = page.getByRole('dialog',{name:'App update'});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await calls(page,'AlphaDevice','activateUpdate')).toEqual([]);
  await page.evaluate(update => {
    const w = window as any;
    w.updateState = {...update,pending:false,outcome:'canceled',resume:true,activationId:'33333333-2222-4333-8444-555555555555'};
  }, update);
  await expect.poll(() => calls(page,'AlphaDevice','updateState').then(rows=>rows.length)).toBeGreaterThan(3);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateReconnects)).toBe(0);
  await page.evaluate(update => {
    const w = window as any;
    w.updateState = {...update,pending:true,phase:'preparing'};
    w.releaseDraftRead();
  }, update);
  await expect.poll(() => calls(page,'AlphaDevice','activateUpdate')).toEqual([{...update,ready:true,resumeEligible:true}]);
  await page.evaluate(update => { (window as any).updateState = {...update,pending:false,outcome:'canceled',resume:true}; }, update);
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue('Keep this draft');
  expect(await page.evaluate(() => (window as any).updateReconnects)).toBe(1);
});

test('native idle restores a mounted editor after a newer result without replaying reconnect', async ({page}) => {
  const update = {activationId:'22222222-2222-4333-8444-555555555555',bridgeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  await nativeStub(page,{update:{...update,mounted:true}});
  await page.goto('/');
  const input = page.getByRole('textbox',{name:'Ask Alpha',exact:true});
  await input.fill('Keep my draft after updating');
  await expect.poll(() => page.evaluate(() => [...(window as any).updateSlots.values()].some(value => typeof value==='string'&&value.includes('Keep my draft after updating')))).toBe(true);
  await page.evaluate(async update => {
    const w = window as any;
    const {connectionController}=await import('/src/runtime/connection-ui.tsx');
    w.updateReconnects=0;
    connectionController.captureAppUpdateReconnect=()=>async stillSettled=>{if(stillSettled())w.updateReconnects++;};
    w.updateState = {...update,pending:true,phase:'preparing'};
    w.notifyUpdateReady(w.updateState);
  }, update);
  const dialog = page.getByRole('dialog',{name:'App update'});
  await expect(dialog).toBeVisible();
  await expect.poll(() => calls(page,'AlphaDevice','activateUpdate')).toEqual([{...update,ready:true,resumeEligible:true}]);
  await page.evaluate(update => {
    (window as any).updateState = {...update,activationId:'33333333-2222-4333-8444-555555555555',pending:false,idle:true,outcome:'canceled',resume:true};
  }, update);
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue('Keep my draft after updating');
  expect(await page.evaluate(() => (window as any).updateReconnects)).toBe(0);
});

test('a mounted Android WebView refuses an update when draft readback differs', async ({page}) => {
  const update = {activationId:'44444444-2222-4333-8444-555555555555',bridgeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  await nativeStub(page,{update:{...update,mounted:true}});
  await page.goto('/');
  const input = page.getByRole('textbox',{name:'Ask Alpha',exact:true});
  await input.fill('Preserve the editor');
  await expect.poll(() => page.evaluate(() => [...(window as any).updateSlots.values()].some(value => typeof value==='string'&&value.includes('Preserve the editor')))).toBe(true);
  await page.evaluate(update => {
    const w = window as any;
    const entry = [...w.updateSlots.entries()].find(([,value]) => value.includes('Preserve the editor'));
    if (!entry) throw Error('Draft was not saved in the fixture');
    w.updateSlots.set(entry[0], JSON.stringify({...JSON.parse(entry[1]),text:'A different draft'}));
    w.updateState = {...update,pending:true,phase:'preparing'};
    w.notifyUpdateReady(w.updateState);
  }, update);
  await expect(page.getByRole('dialog',{name:'App update'})).toBeVisible();
  await expect.poll(() => calls(page,'AlphaDevice','activateUpdate')).toEqual([{...update,ready:false}]);
  await page.evaluate(update => { (window as any).updateState = {...update,pending:false,outcome:'failed'}; }, update);
  await expect(page.getByRole('dialog',{name:'App update'})).toHaveCount(0);
  await expect(input).toHaveValue('Preserve the editor');
  await expect(page.getByText('Finish your changes, then try updating again.',{exact:true})).toBeVisible();
});

test('Android Back lowers chat above Apps before closing the drawer', async ({ page }) => {
  await nativeStub(page, { apps: [{ packageName: 'com.android.settings', label: 'Settings' }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.locator('[data-alpha-layer="drawer"]');
  const search = drawer.getByRole('searchbox', { name: 'Search apps', exact: true });
  await search.fill('sett');

  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  await expect(drawer).toHaveAttribute('inert', '');
  const back = () => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));
  await back();
  await expect(drawer).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toBeVisible();
  await back();
  await expect(page.getByRole('button', { name: 'Open conversation', exact: true })).toBeVisible();
  await expect(search).toHaveValue('sett');
  await back();
  await expect(drawer).toHaveCount(0);
});

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

test('denied notification access stays pending after account restoration without repeating its prompt',async({page})=>{
 await nativeStub(page,{notifications:{permissionGranted:false,appEnabled:false},microphone:'granted'});
 const restoreAccount=()=>page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),snapshot=c.getSnapshot();
  const restored={...snapshot,startupResolved:true,cloudAccount:{environment:'production',userId:'fixture-owner',credentialId:'fixture-permissions',sessionId:'fixture-cloud'},setupRevision:1,busy:false,signIn:null} as any;c.getSnapshot=()=>restored;
  c.close();
 });
 await page.goto('/');const panel=page.locator('dialog.alpha-startup-permissions');await expect(panel).toHaveCount(0);
 await restoreAccount();
 await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Allow',exact:true}).click();
 await expect.poll(()=>calls(page,'DailyApps','requestPermissions')).toEqual([{permissions:['notifications']}]);
 await expect(panel.getByRole('button',{name:'Open Android settings',exact:true})).toBeVisible();
 // Walkthrough choices do not grant OS permission. A denied prompt is not requested again.
 await expect(panel.getByRole('button',{name:/Skip|Not now|Back/})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(panel).toBeVisible();
 await page.reload();await restoreAccount();
 await expect(panel.getByRole('button',{name:'Open Android settings',exact:true})).toBeVisible();
 expect(await calls(page,'DailyApps','requestPermissions')).toEqual([]);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')!))).toEqual({version:4,status:'pending',step:0});
});

test('the assistant Activity renders chat and Close only', async ({ page }) => {
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

test('the alpha.assistant launch extra alone keeps Home', async ({ page }) => {
  // Only AlphaAssistActivity (DailyApps.surfaceInfo) opens the assistant surface.
  await nativeStub(page, { launchAssistant: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/alpha-assistant-surface/);
  await expect(page.getByRole('button', { name: 'Close assistant', exact: true })).toHaveCount(0);
});
