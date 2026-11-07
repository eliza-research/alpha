import type { Page } from '@playwright/test';
/** A native-plugin stub whose ElizaSystem launcher lists `count` installed Android apps ("App 00" …),
 * for specs that need the Apps drawer filled. Development lane only; no Android package manager is
 * involved (home-app-library.spec.ts covers launch, refusals and changes). */
export async function deviceAppsStub(page: Page, count = 40) {
  await page.addInitScript(count => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
    const w = window as any, apps = Array.from({ length: count }, (_, i) => ({ packageName: `org.example.app${i}`, activityName: `org.example.app${i}.Main`, label: `App ${String(i).padStart(2, '0')}` }));
    const plugins: Record<string, string[]> = { ElizaSystem: ['listLauncherApps', 'launchApp', 'resolveDefaultApp', 'openDefaultApp', 'openAppInfo', 'getBuildInfo', 'getLocaleInfo', 'getLaunchInfo'], DeviceApps: ['platformCapabilities'], DailyApps: ['surfaceInfo'], AlphaNotifications: ['status', 'list'], AlphaVoiceCloud: ['checkPermissions', 'requestPermissions'] };
    const answers: Record<string, unknown> = { 'ElizaSystem.listLauncherApps': { apps }, 'ElizaSystem.resolveDefaultApp': { role: 'dial', available: false }, 'ElizaSystem.getBuildInfo': { launcher: true, version: 'stub' }, 'ElizaSystem.getLaunchInfo': { assistant: false }, 'ElizaSystem.getLocaleInfo': { locale: 'en-US', hour24: false },
      'DailyApps.surfaceInfo': { assistant: false, developmentBuild: true, topInset: 0, bottomInset: 0 }, 'AlphaNotifications.status': { permissionGranted: true, appEnabled: true }, 'AlphaVoiceCloud.checkPermissions': { microphone: 'granted' } };
    w.androidBridge = {};
    const cap: any = w.Capacitor = {
      Plugins: {},
      PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: [...methods, 'addListener', 'removeListener'].map(m => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback: () => 'stub-callback',
      nativePromise: async (plugin: string, method: string) => answers[`${plugin}.${method}`] ?? {},
    };
    for (const name of Object.keys(plugins)) cap.Plugins[name] = { addListener: () => ({ remove: async () => {} }) };
  }, count);
}
