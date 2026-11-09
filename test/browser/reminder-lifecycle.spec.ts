import {test,expect} from '@playwright/test';
// Renderer reminder lifecycle: refusal retirement and reopen against browser storage. No device
// effects. Refusal copy, overdue and to-do listing, time zones and Clock days are node tests in
// test/reminder-lifecycle-pure.test.mjs.
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
});
