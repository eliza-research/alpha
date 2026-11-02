import { test, expect, type Page } from '@playwright/test';
import { auditPage, auditTree, format } from './accessibility-audit';

// Android's shade is the one notification and quick-settings surface (issues #416 and #417,
// docs/gesture-zones.md). Alpha draws no shade in a product build. On launcher Home a
// Notifications button, and a pull down that starts on empty Home, ask Android to open its shade;
// the standalone app is an ordinary app and offers neither. The top edge stays Android's.
//
// This is Chromium on the development server, which has no Android: here the request opens the
// development stand-in for Android's shade ([data-alpha-layer="shade"]). That Android expands its
// real shade, TalkBack, the system gesture zone and WebView touch handling are emulator/device
// evidence (SystemShadeInstrumentedTest, AccessibilityInstrumentedTest), not shown here. The
// product fallback without a stand-in is in settings-truth.production.spec.ts.
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const shade = (page: Page) => page.locator('[data-alpha-layer="shade"]');
const button = (page: Page) => page.getByRole('button', { name: 'Open notifications', exact: true });
const LAUNCHER = '/?shell=launcher';

async function home(page: Page, url = LAUNCHER) {
  await page.addInitScript(offline);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
}
/** A real pointer drag in screen coordinates of the 412px phone canvas. */
async function drag(page: Page, from: { x: number; y: number }, dy: number, dx = 0) {
  const box = (await page.locator('[data-screen]').boundingBox())!, scale = box.width / 412;
  await page.mouse.move(box.x + from.x * scale, box.y + from.y * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + (from.x + dx) * scale, box.y + (from.y + dy) * scale, { steps: 10 });
  await page.mouse.up();
}
/** The button's box in the phone canvas's own 412px coordinates. */
async function buttonBox(page: Page) {
  return button(page).evaluate(element => {
    const screen = element.closest('[data-screen]')!.getBoundingClientRect(), scale = screen.width / 412, box = element.getBoundingClientRect();
    return { left: (box.left - screen.left) / scale, top: (box.top - screen.top) / scale, width: box.width / scale, height: box.height / scale };
  });
}
async function closed(page: Page, why: string) {
  await page.waitForTimeout(120);
  await expect(shade(page), why).toHaveAttribute('aria-hidden', 'true');
}

test.describe('standalone app', () => {
  test('Home has no notifications control and no downward pull opens a shade', async ({ page }) => {
    await home(page, '/');
    await expect(page.locator('[data-alpha-shade-handle]')).toHaveCount(0);
    for (const start of [{ x: 206, y: 3 }, { x: 206, y: 60 }, { x: 206, y: 300 }, { x: 206, y: 420 }]) {
      await drag(page, start, 260);
      await closed(page, `start ${start.y}`);
      await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    }
  });
});

