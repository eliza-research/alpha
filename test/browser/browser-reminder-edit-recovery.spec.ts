import {reviewCalendarAction} from './helpers/calendar-review';
import {chooseCalendarEventAction} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'Asia/Tokyo'});
// Storage tests launch Calendar from the keyboard; a delayed pointer release is a Home long press.
async function editor(page:any,completed=false){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).waitFor();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'reschedule',title:'Reviewed reminder',body:'Original',at:Date.parse('2027-03-13T14:00Z')});});
 if(completed)await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps');const r=(await daily.listReminders()).reminders[0];await daily.reminderDecision({id:r.id,occurrenceId:r.occurrenceId,action:'done'});});
 await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).press('Enter');await page.getByRole('button',{name:/^Reviewed reminder,/}).click();await chooseCalendarEventAction(page, 'Edit event');await page.getByRole('button',{name:'Start later',exact:true}).click();
}
test('stale rendered schedule must not overwrite a newer canonical edit',async({page})=>{
 await editor(page);
 const newer=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps');const target=await daily.selectedReminder({id:'reschedule'});await daily.operateReminder({operationId:crypto.randomUUID(),bindingHash:'a'.repeat(64),operation:{type:'reminder_update',target,fields:{title:'Changed elsewhere',body:'Newer details'}}});return JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0];});
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect.poll(()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0])).toEqual(newer);
});
for(const metadata of [false,true])test(`committed ${metadata?'metadata':'reschedule'} response and receipt loss survives reload without replay`,async({page})=>{
 await editor(page);if(metadata)await page.getByRole('button',{name:'Start earlier',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Reviewed change');
 await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const original=BrowserDaily.prototype.operateReminder;(window as any).editCalls=0;BrowserDaily.prototype.operateReminder=async function(input){(window as any).editCalls++;await original.call(this,input);throw Error('Synthetic committed response lost');};BrowserDaily.prototype.reminderOperationReceipt=async()=>{throw Error('Synthetic receipt unavailable');};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();
 const first=await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()));
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).editCalls)).toBe(1);
 expect(await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()))).toBe(first);
 expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).press('Enter');
 await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);
 expect(await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()))).toBe(first);
});

