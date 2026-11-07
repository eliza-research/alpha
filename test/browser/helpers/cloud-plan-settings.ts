import type { Page } from '@playwright/test';

/** Follow the Settings account entry, preserving native-page and browser-panel behavior. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = page.locator('[data-settings-page]:not([inert])').last();
  await current.getByRole('button', { name: 'Eliza Cloud', exact: true }).click({ timeout: 5000 });
}
