import type { Page } from '@playwright/test';

/** Open the account panel from grouped production Settings. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = () => page.locator('[data-settings-page]:not([inert])').last();
  if (!await current().getByRole('button', { name: 'Account & plan', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Account', exact: true }).filter({visible:true}).click();
  }
  await current().getByRole('button', { name: 'Account & plan', exact: true }).click({ timeout: 5000 });
}
