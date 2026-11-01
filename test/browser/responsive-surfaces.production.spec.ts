import {openCanonicalCalendar} from './helpers/canonical-calendar';
import { openLegacyNotes } from './helpers/legacy-notes';
import { test, expect, type Page, type Locator } from '@playwright/test';

// Issue #411, responsive-surface matrix (docs/implementation-plan.md). Production renderer in a
// touch viewport: synthetic storage/provider inputs, no shipped developer surfaces. Viewport changes stand in for rotation,
// window resizing and the software keyboard; they do not qualify Android rotation, process
// recreation, TalkBack or a device keyboard.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'production', 'Production bundle only'));

const PORTRAIT = { width: 412, height: 915 }, SMALL_LANDSCAPE = { width: 640, height: 360 }, LANDSCAPE = { width: 915, height: 412 };
const TABLET_PORTRAIT = { width: 800, height: 1280 }, TABLET_LANDSCAPE = { width: 1280, height: 800 };
const MATRIX = [SMALL_LANDSCAPE, LANDSCAPE, TABLET_PORTRAIT, TABLET_LANDSCAPE, PORTRAIT];
const COLUMN = 720;

async function open(page: Page, app: string) {
  if(app==='Calendar'){
    // Layout-only CalendarService read, through the same canonical source as the app.
    await openCanonicalCalendar(page,{eventTitle:'Column check',launcher:false});
    return;
  }
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline', localApps: true })));
  await page.goto('/');
  if(app==='Notes')await openLegacyNotes(page);
  else await page.getByRole('button', { name: app, exact: true }).click();
}
const geometry = (page: Page) => page.evaluate(() => {
  const root = document.documentElement;
  return { scale: Number(getComputedStyle(root).getPropertyValue('--phone-scale')), landscape: root.classList.contains('alpha-landscape'), wide: root.classList.contains('alpha-wide') };
});
async function box(locator: Locator) { const value = await locator.boundingBox(); expect(value).not.toBeNull(); return value!; }
/** Resize, then wait until the renderer has measured the new window and rendered it. */
async function resize(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--alpha-visible-height'))).toBe(`${viewport.height}px`);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
}
/** Within the readable column and centred in the window, or the full phone width when narrow. */
async function expectColumn(page: Page, locator: Locator) {
  const { width } = page.viewportSize()!, bounds = await box(locator);
  if (width < 760) { expect(bounds.width).toBeGreaterThan(width - 80); return; }
  expect(bounds.width).toBeLessThanOrEqual(COLUMN + 1);
  expect(Math.abs(bounds.x - (width - bounds.x - bounds.width))).toBeLessThan(4);
}
async function expectTarget(page: Page, control: Locator) {
  const bounds = await box(control), view = page.viewportSize()!;
  expect(bounds.width).toBeGreaterThanOrEqual(43.5); expect(bounds.height).toBeGreaterThanOrEqual(43.5);
  expect(bounds.x).toBeGreaterThanOrEqual(-0.5); expect(bounds.x + bounds.width).toBeLessThanOrEqual(view.width + 0.5);
}

test('the canvas keeps its own density and takes its arrangement from measured size, not the keyboard', async ({ page }) => {
  await open(page, 'Settings');
  expect(await geometry(page)).toEqual({ scale: 1, landscape: false, wide: false });
  await resize(page, SMALL_LANDSCAPE);
  // A small phone turned sideways is not shrunk: 44px controls stay 44px.
  await expect.poll(() => geometry(page)).toEqual({ scale: 1, landscape: true, wide: false });
  await expectTarget(page, page.getByRole('button', { name: 'Back to apps', exact: true }));
  await expectTarget(page, page.getByRole('button', { name: 'Display', exact: true }));
  // A tablet is never drawn as a magnified phone, in either orientation.
  await resize(page, TABLET_LANDSCAPE);
  await expect.poll(() => geometry(page)).toEqual({ scale: 1, landscape: true, wide: true });
  await resize(page, TABLET_PORTRAIT);
  await expect.poll(() => geometry(page)).toEqual({ scale: 1, landscape: false, wide: true });
  expect((await box(page.getByRole('button', { name: 'Back to apps', exact: true }))).height).toBeLessThan(60);

  // Typing in portrait: the keyboard shortens the window below its width, which is not a rotation.
  await resize(page, PORTRAIT);
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await body.fill('Typed with the keyboard open');
  await resize(page, { width: 412, height: 380 });
  await expect.poll(() => geometry(page)).toEqual({ scale: 1, landscape: false, wide: false });
  await expect(body).toBeFocused();
  // A real rotation changes the width; the arrangement follows it even while typing.
  await resize(page, LANDSCAPE);
  await expect.poll(() => geometry(page)).toMatchObject({ scale: 1, landscape: true });
  await expect(body).toHaveValue('Typed with the keyboard open');
});

