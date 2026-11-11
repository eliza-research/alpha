import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'UTC'});
for(const action of ['done','snooze'] as const)for(const mode of ['fresh','stale','duplicate','response-loss','reload-loss','late-stale','navigate','unknown-same-target','navigate-after-dispatch'] as const)test(`reviewed reminder ${action}: ${mode}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).waitFor();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'decision-boundary',title:'Decision boundary reminder',at:Date.parse('2027-03-13T14:00Z')});});
 await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Decision boundary reminder,/}).click();
 const original=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0]);
 await page.evaluate(async({mode,action})=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts');const operate=BrowserDaily.prototype.operateReminder,receipt=BrowserDaily.prototype.reminderOperationReceipt;(window as any).dispatches=0;
  const edit=async ()=>{await (await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].title='Changed elsewhere';data.reminders[0].revision='a'.repeat(64);});};
  BrowserDaily.prototype.operateReminder=async function(input){(window as any).dispatches++;if(mode==='late-stale')await edit();if(mode==='unknown-same-target')throw Error('Transport outcome unknown');if(mode==='duplicate'||mode==='navigate-after-dispatch')await new Promise<void>(r=>(window as any).releaseDecision=r);const out=await operate.call(this,input);if(mode==='response-loss'||mode==='reload-loss')throw Error('Lost response');return out;};
  BrowserDaily.prototype.reminderOperationReceipt=async function(input){if(mode==='reload-loss')throw Error('Receipt transport unavailable');return receipt.call(this,input);};
  if(mode==='stale')await edit();
  if(mode==='navigate'){let first=true;const locks=navigator.locks,request=locks.request.bind(locks);Object.defineProperty(navigator,'locks',{configurable:true,value:locks});locks.request=((name:any,options:any,callback:any)=>request(name,options,async lock=>{const result=await callback(lock);if(name===JSON.stringify(['browser-document','alpha.browser.documents.v1','alpha.browser.reminder-deletions.v1'])&&first){first=false;await new Promise<void>(r=>(window as any).releaseRetention=r);}return result;})) as any;}
 },{mode,action});
 const button=page.getByRole('button',{name:action==='done'?'Complete reminder occurrence':'Snooze reminder 10 minutes',exact:true});await button.click();
 if(mode==='navigate-after-dispatch'){
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseDecision)).toBe('function');await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await returnToApps(page);await page.evaluate(()=>(window as any).releaseDecision());await expect.poll(()=>page.evaluate(async ()=>Object.keys(JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).receipts||{}).length)).toBe(1);await expect(page.locator('html')).toHaveAttribute('data-active-view','home');return;
 }
 if(mode==='duplicate'){await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseDecision)).toBe('function');await button.click();await page.evaluate(()=>(window as any).releaseDecision());}
 if(mode==='navigate'){await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseRetention)).toBe('function');await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await page.evaluate(()=>(window as any).releaseRetention());await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);expect(await page.evaluate(()=>(window as any).dispatches)).toBe(0);return;}
 if(mode==='stale'){await expect(page.getByText('Changed',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).dispatches)).toBe(0);const row=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0]);expect(row.occurrenceId).toBe(original.occurrenceId);expect(row.status).toBe('scheduled');return;}
 if(mode==='unknown-same-target'){
  await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();await button.click();
  expect(await page.evaluate(()=>(window as any).dispatches)).toBe(1);
  const other=page.getByRole('button',{name:action==='done'?'Snooze reminder 10 minutes':'Complete reminder occurrence',exact:true});await other.click();expect(await page.evaluate(()=>(window as any).dispatches)).toBe(1);
  expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0].status)).toBe('scheduled');expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(1);return;
 }
 if(mode==='reload-loss'||mode==='late-stale'){
  await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();
  if(mode==='reload-loss'){
   await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await page.getByRole('button',{name:'Check reminder action status',exact:true}).click();expect(await page.evaluate(()=>(window as any).dispatches)).toBe(1);
   await expect(page.getByRole('button',{name:'Check reminder action status',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);
  }else{
   const retained=await page.evaluate(async()=>(await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions());
   await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Changed elsewhere,/}).click();await button.click();await expect(page.getByText(action==='done'?'Done':'Snoozed 10 minutes',{exact:true})).toBeVisible();expect(await page.evaluate(async()=>(await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions())).toEqual(retained);
  }
 }else await expect(page.getByText(action==='done'?'Done':'Snoozed 10 minutes',{exact:true})).toBeVisible();
 const data=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!));expect(Object.keys(data.receipts)).toHaveLength(1);expect(data.reminders[0].status).toBe(action==='done'?'completed':'scheduled');if(action==='snooze'){expect(data.reminders[0].at).toBe(Date.parse('2027-03-13T00:10Z'));expect(data.reminders[0].occurrenceId).toBe(original.occurrenceId);}else expect(data.reminders[0].history).toHaveLength(1);
});
// Controlled provider-result boundary; Android notification permission/scheduler
// behavior itself remains native acceptance. No permission or alarm is changed.
for(const status of ['permission-denied','scheduling-failed','completed'] as const)test(`reviewed snooze provider result ${status}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).waitFor();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'outcome',title:'Outcome reminder',at:Date.parse('2027-03-13T14:00Z')});});await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Outcome reminder,/}).click();
 await page.evaluate(async status=>{const {BrowserDaily}=await import('/src/browser/daily.ts'),operate=BrowserDaily.prototype.operateReminder;BrowserDaily.prototype.operateReminder=async function(input){const result=await operate.call(this,input);return {...result,result:{...result.result,status}};};},status);
 await page.getByRole('button',{name:'Snooze reminder 10 minutes',exact:true}).click();
 await expect(page.getByText(status==='permission-denied'?'Saved · Alerts off':status==='scheduling-failed'?'Saved · Alert not set':'Unconfirmed',{exact:true})).toBeVisible();
 await expect(page.getByText('Snoozed 10 minutes',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(status==='completed'?1:0);
});
