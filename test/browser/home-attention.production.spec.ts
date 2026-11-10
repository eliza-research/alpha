import { test, expect } from '@playwright/test';
// Production lane (flag-off build, mocks unset). Unconnected or empty Home widgets are hidden.
// Connection setup and the apps remain reachable without fabricating provider rows.
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

test('unconnected Home hides empty widgets and keeps sign-in reachable', async ({ page }, info) => {
 const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(offline);await page.goto('/');
 const home=page.getByRole('region',{name:'Home',exact:true});await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
 await expect(home.locator('[data-alpha-home-inbox]')).toHaveCount(0);await expect(home).not.toContainText(/unread|Accounts are not connected/);
 await page.screenshot({path:info.outputPath('home-not-connected.png')});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Account',exact:true}).click();await expect(page.getByRole('dialog',{name:'Welcome to Alpha.',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('unloaded workflows and calendar stay hidden without fabricating data or avatars',async({page})=>{
 await page.addInitScript(offline);await page.goto('/');const home=page.getByRole('region',{name:'Home',exact:true});
 for(const selector of ['[data-alpha-home-workflows]','[data-alpha-home-calendar]','[data-alpha-home-inbox]','[data-alpha-home-brief]'])await expect(home.locator(selector)).toHaveCount(0);
 await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);await expect(home.getByText(/^(MC|JP|\+2)$/)).toHaveCount(0);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
});
