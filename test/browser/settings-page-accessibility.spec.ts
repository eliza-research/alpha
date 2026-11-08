import {test, expect} from '@playwright/test';

for (const mode of ['mock', 'dev']) {
 test(`${mode} Settings hides covered pages and restores keyboard focus`, async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto(`/?mode=${mode}`);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  const models = page.getByRole('button', {name:'Models', exact:true});
  await models.focus();
  await page.keyboard.press('Enter');
  const back = page.getByRole('button', {name:'Back to Settings', exact:true});
  await expect(back).toBeFocused();
  await expect(page.getByRole('button', {name:'Accounts', exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'Settings', exact:true})).toHaveCount(0);
  await expect(page.locator('[data-settings-page="Settings"]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[inert]'))).toBe(false);
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(models).toBeFocused();
  await expect(page.getByRole('button', {name:'Accounts', exact:true})).toBeVisible();
  if (mode === 'dev') {
   const password = page.getByRole('button', {name:'Password manager', exact:true});
   await password.focus(); await page.keyboard.press('Enter');
   await expect(back).toBeFocused();
   await expect(page.getByRole('button', {name:'Models', exact:true})).toHaveCount(0);
   await page.keyboard.press('Enter');
   await expect(password).toBeFocused();
   const calendar=page.getByRole('button',{name:'Calendar',exact:true});await calendar.focus();await page.keyboard.press('Enter');await expect(back).toBeFocused();await expect(page.getByRole('button',{name:'Google Calendar',exact:true})).toBeVisible();await expect(page.getByText('Display only',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Models',exact:true})).toHaveCount(0);await page.keyboard.press('Enter');await expect(calendar).toBeFocused();
  } else {
   const accounts = page.getByRole('button', {name:'Accounts', exact:true});
   await accounts.focus(); await page.keyboard.press('Enter');
   const add = page.getByRole('button', {name:'Add account', exact:true});
   await add.focus(); await page.keyboard.press('Enter');
   const parent = page.getByRole('button', {name:'Back to Accounts', exact:true});
   await expect(parent).toBeFocused();
   await expect(back).toHaveCount(0);
   await page.keyboard.press('Enter');
   await expect(add).toBeFocused();
   await back.click(); await expect(accounts).toBeFocused();
  }
 });
}

test('developer-only Settings rows appear only with ?tools=1 on the development server', async ({page}) => {
 await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
 const open = async (query: string) => { await page.goto(`/${query}`); await page.getByRole('button', {name:'Settings', exact:true}).first().click(); await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings'); };
 await open('');
 for (const name of ['Developer', 'Try mock mode']) await expect(page.getByRole('button', {name, exact:true})).toHaveCount(0);
 await page.getByRole('button', {name:'About', exact:true}).click();
 await expect(page.getByText('Update channel (development)', {exact:true})).toHaveCount(0);
 await page.getByRole('button', {name:'Back to Settings', exact:true}).click();
 await page.getByRole('button', {name:'Calendar', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toHaveCount(0);
 await open('?tools=1');
 for (const name of ['Developer', 'Try mock mode']) await expect(page.getByRole('button', {name, exact:true})).toBeVisible();
 await page.getByRole('button', {name:'About', exact:true}).click();
 await expect(page.getByText('Update channel (development)', {exact:true})).toBeVisible();
 await page.getByRole('button', {name:'Back to Settings', exact:true}).click();
 await page.getByRole('button', {name:'Calendar', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toBeVisible();
});
