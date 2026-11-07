import type { Page } from '@playwright/test';

export async function openCameraTools(page: Page) {
  const tools = page.locator('details[data-alpha-camera="tools"]');
  if (await tools.getAttribute('open') === null) await tools.locator('summary').click();
}
