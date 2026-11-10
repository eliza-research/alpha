import { test, expect } from '@playwright/test';
import { auditPage, auditReadingOrder, auditTabOrder, auditTree, exposedTabStopBudget, format, blocking } from './accessibility-audit';
import { LIVE_STATES, type State } from './accessibility-states';

import {flagOffAndroid, residentHome, fenceNetwork} from './flag-off-android';
import {residentStub} from './resident-stub';
import {settled} from './helpers/settled';

// The same renderer checks against the flag-off production bundle: no mocks, fixtures or
// developer surfaces, so these are the screens a disconnected phone actually shows, with names,
// focus, contrast and TalkBack reading order. Large text
// is checked on the development server only (the scale is applied through a source module).
// Not a TalkBack, physical large-font, rotation or device pass (MVP-48 acceptance stays open).
test.describe.configure({ mode: 'parallel' });
// Production browsers have no installed inventory. Exercise the packaged drawer through
// the synthetic Android bridge instead; these checks remain renderer-only evidence.
const PRODUCTION_APPS_STATE: State = {
  name: 'launcher Apps',
  open: async page => {
    const foreign = await fenceNetwork(page);
    await flagOffAndroid(page);
    await residentStub(page);
    await page.addInitScript(() => {
      const cap = (window as any).Capacitor, previous = cap.nativePromise;
      cap.PluginHeaders.find((row: any) => row.name === 'ElizaSystem').methods.push(
        {name: 'listLauncherApps', rtype: 'promise'},
      );
      cap.nativePromise = async (plugin: string, method: string, input: unknown) => {
        if (plugin === 'ElizaSystem' && method === 'listLauncherApps') return {
          apps: [{packageName: 'org.example.clock', label: 'Synthetic clock'}, {packageName: 'org.example.weather', label: 'Synthetic weather'}],
        };
        return previous(plugin, method, input);
      };
    });
    await residentHome(page);
    const notice=page.getByRole('region',{name:'Eliza Cloud sign-in notice',exact:true});
    // This fixture retains a 30-day sign-in; it must not show the 14-day expiry warning.
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', {name: 'Apps', exact: true}).click();
    const drawer = page.getByRole('dialog', {name: 'Apps', exact: true});
    await expect(drawer.getByRole('button', {name: 'Open Synthetic clock', exact: true})).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Open Calendar', exact: true})).toHaveCount(0);
    await settled(page);
    expect(foreign).toEqual([]);
  },
};
const PRODUCTION_CONNECTIONS_STATE: State = {
  name: 'signed-in Google accounts',
  open: async page => {
    const foreign = await fenceNetwork(page);
    await flagOffAndroid(page);
    await residentStub(page);
    await residentHome(page);
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await page.getByRole('button', {name: 'Account', exact: true}).click();
    await page.getByRole('dialog', {name: 'Account', exact: true})
      .getByRole('button', {name: 'Google & email', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Google accounts', exact: true})).toBeVisible();
    await settled(page);
    expect(foreign).toEqual([]);
  },
};
const STATES = [...LIVE_STATES, PRODUCTION_APPS_STATE, PRODUCTION_CONNECTIONS_STATE];

for (const state of STATES) {
  test(`production names, roles, focus, contrast and clipping: ${state.name}`, async ({ page }) => {
    await state.open(page);
    // Walk every exposed component row in the license inventory, with room for the browser edge.
    const tabLimit=state.name==='live Settings licenses'?await exposedTabStopBudget(page):undefined;
    if(tabLimit)test.setTimeout(90_000);
    const found = blocking(format([
      ...await auditTree(page),
      ...await auditPage(page, { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true }),
      ...await auditTabOrder(page,tabLimit),
      ...await auditReadingOrder(page),
    ]));
    expect(found, found.join('\n')).toEqual([]);
  });
}

test.describe('landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const state of STATES) {
    test(`production landscape keeps every control on screen: ${state.name}`, async ({ page }) => {
      await state.open(page);
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      const tabLimit=state.name==='live Settings licenses'?await exposedTabStopBudget(page):undefined;
      if(tabLimit)test.setTimeout(90_000);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page,tabLimit), ...await auditReadingOrder(page)]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});
