import { test, expect, type Page } from '@playwright/test';
import { ASSISTANT_GROUP, auditPage, auditReadingOrder, auditTree, format } from './accessibility-audit';
import { setTextScale } from './accessibility-states';
import { settled } from './helpers/settled';

// PRD AP-15 across views, in the renderer: repeated HOME, popups open when HOME arrives, rotation
// and a reload (the renderer's process death) leave every screen announced, operable and in
// reading order. Chromium on the development server: Android's HOME key arrives as the renderer's
// `launcher-home` event and rotation as a viewport change, as main.tsx and MainActivity deliver
// them. Not TalkBack, an emulator or a device (AccessibilityLifecycleInstrumentedTest and
// MVP-48's device list).
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const VIEWS = ['Inbox', 'Calendar', 'Browser', 'Camera', 'Photos', 'Maps', 'Notes', 'Files', 'Workflows', 'Settings'] as const;
const DRAFT = 'Lifecycle draft kept across every screen';

async function start(page: Page) {
  await page.addInitScript(offline);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
const activeView = (page: Page) => page.evaluate(() => document.documentElement.dataset.activeView);
/** Where focus is, as a person would find it: nowhere (dropped), or a named element on the screen in front. */
const focusState = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  const dropped = !el || el === document.body || el === document.documentElement || !el.isConnected || !!el.closest('[inert],[aria-hidden="true"],[hidden]') || !el.getClientRects().length;
  return {
    dropped,
    onHome: !!el?.closest('[data-alpha-layer="home"]'),
    name: el ? (el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40)) : '',
    title: !!el?.matches('[data-alpha-app-title]'),
  };
});
/** Activates a Home app tile from the keyboard, as Switch Access or a TalkBack double tap does. */
async function openFromHome(page: Page, view: string) {
  const tile = page.locator('[data-alpha-layer="home"]').getByRole('button', { name: view, exact: true }).and(page.locator('[data-mobile-shell-tile]'));
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => activeView(page)).toBe(view.toLowerCase());
}
async function pressHome(page: Page, times = 1) {
  for (let press = 0; press < times; press++) {
    await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
    // Press cadence, not readiness: repeated presses land while the previous one is still moving.
    await page.waitForTimeout(120);
  }
  await expect.poll(() => activeView(page)).toBe('home');
}
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"]:not([inert]) textarea[data-alpha-composer]');
async function screenIsSound(page: Page, where: string) {
  const found = format([...await auditTree(page), ...await auditReadingOrder(page), ...await auditPage(page, { dock: true })]);
  expect(found, `${where}:\n${found.join('\n')}`).toEqual([]);
  await expect(page.locator('dialog[open]'), `${where}: no dialog is left open`).toHaveCount(0);
  expect(await page.evaluate(() => !!document.querySelector('.os')?.closest('[inert]')), `${where}: the phone is not left inert`).toBe(false);
}

test.describe('repeated HOME across views', () => {
  for (const view of VIEWS) {
    test(`${view}: focus lands on the screen's name, and HOME three times returns to an accessible Home`, async ({ page }) => {
      test.setTimeout(60_000);
      await start(page);
      await composer(page).fill(DRAFT);
      await openFromHome(page, view);
      // Opening an app from the keyboard announces it: focus is on its name, not dropped behind Home.
      await expect.poll(async () => (await focusState(page)).dropped, { message: `${view}: focus was dropped when it opened` }).toBe(false);
      expect((await focusState(page)).onHome).toBe(false);
      await pressHome(page, 3);
      await expect.poll(async () => (await focusState(page)).dropped, { message: `${view}: focus was dropped by HOME` }).toBe(false);
      expect((await focusState(page)).onHome).toBe(true);
      await expect(page.getByRole('region', { name: 'Home', exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: ASSISTANT_GROUP, exact: true })).toHaveCount(1);
      await expect(composer(page)).toHaveValue(DRAFT);
      await screenIsSound(page, `Home after HOME from ${view}`);
      // Tab continues into Home from its name, not from a control of the closed app.
      await page.keyboard.press('Tab');
      const next = await focusState(page);
      expect(next.dropped).toBe(false);
      expect(next.onHome || next.name === 'Open conversation', `Tab after HOME went to '${next.name}'`).toBe(true);
      // The app opens again, in front and exposed.
      await openFromHome(page, view);
      await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
      await expect(page.locator('[data-alpha-layer="home"]')).toHaveAttribute('aria-hidden', 'true');
    });
  }

  test('HOME on Home with Apps open closes it and keeps focus on Home', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    await page.getByRole('button', { name: 'Apps', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-alpha-layer="drawer"]')).toBeVisible();
    await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
    await pressHome(page, 2);
    await expect(page.locator('[data-alpha-layer="drawer"]')).toHaveCount(0);
    await expect.poll(async () => (await focusState(page)).onHome).toBe(true);
    await screenIsSound(page, 'Home after HOME from Apps');
  });
});

