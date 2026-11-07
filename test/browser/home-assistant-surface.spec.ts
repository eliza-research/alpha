import { test, expect } from '@playwright/test';
// Development lane. `?surface=assistant` (development server only) previews the surface Android
// renders for ACTION_ASSIST (AlphaAssistActivity, DailyApps.surfaceInfo().assistant). The Android
// entry itself is covered by AssistantInstrumentedTest; this checks the renderer surface only.

test('the assistant surface shows chat and Close only: no app grid, digests or startup permissions', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?surface=assistant');
  await expect(page.locator('html')).toHaveClass(/alpha-assistant-surface/);
  const close = page.getByRole('button', { name: 'Close assistant', exact: true });
  await expect(close).toBeVisible();
  await expect(page.getByRole('button', { name: 'Minimize chat', exact: true })).toHaveCount(0);
  // Home's app grid and Apps drawer are not part of the assistant surface.
  await expect(page.locator('[data-alpha-layer="home"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.locator('.alpha-startup-permissions')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /scheduled digests/i })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('assistant-surface.png') });
  expect(errors).toEqual([]);
});

test('without the assistant entry Home keeps its app grid and minimize control', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/alpha-assistant-surface/);
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close assistant', exact: true })).toHaveCount(0);
});
