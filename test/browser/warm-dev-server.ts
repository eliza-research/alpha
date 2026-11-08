import { chromium, type FullConfig } from '@playwright/test';

// Playwright's webServer is "ready" once `/` answers, but the development server transforms the
// app's modules on the first page that asks for them. With several workers starting together, every
// first `page.goto` waited on that one cold transform and the slowest ones ran out their test
// timeout under load (accessibility-lifecycle's first tests, for example). One page load here, before
// any worker starts, leaves the module graph transformed and cached. It asserts nothing about the
// product; a failure to warm is reported and the specs still run (and fail on their own terms).
export default async function warmDevelopmentServer(config: FullConfig) {
  // playwright.config.ts installs this only when a development project is selected.
  const development = config.projects.find(project => project.name === 'chromium');
  if (!development?.use.baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
    // The product shell, then the development and fixture modes, which load their own modules.
    for (const path of ['/', '/?mode=dev', '/?mode=mock&start=home']) {
      await page.goto(new URL(path, String(development.use.baseURL)).href, { timeout: 240_000 });
      await page.locator('.alpha-phone').waitFor({ timeout: 240_000 });
    }
  } catch (error) {
    console.warn(`Development server warm-up did not finish: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}