test.describe('HOME while a popup, subview or field is open', () => {
  // Menus and sheets over a scrim own focus (subview-accessibility.ts); HOME must retire them, not
  // leave the page inert or focus behind them. Live screens: HOME is the product's own handler.
  for (const steps of [['Browser', 'Menu'], ['Browser', 'Edit address'], ['Calendar', 'Clock alarms'], ['Workflows', 'New automation'], ['Settings', 'Display']] as const) {
    test(`${steps.join(' > ')}: HOME retires it and Home is announced`, async ({ page }) => {
      // Two app openings, a popup and two audits: explicit, as the 200% sweeps run beside it.
      test.setTimeout(60_000);
      await start(page);
      await openFromHome(page, steps[0]);
      for (const step of steps.slice(1)) await page.getByRole('button', { name: step, exact: true }).first().click();
      await settled(page);
      await pressHome(page, 2);
      await expect.poll(async () => (await focusState(page)).onHome).toBe(true);
      await screenIsSound(page, `Home after HOME from ${steps.join(' > ')}`);
      // The app opens again without the popup in front of it.
      await openFromHome(page, steps[0]);
      await expect(page.locator('[role="dialog"][aria-modal="true"]:visible, dialog[open]')).toHaveCount(0);
      await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
    });
  }
});

test.describe('rotation across views', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const view of VIEWS) {
    test(`${view}: rotating keeps the screen, focus and draft, with every control on screen`, async ({ page }) => {
      // Four rotations, each audited: explicit, as the 200% sweeps run beside it.
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 412, height: 915 });
      await start(page);
      await composer(page).fill(DRAFT);
      await openFromHome(page, view);
      await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
      const before = (await focusState(page)).name;
      for (const [width, height, landscape] of [[915, 412, true], [412, 915, false], [915, 412, true], [412, 915, false]] as const) {
        await page.setViewportSize({ width, height });
        const html = page.locator('html');
        if (landscape) await expect(html).toHaveClass(/alpha-landscape/); else await expect(html).not.toHaveClass(/alpha-landscape/);
        await settled(page);
        expect(await activeView(page), `${view} is still in front after rotating`).toBe(view.toLowerCase());
        // Focus stays on the screen's name; a layer the new layout rebuilt hands it back within a few frames.
        await expect.poll(async () => { const focus = await focusState(page); return focus.dropped ? 'dropped' : focus.name; }, { message: `${view}: rotating dropped focus` }).toBe(before);
        const found = format([...await auditReadingOrder(page), ...await auditPage(page, { clipping: true, overlap: true, dock: true })]).filter(line => !line.startsWith('text-truncated:'));
        expect(found, `${view} ${landscape ? 'landscape' : 'portrait'}:\n${found.join('\n')}`).toEqual([]);
      }
      await pressHome(page);
      await expect(composer(page)).toHaveValue(DRAFT);
    });
  }
});

