import { expect, type Page } from '@playwright/test';

/** The Settings header opens the same Account sheet used by startup. */
export async function openCloudPlanFromSettings(page: Page) {
  const sheet=page.getByRole('dialog',{name:'Account',exact:true});
  if(!await sheet.isVisible())await page.getByRole('button',{name:'Account',exact:true}).filter({visible:true}).click();
  await expect(sheet).toBeVisible();
}