test('Settings keeps a readable column, 44px rows and the focused row through every size', async ({ page }) => {
  await open(page, 'Settings');
  const row = page.getByRole('button', { name: 'Display', exact: true });
  await row.focus();
  const original = await row.elementHandle();
  for (const viewport of MATRIX) {
    await resize(page, viewport);
    await expect(row).toBeFocused();
    expect(await row.evaluate((element, previous) => element === previous, original)).toBe(true);
    await expectColumn(page, row);
    expect((await box(row)).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`settings-${viewport.width}x${viewport.height}.png`) });
  }
  await row.press('Enter');
  await expect(page.getByRole('heading', { name: 'Display', exact: true })).toBeVisible();
});

test('a Calendar event draft keeps its text, caret and field through resizing, in a bounded form', async ({ page }) => {
  await open(page, 'Calendar');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Rotation review with Priya');
  await title.evaluate((element: HTMLInputElement) => { element.focus(); element.setSelectionRange(9, 15); });
  const original = await title.elementHandle();
  for (const viewport of MATRIX) {
    await resize(page, viewport);
    await expect(title).toHaveValue('Rotation review with Priya');
    expect(await title.evaluate((element, previous) => element === previous, original)).toBe(true);
    expect(await title.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([9, 15]);
    if (viewport.width >= 760) expect((await box(title)).width).toBeLessThanOrEqual(COLUMN + 1);
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`calendar-form-${viewport.width}x${viewport.height}.png`) });
  }
});

test('the Calendar month picker is a bounded sheet on a wide screen and scrolls on a short one', async ({ page }) => {
  await open(page, 'Calendar');
  await page.getByRole('button', { name: 'Month view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose calendar date', exact: true });
  await expect(dialog).toBeVisible();
  await resize(page, TABLET_LANDSCAPE);
  const wide = await box(dialog);
  expect(wide.width).toBeLessThanOrEqual(561);
  expect(Math.abs(wide.x - (1280 - wide.x - wide.width))).toBeLessThan(4);
  await resize(page, SMALL_LANDSCAPE);
  // The sheet's own transition can still be settling after the renderer has measured.
  await expect.poll(async () => { const bounds = await box(dialog); return bounds.y + bounds.height; }).toBeLessThanOrEqual(361);
  // Every day stays reachable by scrolling the sheet, at full tap size.
  const last = dialog.getByRole('button').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await box(last)).height).toBeGreaterThanOrEqual(44);
});

test('Workflows and Files lists keep a readable column instead of stretching', async ({ page }) => {
  await open(page, 'Workflows');
  const status = page.locator('[data-alpha-app-scroll="workflows"]').getByText(/Your agent runs on your phone, not here/);
  await expect(status).toBeVisible();
  for (const viewport of [TABLET_LANDSCAPE, LANDSCAPE, PORTRAIT]) {
    await resize(page, viewport);
    await expectColumn(page, status);
  }
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const documents = page.getByRole('button', { name: 'Documents', exact: true });
  for (const viewport of [TABLET_LANDSCAPE, TABLET_PORTRAIT]) {
    await resize(page, viewport);
    await expect(async () => {
      const scroller = await box(page.locator('[data-alpha-app-scroll="files"]'));
      const tile = await box(documents);
      // The window's full width, with the two-column folder grid inside the centred column.
      expect(scroller.width).toBeGreaterThan(viewport.width - 2);
      expect(tile.x + tile.width).toBeLessThanOrEqual(scroller.x + (scroller.width + COLUMN) / 2 + 1);
      expect(tile.x).toBeGreaterThanOrEqual(scroller.x + (scroller.width - COLUMN) / 2 - 1);
    }).toPass({ timeout: 5000 });
  }
});