test.describe('a reload (the renderer restarted)', () => {
  test('the chosen text size survives, and Home comes back announced and in reading order', async ({ page }) => {
    // A reload plus three audited views: 5 s alone, past the 30 s default when run beside the 200% sweeps.
    test.setTimeout(90_000);
    await start(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Display', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Text size', exact: true });
    await expect(slider).toBeVisible();
    // The largest in-app size (150%), set as a person drags the slider: the input event the page listens for.
    await slider.evaluate(input => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '100'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')))).toBeGreaterThanOrEqual(1.4);
    const scale = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')))).toBeCloseTo(scale, 1);
    await settled(page);
    await screenIsSound(page, 'Home after a reload at the larger text size');
    // Every app still opens announced at that size.
    for (const view of ['Settings', 'Files', 'Calendar'] as const) {
      await openFromHome(page, view);
      await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
      const found = format([...await auditTree(page), ...await auditReadingOrder(page)]);
      expect(found, `${view} after reload:\n${found.join('\n')}`).toEqual([]);
      await pressHome(page);
    }
  });

  test('200% text: every view reads in order after a reload', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await setTextScale(page, 2);
    for (const view of VIEWS) {
      await openFromHome(page, view);
      await settled(page);
      const found = format(await auditReadingOrder(page));
      expect(found, `${view} at 200% after reload:\n${found.join('\n')}`).toEqual([]);
      await pressHome(page);
    }
    await screenIsSound(page, 'Home at 200% after visiting every view');
  });
});

test.describe('permission loss and offline', () => {
  test('camera permission withdrawn while away: Camera reopens to an announced recovery, and HOME still works', async ({ page }) => {
    test.setTimeout(60_000);
    // Granted first (a synthetic canvas stream), then withdrawn as Android Settings would while Alpha is in the background.
    await page.addInitScript(() => {
      const devices = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
      (window as any).cameraAllowed = true;
      navigator.mediaDevices.getUserMedia = async () => {
        if (!(window as any).cameraAllowed) throw new DOMException('Synthetic denial', 'NotAllowedError');
        return canvas.captureStream(5);
      };
    });
    await start(page);
    await openFromHome(page, 'Camera');
    await expect(page.locator('[aria-label^="Viewfinder."] video')).toBeVisible();
    await pressHome(page);
    await page.evaluate(() => { (window as any).cameraAllowed = false; });
    await openFromHome(page, 'Camera');
    const recovery = page.getByRole('alert', { name: 'Camera access is off' });
    await expect(recovery).toBeVisible();
    await expect.poll(async () => (await focusState(page)).dropped).toBe(false);
    const found = format([...await auditTree(page), ...await auditReadingOrder(page), ...await auditPage(page, { dock: true })]);
    expect(found, `Camera with access withdrawn:\n${found.join('\n')}`).toEqual([]);
    // The way back to the camera is reachable from the keyboard, not only by touch.
    const retry = recovery.getByRole('button', { name: 'Try again', exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    await pressHome(page, 2);
    await expect.poll(async () => (await focusState(page)).onHome).toBe(true);
    await screenIsSound(page, 'Home after HOME from Camera with access withdrawn');
  });

  test('the network going away mid-session leaves every view announced, in order and able to go HOME', async ({ page, context }) => {
    test.setTimeout(120_000);
    await start(page);
    await composer(page).fill(DRAFT);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    try {
      for (const view of VIEWS) {
        await openFromHome(page, view);
        await expect.poll(async () => (await focusState(page)).dropped, { message: `${view} offline: focus was dropped` }).toBe(false);
        await settled(page);
        const found = format([...await auditTree(page), ...await auditReadingOrder(page)]);
        expect(found, `${view} offline:\n${found.join('\n')}`).toEqual([]);
        await pressHome(page);
        await expect.poll(async () => (await focusState(page)).onHome, { message: `HOME from ${view} offline` }).toBe(true);
      }
      await expect(composer(page)).toHaveValue(DRAFT);
      await screenIsSound(page, 'Home offline after visiting every view');
    } finally {
      await context.setOffline(false);
    }
  });
});
