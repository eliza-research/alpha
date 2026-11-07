import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
// Each step re-enters Settings and Calendar. Their 460ms entry animation is not under test here,
// and clicking during it waits out Playwright's stability retries on every step.
test.use({contextOptions:{reducedMotion:'reduce'}});
async function open(page:any){await page.goto('/?mode=dev');await openBrowserCalendar(page);await page.getByRole('button',{name:'Month view',exact:true}).click();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!localStorage.getItem('alpha.browser.calendar.v1')){const start=new Date();start.setHours(12,0,0,0);(localStorage.getItem('alpha.browser.calendar.v1')===null&&localStorage.setItem('alpha.browser.calendar.v1',JSON.stringify({sourceRevision:'a'.repeat(64),events:[{id:'prefs-event',calendarId:'local',title:'Preference event',body:'',location:'',begin:+start,end:+start+3600000,revision:'b'.repeat(64)}]})));}});});
// Per-source visibility/color Settings controls were removed by the one-Calendar
// contract. Their canonical replacement is covered in one-calendar.spec.ts;
// these historical browser-provider cases keep the month-dialog accessibility checks.
for(const date of ['2026-02-15T12:00:00Z','2026-08-15T12:00:00Z'])test(`month dialog closes and restores the toggle for pointer and keyboard at large text: ${date}`,async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await page.clock.install({time:new Date(date)});await open(page);
 await expect(page.getByRole('switch')).toHaveCount(0);await expect(page.getByRole('button',{name:/Change .* calendar color/})).toHaveCount(0);
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 const toggle=page.getByRole('button',{name:'Month view',exact:true}),dialog=page.getByRole('dialog',{name:'Choose calendar date'});
 await expect(dialog).toBeVisible();await expect(toggle).toHaveCount(0);
 await page.screenshot({path:info.outputPath('month-open-large-text.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'Close month',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
 await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await expect(toggle).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
});