for(const scenario of ['metadata','reschedule-accept','reschedule-cancel'])test(`completed reminder editing: ${scenario}`,async({page})=>{
 await editor(page,true);if(scenario==='metadata')await page.getByRole('button',{name:'Start earlier',exact:true}).click();
 const before=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0]);
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Completed edited');
 let dialogs=0;if(scenario==='metadata')await page.getByRole('button',{name:'Save event',exact:true}).click();else{await reviewCalendarAction(page,()=>page.getByRole('button',{name:'Save event',exact:true}).click(),scenario==='reschedule-accept');dialogs++;}
 if(scenario==='reschedule-cancel'){await expect.poll(()=>dialogs).toBe(1);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0])).toEqual(before);return;}
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);
 const after=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0]);expect(after.title).toBe('Completed edited');expect(after.history).toEqual(before.history);expect(before.completedAt).toBe(Date.parse('2027-03-13T00:00Z'));
 if(scenario==='metadata'){expect(dialogs).toBe(0);expect(after.status).toBe('completed');expect(after.completedAt).toBe(before.completedAt);expect(after.occurrenceId).toBe(before.occurrenceId);}else{expect(dialogs).toBe(1);expect(after.status).toBe('scheduled');expect(after.completedAt).toBeUndefined();expect(after.occurrenceId).not.toBe(before.occurrenceId);}
});
for(const scenario of ['draft-during-digest','navigate-during-digest','storage-failure'])test(`no dispatch before durable reviewed edit: ${scenario}`,async({page})=>{
 await editor(page);const before=await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()));
 await page.evaluate(async scenario=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const original=BrowserDaily.prototype.operateReminder;(window as any).editCalls=0;BrowserDaily.prototype.operateReminder=async function(input){(window as any).editCalls++;return original.call(this,input);};if(scenario==='storage-failure'){const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.reminder-deletions.v1')throw Error('Synthetic durable storage unavailable');return put.call(this,value,key);};}else{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async function(algorithm,data){if(new TextDecoder().decode(data as ArrayBuffer).includes('reminder_update'))await new Promise<void>(resolve=>(window as any).releaseEdit=resolve);return digest(algorithm,data);};}},scenario);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 if(scenario==='storage-failure')await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();
 else{await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseEdit)).toBe('function');if(scenario==='draft-during-digest')await page.getByRole('textbox',{name:'Title',exact:true}).fill('Later draft');else await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await page.evaluate(()=>(window as any).releaseEdit());await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);}
 expect(await page.evaluate(()=>(window as any).editCalls)).toBe(0);expect(await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()))).toBe(before);
});
for(const scenario of ['double-save','draft-after-dispatch','navigate-after-dispatch'])test(`committed edit completion ownership: ${scenario}`,async({page})=>{
 await editor(page);
 await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const original=BrowserDaily.prototype.operateReminder;(window as any).editCalls=0;BrowserDaily.prototype.operateReminder=async function(input){(window as any).editCalls++;const result=await original.call(this,input);await new Promise<void>(resolve=>(window as any).releaseEdit=resolve);return result;};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseEdit)).toBe('function');
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeDisabled();
 // Bypass the disabled UI only to prove the handler still rejects duplicate dispatch.
 if(scenario==='double-save')await page.getByRole('button',{name:'Save event',exact:true}).dispatchEvent('click');else if(scenario==='draft-after-dispatch')await page.getByRole('textbox',{name:'Title',exact:true}).fill('Later unsaved draft');else await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();
 await page.evaluate(()=>(window as any).releaseEdit());await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);
 expect(await page.evaluate(()=>(window as any).editCalls)).toBe(1);
 if(scenario==='draft-after-dispatch'){await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Later unsaved draft');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByText('Pending edit',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).editCalls)).toBe(1);}else await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);
});
for(const scenario of ['receipt-recovered','late-stale','wrong-receipt'])test(`canonical edit receipt boundary: ${scenario}`,async({page})=>{
 await editor(page);
 await page.evaluate(async scenario=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const original=BrowserDaily.prototype.operateReminder,receipt=BrowserDaily.prototype.reminderOperationReceipt;(window as any).editCalls=0;BrowserDaily.prototype.operateReminder=async function(input){(window as any).editCalls++;if(scenario==='late-stale'){await original.call(this,{operationId:crypto.randomUUID(),bindingHash:'c'.repeat(64),operation:{...input.operation,fields:{title:'Concurrent edit',body:'Must survive'}}});return original.call(this,input);}await original.call(this,input);throw Error('Synthetic response lost');};if(scenario==='wrong-receipt')BrowserDaily.prototype.reminderOperationReceipt=async function(input){const result=await receipt.call(this,input);return {...result,result:{...result.result,reminderId:'wrong-record'}};};},scenario);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 if(scenario==='receipt-recovered'){await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);}
 else{await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save event',exact:true}).click();expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(1);if(scenario==='late-stale')expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0].title)).toBe('Concurrent edit');}
 expect(await page.evaluate(()=>(window as any).editCalls)).toBe(1);
});
test('navigation during durable retention discards only undispatched edit',async({page})=>{
 await editor(page);
 await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');(window as any).editCalls=0;const original=BrowserDaily.prototype.operateReminder;BrowserDaily.prototype.operateReminder=async function(input){(window as any).editCalls++;return original.call(this,input);};const lock=navigator.locks.request.bind(navigator.locks);let held=false;navigator.locks.request=((name:any,options:any,callback:any)=>lock(name,options,async(l:any)=>{const result=await callback(l);if(name===JSON.stringify(['browser-document','alpha.browser.documents.v1','alpha.browser.reminder-deletions.v1'])&&!held){held=true;await new Promise<void>(resolve=>(window as any).releaseRetention=resolve);}return result;})) as any;});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseRetention)).toBe('function');await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await page.evaluate(()=>(window as any).releaseRetention());await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(0);expect(await page.evaluate(()=>(window as any).editCalls)).toBe(0);
});
for(const status of ['permission-denied','scheduling-failed','completed','cancelled','posted'])test(`native-shaped reschedule receipt: ${status}`,async({page})=>{
 await editor(page);
 await page.evaluate(async status=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const original=BrowserDaily.prototype.operateReminder;BrowserDaily.prototype.operateReminder=async function(input){const result=await original.call(this,input);return {...result,result:{...result.result,status}};};},status);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 if(status==='permission-denied'||status==='scheduling-failed'){await expect(page.getByText(status==='permission-denied'?'Saved · Alerts off':'Saved · Alert not set',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);}
 else{await expect(page.getByText('Unconfirmed',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeVisible();expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()).length)).toBe(1);}
 await expect(page.getByText('Reminder rescheduled',{exact:true})).toHaveCount(0);
});
