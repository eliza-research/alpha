import {test, expect} from '@playwright/test';

for (const mode of ['mock', 'dev']) {
 test(`${mode} Settings hides covered pages and restores keyboard focus`, async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto(`/?mode=${mode}`);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  const about = page.getByRole('button', {name:'About', exact:true});
  await about.focus();
  await page.keyboard.press('Enter');
  const back = page.getByRole('button', {name:'Back to Settings', exact:true});
  await expect(back).toBeFocused();
  await expect(page.getByRole('button', {name:'Calendars', exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'Settings', exact:true})).toHaveCount(0);
  await expect(page.locator('[data-settings-page="Settings"]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[inert]'))).toBe(false);
  // A second level covers its parent the same way and gives focus back to the row that opened it.
  const problems = page.getByRole('button', {name:'Problem log', exact:true});
  await problems.focus(); await page.keyboard.press('Enter');
  const parent = page.getByRole('button', {name:'Back to About', exact:true});
  await expect(parent).toBeFocused();
  await expect(back).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(problems).toBeFocused();
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(about).toBeFocused();
  await expect(page.getByRole('button', {name:'Calendars', exact:true})).toBeVisible();
  const password = page.getByRole('button', {name:'Passwords', exact:true});
  await password.focus(); await page.keyboard.press('Enter');
  await expect(back).toBeFocused();
  await expect(page.getByRole('button', {name:'About', exact:true})).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(password).toBeFocused();
  const calendar=page.getByRole('button',{name:'Calendars',exact:true});await calendar.focus();await page.keyboard.press('Enter');await expect(back).toBeFocused();await expect(page.getByRole('button',{name:'Google Calendar',exact:true})).toBeVisible();await expect(page.getByText('Display only',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'About',exact:true})).toHaveCount(0);await page.keyboard.press('Enter');await expect(calendar).toBeFocused();
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
 await page.getByRole('button', {name:'Calendars', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toHaveCount(0);
 await open('?tools=1');
 for (const name of ['Developer', 'Try mock mode']) await expect(page.getByRole('button', {name, exact:true})).toBeVisible();
 await page.getByRole('button', {name:'About', exact:true}).click();
 await expect(page.getByText('Update channel (development)', {exact:true})).toBeVisible();
 await page.getByRole('button', {name:'Back to Settings', exact:true}).click();
 await page.getByRole('button', {name:'Calendars', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toBeVisible();
});
