import { test, expect, type Page } from '@playwright/test';
import { button, fenceNetwork, flagOffAndroid, harness, residentHome } from './flag-off-android';
// Open in another browser, flag-off production bundle: the rendered Browser menu item reaches the
// adapter's handoff, a normal page leaves at once and a private page leaves only after its review.
//
// The AlphaBrowser native plugin is a stub added at the Capacitor bridge in this file: it commits a
// test-owned page and records openExternalBrowser. Evidence boundary: renderer evidence only. Not the
// native handoff (BrowserExternalHandoffInstrumentedTest checks privateConfirmed), a WebView or a device.

const PAGE = 'https://handoff-fixture.test/harbour';

async function nativeBrowser(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor, previous = bridge.nativePromise;
    const stub = w.browserStub = { handoffs: [] as any[], privateTabs: [] as string[], sequence: 0, navigation: 0 };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    bridge.PluginHeaders.push({ name: 'AlphaBrowser', methods: [...promise(['create', 'navigate', 'command', 'present', 'close', 'bookmarks', 'setBookmark', 'browsingState', 'saveBrowsingState', 'share', 'downloads', 'clearBrowsingData', 'clearSiteData', 'openExternalBrowser']), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] });
    bridge.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin !== 'AlphaBrowser') return previous(plugin, method, input);
      if (method === 'bookmarks' || method === 'setBookmark') return { urls: [] };
      if (method === 'browsingState') return {};
      if (method === 'create' && input.private) stub.privateTabs.push(input.id);
      if (method === 'navigate') {
        const navigation = ++stub.navigation;
        setTimeout(() => w.flagOff.emit('AlphaBrowser', 'stateChanged', { session: input.session, id: input.id, private: stub.privateTabs.includes(input.id), sequence: ++stub.sequence, navigation, url: input.url, title: 'Harbour report', loading: false, committed: true, error: '', canBack: false, canForward: false }), 0);
        return {};
      }
      if (method === 'openExternalBrowser') stub.handoffs.push(input);
      return {};
    };
  });
}
async function start(page: Page) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await nativeBrowser(page);
  await residentHome(page);
  await button(page, 'Browser').click();
  return foreign;
}
async function openPage(page: Page) {
  const address = page.getByRole('textbox', { name: 'Address', exact: true });
  if (!await address.isVisible()) await button(page, 'Search or type address').click();
  await address.fill(PAGE);
  await address.press('Enter');
  await expect(button(page, 'Edit address')).toContainText('handoff-fixture.test');
}
async function menu(page: Page, name: string) {
  await button(page, 'Menu').click();
  await button(page, name).click();
}
const handoffs = (page: Page) => page.evaluate(() => (window as any).browserStub.handoffs as any[]);

test('a normal page opens in another browser from the menu', async ({ page }) => {
  const foreign = await start(page);
  await openPage(page);
  await menu(page, 'Open in another browser');
  await expect.poll(() => handoffs(page)).toHaveLength(1);
  expect((await handoffs(page))[0]).toEqual(expect.objectContaining({ url: PAGE, navigation: 1, privateConfirmed: false }));
  await expect(page.getByRole('dialog', { name: 'Leave private browsing?' })).toHaveCount(0);
  expect(await harness(page, f => f.posts)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a private page leaves only after the review is approved', async ({ page }) => {
  const foreign = await start(page);
  await openPage(page);
  await menu(page, 'New private tab');
  await openPage(page);
  await expect(page.getByRole('img', { name: 'Private tab', exact: true })).toBeVisible();
  await menu(page, 'Open in another browser');
  const review = page.getByRole('dialog', { name: 'Leave private browsing?' });
  await expect(review).toContainText(PAGE);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await handoffs(page)).toEqual([]);

  await menu(page, 'Open in another browser');
  await review.getByRole('button', { name: 'Choose browser', exact: true }).click();
  await expect.poll(() => handoffs(page)).toHaveLength(1);
  expect((await handoffs(page))[0]).toEqual(expect.objectContaining({ url: PAGE, navigation: 2, privateConfirmed: true }));
  expect(await harness(page, f => f.posts)).toEqual([]);
  expect(foreign).toEqual([]);
});
