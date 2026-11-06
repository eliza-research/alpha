import {installHomeCalendar} from './helpers/home-calendar';
import { test, expect, type Page } from '@playwright/test';
import { auditPage, format } from './accessibility-audit';
import { setTextScale } from './accessibility-states';
import { deviceAppsStub } from './device-apps-stub';

// PRD AP-15 (large font). The round-7 emulator run at 200% font showed the Home card title printed
// over the lines around it and the Home app labels split mid-word; the instrumentation's bounds
// checks and the clipping rules of the accessibility sweep did not see it, because nothing was cut:
// text was printed over other text. These tests measure bounding boxes, so overlap cannot return.
//
// 200% is the largest system font scale Android offers. In the browser build it is applied by
// multiplying every declared pixel size (browser/display.ts), which is what the page's own layout
// sees under WebView text zoom. This is Chromium on a development server; it is not a WebView,
// TalkBack or device result. The same checks run over every retained view in
// accessibility-sweep.spec.ts ("200% text is not clipped and does not overlap").
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const blocking = (lines: string[]) => lines.filter(line => !line.startsWith('text-truncated:'));

type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

/** The painted box of every line of text inside each matched element, in page coordinates. */
async function textBoxes(page: Page, selector: string): Promise<Array<{ text: string; lines: Box[]; own: Box }>> {
  return page.locator(selector).evaluateAll(elements => elements.map(element => {
    const lines: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.nodeValue || '').trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) if (rect.width > 1 && rect.height > 1) lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    }
    const own = element.getBoundingClientRect();
    return { text: (element.textContent || '').trim(), lines, own: { left: own.left, top: own.top, right: own.right, bottom: own.bottom } };
  }));
}

async function home(page: Page, url = '/') {
  await page.addInitScript(offline);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Every Home card in turn, brought into the row's visible area: text scrolled out of the row is not painted. */
async function eachHomeCard(page: Page, check: (name: string) => Promise<void>) {
  const cards = page.locator('[data-alpha-layer="home"] :is([data-alpha-home-calendar],[data-alpha-home-workflows],[data-alpha-home-inbox],[data-alpha-home-brief])');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    await card.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'start' }));
    await page.waitForTimeout(150);
    await check(await card.evaluate(element => Array.from(element.attributes).find(attribute => attribute.name.startsWith('data-alpha-home-'))?.name || 'card'));
  }
}

