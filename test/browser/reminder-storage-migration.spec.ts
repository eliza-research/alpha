import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');});
test('empty and unchanged reminder polling preserves document identity',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),{reminderDocument}=await import('/src/browser/reminder-store.ts'),daily=new BrowserDaily({} as any);
  await daily.listReminders();const empty=await reminderDocument.capture();
  await daily.scheduleReminder({id:'stable',title:'Retain stable reminder',at:Date.now()+3600000});const before=await reminderDocument.capture();
  await daily.listReminders();await daily.listReminders();const after=await reminderDocument.capture();
  return {empty:empty.snapshot,stable:before.snapshot?.revision===after.snapshot?.revision,legacy:localStorage.getItem('alpha.browser.reminders.v1')};
 });expect(result).toEqual({empty:undefined,stable:true,legacy:null});
});
test('concurrent tabs retain every scheduled reminder',async({page,context})=>{
 const second=await context.newPage();await second.goto('/?mode=dev');
 await Promise.all([page,second].map((tab,index)=>tab.evaluate(async index=>{const {BrowserDaily}=await import('/src/browser/daily.ts'),daily=new BrowserDaily({} as any);for(let i=0;i<10;i++)await daily.scheduleReminder({id:`tab-${index}-${i}`,title:`Reminder ${index}-${i}`,at:Date.now()+3600000});},index)));
 const ids=await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');return (await new BrowserDaily({} as any).listReminders()).reminders.map(row=>row.id);});
 expect(ids.sort()).toEqual(Array.from({length:2},(_,tab)=>Array.from({length:10},(_,i)=>`tab-${tab}-${i}`)).flat().sort());
});
test('failed transactions retain the reminder and its operation receipts together',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),{reminderDocument}=await import('/src/browser/reminder-store.ts'),daily=new BrowserDaily({} as any);
  await daily.scheduleReminder({id:'receipt',title:'Receipt reminder',at:Date.now()+3600000});const target=await daily.selectedReminder({id:'receipt'}),input={operationId:'complete',bindingHash:'a'.repeat(64),operation:{type:'reminder_complete' as const,target}},before=await reminderDocument.readRaw();
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.reminders.v1')throw Error('Injected quota failure');return put.call(this,value,key);};let failed=false;
  try{await daily.operateReminder(input);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
  const unchanged=before===await reminderDocument.readRaw(),missing=await daily.reminderOperationReceipt(input),saved=await daily.operateReminder(input),receipt=await daily.reminderOperationReceipt(input);
  return {failed,unchanged,missing,saved,receipt};
 });expect(result.failed).toBe(true);expect(result.unchanged).toBe(true);expect(result.missing).toEqual({status:'unknown'});expect(result.saved).toEqual(result.receipt);expect(result.saved.result.status).toBe('completed');
});
test('legacy migration preserves exact bytes and refuses later older-tab writes',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),{reminderDocument}=await import('/src/browser/reminder-store.ts'),daily=new BrowserDaily({} as any),key='alpha.browser.reminders.v1',legacy='{ "sourceRevision": "legacy", "reminders": [] }';
  localStorage.setItem(key,legacy);await daily.listReminders();await daily.scheduleReminder({id:'canonical',title:'Canonical reminder',at:Date.now()+3600000});const canonical=await reminderDocument.readRaw();
  localStorage.setItem(key,'{broken older copy');let refused=false;try{await daily.listReminders();}catch{refused=true;}
  const recovery=await reminderDocument.capture();return {refused,canonical:recovery.raw===canonical,legacy:recovery.legacy,changed:recovery.legacyChanged,imported:JSON.parse(recovery.snapshot!.raw!).legacy};
 });expect(result).toEqual({refused:true,canonical:true,legacy:'{broken older copy',changed:true,imported:'{ "sourceRevision": "legacy", "reminders": [] }'});
});
test('stale reset cannot erase a newer reminder',async({page})=>{
 const result=await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts'),{reminderDocument}=await import('/src/browser/reminder-store.ts'),daily=new BrowserDaily({} as any);await daily.scheduleReminder({id:'first',title:'First',at:Date.now()+3600000});const snapshot=await reminderDocument.capture();await daily.scheduleReminder({id:'second',title:'Second',at:Date.now()+3600000});let rejected=false;try{await reminderDocument.reset(snapshot);}catch{rejected=true;}return {rejected,ids:(await daily.listReminders()).reminders.map(row=>row.id)};});expect(result).toEqual({rejected:true,ids:['first','second']});
});
test('damaged reminders expose exact backup and explicit reset from Calendar',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('alpha.browser.reminders.v1','{damaged reminder bytes'));await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'Recover browser reminders',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Browser reminder recovery',exact:true});await expect(dialog).toBeVisible();
 const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download reminders backup',exact:true}).click();const download=await downloadPromise;const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).toString()).toBe('{damaged reminder bytes');
 await dialog.getByRole('button',{name:'Reset app reminders',exact:true}).click();await dialog.getByRole('button',{name:'Confirm reminders reset',exact:true}).click();await expect(dialog).toHaveCount(0);
 const result=await page.evaluate(async()=>{const {reminderDocument}=await import('/src/browser/reminder-store.ts');return {raw:await reminderDocument.readRaw(),legacy:localStorage.getItem('alpha.browser.reminders.v1')};});expect(result).toEqual({raw:null,legacy:'{damaged reminder bytes'});
});
