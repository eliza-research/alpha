// The agent review of an update to an all-day event with attendees: every line shown is what is
// saved. Source/test evidence for the browser build's Calendar plugin only (real BrowserCalendar,
// its store and its review dialog); no agent, account or device calendar is involved.
import {test,expect} from '@playwright/test';
const DAY=86400000,begin=Date.UTC(2027,2,1);
const seeded={sourceRevision:'b'.repeat(64),events:[{id:'all-day-event',calendarId:'local',title:'Harbour festival',body:'',location:'Quay',begin,end:begin+2*DAY,allDay:true,timeZone:'UTC',who:['Ana','Ben'],revision:'c'.repeat(64)}]};
const update=(start:number,end:number)=>({type:'calendar_update',target:{sourceId:'local',sourceRevision:seeded.sourceRevision,eventId:'all-day-event',revision:seeded.events[0].revision},fields:{title:'Harbour festival',description:'',location:'Quay',start:new Date(start).toISOString(),end:new Date(end).toISOString(),timeZone:'Asia/Tokyo'}});
const stored=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');return JSON.parse((await calendarDocument.readRaw())!).events as any[];});

test('an all-day update is reviewed as the dates and attendees that are saved, and instants that are not whole dates are refused unreviewed',async({page})=>{
 await page.addInitScript(seeded=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(localStorage.getItem('alpha.browser.calendar.v1')===null)localStorage.setItem('alpha.browser.calendar.v1',JSON.stringify(seeded));},seeded);
 await page.goto('/?mode=dev');
 const run=(id:string,operation:unknown)=>page.evaluate(async([id,operation])=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts');
  (window as any).calendarResult=undefined;void new BrowserCalendar().executeAgent({operationId:id as string,operation}).then(result=>{(window as any).calendarResult=result;});
 },[id,operation] as const);
 const result=()=>page.evaluate(()=>(window as any).calendarResult);
 const review=page.getByRole('dialog',{name:'Review calendar change'});

 // Local midnight in the proposal's zone is not a whole stored date: nothing is offered or saved.
 await run('not-whole-dates',update(begin+DAY-9*3600000,begin+3*DAY-9*3600000));
 await expect.poll(result).toEqual({status:'unsupported'});
 await expect(review).toHaveCount(0);
 expect(await stored(page)).toMatchObject([{begin,end:begin+2*DAY,revision:seeded.events[0].revision}]);

 // Whole dates, one day later. The proposal names Asia/Tokyo; an all-day event has no zone to show.
 await run('whole-dates',update(begin+DAY,begin+3*DAY));
 expect((await review.getByRole('paragraph').innerText()).split('\n')).toEqual([
  'Update event',
  '“Harbour festival”',
  'App calendar · Alpha Phone',
  'March 2, 2027 – March 3, 2027',
  'All day',
  '2 people · no invites sent',
  'Location: Quay',
 ]);
 expect(await stored(page)).toMatchObject([{begin,end:begin+2*DAY}]);
 await review.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(async()=>(await result())?.status).toBe('applied');
 // Saved: the reviewed dates, still all day, the same two attendees.
 const events=await stored(page);
 expect(events).toHaveLength(1);
 expect(events[0]).toMatchObject({id:'all-day-event',begin:begin+DAY,end:begin+3*DAY,allDay:true,who:['Ana','Ben'],title:'Harbour festival',location:'Quay'});
 expect(new Date(events[0].begin).toISOString().slice(0,10)).toBe('2027-03-02');
 expect(new Date(events[0].end-1).toISOString().slice(0,10)).toBe('2027-03-03');
});
