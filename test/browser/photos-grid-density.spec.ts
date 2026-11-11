import {expect, test, type Locator} from '@playwright/test';
import {photosBridge} from './helpers/photos-bridge';

test.use({hasTouch: true, isMobile: true});

async function pinch(scroller: Locator, expand: boolean) {
  await scroller.evaluate((element, expand) => {
    const touch = (id: number, x: number) => new Touch({identifier: id, target: element, clientX: x, clientY: 250});
    element.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, touches: [touch(1, 100), touch(2, 200)]}));
    element.dispatchEvent(new TouchEvent('touchmove', {bubbles: true, touches: [touch(1, 100), touch(2, expand ? 240 : 170)]}));
    element.dispatchEvent(new TouchEvent('touchend', {bubbles: true, touches: []}));
  }, expand);
}

for (const viewport of [{width: 412, height: 915}, {width: 800, height: 1280}]) {
  test(`Photos keeps density and virtual rows aligned at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await photosBridge(page, 'full', false);
    await page.evaluate(() => {
      const cap = (window as any).Capacitor, previous = cap.nativePromise;
      const sample = (window as any).mediaFixture.row, date = Date.now();
      const items = Array.from({length: 120}, (_, index) => ({...sample, id: `m:external_primary:i:${1000 + index}`, date}));
      cap.nativePromise = async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaPhotos' && method === 'list') return {items: input?.trashed ? [] : items, next: ''};
        return previous(plugin, method, input);
      };
    });
    await page.getByRole('button', {name: 'Photos', exact: true}).click();
    const scroller = page.locator('[data-alpha-app-scroll="photos"]');
    await expect(scroller.locator('[data-owned-media-id]').first()).toBeVisible();

    const densities = [{columns: 4, expand: undefined}, {columns: 3, expand: true}, {columns: 4, expand: false}, {columns: 5, expand: false}];
    for (const {columns, expand} of densities) {
      if (expand !== undefined) await pinch(scroller, expand);
      await expect.poll(() => scroller.locator('.photo-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
      for (const middle of [false, true]) {
        await scroller.evaluate((el, middle) => { el.scrollTop = middle ? Math.floor(el.scrollHeight / 2) : 0; }, middle);
        await expect.poll(() => scroller.evaluate((el, columns) => {
          const grid = el.querySelector<HTMLElement>('.photo-grid')!;
          const header = el.querySelector<HTMLElement>('.photo-day-header')!;
          const style = getComputedStyle(grid), scrollStyle = getComputedStyle(el);
          const gap = parseFloat(style.rowGap), tile = (grid.clientWidth - gap * (columns - 1)) / columns;
          const rows = 120 / columns;
          const expected = parseFloat(scrollStyle.paddingTop) + header.offsetHeight + rows * tile + (rows - 1) * gap + parseFloat(scrollStyle.paddingBottom);
          return {aligned: Math.abs(el.scrollHeight - expected) <= 2, left: style.marginLeft, right: style.marginRight};
        }, columns)).toEqual({aligned: true, left: '12px', right: '12px'});
        const rendered = await scroller.locator('[data-owned-media-id]').count();
        expect(rendered).toBeGreaterThan(columns);
        expect(rendered).toBeLessThan(120);
        // Query the tiles inside the scroller in one synchronous pass: virtual rows are replaced while scrolling,
        // so a tile handle resolved earlier can already be detached from the scroller.
        await expect.poll(() => scroller.evaluate(el => {
          const viewport = el.getBoundingClientRect();
          return [...el.querySelectorAll('[data-owned-media-id]')].filter(item => { const box = item.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom; }).length;
        })).toBeGreaterThanOrEqual(columns * 2);
      }
    }
  });
}
