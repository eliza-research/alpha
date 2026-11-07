import {openBrowserCalendar} from './helpers/browser-calendar';
import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'America/Los_Angeles'});
// The browser-provider source remains separate from Home's Agent Calendar agenda.
async function openSavedDay(page:any){
 await openBrowserCalendar(page);
 await page.getByRole('button',{name:'Month view',exact:true}).click();
 await page.getByRole('dialog',{name:'Choose calendar date',exact:true}).getByRole('button',{name:'Saturday March 13',exact:true}).click();
 await expect(page.getByRole('button',{name:'All-day boundary, All day',exact:true})).toBeVisible();
}
test.beforeEach(async({context})=>guardNoMedia(context));
for(const repeat of ['none','daily'] as const)test(`provider saves ${repeat} all-day events as exact UTC civil boundaries`,async({page})=>{
 await page.clock.setFixedTime(new Date('2027-03-12T12:00:00Z'));await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await openBrowserCalendar(page);
 const result=await page.evaluate(async repeat=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const cal=registerPlugin<any>('AlphaCalendar');const saved=await cal.save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'All-day boundary',body:'Retained details',location:'',allDay:true,begin:Date.parse('2027-03-13T00:00:00Z'),end:Date.parse('2027-03-14T00:00:00Z'),timeZone:'Pacific/Auckland',repeat});const rows=(await cal.list({begin:Date.parse('2027-03-13T00:00:00Z'),end:Date.parse('2027-03-16T00:00:00Z')})).events;return {saved,rows};},repeat);
 expect(result.rows).toHaveLength(repeat==='daily'?3:1);for(const row of result.rows){expect(row.allDay).toBe(true);expect(row.end-row.begin).toBe(86400000);expect(row.begin%86400000).toBe(0);}
 await page.reload();await openBrowserCalendar(page);const reopened=await page.evaluate(async id=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').open({id});},result.saved.id);expect(reopened).toEqual({status:'opened'});await expect(page.getByText('All day',{exact:true}).last()).toBeVisible();await expect(page.getByText('Retained details',{exact:true})).toBeVisible();await returnToApps(page);await openSavedDay(page);await page.clock.setFixedTime(new Date('2027-03-14T04:30:00Z'));await page.reload();await openSavedDay(page);await page.getByRole('button',{name:'All-day boundary, All day',exact:true}).click();await expect(page.getByText('All day',{exact:true}).last()).toBeVisible();await expect(page.getByText('Retained details',{exact:true})).toBeVisible();
});
test('invalid all-day types or non-midnight boundaries fail without storing an event',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await openBrowserCalendar(page);const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const cal=registerPlugin<any>('AlphaCalendar');await cal.prepareAgentSource();const before=(await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw());let rejected=0;for(const patch of [{allDay:'true'},{begin:Date.parse('2027-03-13T12:00:00Z')},{end:Date.parse('2027-03-14T12:00:00Z')}]){try{await cal.save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Invalid all-day',allDay:true,begin:Date.parse('2027-03-13T00:00:00Z'),end:Date.parse('2027-03-14T00:00:00Z'),...patch});}catch{rejected++;}}return {rejected,unchanged:before===(await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())};});expect(result).toEqual({rejected:3,unchanged:true});
});
