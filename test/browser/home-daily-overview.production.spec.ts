import {test,expect} from '@playwright/test';
import {fenceNetwork} from './flag-off-android';
// Production lane (flag-off build, mocks unset): the daily overview on a fresh profile with no
// account. Empty widgets, avatars and fixture content are absent; the app grid still opens
// Workflows without inventing results, and loading Home makes no
// request beyond the app's own origin.

test('fresh Home hides empty widgets without fixture content or outside requests',async({page},info)=>{
 const errors:string[]=[],outside=await fenceNetwork(page);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 const home=page.getByRole('region',{name:'Home',exact:true});
 await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
 for(const selector of ['[data-alpha-home-calendar]','[data-alpha-home-workflows]','[data-alpha-home-inbox]','[data-alpha-home-brief]'])await expect(home.locator(selector)).toHaveCount(0);
 await expect(page.getByRole('img',{name:'Has a meeting link'})).toHaveCount(0);
 await expect(home).not.toContainText(/Nothing planned|No upcoming events|No brief yet|Open to view|unread|Accounts are not connected/);
 await expect(home).not.toContainText(/Morning brief|Design review|7:02 AM/);
 await expect(home.getByText(/^(MC|JP|PN|\+2)$/)).toHaveCount(0);
 await page.waitForTimeout(1500);
 expect(outside).toEqual([]);
 expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('home-overview-production.png'),animations:'disabled'});
 // The app remains reachable without an empty Home card.
 const workflows=home.getByRole('button',{name:'Workflows',exact:true});
 await expect(workflows).toBeVisible();
 await workflows.click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');
 await expect(page.getByRole('dialog',{name:'Scheduled digests',exact:true})).toHaveCount(0);
});
