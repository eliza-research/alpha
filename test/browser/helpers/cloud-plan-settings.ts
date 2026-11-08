import { expect, type Page } from '@playwright/test';

/** Open the account panel from grouped production Settings. */
export async function openCloudPlanFromSettings(page: Page) {
  const current = () => page.locator('[data-settings-page]:not([inert])').last();
  if (!await current().getByRole('button', { name: 'Account & plan', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Account', exact: true }).filter({visible:true}).click();
  }
  const plan = current().getByRole('button', { name: 'Account & plan', exact: true });
  await expect(plan).toBeVisible({ timeout: 15_000 });
  await plan.click({ timeout: 15_000 });
}
