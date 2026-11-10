import { test, expect, type Page } from '@playwright/test';
import { auditPage, format } from './accessibility-audit';

// Android's shade is the one notification and quick-settings surface (issues #416 and #417,
// docs/gesture-zones.md). Alpha draws no shade in a product build, and Home has no
// notifications control. On launcher Home a pull down that starts on empty Home asks Android to
// open its shade; the standalone app is an ordinary app and has no pull. The top edge stays Android's.
//
// This is Chromium on the development server, which has no Android: here the request opens the
// development stand-in for Android's shade ([data-alpha-layer="shade"]). That Android expands its
// real shade, TalkBack, the system gesture zone and WebView touch handling are emulator/device
// evidence (SystemShadeInstrumentedTest, AccessibilityInstrumentedTest), not shown here. The
// product fallback without a stand-in is in settings-truth.production.spec.ts.
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const shade = (page: Page) => page.locator('[data-alpha-layer="shade"]');
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
async function closed(page: Page, why: string) {
  // The pull is decided while the pointer moves and lifts, and the shell renders the result before
  // the next frame: after two frames an opened shade would show.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(shade(page), why).toHaveAttribute('aria-hidden', 'true');
}

test.describe('standalone app', () => {
  test('Home has no notifications control and no downward pull opens a shade', async ({ page }) => {
    await home(page, '/');
    await expect(page.getByRole('button', { name: 'Open notifications', exact: true })).toHaveCount(0);
    for (const start of [{ x: 206, y: 3 }, { x: 206, y: 60 }, { x: 206, y: 300 }, { x: 206, y: 420 }]) {
      await drag(page, start, 260);
      await closed(page, `start ${start.y}`);
      await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    }
  });
});

test.describe('launcher', () => {
  test('Home has no notifications control below the status bar', async ({ page }) => {
    await home(page);
    await expect(page.getByRole('button', { name: 'Open notifications', exact: true })).toHaveCount(0);
  });

  test('a pull down on empty Home opens the shade; Close, Back and Escape close it', async ({ page }) => {
    await home(page);
    const open = () => drag(page, { x: 206, y: 420 }, 240);
    await open();
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-alpha-layer="home"]')).toHaveAttribute('aria-hidden', 'true');
    await shade(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
    await open();
    await page.keyboard.press('Escape');
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
    await open();
    await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'true');
  });

  test('a pull down anywhere on empty Home opens the shade', async ({ page }) => {
    await home(page);
    for (const start of [
      { name: 'upper Home', x: 206, y: 90 },
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
    // Home content scrolls independently. The dock is the explicit chat entry.
    await drag(page, { x: 206, y: 600 }, -260);
    await expect(page.locator('[data-screen]')).toHaveAttribute('data-alpha-chat-half', 'false');
    await expect(page.locator('[data-alpha-layer="conversation"]')).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await expect(page.locator('[data-alpha-transcript]')).toBeVisible();
    await drag(page, { x: 206, y: 300 }, 260);
    await closed(page, 'pull while the conversation sheet was open');
    // Inside an app view there is no pull.
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
    await expect.poll(() => layer.evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBe(true);
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

/** Where Home's content starts, in screen pixels below the top of the canvas. */
const contentTop = (page: Page) => page.locator('[data-alpha-home-layout]').evaluate(element => {
  const first = element.querySelector('button')!.getBoundingClientRect(), screen = element.closest('[data-screen]')!.getBoundingClientRect();
  return Math.round((first.top - screen.top) * 10) / 10;
});

// The inset Android reports is in screen pixels; Home is laid out on a 412px canvas scaled to the
// screen. On a phone narrower than the canvas the margin must still be measured on the screen.
// Home's top padding has a floor (phone.css), so under a short status bar content starts lower than
// the margin alone: only the lower bound holds at every inset.
for (const width of [360, 412, 480]) {
  test(`launcher Home starts at least 12 screen pixels below any status bar on a ${width}px wide screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await home(page);
    for (const inset of [24, 48, 56, 72, 100]) {
      await page.evaluate(value => document.documentElement.style.setProperty('--native-top-inset', `${value}px`), inset);
      await expect.poll(() => contentTop(page), { message: `inset ${inset}` }).toBeGreaterThanOrEqual(inset + 12 - .5);
    }
  });
}

test('every Home app stays reachable above the dock at 200% text', async ({ page }) => {
  await home(page);
  await page.evaluate(async () => { const display = await import('/src/browser/display.ts' as string); display.installBrowserDisplay(); document.documentElement.style.setProperty('--browser-text-scale', '2'); });
  await page.waitForTimeout(350);
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

// The launcher is portrait only (docs/decisions.md P-27). A short portrait window, as on a short
// phone with large text, is the geometry in which its Home overflows.
test.describe('launcher Home taller than a short portrait screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 560 } });

  test('a downward touch pull at the top of an overflowing Home opens the shade; upward still scrolls', async ({ page }) => {
    await home(page);
    const layer = page.locator('[data-alpha-layer="home"]');
    await expect(layer).toHaveAttribute('data-alpha-home-fits', 'false');
    expect(await layer.evaluate(element => element.scrollTop)).toBe(0);
    // Empty Home, clear of every control and below the status bar, where vertical touch would scroll Home.
    const emptyHome = () => page.evaluate(() => {
      const screen = document.querySelector('[data-screen]')!.getBoundingClientRect();
      // Below Android's 44px status band in canvas pixels (the canvas is scaled to the screen).
      for (let y = screen.top + Math.ceil(60 * screen.width / 412); y < screen.bottom; y += 4) for (let x = screen.left + 12; x < screen.right; x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('[data-alpha-layer="home"]') && !hit.closest('button,.scr')) return { x, y };
      }
      return null;
    });
    const start = await emptyHome();expect(start).not.toBeNull();
    // The first app row is on screen; the lower rows may sit under the dock.
    const icons = (await page.locator('[data-alpha-home-apps] button').first().boundingBox())!;
    // An upward drag on the app row is ordinary scrolling: Home moves, no shade.
    await touchDrag(page, icons.x + icons.width / 2, icons.y + icons.height / 2, -160);
    await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await closed(page, 'upward scroll');
    // Scrolled away from its top, a downward drag scrolls Home back instead of opening the shade.
    // Drag on empty Home: the cards keep vertical drags for themselves.
    const scrolled = await layer.evaluate(element => element.scrollTop);
    const scrolledStart=await emptyHome();expect(scrolledStart).not.toBeNull();
    await touchDrag(page, scrolledStart!.x, scrolledStart!.y, 120);
    await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeLessThan(scrolled);
    await closed(page, 'scrolled Home scrolls back');
    await layer.evaluate(element => { element.scrollTop = 0; });
    // At the top, a downward pull on empty Home reaches Alpha and opens the shade.
    const topStart=await emptyHome();expect(topStart).not.toBeNull();
    await touchDrag(page, topStart!.x, topStart!.y, 160);
    await expect(shade(page)).toHaveAttribute('aria-hidden', 'false');
  });
});
