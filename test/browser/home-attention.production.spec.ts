import { test, expect } from '@playwright/test';
// Production lane (flag-off build, mocks unset). Home's Inbox card shows an honest state: no
// provider is connected in a fresh browser profile. The connected Inbox state of this card is
// exercised with development data in home-attention.spec.ts until a provider adapter reports
// through setHomeSources() in this lane. The fresh brief and calendar cards are covered in
// home-daily-overview.production.spec.ts.
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

test('unconnected Home hides empty widgets and Google setup in Settings', async ({ page }, info) => {
 const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(offline);await page.goto('/');
 const home=page.getByRole('region',{name:'Home',exact:true});await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
 await expect(home.locator('[data-alpha-home-inbox]')).toHaveCount(0);await expect(home).not.toContainText(/unread|Accounts are not connected/);
 await page.screenshot({path:info.outputPath('home-not-connected.png')});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Account',exact:true}).click();await expect(page.getByRole('button',{name:'Google & email',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('unloaded workflows and calendar stay hidden without fabricating data or avatars',async({page})=>{
 await page.addInitScript(offline);await page.goto('/');const home=page.getByRole('region',{name:'Home',exact:true});
 for(const selector of ['[data-alpha-home-workflows]','[data-alpha-home-calendar]'])await expect(home.locator(selector)).toHaveCount(0);
 await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);await expect(home.getByText(/^(MC|JP|\+2)$/)).toHaveCount(0);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
});