test('the Browser menu ends above the dock on short screens and its rows stay reachable', async ({ page }) => {
  await open(page, 'Browser');
  for (const viewport of [LANDSCAPE, SMALL_LANDSCAPE]) {
    await resize(page, viewport);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Browser menu', exact: true });
    await expect(menu).toBeVisible();
    const bounds = await box(menu);
    const docks = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *')).filter(dock => dock.getClientRects().length && !dock.closest('[inert]')).map(dock => dock.getBoundingClientRect().top));
    // Whether or not a dock is shown on this page, the menu ends above it and on screen.
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(Math.min(viewport.height, ...docks) + 0.5);
    const rows = menu.getByRole('button');
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    expect(await last.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); })).toBe(true);
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`browser-menu-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape');
    if (await menu.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(menu).toBeHidden();
  }
});

test('the Maps notice sits beside the map in landscape and is bounded on a wide portrait screen', async ({ page }) => {
  await open(page, 'Maps');
  const notice = page.locator('[data-alpha-maps-status]');
  await expect(notice).toBeVisible();
  await resize(page, LANDSCAPE);
  expect((await box(notice)).width).toBeLessThanOrEqual(915 / 2);
  await expectTarget(page, page.getByRole('button', { name: 'Add location', exact: true }));
  await resize(page, TABLET_PORTRAIT);
  expect((await box(notice)).width).toBeLessThanOrEqual(561);
  await resize(page, PORTRAIT);
  expect((await box(notice)).width).toBeGreaterThan(360);
});

const fakeCamera = () => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 640; const context = canvas.getContext('2d')!;
  const paint = () => { context.fillStyle = '#123'; context.fillRect(0, 0, 480, 640); context.fillStyle = 'white'; context.font = '64px sans-serif'; context.fillText('ALPHA', 60, 320); }; paint(); setInterval(paint, 50);
  const devices = navigator.mediaDevices; (window as any).cameraOpens = 0;
  devices.getUserMedia = async () => { (window as any).cameraOpens++; return canvas.captureStream(20); };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
};

test('Camera keeps one capture session and an undistorted preview through rotation; Photos fits the capture', async ({ page }) => {
  await page.addInitScript(fakeCamera);
  await open(page, 'Camera');
  const video = page.locator('[aria-label^="Viewfinder."] video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const original = await video.elementHandle();
  const shutter = page.getByRole('button', { name: 'Take photo', exact: true });
  for (const viewport of [SMALL_LANDSCAPE, LANDSCAPE, TABLET_LANDSCAPE, PORTRAIT]) {
    await resize(page, viewport);
    expect(await video.evaluate((element, previous) => element === previous, original)).toBe(true);
    expect(await video.evaluate((v: HTMLVideoElement) => getComputedStyle(v).objectFit)).not.toBe('fill');
    await expectTarget(page, shutter);
    // Zoom chips draw small but take a 44px touch target.
    for (const name of ['Zoom 1x', 'Zoom 2x']) await expectTarget(page, page.getByRole('button', { name, exact: true }));
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`camera-${viewport.width}x${viewport.height}.png`) });
  }
  expect(await page.evaluate(() => (window as any).cameraOpens)).toBe(1);
  await shutter.click();
  await expect(page.getByRole('button', { name: 'Open last photo', exact: true })).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Photos', exact: true }).click();
  const tile = page.getByRole('button', { name: /^Captured photo / });
  await expect(tile).toHaveCount(1);
  for (const tab of ['Library', 'Albums']) await expectTarget(page, page.getByRole('button', { name: tab, exact: true }));
  // The grid adds columns with width instead of growing each square tile.
  const portraitTile = await box(tile);
  expect(portraitTile.width).toBeGreaterThan(120); expect(portraitTile.width).toBeLessThan(140);
  await resize(page, LANDSCAPE);
  const landscapeTile = await box(tile);
  expect(landscapeTile.width).toBeLessThan(140);
  expect(Math.abs(landscapeTile.width - landscapeTile.height)).toBeLessThan(1);
  await tile.click();
  // The viewer fits the whole frame on screen in landscape instead of cropping it to the width.
  const frame = page.locator('[data-alpha-photo-frame]');
  await expect(frame).toBeVisible();
  for (const viewport of [LANDSCAPE, SMALL_LANDSCAPE, PORTRAIT, TABLET_LANDSCAPE]) {
    await resize(page, viewport);
    await expect(async () => {
      const bounds = await box(frame);
      expect(bounds.y).toBeGreaterThanOrEqual(-0.5); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(bounds.x).toBeGreaterThanOrEqual(-0.5); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(bounds.width / bounds.height).toBeCloseTo(0.75, 2);
    }).toPass({ timeout: 5000 });
    expect(await frame.locator('span').first().evaluate(el => getComputedStyle(el).backgroundSize)).toBe('contain');
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`photo-viewer-${viewport.width}x${viewport.height}.png`) });
  }
  await expect(page.getByRole('button', { name: 'Back from photo', exact: true })).toBeInViewport();
});

const inert = (locator: Locator) => locator.evaluate(element => !!element.closest('[inert]'));

test('the Settings Theme choice is a 44px target at every size', async ({ page }) => {
  await open(page, 'Settings');
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  for (const viewport of [PORTRAIT, SMALL_LANDSCAPE, TABLET_LANDSCAPE]) {
    await resize(page, viewport);
    for (const name of ['Theme: Light', 'Theme: Dark']) await expectTarget(page, page.getByRole('button', { name, exact: true }));
  }
});

test('Notes opens beside its list on a wide canvas and keeps each draft through switching and collapsing', async ({ page }) => {
  await open(page, 'Notes');
  await resize(page, TABLET_LANDSCAPE);
  const title = page.getByRole('textbox', { name: 'Title', exact: true }), body = page.getByRole('textbox', { name: 'Note', exact: true });
  const list = page.locator('[data-alpha-subview="notes-list"]'), editor = page.locator('[data-alpha-subview="notes-editor"]');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await title.fill('First draft'); await body.fill('Words for the first note that must not be lost.');
  // The list stays usable beside the open note, and marks it.
  await expect(list).toBeVisible();
  await expect.poll(() => inert(list)).toBe(false);
  const listBox = await box(list), editorBox = await box(editor);
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(editorBox.x + 1);
  await expect(page.getByRole('button', { name: 'Open First draft', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await title.fill('Second draft'); await body.fill('The second note, typed beside the list.');
  await page.getByRole('button', { name: 'Open First draft', exact: true }).click();
  await expect(body).toHaveValue('Words for the first note that must not be lost.');
  await page.getByRole('button', { name: 'Open Second draft', exact: true }).click();
  await expect(body).toHaveValue('The second note, typed beside the list.');
  await body.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(4, 10); });
  const original = await body.elementHandle();
  // Collapsing to one column keeps the open note, its element and caret; the list leaves the order.
  for (const viewport of [PORTRAIT, LANDSCAPE, TABLET_LANDSCAPE, SMALL_LANDSCAPE]) {
    await resize(page, viewport);
    await expect(body).toHaveValue('The second note, typed beside the list.');
    expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true);
    expect(await body.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([4, 10]);
    await expect.poll(() => inert(list)).toBe(viewport.width < 1000);
    await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`notes-split-${viewport.width}x${viewport.height}.png`) });
  }
  // Large text returns to one pane on a wide canvas, with the same editor and draft.
  const probe = (size: string) => page.evaluate(value => { document.querySelector<HTMLElement>('[data-alpha-text-probe]')!.style.fontSize = value; }, size);
  await resize(page, TABLET_LANDSCAPE);
  await expect.poll(() => inert(list)).toBe(false);
  await probe('150px');
  await expect.poll(() => inert(list)).toBe(true);
  expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true);
  await expect(body).toHaveValue('The second note, typed beside the list.');
  await probe('100px');
  await expect.poll(() => inert(list)).toBe(false);
  // Focus left on the list when it is covered moves to the open note's controls.
  await page.getByRole('button', { name: 'Open First draft', exact: true }).focus();
  await resize(page, PORTRAIT);
  await expect(page.getByRole('button', { name: 'Back to notes', exact: true })).toBeFocused();
});

test('switching notes beside the list leaves the previous one as Back does', async ({ page }) => {
  await open(page, 'Notes');
  await resize(page, TABLET_LANDSCAPE);
  const title = page.getByRole('textbox', { name: 'Title', exact: true }), newItem = page.getByRole('textbox', { name: 'New item', exact: true });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await title.fill('List A');
  await page.getByRole('button', { name: 'Turn into checklist', exact: true }).click();
  await newItem.fill('Half-typed item for list A');
  // The unsent item belongs to List A; it is not carried into the next note.
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await title.fill('List B');
  await page.getByRole('button', { name: 'Turn into checklist', exact: true }).click();
  await expect(newItem).toHaveValue('');
  // An untouched new note is dropped when another note is opened beside the list, as Back drops it.
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(title).toHaveValue('');
  await page.getByRole('button', { name: 'Open List A', exact: true }).click();
  await expect(title).toHaveValue('List A');
  await expect(page.getByRole('button', { name: 'Open Untitled', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open List B', exact: true })).toHaveCount(1);
});

test('Calendar shows readable day columns on wide screens, a single-day agenda at large text, and keeps the opened event', async ({ page }) => {
  await open(page, 'Calendar');
  await resize(page, TABLET_LANDSCAPE);
  const columns = page.locator('[data-alpha-calendar-day]');
  await expect(columns).toHaveCount(5);
  for (const column of await columns.all()) expect((await box(column)).width).toBeGreaterThanOrEqual(200);
  // From three columns the previous day leads; the selected day is marked.
  const selected = columns.nth(1);
  await expect(selected).toHaveAttribute('aria-current', 'date');
  await expect(columns.first()).toHaveAttribute('aria-current', 'false');
  await expect(page.getByText('Column check').first()).toBeVisible();
  const back = page.getByRole('button', { name: /^Back/ }).filter({ visible: true }).first();
  if (await page.locator('[data-alpha-subview="calendar-detail"]').count()) await back.click();
  const event = selected.getByRole('button', { name: /^Column check, / });
  await expect(event).toBeVisible();
  const eventBox = await box(event), column = await box(selected);
  expect(eventBox.x).toBeGreaterThanOrEqual(column.x - 1); expect(eventBox.x + eventBox.width).toBeLessThanOrEqual(column.x + column.width + 1);
  await event.click();
  const detail = page.locator('[data-alpha-subview="calendar-detail"]');
  await expect(detail).toContainText('Column check');
  // The opened event survives rotation and collapsing to one day.
  for (const viewport of [PORTRAIT, LANDSCAPE, TABLET_PORTRAIT]) {
    await resize(page, viewport);
    await expect(detail).toContainText('Column check');
  }
  await page.getByRole('button', { name: /^Back/ }).filter({ visible: true }).first().click();
  await resize(page, PORTRAIT);
  await expect(columns).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Column check, / })).toBeVisible();
  // Enlarged text below 150% keeps fewer, wider columns.
  await resize(page, TABLET_LANDSCAPE);
  await expect(columns).toHaveCount(5);
  const probe = (size: string) => page.evaluate(value => { document.querySelector<HTMLElement>('[data-alpha-text-probe]')!.style.fontSize = value; }, size);
  await probe('130px');
  await expect(columns).toHaveCount(3);
  // Large text: the days give way to the selected day's agenda list even on a wide screen. The
  // timeline stays mounted, hidden, and comes back with its scroll position.
  const timeline = page.getByRole('region', { name: 'Calendar timeline', exact: true });
  await timeline.evaluate(element => { element.scrollTop = 120; });
  const original = await timeline.elementHandle();
  await probe('200px');
  const agenda = page.getByRole('region', { name: 'Calendar agenda', exact: true });
  await expect(agenda).toBeVisible();
  await expect(columns).toHaveCount(0);
  await expect(timeline).toBeHidden();
  await expect(agenda.getByRole('button', { name: /^Column check, / })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath('calendar-large-text.png') });
  await agenda.getByRole('button', { name: /^Column check, / }).click();
  await expect(detail).toContainText('Column check');
  await page.getByRole('button', { name: /^Back/ }).filter({ visible: true }).first().click();
  await probe('100px');
  await expect(agenda).toHaveCount(0);
  await expect(timeline).toBeVisible();
  expect(await timeline.evaluate((element, previous) => element === previous, original)).toBe(true);
  expect(await timeline.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
