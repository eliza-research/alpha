import { expect, type Page } from '@playwright/test';

/** The Settings header opens the same Account sheet used by startup. */
export async function openCloudPlanFromSettings(page: Page) {
  const sheet=page.getByRole('dialog',{name:'Account',exact:true});
  if(!await sheet.isVisible())await page.getByRole('button',{name:'Account',exact:true}).filter({visible:true}).click();
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function confirmCloudSignOut(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Sign out?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
}
