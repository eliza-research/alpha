import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
// Layout fixtures use UTC civil dates independently of the runner locale.
test.use({timezoneId:'UTC'});
for(const theme of ['light','dark'])for(const kind of ['event','reminder'])test(`calendar detail keeps long text readable: ${kind} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));
 const title='Reference-'+ 'abcdefghij'.repeat(6),body='First paragraph\n\nReference: '+ '0123456789'.repeat(12)+'\nLast paragraph';
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev&theme='+theme);
 await page.evaluate(async({kind,title,body})=>{const {registerPlugin}=await import('/src/platform-plugins.ts');if(kind==='event')await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title,body,location:'Building-'+ 'abcdef'.repeat(15),begin:Date.parse('2027-03-13T14:00Z'),end:Date.parse('2027-03-13T15:00Z')});else await registerPlugin<any>('DailyApps').scheduleReminder({id:'large-detail',title,body,at:Date.parse('2027-03-13T14:00Z')});const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});},{kind,title,body});
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'Day 13',exact:true}).click();await page.getByRole('button',{name:new RegExp('^Reference-')}).click();
 const heading=page.getByRole('heading',{name:title,exact:true});await expect(heading).toBeVisible();const detail=heading.locator('..');
 expect(await detail.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 const notes=page.getByText(kind==='reminder'?body+'\nScheduled · approximate delivery':body,{exact:true});await notes.scrollIntoViewIfNeeded();await expect(notes).toHaveCSS('white-space','pre-wrap');expect(await notes.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('description.png'),animations:'disabled'});
 if(kind==='reminder')for(const name of ['Complete reminder occurrence','Snooze reminder 10 minutes']){const action=page.getByRole('button',{name,exact:true});await action.scrollIntoViewIfNeeded();const box=await action.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);expect(box!.height).toBeGreaterThanOrEqual(44);await expect(action).toBeInViewport();}
 await heading.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('detail.png'),animations:'disabled'});await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await expect(heading).toHaveCount(0);
});
