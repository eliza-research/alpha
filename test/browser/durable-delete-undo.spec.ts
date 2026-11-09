import {chooseCalendarEventAction} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'UTC'});
async function openReminder(page:any){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.install({time:new Date('2027-03-13T00:00Z')});await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).waitFor();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'undo-fixture',title:'Exact Undo reminder',body:'Retained body',at:Date.parse('2027-03-13T14:00Z')});});
 await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Exact Undo reminder,/}).click();
}
const read=(page:any)=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!));
for(const mode of ['undo','expire','restart'])test(`real reminder deletion review and durable ${mode}`,async({page})=>{
 await openReminder(page);const before=(await read(page)).reminders[0];
 await chooseCalendarEventAction(page, 'Delete event');
 const review=page.getByRole('dialog',{name:'Delete reminder?',exact:true});await expect(review).toBeVisible();
 await review.getByRole('button',{name:'Delete reminder',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Pending deletions'});await expect(panel.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 let stored=await read(page);expect(stored.reminders[0].status).toBe('scheduled');expect(stored.reminders[0].pendingDeletion).toBeTruthy();expect(stored.reminders[0].occurrenceId).toBe(before.occurrenceId);
 if(mode==='restart'){await page.reload();await expect(panel.getByText(/Deletion paused/)).toBeVisible();await page.clock.fastForward(12000);expect((await read(page)).reminders[0].status).toBe('scheduled');}
 if(mode==='expire'){
  await page.clock.fastForward(11000);await expect.poll(async()=>(await read(page)).reminders[0].status).toBe('cancelled');await expect(panel.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0);
 }else{
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await read(page)).reminders[0].pendingDeletion).toBe(undefined);
  stored=await read(page);expect(stored.reminders[0]).toEqual(before);await page.clock.fastForward(12000);expect((await read(page)).reminders[0]).toEqual(before);
 }
});

test('unknown deletion receipt can refresh and dismiss without changing or retrying the item',async({page})=>{
 await openReminder(page);const before=(await read(page)).reminders[0];
 await chooseCalendarEventAction(page, 'Delete event');
 await page.getByRole('dialog',{name:'Delete reminder?',exact:true}).getByRole('button',{name:'Delete reminder',exact:true}).click();
 await page.evaluate(async()=>{const {reminderDocument}=await import('/src/browser/reminder-store.ts');await reminderDocument.edit(()=>({}),data=>{const entry=Object.values(data.deletions)[0] as any;entry.phase='unknown';delete data.reminders[0].pendingDeletion;});window.dispatchEvent(new Event('alpha:deletions-changed'));});
 const panel=page.getByRole('complementary',{name:'Pending deletions'});
 await expect(panel.getByRole('button',{name:'Refresh receipt'})).toBeVisible();
 await panel.getByRole('button',{name:'Refresh receipt'}).click();
 expect((await read(page)).reminders[0]).toEqual(before);
 await panel.getByRole('button',{name:'Dismiss outcome'}).click();
 await expect(panel.getByRole('button',{name:'Dismiss outcome'})).toHaveCount(0);
 await page.reload();await page.clock.fastForward(12000);
 const saved=await read(page),entry:any=Object.values(saved.deletions)[0];
 expect(entry.phase).toBe('unknown');expect(entry.acknowledged).toBe(true);expect(saved.reminders[0]).toEqual(before);
 await expect(panel.getByRole('button',{name:'Dismiss outcome'})).toHaveCount(0);
});
