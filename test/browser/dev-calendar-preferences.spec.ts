import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';
async function open(page:any){await page.goto('/?mode=dev');await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Calendar views',exact:true}).click();}
async function sources(page:any){await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();await expect(page.getByText('Agent access is reviewed separately',{exact:true})).toBeVisible();}
async function timeline(page:any){await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await returnToApps(page);await page.getByRole('button',{name:'Calendar',exact:true}).click();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!localStorage.getItem('alpha.browser.calendar.v1')){const start=new Date();start.setHours(12,0,0,0);(localStorage.getItem('alpha.browser.calendar.v1')===null&&localStorage.setItem('alpha.browser.calendar.v1',JSON.stringify({sourceRevision:'a'.repeat(64),events:[{id:'prefs-event',calendarId:'local',title:'Preference event',body:'',location:'',begin:+start,end:+start+3600000,revision:'b'.repeat(64)}]})));}});});
test('calendar visibility and color affect the timeline and persist across reload',async({page})=>{
 await sources(page);const toggle=page.getByRole('switch',{name:'Show In this app calendar',exact:true});await expect(toggle).toHaveAttribute('aria-checked','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');await timeline(page);await expect(page.getByRole('button',{name:/^Preference event,/})).toHaveCount(0);
 await sources(page);await expect(toggle).toHaveAttribute('aria-checked','false');await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');await page.getByRole('button',{name:'Change In this app calendar color',exact:true}).click();await expect.poll(()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).preferences.color)).toBe('fg');await timeline(page);const event=page.getByRole('button',{name:/^Preference event,/});await expect(event).toBeVisible();await expect(event.locator('span').first()).toHaveAttribute('style',/background: var\(--fg\)/);
 await sources(page);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).preferences)).toEqual({visible:true,color:'fg'});
});
test('calendar preferences synchronize across tabs and failed writes preserve saved controls',async({page,context})=>{
 await sources(page);const other=await context.newPage();await sources(other);const toggle=other.getByRole('switch',{name:'Show In this app calendar',exact:true});await page.getByRole('switch',{name:'Show In this app calendar',exact:true}).click();await expect(toggle).toHaveAttribute('aria-checked','false');await other.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.calendar.v1')throw Error('Full');return original.call(this,value,key);};});await toggle.click();await expect(other.getByText('Calendar settings could not be saved. Try again.',{exact:true})).toBeVisible();await expect(toggle).toHaveAttribute('aria-checked','false');expect(await other.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).preferences.visible)).toBe(false);await other.close();
});

test('the views menu switch hides and shows the browser calendar on the timeline',async({page})=>{
 await open(page);const dialog=page.getByRole('dialog',{name:'Views and calendars'}),toggle=dialog.getByRole('switch',{name:'Show In this app calendar',exact:true});
 await expect(toggle).toHaveAttribute('aria-checked','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^Preference event,/})).toHaveCount(0);
 await page.getByRole('button',{name:'Calendar views',exact:true}).click();await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^Preference event,/})).toBeVisible();
});

for(const date of ['2026-02-15T12:00:00Z','2026-08-15T12:00:00Z'])test(`views menu closes and restores the title for pointer and keyboard at large text: ${date}`,async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await page.clock.install({time:new Date(date)});await open(page);
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 const toggle=page.getByRole('button',{name:'Calendar views',exact:true}),dialog=page.getByRole('dialog',{name:'Views and calendars'});
 await expect(dialog).toBeVisible();await expect(toggle).toHaveCount(0);
 for(const name of ['Schedule','Day','Week','Month']){const item=dialog.getByRole('radio',{name,exact:true});await expect(item).toBeVisible();expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
 await page.screenshot({path:info.outputPath('views-menu-large-text.png'),animations:'disabled'});
 // A tap outside the menu closes it.
 await page.mouse.click(350,630);await expect(dialog).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
 await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await expect(toggle).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
});
