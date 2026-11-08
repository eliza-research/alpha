import {test, expect} from '@playwright/test';

for (const mode of ['mock', 'dev']) {
 test(`${mode} Settings hides covered pages and restores keyboard focus`, async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto(`/?mode=${mode}`);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  const current=()=>page.locator('[data-settings-page]:not([inert])').last();
  if(mode==='dev')await current().getByRole('button',{name:'General',exact:true}).click();
  const display=current().getByRole('button',{name:'Display',exact:true});
  await display.focus();await display.press('Enter');
  const parentLabel=mode==='dev'?'Back to General':'Back to Settings';
  const back=page.getByRole('button',{name:parentLabel,exact:true});
  await expect(back).toBeFocused();
  await expect(page.locator('[data-settings-page="Settings"]')).toHaveAttribute('inert','');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>!!document.activeElement?.closest('[inert]'))).toBe(false);
  await back.focus();await back.press('Enter');await expect(display).toBeFocused();
  if(mode==='dev'){
   await current().getByRole('button',{name:'Back to Settings',exact:true}).click();
   await current().getByRole('button',{name:'Apps',exact:true}).click();
   for(const label of ['Passwords','Calendar']){
    const entry=current().getByRole('button',{name:label,exact:true});
    await entry.focus();await entry.press('Enter');
    const parent=page.getByRole('button',{name:'Back to Apps',exact:true});
    await expect(parent).toBeFocused();
    await expect(page.getByRole('button',{name:'About',exact:true})).toHaveCount(0);
    if(label==='Calendar')await expect(page.getByRole('button',{name:'Google Calendar',exact:true})).toBeVisible();
    await parent.press('Enter');await expect(entry).toBeFocused();
   }
  }else{
   const accounts=current().getByRole('button',{name:'Accounts',exact:true});
   await accounts.focus();await accounts.press('Enter');
   const add=page.getByRole('button',{name:'Add account',exact:true});await add.focus();await add.press('Enter');
   const parent=page.getByRole('button',{name:'Back to Accounts',exact:true});await expect(parent).toBeFocused();
   await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toHaveCount(0);
   await parent.press('Enter');await expect(add).toBeFocused();
   await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await expect(accounts).toBeFocused();
  }
 });
}

test('developer-only Settings rows appear only with ?tools=1 on the development server', async ({page}) => {
 await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
 const open = async (query: string) => { await page.goto(`/${query}`); await page.getByRole('button', {name:'Settings', exact:true}).first().click(); await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings'); };
 await open('');
 await page.getByRole('button',{name:'General',exact:true}).click();
 for (const name of ['Developer', 'Try mock mode']) await expect(page.getByRole('button', {name, exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await page.getByRole('button', {name:'About', exact:true}).click();
 await expect(page.getByText('Update channel (development)', {exact:true})).toHaveCount(0);
 await page.getByRole('button', {name:'Back to Settings', exact:true}).click();
 await page.getByRole('button',{name:'Apps',exact:true}).click();
 await page.getByRole('button', {name:'Calendar', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toHaveCount(0);
 await open('?tools=1');
 await page.getByRole('button',{name:'General',exact:true}).click();
 for (const name of ['Developer', 'Try mock mode']) await expect(page.getByRole('button', {name, exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await page.getByRole('button', {name:'About', exact:true}).click();
 await expect(page.getByText('Update channel (development)', {exact:true})).toBeVisible();
 await page.getByRole('button', {name:'Back to Settings', exact:true}).click();
 await page.getByRole('button',{name:'Apps',exact:true}).click();
 await page.getByRole('button', {name:'Calendar', exact:true}).click();
 await expect(page.getByText('Calendar backups', {exact:true})).toBeVisible();
});


test('development Problem log restores focus to About', async ({page}) => {
 await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.getByRole('button', {name:'Settings', exact:true}).click();
 const about=page.getByRole('button', {name:'About', exact:true});
 await about.focus();await about.press('Enter');
 const problems=page.getByRole('button', {name:'Problem log', exact:true});
 await problems.focus();await problems.press('Enter');
 const parent=page.getByRole('button', {name:'Back to About', exact:true});
 await expect(parent).toBeFocused();
 await expect(page.getByRole('button', {name:'Back to Settings', exact:true})).toHaveCount(0);
 await parent.press('Enter');await expect(problems).toBeFocused();
 await page.getByRole('button', {name:'Back to Settings', exact:true}).press('Enter');
 await expect(about).toBeFocused();
});