test.describe('launcher', () => {
  test('the button is a visible, named, adequately sized control below the status bar', async ({ page }) => {
    await home(page);
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toContainText('Notifications');
    await expect(button(page)).toHaveAttribute('aria-description', "Opens Android's notifications and quick settings");
    // It controls no Alpha region: the shade it opens is Android's.
    await expect(button(page)).not.toHaveAttribute('aria-controls', /.*/);
    const box = await buttonBox(page);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.top).toBeGreaterThanOrEqual(44 + 8);
    const found = format([...await auditTree(page), ...await auditPage(page, { targetSize: 44 })]).filter(line => line.includes('data-alpha-shade-handle'));
    expect(found, found.join('\n')).toEqual([]);
  });

  test('a tap opens the shade; Close, Back and Escape close it and focus returns to the button', async ({ page }) => {
    await home(page);
    await button(page).click();
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-alpha-layer="home"]')).toHaveAttribute('aria-hidden', 'true');
    await shade(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(button(page)).toBeFocused();
    await button(page).click();
    await page.keyboard.press('Escape');
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(button(page)).toBeFocused();
    await button(page).click();
    await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
  });

  for (const key of ['Enter', 'Space']) {
    test(`the keyboard reaches the button and ${key} opens the shade`, async ({ page }) => {
      await home(page);
      let reached = false;
      for (let presses = 0; presses < 40 && !reached; presses++) { await page.keyboard.press('Tab'); reached = await button(page).evaluate(element => element === document.activeElement); }
      expect(reached, 'Tab reaches the notifications button').toBe(true);
      await page.keyboard.press(key);
      await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
    });
  }

  test('an accessibility click with no pointer opens the shade', async ({ page }) => {
    await home(page);
    // What TalkBack's double-tap and Switch Access deliver: the click action alone.
    await button(page).evaluate(element => (element as HTMLElement).click());
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
  });

  // Android's ACTION_CLICK lands on the node at the target's centre: the trigger must be the
  // native <button> itself (not a wrapper or a role on a div), carry its own name, and no layer of
  // the launcher (status bar band, cutout, development chrome) may sit over that point.
  test('the trigger is a named native button that nothing covers, at any status bar inset', async ({ page }) => {
    await home(page);
    for (const inset of [0, 24, 48, 72]) {
      await page.evaluate(value => document.documentElement.style.setProperty('--native-top-inset', `${value}px`), inset);
      await page.waitForTimeout(50);
      const target = await button(page).evaluate(element => {
        const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y), owner = hit?.closest('button');
        const stack = document.elementsFromPoint(x, y), own = stack.findIndex(node => element.contains(node));
        const covering = (own < 0 ? stack : stack.slice(0, own)).filter(node => !node.contains(element)).map(node => node.tagName + (node.getAttribute('data-alpha-layer') ? `[${node.getAttribute('data-alpha-layer')}]` : ''));
        return { tag: element.tagName, type: (element as HTMLButtonElement).type, name: element.getAttribute('aria-label'), role: element.getAttribute('role'), owned: owner === element, covering, inert: !!element.closest('[inert]'), hidden: !!element.closest('[aria-hidden="true"]') };
      });
      expect(target, `inset ${inset}`).toMatchObject({ tag: 'BUTTON', type: 'button', name: 'Open notifications', role: null, owned: true, inert: false, hidden: false });
      // Whatever stacks above Home at that point is only an ancestor, never a sibling overlay.
      expect(target.covering, `inset ${inset}`).toEqual([]);
      await button(page).evaluate(element => (element as HTMLElement).click());
      await expect(shade(page), `inset ${inset}`).toHaveAttribute('aria-hidden', 'false');
      await page.keyboard.press('Escape');
      await expect(shade(page), `inset ${inset}`).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('a pull down on the button or on empty Home opens the shade', async ({ page }) => {
    await home(page);
    const box = await buttonBox(page);
    for (const start of [
      { name: 'on the button', x: box.left + box.width / 2, y: box.top + box.height / 2 },
      { name: 'beside the button', x: Math.max(8, box.left - 40), y: box.top + box.height / 2 },
      { name: 'middle of Home', x: 206, y: 420 },
      { name: 'lower Home', x: 206, y: 640 },
    ]) {
      await drag(page, start, 240);
      await expect(shade(page), start.name).toHaveAttribute('aria-hidden', 'false');
      // A swipe up inside the open shade closes it.
      await drag(page, { x: 206, y: 500 }, -240);
      await expect(shade(page), start.name).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('the top edge, sideways drags, app views and open sheets keep their own gestures', async ({ page }) => {
    await home(page);
    // Android's status bar band: Android answers that swipe itself.
    for (const y of [3, 30]) { await drag(page, { x: 206, y }, 260); await closed(page, `status band ${y}`); }
    // A mostly sideways drag is a card row or Back, not the shade.
    await drag(page, { x: 120, y: 420 }, 120, 160);
    await closed(page, 'sideways');
    // An upward swipe on Home is the conversation sheet; while it is open a pull down closes it.
    await drag(page, { x: 206, y: 600 }, -260);
    await expect(page.locator('[data-alpha-transcript]')).toBeVisible();
    await drag(page, { x: 206, y: 300 }, 260);
    await closed(page, 'pull while the conversation sheet was open');
    // Inside an app view there is no button and no pull.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
    for (const y of [3, 70, 420]) { await drag(page, { x: 206, y }, 260); await closed(page, `Settings, start ${y}`); }
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  });

  test('with the composer focused (keyboard up) a pull does not open the shade', async ({ page }) => {
    await home(page);
    const composer = page.locator('textarea[data-alpha-composer]');
    await composer.focus();
    await expect(composer).toBeFocused();
    await drag(page, { x: 206, y: 420 }, 240);
    await closed(page, 'keyboard');
  });

  test('a Home scrolled away from its top scrolls back before a pull opens the shade', async ({ page }) => {
    await home(page);
    // Model the bounded dock/content clearance the Home fit observer already watches.
    // Large text alone is not an overflow guarantee: the current Home adapts its layout.
    const clearance = page.locator('[data-alpha-home-clearance]');
    await clearance.evaluate(element => { (element as HTMLElement).style.height = '160px'; });
    const layer = page.locator('[data-alpha-layer="home"]');
    await expect.poll(() => layer.evaluate(element => element.scrollHeight > element.clientHeight + 40)).toBe(true);
    // An overflowing Home keeps ordinary vertical scrolling for touch.
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'false');
    await layer.evaluate(element => { element.scrollTop = 120; });
    await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await drag(page, { x: 206, y: 420 }, 240);
    await closed(page, 'scrolled Home');
    await layer.evaluate(element => { element.scrollTop = 0; });
    await drag(page, { x: 206, y: 420 }, 240);
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
    await clearance.evaluate(element => { (element as HTMLElement).style.removeProperty('height'); });
  });

  for (const height of [915, 1200]) test(`a Home that fits hands vertical touch drags to the page at 412x${height}`, async ({ page }) => {
    // Include the original compact-height dock-padding regression and a tall phone.
    await page.setViewportSize({width:412,height});
    await home(page);
    const layer = page.locator('[data-alpha-layer="home"]');
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'true');
    await expect.poll(() => layer.evaluate(element => getComputedStyle(element).touchAction)).toBe('pan-x pinch-zoom');
    // Half-chat clearance can change scroll range while Home and its icon layout keep their size.
    const clearance = page.locator('[data-alpha-home-clearance]');
    await clearance.evaluate(element => { (element as HTMLElement).style.height = '160px'; });
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'false');
    await clearance.evaluate(element => { (element as HTMLElement).style.height = '0px'; });
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'true');
  });
});

