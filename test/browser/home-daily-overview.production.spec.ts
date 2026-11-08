import {test,expect} from '@playwright/test';
// Production lane (flag-off build, mocks unset): the daily overview on a fresh profile with no
// account. The calendar card reports its unverified source, no brief card or fixture content is
// present, and loading Home makes no request beyond the app's own origin.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'production', 'Runs against the flag-off production build only'); });

test('fresh Home shows the date line and no placeholder cards, no fixture content and no outside request',async({page},info)=>{
 const errors:string[]=[],outside:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))outside.push(request.url());});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 const home=page.getByRole('region',{name:'Home',exact:true});
 // Nothing to show on a fresh profile (docs/ui-refresh-2026-11): no cards, only the date line. Connect
 // Google appears only once signed in to Eliza Cloud, which this offline profile is not.
 await expect(home.locator('[data-alpha-home-date]')).toBeVisible();
 await expect(home.getByRole('button',{name:'Connect Google',exact:true})).toHaveCount(0);
 for(const card of ['[data-alpha-home-calendar]','[data-alpha-home-workflows]','[data-alpha-home-inbox]','[data-alpha-home-brief]'])await expect(home.locator(card)).toHaveCount(0);
 await expect(home).not.toContainText(/No upcoming events|Set up Gmail|Connect email|Open to view|Loading/);
 await expect(home).not.toContainText(/Morning brief|Design review|7:02 AM|No brief yet/);
 await expect(home.getByText(/^(MC|JP|PN|\+2)$/)).toHaveCount(0);
 await page.waitForTimeout(1500);
 expect(outside).toEqual([]);
 expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('home-overview-production.png'),animations:'disabled'});
});