for (const scale of [1, 1.5, 2]) {
  for (const source of [{ name: 'empty Home', url: '/' }, { name: 'populated Home', url: '/?mode=mock&start=home' }]) {
    test(`${source.name} at ${scale * 100}% text: no card text or app label is printed over another or cut`, async ({ page }) => {
      await home(page, source.url);
      await setTextScale(page, scale);
      // The measured scale is what the layout rules read.
      await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')))).toBeCloseTo(scale, 1);

      await eachHomeCard(page, async name => {
        const found = blocking(format(await auditPage(page, { clipping: true, overlap: true })));
        expect(found, `${name}\n${found.join('\n')}`).toEqual([]);
      });

      // Every line of every card's text lies inside that card.
      for (const card of await textBoxes(page, '[data-alpha-layer="home"] :is([data-alpha-home-calendar],[data-alpha-home-workflows],[data-alpha-home-inbox],[data-alpha-home-brief])'))
        for (const line of card.lines) {
          expect(line.top, `"${card.text.slice(0, 40)}" above its card`).toBeGreaterThanOrEqual(card.own.top - 1);
          expect(line.bottom, `"${card.text.slice(0, 40)}" below its card`).toBeLessThanOrEqual(card.own.bottom + 1);
        }
      // Cards in the row share one height and none is shorter than the design card.
      const heights = await page.locator('[data-alpha-layer="home"] :is([data-alpha-home-calendar],[data-alpha-home-workflows],[data-alpha-home-inbox],[data-alpha-home-brief])').evaluateAll(list => list.map(element => Math.round(element.getBoundingClientRect().height)));
      expect(new Set(heights).size, `card heights ${heights}`).toBe(1);
      expect(heights[0]).toBeGreaterThanOrEqual(196);

      // App labels: each stays inside its own tile, no two labels touch, none is split mid-word.
      await page.locator('[data-alpha-home-apps]').evaluate(element => element.scrollIntoView({ block: 'center' }));
      const labels = await textBoxes(page, '[data-alpha-home-apps] > button');
      expect(labels.length).toBeGreaterThanOrEqual(11);
      for (const label of labels) {
        expect(label.lines.length, `"${label.text}" has a painted label`).toBeGreaterThan(0);
        for (const line of label.lines) {
          expect(line.left, `"${label.text}" left of its tile`).toBeGreaterThanOrEqual(label.own.left - 1);
          expect(line.right, `"${label.text}" right of its tile`).toBeLessThanOrEqual(label.own.right + 1);
        }
        // One word, one line.
        if (!/\s/.test(label.text)) expect(new Set(label.lines.map(line => Math.round(line.top))).size, `"${label.text}" is split across lines`).toBe(1);
      }
      for (let first = 0; first < labels.length; first++) for (let second = first + 1; second < labels.length; second++)
        for (const a of labels[first].lines) for (const b of labels[second].lines)
          expect(overlaps(a, b), `"${labels[first].text}" over "${labels[second].text}"`).toBe(false);
      const found = blocking(format(await auditPage(page, { clipping: true, overlap: true })));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}

test('the Home app grid keeps four columns at the default size and makes room for 200% labels', async ({ page }) => {
  await home(page);
  const columns = () => page.locator('[data-alpha-home-apps] > button').evaluateAll(list => new Set(list.map(element => Math.round(element.getBoundingClientRect().left))).size);
  expect(await columns()).toBe(4);
  await setTextScale(page, 1.5);
  expect(await columns()).toBe(4);
  await setTextScale(page, 2);
  await expect.poll(columns).toBe(3);
  // Back at the default size the design grid returns: the rule reads the live measurement.
  await setTextScale(page, 1);
  await expect.poll(columns).toBe(4);
});

test('the Home calendar card shows its whole title at 200% and widens to the row', async ({ page }) => {
  await home(page);
  await installHomeCalendar(page,{title:'Weekly project meeting',startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString()});
  const card = page.locator('[data-alpha-home-calendar]');
  const design = (await card.boundingBox())!;
  expect(Math.round(design.width)).toBe(280);
  expect(Math.round(design.height)).toBe(196);
  await setTextScale(page, 2);
  const title = card.locator('.home-calendar-title');
  await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBeGreaterThan(280);
  const geometry = await card.evaluate(element => {
    const box = element.getBoundingClientRect(), row = element.parentElement!.getBoundingClientRect();
    const heading = element.querySelector('.home-calendar-title')!;
    const head = element.querySelector('.home-calendar-head')!.getBoundingClientRect(), text = heading.getBoundingClientRect();
    const meta = element.querySelector('.home-calendar-meta')?.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(heading);
    const lines = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 1).map(rect => Math.round(rect.top))).size;
    return { right: box.right, rowRight: row.right, lines, lineHeight: parseFloat(getComputedStyle(heading).lineHeight), height: text.height, headBottom: head.bottom, titleTop: text.top, titleBottom: text.bottom, metaTop: meta?.top ?? null, bottom: box.bottom };
  });
  // Inside the screen, the title below the header row and above the read time, nothing hidden by the clamp.
  expect(geometry.right).toBeLessThanOrEqual(geometry.rowRight + 1);
  expect(geometry.titleTop).toBeGreaterThanOrEqual(geometry.headBottom - 1);
  if (geometry.metaTop !== null) expect(geometry.titleBottom).toBeLessThanOrEqual(geometry.metaTop + 1);
  expect(geometry.titleBottom).toBeLessThanOrEqual(geometry.bottom + 1);
  // Every line the title wraps to has its own line box: none is hidden by the clamp or a fixed height.
  expect(geometry.lines).toBeLessThanOrEqual(3);
  expect(geometry.height, 'title lines hidden').toBeGreaterThanOrEqual(geometry.lines * geometry.lineHeight - 1);
  await expect(title).toHaveText('Weekly project meeting');
});

for (const scale of [1, 2]) {
  test(`Apps at ${scale * 100}% text: tiles and the header do not overlap`, async ({ page }) => {
    await deviceAppsStub(page, 24);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Apps' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-launcher-app]')).toHaveCount(24);
    await setTextScale(page, scale);
    const found = blocking(format(await auditPage(page, { clipping: true, overlap: true })));
    expect(found, found.join('\n')).toEqual([]);
    // Apps covers Home below the launcher's status bar: nothing of Home is left showing around it.
    const cover = await drawer.evaluate(element => { const box = element.getBoundingClientRect(), screen = element.closest('[data-screen]')!.getBoundingClientRect(); return { top: box.top - screen.top, left: box.left - screen.left, right: screen.right - box.right }; });
    expect({ left: cover.left, right: cover.right }).toEqual({ left: 0, right: 0 });
    expect(cover.top).toBeLessThanOrEqual(44);
    // Each tile's name stays inside its tile, and no two tiles overlap.
    const tiles = await drawer.locator('[data-launcher-app]').evaluateAll(list => list.map(tile => {
      const name = tile.querySelector('button > span:last-of-type')!, range = document.createRange(); range.selectNodeContents(name);
      const text = Array.from(range.getClientRects()).filter(rect => rect.width > 1), box = tile.getBoundingClientRect();
      return { label: name.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        textLeft: Math.min(...text.map(rect => rect.left)), textRight: Math.max(...text.map(rect => rect.right)), textBottom: Math.max(...text.map(rect => rect.bottom)) };
    }));
    for (const tile of tiles) {
      expect(tile.textLeft, `${tile.label} left of its tile`).toBeGreaterThanOrEqual(tile.left - 1);
      expect(tile.textRight, `${tile.label} right of its tile`).toBeLessThanOrEqual(tile.right + 1);
      expect(tile.textBottom, `${tile.label} below its tile`).toBeLessThanOrEqual(tile.bottom + 1);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++)
      expect(overlaps(tiles[i], tiles[j]), `${tiles[j].label} over ${tiles[i].label}`).toBe(false);
  });
}

