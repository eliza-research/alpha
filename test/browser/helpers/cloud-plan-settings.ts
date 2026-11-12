import { expect, type Page } from '@playwright/test';

/** The Settings header opens the same Account sheet used by startup. */
export async function openCloudPlanFromSettings(page: Page) {
  const sheet=page.getByRole('dialog',{name:'Account',exact:true});
  if(!await sheet.isVisible()){
    const account=page.getByRole('button',{name:'Account',exact:true}).filter({visible:true});
    for(const name of ['Back to General','Back to Settings']){
      const back=page.getByRole('button',{name,exact:true}).filter({visible:true});
      if(!await account.count()&&await back.count())await back.click();
    }
    await account.click();
  }
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function confirmCloudSignOut(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Sign out?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
}
