import {test,expect} from '@playwright/test';
// Renderer reminder lifecycle: refusal retirement, overdue listing, reopen, undated to-dos,
// one-off time-zone policy and Clock repeat days. Browser storage only; no device effects.
const offline=async({page}:{page:import('@playwright/test').Page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');};

test.describe('reminder lifecycle',()=>{
 test.beforeEach(offline);
 test('33 definite refusals are retired after absent readback and creation still works',async({page})=>{
  const result=await page.evaluate(async()=>{
   const creations=await import('/src/runtime/reminder-creations.ts'),{DailyApps}=await import('/src/daily.ts');
   const statuses:string[]=[],retired:boolean[]=[];
   for(let i=0;i<33;i++){
    const id=`refused-${i}-${crypto.randomUUID()}`,request={id,title:`Refused ${i}`,body:'',at:Date.now()-60000};
    await creations.retainReminderCreation({id,request,state:'pending'});
    const response=await DailyApps.scheduleReminder(request);statuses.push(response.status);
    retired.push(await creations.retireRefusedCreation(id,response.status));
   }
   const pendingAfterRefusals=Object.values(await creations.reminderCreations()).filter(row=>row.state==='pending').length;
   const id=`accepted-${crypto.randomUUID()}`,request={id,title:'Accepted after refusals',body:'',at:Date.now()+3600000};
   await creations.retainReminderCreation({id,request,state:'pending'});
   const accepted=await DailyApps.scheduleReminder(request);
   // A refusal code for an ID that readback finds saved is never retired.
   const keptSaved=await creations.retireRefusedCreation(id,'failed');
   const found=await creations.checkReminderCreation(id);
   const notRefusal=await creations.retireRefusedCreation('absent-id','scheduled');
   return {statuses:[...new Set(statuses)],retired:retired.every(Boolean),pendingAfterRefusals,accepted:accepted.status,keptSaved,found,notRefusal,
    refusals:creations.reminderRefusals,listed:(await DailyApps.listReminders()).reminders.filter(r=>r.id.startsWith('refused-')).length};
  });
  expect(result).toEqual({statuses:['past'],retired:true,pendingAfterRefusals:0,accepted:'scheduled',keptSaved:false,found:'found',notRefusal:false,refusals:['past','permission-denied','storage-full','failed'],listed:0});
 });
 test('each refusal shows a specific reason',async({page})=>{
  const messages=await page.evaluate(async()=>{const {reminderRefusalMessage}=await import('/src/runtime/reminder-creations.ts');return (['past','permission-denied','storage-full','failed'] as const).map(status=>reminderRefusalMessage(status,true));});
  expect(new Set(messages).size).toBe(4);
  expect(messages[0]).toContain('passed');expect(messages[1]).toContain('Android settings');expect(messages[2]).toContain('storage is full');
  for(const message of messages)expect(message).toContain('Nothing was saved');
 });
 test('overdue lists posted and late scheduled reminders only, oldest first',async({page})=>{
  const ids=await page.evaluate(async()=>{
   const {overdueReminders}=await import('/src/runtime/reminder-creations.ts');const now=Date.UTC(2026,9,8,12);
   const row=(id:string,status:string,dueAt:number,extra={})=>({id,title:id,body:'',at:dueAt,dueAt,status,mode:'inexact',createdAt:0,occurrenceId:id,...extra}) as any;
   return overdueReminders([row('late-scheduled','scheduled',now-60000),row('posted','posted',now-3600000),row('future','scheduled',now+60000),row('completed','completed',now-7200000),row('pending-no-alert','pending',now-7200000),row('denied','permission-denied',now-7200000),row('snoozed','scheduled',now-120000,{at:now+480000,snoozedAt:now-120000}),row('todo','todo',NaN,{undated:true,at:undefined,dueAt:undefined})],now).map(r=>r.id);
  });
  expect(ids).toEqual(['posted','snoozed','late-scheduled']);
 });
 test('undated to-dos never become calendar events and list open first',async({page})=>{
  const result=await page.evaluate(async()=>{
   const {undatedTodos,reminderEvents}=await import('/src/runtime/reminder-creations.ts');
   const rows=[{id:'a',title:'Done to-do',body:'',status:'completed',mode:'none',createdAt:1,undated:true},{id:'b',title:'Open to-do',body:'',status:'todo',mode:'none',createdAt:2,undated:true},{id:'c',title:'Dated',body:'',at:Date.now()+60000,dueAt:Date.now()+60000,status:'scheduled',mode:'inexact',createdAt:3,occurrenceId:'c'}] as any[];
   return {todos:undatedTodos(rows).map(r=>r.id),events:reminderEvents(rows).map(e=>e.alphaReminderId)};
  });
  expect(result).toEqual({todos:['b','a'],events:['c']});
 });
 test('reopen runs a reviewed reminder_update to an open no-alert occurrence with readback',async({page})=>{
  const result=await page.evaluate(async()=>{
   const {DailyApps}=await import('/src/daily.ts'),{reopenSchedule}=await import('/src/runtime/reminder-creations.ts');
   const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const operate=async(operation:any)=>DailyApps.operateReminder({operationId:crypto.randomUUID(),bindingHash:await hash(operation),operation});
   const id=`reopen-${crypto.randomUUID()}`,dueAt=Date.now()+3600000;
   await DailyApps.scheduleReminder({id,title:'Reopen fixture',body:'',at:dueAt,dueAt,alertMinutes:null});
   let row=(await DailyApps.listReminders()).reminders.find(r=>r.id===id)!;
   const completed=await operate({type:'reminder_complete',target:row.target});
   row=(await DailyApps.listReminders()).reminders.find(r=>r.id===id)!;const before=row.occurrenceId;
   const schedule=reopenSchedule({dueAt:row.dueAt!,alertMinutes:null},'open')!;
   const reopened=await operate({type:'reminder_update',target:row.target,fields:{title:row.title,body:row.body,schedule}});
   const after=(await DailyApps.listReminders()).reminders.find(r=>r.id===id)!;
   const tomorrow=reopenSchedule({dueAt:Date.now()-3600000,alertMinutes:5},'tomorrow');
   return {completed:completed.status,statusBefore:row.status,reopened:reopened.status,status:after.status,newOccurrence:after.occurrenceId!==before,dueAt:after.dueAt===schedule.dueAt,alert:after.alertMinutes,
    tomorrowLead:tomorrow&&tomorrow.dueAt-tomorrow.at,tomorrowFuture:!!tomorrow&&tomorrow.at>Date.now()};
  });
  expect(result).toEqual({completed:'succeeded',statusBefore:'completed',reopened:'succeeded',status:'pending',newOccurrence:true,dueAt:true,alert:null,tomorrowLead:300000,tomorrowFuture:true});
 });
 test('Clock repeat days are validated and carried in the reviewed request',async({page})=>{
  const result=await page.evaluate(async()=>{
   const {buildClockRequest,validateClockOperation,describeClockHandoff}=await import('/src/runtime/clock-contract.ts');
   const once=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[]},'UTC');
   const weekdays=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[6,2,4,3,5]},'UTC');
   let invalid=0;for(const days of [[0],[8],[2,2],[1.5]])try{validateClockOperation({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Run',timeZone:'UTC',days});}catch{invalid++;}
   const explicitOnce=validateClockOperation({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Run',timeZone:'UTC',days:[]});
   const op=validateClockOperation({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Run',timeZone:'UTC',days:[1,7]});
   return {once:'days' in once,explicitOnce:'days' in explicitOnce,weekdays:(weekdays as any).days,invalid,described:describeClockHandoff(op)};
  });
  expect(result.once).toBe(false);expect(result.explicitOnce).toBe(false);expect(result.weekdays).toEqual([2,3,4,5,6]);expect(result.invalid).toBe(4);expect(result.described).toContain('repeating weekends');
 });
});

// One-off reminders are absolute instants; only the rendered wall time follows the zone.
for(const [zone,hour] of [['America/New_York',9],['America/Los_Angeles',6]] as const)test.describe(`one-off reminder in ${zone}`,()=>{
 test.use({timezoneId:zone});
 test.beforeEach(offline);
 test('keeps its instant and re-renders the wall time',async({page})=>{
  const instant=Date.UTC(2026,10,20,14,0);// 09:00 in New York (EST), 06:00 in Los Angeles (PST)
  const event=await page.evaluate(async instant=>{const {reminderEvents}=await import('/src/runtime/reminder-creations.ts');const [row]=reminderEvents([{id:'zone',title:'Zone fixture',body:'',at:instant,dueAt:instant,alertMinutes:0,status:'scheduled',mode:'inexact',createdAt:0,occurrenceId:'zone'} as any],new Date(instant));return {t:row.t,due:row.reminderDueAt,at:row.reminderAt,off:row.off};},instant);
  expect(event).toEqual({t:hour,due:instant,at:instant,off:0});
 });
});