test('Files locations, share targets and avatar initials keep whole words at 200% text', async ({ page }) => {
  await page.goto('/?mode=mock&start=files');
  await expect(page.locator('.alpha-phone')).toBeVisible();
  await setTextScale(page, 2);
  let found = blocking(format(await auditPage(page, { clipping: true, overlap: true })));
  expect(found, found.join('\n')).toEqual([]);
  // At 200% a location tile takes the whole row; at the default size two share it.
  const tiles = () => page.getByRole('button', { name: /^(Downloads|Documents)$/ }).evaluateAll(list => list.map(element => Math.round(element.getBoundingClientRect().top)));
  await expect.poll(async () => new Set(await tiles()).size).toBe(2);
  await setTextScale(page, 1);
  await expect.poll(async () => new Set(await tiles()).size).toBe(1);

  for (const start of ['calendar:event', 'photos:viewer']) {
    await page.goto(`/?mode=mock&start=${start}`);
    await expect(page.locator('.alpha-phone')).toBeVisible();
    if (start === 'photos:viewer') await page.getByRole('button', { name: 'Share photo', exact: true }).click();
    await setTextScale(page, 2);
    found = blocking(format(await auditPage(page, { clipping: true, overlap: true })));
    expect(found, `${start}\n${found.join('\n')}`).toEqual([]);
  }
});
