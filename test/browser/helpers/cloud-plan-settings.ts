import type { Page } from '@playwright/test';

/** Follow the production Settings path: the Eliza Cloud row at the top of Settings. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = page.locator('[data-settings-page]:not([inert])').last();
  await current.getByRole('button', { name: 'Eliza Cloud', exact: true }).click({ timeout: 5000 });
}
