import {test,expect} from '@playwright/test';
import {deviceAppsStub} from './device-apps-stub';
import {settled} from './helpers/settled';

for (const height of [600, 915]) test(`Apps fills the screen and its last control clears the chat bar at ${height}px`, async ({page}) => {
  await page.setViewportSize({width: 412, height});
  await deviceAppsStub(page);
  await page.addInitScript(() => {
    const cap = (window as any).Capacitor, nativePromise = cap.nativePromise;
    let failRead: () => void;
    const draftRead = new Promise((_, reject) => { failRead = () => reject(Error('Draft storage unavailable')); });
    (window as any).failDrawerDraftRead = () => failRead();
    cap.PluginHeaders.push({name: 'AlphaConnection', methods: [
      ...['secureRead', 'secureCompareExchange', 'removeListener'].map(name => ({name, rtype: 'promise'})),
      {name: 'addListener', rtype: 'callback'},
    ]});
    cap.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'AlphaConnection' && method === 'secureRead') {
        if (input.slot.startsWith('assistant-draft:')) return draftRead;
        return {value: null};
      }
      return nativePromise(plugin, method, input);
    };
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Apps', exact: true}).click();
  const list = page.locator('[data-installed-apps-scroll]');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', {name: 'Open App 39'})).toBeAttached();
  expect(await list.evaluate(el => Math.abs(el.getBoundingClientRect().bottom - document.querySelector('[data-screen]')!.getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);

  const barTops=new Map<number,number>();
  for (const failedRead of [false, true]) {
    if (failedRead) {
      await page.evaluate(() => (window as any).failDrawerDraftRead());
      await expect(page.getByRole('status', {name: 'Assistant draft status'})).toContainText('could not be read');
    }
    for (const inset of [0, 72]) {
      await page.evaluate(inset => document.documentElement.style.setProperty('--native-bottom-inset', inset + 'px'), inset);
      // A recovery notice can arrive after the drawer has opened. Wait for the whole
      // composer footprint before scrolling, including the notice above its input bar.
      await expect.poll(() => list.evaluate(el => {
        const screen = document.querySelector('[data-screen]')!.getBoundingClientRect();
        const dock = document.querySelector('[data-alpha-layer="composer"]')!.getBoundingClientRect();
        return parseFloat(getComputedStyle(el).paddingBottom) >= screen.bottom - dock.top + 4;
      })).toBe(true);
      await settled(page);
      const barTop=(await page.locator('[data-alpha-input-bar]').boundingBox())!.y;
      if(failedRead)expect(barTop).toBeCloseTo(barTops.get(inset)!,0);else barTops.set(inset,barTop);
      await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const last = list.getByRole('button').last();
      await expect(last).toBeInViewport({ratio: 1});
      await expect.poll(() => last.evaluate(el => {
        const r = el.getBoundingClientRect(), dock = document.querySelector('[data-alpha-layer="composer"]')!.getBoundingClientRect();
        return {clear: r.bottom <= dock.top - 4, reachable: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))};
      })).toEqual({clear: true, reachable: true});
    }
  }
});