test('a taller status bar pushes the launcher button down, clear of the system gesture zone', async ({ page }) => {
  await home(page);
  const before = await buttonBox(page);
  // What MainActivity publishes on the launcher flavor: the status bar height in CSS pixels.
  await page.evaluate(() => document.documentElement.style.setProperty('--native-top-inset', '72px'));
  await expect.poll(async () => (await buttonBox(page)).top).toBeGreaterThanOrEqual(72 + 8);
  expect((await buttonBox(page)).top).toBeGreaterThan(before.top);
});

// The inset Android reports is in screen pixels; Home is laid out on a 412px canvas scaled to the
// screen. On a phone narrower than the canvas the margin must still be measured on the screen.
for (const width of [360, 412, 480]) {
  test(`the launcher button starts 12 screen pixels below any status bar on a ${width}px wide screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await home(page);
    for (const inset of [24, 48, 56, 72, 100]) {
      await page.evaluate(value => document.documentElement.style.setProperty('--native-top-inset', `${value}px`), inset);
      await expect.poll(async () => Math.round(((await button(page).boundingBox())!.y - (await page.locator('[data-screen]').boundingBox())!.y) * 10) / 10, { message: `inset ${inset}` }).toBeGreaterThanOrEqual(inset + 12 - .5);
      expect((await button(page).boundingBox())!.height, `inset ${inset}`).toBeGreaterThanOrEqual(44 * Math.min(1, width / 412) - .5);
    }
  });
}

test('the button keeps its target and its whole label at 200% text', async ({ page }) => {
  await home(page);
  await page.evaluate(async () => { const display = await import('/src/browser/display.ts' as string); display.installBrowserDisplay(); document.documentElement.style.setProperty('--browser-text-scale', '2'); });
  await page.waitForTimeout(350);
  const box = await buttonBox(page);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.left + box.width).toBeLessThanOrEqual(412);
  // Full-height Home scrolls behind the floating dock and development gesture bar. Bring the
  // final app row above both before auditing overlap; no app may be stranded underneath them.
  const layer = page.locator('[data-alpha-layer="home"]');
  await layer.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const composer = page.locator('[data-alpha-layer="composer"] [data-alpha-input-bar]');
  await expect.poll(async () => { const app = (await settings.boundingBox())!, dock = (await composer.boundingBox())!; return dock.y - (app.y + app.height); }).toBeGreaterThanOrEqual(6);
  await settings.click({ trial: true });
  const found = format(await auditPage(page, { clipping: true, overlap: true })).filter(line => !line.startsWith('text-truncated:'));
  expect(found, found.join('\n')).toEqual([]);
});

/** A real touch drag in viewport pixels through Chromium's input pipeline, so scrolling and
 * pointercancel happen as they do for a finger on a phone. */
async function touchDrag(page: Page, x: number, y: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const at = (to: number) => [{ x, y: to }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
  for (let step = 1; step <= 12; step++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + dy * step / 12) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('launcher Home taller than the screen (landscape)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });

  test('a downward touch pull at the top of an overflowing Home opens the shade; upward still scrolls', async ({ page }) => {
    await home(page);
    const layer = page.locator('[data-alpha-layer="home"]');
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'false');
    expect(await layer.evaluate(element => element.scrollTop)).toBe(0);
    // Empty Home beside the Notifications button, where vertical touch would scroll Home.
    const row = (await page.locator('.alpha-shade-row').boundingBox())!, start = { x: row.x + row.width - 12, y: row.y + row.height - 6 };
    expect(await page.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); return !!hit?.closest('[data-alpha-layer="home"]') && !hit.closest('button,.scr'); }, start)).toBe(true);
    const icons = (await page.getByRole('button', { name: 'Browser', exact: true }).boundingBox())!;
    // An upward drag on the app row is ordinary scrolling: Home moves, no shade.
    await touchDrag(page, icons.x + icons.width / 2, icons.y + icons.height / 2, -160);
    await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await closed(page, 'upward scroll');
    // Scrolled away from its top, a downward drag scrolls Home back instead of opening the shade.
    const scrolled = await layer.evaluate(element => element.scrollTop);
    await touchDrag(page, icons.x + icons.width / 2, 200, 120);
    await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeLessThan(scrolled);
    await closed(page, 'scrolled Home scrolls back');
    await layer.evaluate(element => { element.scrollTop = 0; });
    // At the top, a downward pull on empty Home reaches Alpha and opens the shade.
    await touchDrag(page, start.x, start.y, 280);
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
  });
});
