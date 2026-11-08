import type { Page } from '@playwright/test';

/** Open the account panel from grouped production Settings. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = page.locator('[data-settings-page]:not([inert])').last();
  await current.getByRole('button', { name: 'Account & plan', exact: true }).click({ timeout: 5000 });
}
