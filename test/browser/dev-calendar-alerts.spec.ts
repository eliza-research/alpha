import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({context})=>guardNoMedia(context));
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&tools=1');});
async function notices(page:Page){return page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNotifications').list()).items.filter((n:any)=>n.id.startsWith('calendar:'));});}
test('rendered Calendar alert becomes due and opens the exact event from the shade',async({page})=>{
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Alert event');await page.getByRole('button',{name:'10 min',exact:true}).click();await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);const row=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0]);expect(row.alert).toBe(10);expect(await notices(page)).toEqual([]);await page.clock.setFixedTime(new Date(row.begin-600000));await returnToApps(page);await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Open Alert event',exact:true}).click();await expect(page.getByRole('button',{name:'Back to calendar',exact:true})).toBeVisible();await expect.poll(()=>notices(page)).toEqual([]);await page.reload();expect(await notices(page)).toEqual([]);
});
test('repeating alerts dismiss only one date and title changes do not replay dismissed schedules',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Daily alert',body:'',location:'',begin:Date.now(),end:Date.now()+3600000,repeat:'daily',timeZone:'UTC',alert:0});});const [first]=await notices(page);expect(first).toBeTruthy();await page.evaluate(async(notice)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaNotifications').dismiss(notice);const cal=registerPlugin<any>('AlphaCalendar'),row=(await cal.list({begin:Date.now()-1,end:Date.now()+1})).events[0];await cal.save({...row,expected:row,title:'Renamed alert'});},first);expect(await notices(page)).toEqual([]);await page.clock.setFixedTime(new Date('2026-10-03T12:00:00Z'));const next=await notices(page);expect(next).toHaveLength(1);expect(next[0].id).not.toBe(first.id);
});
test('rescheduling invalidates stale alerts and the Calendar channel suppresses delivery',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Changed alert',body:'',location:'',begin:Date.now(),end:Date.now()+3600000,alert:0});});const [old]=await notices(page);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const cal=registerPlugin<any>('AlphaCalendar'),row=JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0];await cal.save({...row,expected:row,begin:row.begin+3600000,end:row.end+3600000});});expect(await notices(page)).toEqual([]);expect(await page.evaluate(async(old)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');try{await registerPlugin<any>('AlphaNotifications').open(old);return false;}catch{return true;}},old)).toBe(true);await page.clock.setFixedTime(new Date('2026-10-02T13:00:00Z'));expect(await notices(page)).toHaveLength(1);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaNotifications').openChannelSettings({id:'calendar'});});const dialog=page.getByRole('dialog',{name:'Calendar notifications'});await dialog.getByRole('checkbox',{name:'Show calendar alerts'}).uncheck();await dialog.getByRole('button',{name:'Done',exact:true}).click();expect(await notices(page)).toEqual([]);
});
for(const {zone,timeZone,due} of [
 {zone:'America/Los_Angeles',due:'2027-03-13T08:00:00Z'},
 {zone:'Asia/Tokyo',due:'2027-03-12T15:00:00Z'},
 {zone:'UTC',timeZone:'Pacific/Kiritimati',due:'2027-03-12T10:00:00Z'},
])test.describe(timeZone??zone,()=>{
 test.use({timezoneId:zone});
 test('all-day alert starts at civil midnight and stays dismissed after reload',async({page})=>{
  const at=Date.parse(due);
  await page.clock.setFixedTime(new Date(at-1));
  await page.evaluate(async timeZone=>{
   const {registerPlugin}=await import('/src/platform-plugins.ts');
   await registerPlugin<any>('AlphaCalendar').save({
    creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Civil-date alert',
    allDay:true,begin:Date.parse('2027-03-13T00:00Z'),end:Date.parse('2027-03-14T00:00Z'),timeZone,alert:0,
   });
  },timeZone);
  expect(await notices(page)).toEqual([]);
  await page.clock.setFixedTime(new Date(at));
  const dueNotices=await notices(page);
  expect(dueNotices).toHaveLength(1);
  expect(dueNotices[0]).toMatchObject({title:'Civil-date alert',at});
  await page.evaluate(async notice=>{
   const {registerPlugin}=await import('/src/platform-plugins.ts');
   await registerPlugin<any>('AlphaNotifications').dismiss(notice);
  },dueNotices[0]);
  await page.reload();
  expect(await notices(page)).toEqual([]);
 });
});
test('failed dismissal preserves the active alert and deletion removes it without a stale open',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Durable alert',body:'',location:'',begin:Date.now(),end:Date.now()+3600000,alert:0});});const [notice]=await notices(page);expect(await page.evaluate(async(notice)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.calendar.v1')throw Error('Full');return original.call(this,value,key);};try{await registerPlugin<any>('AlphaNotifications').dismiss(notice);return false;}catch{return true;}finally{IDBObjectStore.prototype.put=original;}},notice)).toBe(true);expect(await notices(page)).toHaveLength(1);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const row=JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0];(window as any).removal=registerPlugin<any>('AlphaCalendar').remove({...row,expected:row});});await page.getByRole('dialog',{name:'Delete calendar event?'}).getByRole('button',{name:'Delete event',exact:true}).click();expect(await page.evaluate(async()=>(await (window as any).removal).status)).toBe('queued');await expect.poll(()=>notices(page),{timeout:15000}).toEqual([]);expect(await page.evaluate(async(notice)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');try{await registerPlugin<any>('AlphaNotifications').open(notice);return false;}catch{return true;}},notice)).toBe(true);
});

test('damaged Calendar data does not block other notices and exposes an actionable warning',async({page})=>{
 await page.clock.setFixedTime(new Date('2027-03-13T12:00:00Z'));
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'healthy-notice',title:'Healthy reminder',at:Date.now()+1000});await (async(raw:string)=>{const {browserDocuments}=await import('/src/browser/documents.ts');await browserDocuments.edit('alpha.browser.calendar.v1',async before=>({raw:JSON.stringify({...before?JSON.parse(before.raw!):{version:1,legacy:localStorage.getItem('alpha.browser.calendar.v1')},value:raw}),result:undefined}));})('{damaged calendar');});await page.clock.setFixedTime(new Date('2027-03-13T12:00:02Z'));
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaNotifications').list();});expect(result.calendarStatus).toBe('unavailable');expect(result.items.map((n:any)=>n.title)).toContain('Healthy reminder');await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByText('Calendar alerts could not load. Open Calendar to review the problem.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open Healthy reminder',exact:true})).toBeVisible();expect(await page.evaluate(async ()=>(await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw()))).toBe('{damaged calendar');
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaNotifications').dismiss((await registerPlugin<any>('AlphaNotifications').list()).items.find((n:any)=>n.id==='healthy-notice'));});expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNotifications').list()).items;})).toEqual([]);
});
