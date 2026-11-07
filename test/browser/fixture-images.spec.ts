import { test, expect } from '@playwright/test';

// Fixture photography is bundled in the fixture module; in mock mode the
// rendered screens must load and decode it.
for (const start of ['photos', 'browser', 'camera']) test(`mock ${start} decodes fixture images`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?mode=mock&start=${start}`);
  await expect(page.locator('.mock-mode-banner')).toBeVisible();
  await page.waitForTimeout(500);
  const result = await page.evaluate(async () => {
    const urls = new Set<string>();
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-screen] *'))) {
      for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) if (/\/fixtures\/img\/[a-z0-9_]+\.webp/.test(match[1])) urls.add(match[1]);
    }
    const decoded = await Promise.all([...urls].map(async url => {
      const image = new Image(); image.src = url;
      try { await image.decode(); return { url, width: image.naturalWidth }; } catch { return { url, width: 0 }; }
    }));
    return decoded;
  });
  expect(result.length).toBeGreaterThan(0);
  for (const image of result) expect(image.width, image.url).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
