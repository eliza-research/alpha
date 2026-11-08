import {test,expect} from '@playwright/test';
import {fenceNetwork} from './flag-off-android';
// Production lane (flag-off build, mocks unset): the daily overview on a fresh profile with no
// account. The calendar card reports its unverified source, no brief card, avatar or fixture content is
// present, the Workflows card opens Workflows without inventing results, and loading Home makes no
// request beyond the app's own origin.

test('fresh Home shows honest widget shells without fixture content or outside requests',async({page},info)=>{
 const errors:string[]=[],outside=await fenceNetwork(page);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 const home=page.getByRole('region',{name:'Home',exact:true}),calendar=home.locator('[data-alpha-home-calendar]');
 await expect(home.locator('[data-alpha-home-date]')).toHaveCount(0);
 for(const selector of ['[data-alpha-home-calendar]','[data-alpha-home-workflows]','[data-alpha-home-inbox]','[data-alpha-home-brief]'])await expect(home.locator(selector)).toBeVisible();
 await expect(calendar).not.toContainText(/Nothing planned|No upcoming events|Updated|Read at/);
 await expect(calendar.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
 await expect(calendar.locator('[data-alpha-home-calendar-origin]')).toHaveText('');
 await expect(calendar).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 await expect(calendar).toHaveAttribute('data-alpha-home-calendar-event','false');
 await expect(page.getByRole('img',{name:'Has a meeting link'})).toHaveCount(0);
 await expect(home.locator('[data-alpha-home-brief]')).toContainText('No brief yet');
 await expect(home.locator('[data-alpha-home-inbox]')).not.toContainText(/unread|Read \d/);
 await expect(home).not.toContainText(/Morning brief|Design review|7:02 AM/);
 await expect(home.getByText(/^(MC|JP|PN|\+2)$/)).toHaveCount(0);
 await page.waitForTimeout(1500);
 expect(outside).toEqual([]);
 expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('home-overview-production.png'),animations:'disabled'});
 // No workflow has loaded: the card offers to open Workflows rather than showing a result.
 const workflows=page.getByRole('button',{name:'Open workflows and automations',exact:true});
 await expect(workflows).toContainText('Workflows');
 await expect(workflows).toContainText('Open to view');
 await workflows.click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');
});
