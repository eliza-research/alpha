import type { Page } from '@playwright/test';

/** Follow the production Settings path through the Accounts page. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = page.locator('[data-settings-page]:not([inert])').last();
  await current.getByRole('button', { name: 'Accounts', exact: true }).click({ timeout: 5000 });
  await current.getByRole('button', { name: 'Eliza Cloud account & plan', exact: true }).click({ timeout: 5000 });
}
