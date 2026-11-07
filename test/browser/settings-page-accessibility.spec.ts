import {test, expect} from '@playwright/test';

for (const mode of ['mock', 'dev']) {
 test(`${mode} Settings hides covered pages and restores keyboard focus`, async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto(`/?mode=${mode}`);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  if(mode==='dev'){
   // The first permission read inserts this row before About. Start the keyboard
   // navigation check after the fresh profile's Settings rows have arrived.
   await expect(page.getByRole('button', {name:'Finish setup', exact:true})).toBeVisible();
   await expect(page.getByRole('button', {name:'Models', exact:true})).toHaveCount(0);
   await expect(page.getByRole('button', {name:'Accounts', exact:true})).toHaveCount(0);
  }
  const first = page.getByRole('button', {name:mode==='dev'?'About':'Models', exact:true});
  await first.focus();
  await page.keyboard.press('Enter');
  const back = page.getByRole('button', {name:'Back to Settings', exact:true});
  await expect(back).toBeFocused();
  await expect(page.getByRole('button', {name:mode==='dev'?'Agent':'Accounts', exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'Settings', exact:true})).toHaveCount(0);
  await expect(page.locator('[data-settings-page="Settings"]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[inert]'))).toBe(false);
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(first).toBeFocused();
  await expect(page.getByRole('button', {name:mode==='dev'?'Agent':'Accounts', exact:true})).toBeVisible();
  if (mode === 'dev') {
   const password = page.getByRole('button', {name:'Passwords', exact:true});
   await password.focus(); await page.keyboard.press('Enter');
   await expect(back).toBeFocused();
   await expect(page.getByRole('button', {name:'About', exact:true})).toHaveCount(0);
   await page.keyboard.press('Enter');
   await expect(password).toBeFocused();
   const calendar=page.getByRole('button',{name:'Calendars',exact:true});await calendar.focus();await page.keyboard.press('Enter');await expect(back).toBeFocused();await expect(page.getByRole('heading',{name:'Calendars',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'About',exact:true})).toHaveCount(0);await page.keyboard.press('Enter');await expect(calendar).toBeFocused();
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
