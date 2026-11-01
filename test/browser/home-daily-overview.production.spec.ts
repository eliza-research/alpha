import {test,expect} from '@playwright/test';
// Production lane (flag-off build, mocks unset): the daily overview on a fresh profile with no
// account. The calendar card reports its unverified source, no brief card or fixture content is
// present, and loading Home makes no request beyond the app's own origin.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'production', 'Runs against the flag-off production build only'); });

test('fresh Home shows unverified Agent Calendar state, no brief card, no fixture content and no outside request',async({page},info)=>{
 const errors:string[]=[],outside:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))outside.push(request.url());});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 const home=page.getByRole('region',{name:'Home',exact:true}),calendar=page.locator('[data-alpha-home-calendar]');
 await expect(calendar.locator('[data-overview-part="title"]')).toHaveText('Calendar');
 await expect(calendar).not.toContainText('Nothing planned');
 await expect(calendar).not.toContainText('No upcoming events');
 await expect(calendar.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
 await expect(calendar.locator('[data-alpha-home-calendar-origin]')).toHaveText('');
 // Neutral startup does not claim a successful Calendar read or show a freshness timestamp.
 await expect(calendar).not.toContainText(/Updated|Read at/);
 await expect(calendar).toHaveAttribute('data-overview-state','empty');
 await expect(calendar).toHaveAccessibleName('Open Agent Calendar');
 await expect(calendar).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 await expect(home.locator('[data-alpha-home-brief]')).toHaveCount(0);
 const inbox=home.locator('[data-alpha-home-inbox]');
 await expect(inbox).toHaveAccessibleName('Inbox');
 await expect(inbox).not.toContainText(/unread|Read \d/);
 await expect(home).not.toContainText(/Morning brief|Design review|7:02 AM|No brief yet/);
 await expect(home.getByText(/^(MC|JP|PN|\+2)$/)).toHaveCount(0);
 await page.waitForTimeout(1500);
 expect(outside).toEqual([]);
 expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('home-overview-production.png'),animations:'disabled'});
});
