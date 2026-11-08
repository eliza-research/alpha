import {test,expect} from '@playwright/test';
// Production lane (flag-off build, mocks unset): the daily overview on a fresh profile with no
// account. Nothing has something to show, so Home draws no card and shows the date line; offline,
// Google is not known to be disconnected, so there is no Connect Google. No fixture content is
// present, and loading Home makes no request beyond the app's own origin (docs/daily-overview.md).
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'production', 'Runs against the flag-off production build only'); });

test('fresh Home shows the date line, no cards, no fixture content and no outside request',async({page},info)=>{
 const errors:string[]=[],outside:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))outside.push(request.url());});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 const home=page.getByRole('region',{name:'Home',exact:true});
 const date=home.locator('[data-alpha-home-date]');
 await expect(date).toBeVisible();
 expect(((await date.textContent())||'').trim()).toBe(await page.evaluate(()=>new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date())));
 await expect(date.getByRole('button',{name:'Connect Google',exact:true})).toHaveCount(0);
 // No verified calendar read, no list and no mail: no card and no placeholder for any of them.
 for(const card of ['[data-alpha-home-calendar]','[data-alpha-home-workflows]','[data-alpha-home-inbox]','[data-alpha-home-brief]'])await expect(home.locator(card)).toHaveCount(0);
 await expect(home).not.toContainText(/Nothing planned|No upcoming events|Calendar has not been verified|Connect email|Set up Gmail|Open to view|Loading events|Updated|Read at/);
 await expect(home).not.toContainText(/Morning brief|Design review|7:02 AM|No brief yet/);
 await expect(home.getByText(/^(MC|JP|PN|\+2)$/)).toHaveCount(0);
 await page.waitForTimeout(1500);
 expect(outside).toEqual([]);
 expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('home-overview-production.png'),animations:'disabled'});
});
