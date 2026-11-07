import { test, expect, type Page, type Locator } from '@playwright/test';
// A touch phone in landscape (the Android WebView path in main.tsx). Android rotation itself is
// covered by RotationInstrumentedTest; this checks the renderer layout only.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });

async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(async () => {
    const box = await control.boundingBox(); expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(await control.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); })).toBe(true);
  }).toPass({ timeout: 5000 });
}

test('landscape lays Home and the composer side by side and keeps every Home control reachable', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
  // Scaled by the shorter side: type stays phone-sized rather than shrinking to fit the width.
  expect(Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--phone-scale')))).toBeCloseTo(1, 1);
  const home = page.locator('[data-alpha-layer="home"]'), composer = page.locator('[data-alpha-layer="composer"]');
  const homeBox = (await home.boundingBox())!, composerBox = (await composer.boundingBox())!;
  expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(composerBox.x + 1);
  for (const name of ['Settings', 'Notes', 'Calendar', 'Apps', 'Open workflows and automations'])
    await reachable(page, page.getByRole('button', { name, exact: true }));
  await page.screenshot({ path: info.outputPath('landscape-home.png') });

  const draft = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
  await reachable(page, draft);
  await draft.fill('Rotation keeps this draft');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  // Rotate to portrait: the active view and the composer draft survive.
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.locator('html')).not.toHaveClass(/alpha-landscape/);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ask Alpha', exact: true })).toHaveValue('Rotation keeps this draft');
  await reachable(page, page.getByRole('button', { name: 'Settings', exact: true }));
  // And back to landscape with the drawer open: its search and rows stay reachable too.
  await page.setViewportSize({ width: 915, height: 412 });
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Apps', exact: true });
  await reachable(page, drawer.getByRole('searchbox', { name: 'Search apps', exact: true }));
  await reachable(page, drawer.getByRole('button', { name: 'Close apps', exact: true }));
  await page.screenshot({ path: info.outputPath('landscape-drawer.png') });
});

test('the conversation docks beside Home in landscape and its controls stay on screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).first().click();
  const panel = page.locator('[data-alpha-layer="conversation"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThan(300);
  expect(box.y + box.height).toBeLessThanOrEqual(413);
  await reachable(page, page.getByRole('button', { name: 'Minimize chat', exact: true }));
  await reachable(page, panel.getByRole('textbox'));
});

test.describe('a narrow window on a landscape monitor', () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 500, height: 900 } });
  test('keeps the portrait phone layout: only a landscape window on a landscape screen docks side by side', async ({ page }) => {
    // A 1920x1080 monitor (Chromium ignores the screen option outside mobile emulation).
    await page.addInitScript(() => {
      Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 1920 });
      Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => 1080 });
    });
    await page.goto('/');
    await expect(page.locator('[data-alpha-layer="home"]')).toBeVisible();
    expect(await page.evaluate(() => [screen.width, screen.height, innerWidth < innerHeight])).toEqual([1920, 1080, true]);
    await expect(page.locator('html')).not.toHaveClass(/alpha-landscape/);
    await reachable(page, page.getByRole('button', { name: 'Settings', exact: true }));
  });
});
