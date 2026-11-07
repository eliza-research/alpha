import {openBrowserCalendar} from './helpers/browser-calendar';
import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'UTC'});
const unknown='Reminder creation is unconfirmed. Check new reminder status in Calendar; it will not be created again automatically.';
for(const mode of ['fresh','double','response-loss','reload-loss','mismatch','missing','edit-during-retain','navigate-after-dispatch','persistence-failure','fresh-attempt','newer-draft','changed-repeat-save','missing-attempt','sibling-pending','recurring','history-navigate'] as const)test(`reminder creation ${mode}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');await openBrowserCalendar(page);
 const newForm=async()=>{const replace=async(dialog:any)=>{expect(dialog.message()).toBe('Replace the retained unsaved form with a new event?');await dialog.accept();};page.on('dialog',replace);try{await page.getByRole('button',{name:'New event',exact:true}).click();}finally{page.off('dialog',replace);}await page.getByRole('textbox',{name:'Title',exact:true}).fill('Create boundary reminder');await page.getByRole('button',{name:'Reminders',exact:true}).click();};await newForm();
 if(mode==='recurring')await page.getByRole('button',{name:'Daily',exact:true}).click();
 await page.evaluate(async mode=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),schedule=BrowserDaily.prototype.scheduleReminder,list=BrowserDaily.prototype.listReminders;(window as any).creates=0;
  BrowserDaily.prototype.scheduleReminder=async function(input){(window as any).creates++;if(mode==='double'||mode==='navigate-after-dispatch'||mode==='newer-draft')await new Promise<void>(r=>(window as any).releaseCreate=r);if(mode==='missing'||mode==='fresh-attempt')throw Error('Transport outcome unknown');const out=await schedule.call(this,input);if(['response-loss','reload-loss','mismatch','changed-repeat-save','missing-attempt'].includes(mode))throw Error('Committed response lost');return out;};
  BrowserDaily.prototype.listReminders=async function(){if(mode==='reload-loss'||['changed-repeat-save','missing-attempt'].includes(mode)&&!(window as any).allowReadback)throw Error('Readback unavailable');const out=await list.call(this);if(mode==='mismatch'&&out.reminders.length)out.reminders[0].title='Changed elsewhere';return out;};
  if(mode==='sibling-pending'||mode==='history-navigate'){localStorage.setItem('alpha.browser.reminder-creations.v1',JSON.stringify({'prior-owned':{id:'prior-owned',request:{id:'prior-owned',title:'Prior unknown',body:'',at:Date.parse('2027-03-13T17:00Z')},state:'pending'}}));}
  if(mode==='history-navigate'){const read=Storage.prototype.getItem;let first=true;(window as any).confirmCalls=0;window.confirm=()=>{(window as any).confirmCalls++;return true;};Storage.prototype.getItem=function(k){const result=read.call(this,k);if(k==='alpha.browser.reminder-creations.v1'&&first){first=false;queueMicrotask(()=>{const buttons=[...document.querySelectorAll('button')];(buttons.find(b=>b.getAttribute('aria-label')==='Back to calendar') as HTMLButtonElement)?.click();(buttons.find(b=>b.getAttribute('aria-label')==='Back to apps') as HTMLButtonElement)?.click();});}return result;};}
  if(mode==='persistence-failure'){const write=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='alpha.browser.reminder-creations.v1')throw Error('Storage full');return write.call(this,v,k);};}
  if(mode==='edit-during-retain'){
   // Pause the actual retained document write, independent of browser Web Locks wrappers.
   const {reminderCreationDocument}=await import('/src/browser/reminder-creation-document.ts');
   const edit=reminderCreationDocument.editJson.bind(reminderCreationDocument);let first=true;
   reminderCreationDocument.editJson=async(update,signal)=>{
    await edit(update,signal);
    if(first){first=false;await new Promise<void>(resolve=>(window as any).releaseRetain=resolve);}
   };
  }
 },mode);
 if(mode==='sibling-pending')page.once('dialog',d=>void d.accept());
 const save=page.getByRole('button',{name:'Save event',exact:true});await save.click();
 if(mode==='history-navigate'){await expect(page.locator('html')).toHaveAttribute('data-active-view','home');expect(await page.evaluate(()=>(window as any).confirmCalls)).toBe(0);expect(await page.evaluate(()=>(window as any).creates)).toBe(0);return;}
 if(mode==='double'||mode==='navigate-after-dispatch'||mode==='newer-draft'){
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseCreate)).toBe('function');
  await expect(save).toBeDisabled();
  if(mode==='double'){
   // Bypass actionability only to exercise the handler's duplicate guard.
   await save.dispatchEvent('click');
   expect(await page.evaluate(()=>(window as any).creates)).toBe(1);
  }else{
   await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();
   if(mode==='newer-draft'){await newForm();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Newer draft preserved');}
   else await returnToApps(page);
  }
  await page.evaluate(()=>(window as any).releaseCreate());
 }
 if(mode==='edit-during-retain'){await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseRetain)).toBe('function');expect(await page.evaluate(()=>(window as any).creates)).toBe(0);expect(await page.evaluate(async()=>Object.values(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).map(row=>row.request.title))).toEqual(['Create boundary reminder']);await page.getByRole('textbox',{name:'Title',exact:true}).fill('Changed draft');await page.evaluate(()=>(window as any).releaseRetain());await expect.poll(()=>page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).length)).toBe(0);expect(await page.evaluate(()=>(window as any).creates)).toBe(0);await save.click();await expect(page.getByText('Reminder scheduled · approximate delivery',{exact:true})).toBeVisible();return;}
 if(mode==='persistence-failure'){await expect(page.getByText(unknown,{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).creates)).toBe(0);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders.length)).toBe(0);return;}
 if(mode==='newer-draft'){await expect.poll(()=>page.evaluate(async()=>Object.values(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).every(r=>r.state==='found'))).toBe(true);await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Newer draft preserved');expect(await page.evaluate(()=>(window as any).creates)).toBe(1);return;}
 if(mode==='changed-repeat-save'||mode==='missing-attempt'){
  await expect(page.getByText(unknown,{exact:true})).toBeVisible();
  if(mode==='changed-repeat-save')await page.getByRole('textbox',{name:'Title',exact:true}).fill('Edited unsaved draft');
  await page.evaluate(async mode=>{(window as any).allowReadback=true;if(mode==='missing-attempt'){const {reminderCreationDocument}=await import('/src/browser/reminder-creation-document.ts');await reminderCreationDocument.reset(await reminderCreationDocument.capture());}},mode);await save.click();
  if(mode==='changed-repeat-save'){await expect(page.getByText('The previous reminder was found. This edited draft was not saved. Close it to start a separate reminder.',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Edited unsaved draft');}else await expect(page.getByText(unknown,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).creates)).toBe(1);return;
 }
 if(['reload-loss','mismatch','missing','fresh-attempt'].includes(mode)){
  await expect(page.getByText(unknown,{exact:true})).toBeVisible();await save.click();expect(await page.evaluate(()=>(window as any).creates)).toBe(1);
  await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();await expect(page.getByRole('button',{name:'Check new reminder status',exact:true})).toBeVisible();
  if(mode==='fresh-attempt'){
   // New event resumes the retained form; explicitly discard only that draft before a separate attempt.
   await page.getByRole('button',{name:'New event',exact:true}).click();page.once('dialog',d=>void d.accept());await page.getByRole('button',{name:'Discard calendar draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);
   await newForm();const dismissed=new Promise<void>(resolve=>page.once('dialog',async d=>{expect(d.message()).toContain('may already exist');await d.dismiss();resolve();}));await save.click();await dismissed;await expect(save).toBeEnabled();expect(await page.evaluate(()=>(window as any).creates)).toBe(1);
   page.once('dialog',d=>void d.accept());await save.click();await expect.poll(()=>page.evaluate(()=>(window as any).creates)).toBe(2);expect(await page.evaluate(async()=>Object.keys(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).length)).toBe(2);return;
  }
  await page.getByRole('button',{name:'Check new reminder status',exact:true}).click();expect(await page.evaluate(()=>(window as any).creates)).toBe(1);await page.reload();await openBrowserCalendar(page);
  if(mode==='missing')await expect(page.getByRole('button',{name:'Check new reminder status',exact:true})).toBeVisible();else await expect.poll(()=>page.evaluate(async()=>Object.values(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).every(r=>r.state==='found'))).toBe(true);
 }else if(mode==='response-loss')await expect(page.getByText('The saved reminder was found. Delivery is not verified.',{exact:true})).toBeVisible();else if(mode==='navigate-after-dispatch'){await expect.poll(()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders.length)).toBe(1);await expect(page.locator('html')).toHaveAttribute('data-active-view','home');}else await expect(page.getByText('Reminder scheduled · approximate delivery',{exact:true})).toBeVisible();
 if(mode==='sibling-pending')expect(await page.evaluate(async()=>(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations())['prior-owned'].state)).toBe('pending');
 const rows=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders);expect(rows).toHaveLength(mode==='missing'?0:1);
});
