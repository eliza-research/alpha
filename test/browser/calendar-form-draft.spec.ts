import {openBrowserCalendar} from './helpers/browser-calendar';
import {expectSavedCalendarDraft,guardCalendarFixture} from './calendar-draft-readiness';
import {test,expect} from '@playwright/test';
test.use({timezoneId:'UTC'});
test.beforeEach(async({context})=>guardCalendarFixture(context));
const status=(page:any)=>page.getByRole('status',{name:'Calendar form draft status'});
async function expectNoRetainedForm(page:any){await expect.poll(()=>page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');return (await (await assistantDraftStore(JSON.stringify(['calendar-creation-form','app']))).read())?.text||'';})).toBe('');}
async function open(page:any){await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');await openBrowserCalendar(page);}
async function begin(page:any,title='Unsent calendar form'){await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);await expectSavedCalendarDraft(page,'creation');}
for(const kind of ['event','reminder'] as const)test(`${kind} creation form survives reload without creating an item`,async({page})=>{
 await open(page);await begin(page);if(kind==='reminder'){await page.getByRole('button',{name:'Reminders',exact:true}).click();await expectSavedCalendarDraft(page,'creation',{cal:'alpha-reminders'});}
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Unsent calendar form');
 const rows=await page.evaluate(async()=>({events:(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events,reminders:(await new (await import('/src/browser/daily.ts')).BrowserDaily().listReminders()).reminders}));expect(rows.events).toHaveLength(0);expect(rows.reminders).toHaveLength(0);
});
test('a successful event save clears the retained form',async({page})=>{
 await open(page);await begin(page,'Save once');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);await expectNoRetainedForm(page);
 await page.reload();await openBrowserCalendar(page);await expectNoRetainedForm(page);
});
test('competing views retain current form and require explicit conflict resolution',async({page,context})=>{
 await open(page);await begin(page,'First saved form');const other=await context.newPage();await open(other);await other.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('First window changed');await expectSavedCalendarDraft(page,'creation');await other.getByRole('textbox',{name:'Title',exact:true}).fill('Second window changed');
 await expect(other.getByRole('button',{name:'Restore saved form',exact:true})).toBeVisible();await expect(other.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Second window changed');await other.getByRole('button',{name:'Restore saved form',exact:true}).click();await expect(other.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('First window changed');
});
test('restart on another date retains the selected date',async({page})=>{
 await open(page);await begin(page);await page.clock.setFixedTime(new Date('2027-03-14T00:00Z'));await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByLabel('Selected event date')).toContainText('13');
});
test('a committed event with lost response is recovered without a second creation',async({page})=>{
 await open(page);await begin(page,'Uncertain event');await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const save=BrowserCalendar.prototype.save;BrowserCalendar.prototype.save=async function(input){await save.call(this,input);throw Error('Response lost');};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByText('The calendar write was not confirmed. Check creation receipts before creating another event.',{exact:true})).toBeVisible();await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'Check event creation receipts',exact:true}).click();await expect(page.getByRole('button',{name:'Check event creation receipts',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);expect(await page.evaluate(async()=>(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events.length)).toBe(1);
});
test('a restored uncertain reminder checks its original attempt without rescheduling',async({page})=>{
 await open(page);await begin(page,'Uncertain reminder');await page.getByRole('button',{name:'Reminders',exact:true}).click();await expectSavedCalendarDraft(page,'creation',{cal:'alpha-reminders'});
 await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const save=BrowserDaily.prototype.scheduleReminder;BrowserDaily.prototype.scheduleReminder=async function(input){await save.call(this,input);throw Error('Response lost');};BrowserDaily.prototype.listReminders=async()=>{throw Error('Read unavailable');};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByText('Not confirmed. Check its status in Calendar.')).toBeVisible();await expectSavedCalendarDraft(page,'creation');
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await page.evaluate(async()=>{const {BrowserDaily}=await import('/src/browser/daily.ts');(window as any).replayed=0;BrowserDaily.prototype.scheduleReminder=async()=>{(window as any).replayed++;throw Error('Must not replay');};});await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).replayed)).toBe(0);await expectNoRetainedForm(page);
});
test('an open form retains its date across midnight while editing',async({page})=>{
 await open(page);await begin(page);await page.clock.setFixedTime(new Date('2027-03-14T00:00Z'));await page.getByRole('textbox',{name:'Title',exact:true}).fill('Still March 13');await expectSavedCalendarDraft(page,'creation');await expect(page.getByLabel('Selected event date')).toContainText('13');
});
test('oversized edits stay visible and shortening them resumes persistence',async({page})=>{
 await open(page);await begin(page,'Initial saved form');await page.getByRole('textbox',{name:'Title',exact:true}).fill('x'.repeat(2100));await expect(status(page)).toContainText('Current edits are not saved');await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('x'.repeat(2100));await page.getByRole('textbox',{name:'Title',exact:true}).fill('Initial saved form');await expectSavedCalendarDraft(page,'creation');
});
test('New event reopens the retained form without a replacement dialog or overwritten inputs',async({page})=>{
 await open(page);await begin(page,'Keep retained form');await page.getByRole('textbox',{name:'Location',exact:true}).fill('Retained location');await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Retained notes\n\nSecond paragraph');await page.getByRole('switch',{name:'Video link',exact:true}).click();await expectSavedCalendarDraft(page,'creation');await page.getByRole('button',{name:'Back to calendar',exact:true}).click();let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep retained form');await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Retained location');await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Retained notes\n\nSecond paragraph');await expect(page.getByRole('switch',{name:'Video link',exact:true})).toHaveAttribute('aria-checked','true');expect(dialogs).toBe(0);await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep retained form');await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Retained location');await expect(page.getByRole('switch',{name:'Video link',exact:true})).toHaveAttribute('aria-checked','true');expect(dialogs).toBe(0);await page.screenshot({animations:'disabled',path:test.info().outputPath('retained-calendar-form.png')});
});
test('Calendar stays clean and discarding inside the editor requires confirmation before a fresh draft',async({page})=>{
 await open(page);await begin(page,'Discard only this form');await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume unsaved calendar form',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Discard retained calendar form',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Calendar backups',exact:true})).toHaveCount(0);
 await page.screenshot({animations:'disabled',path:test.info().outputPath('calendar-clean-main.png')});
 await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Discard only this form');await page.screenshot({animations:'disabled',path:test.info().outputPath('calendar-editor-discard.png')});
 page.once('dialog',dialog=>{expect(dialog.message()).toBe('Discard this draft? Saved events and reminders will not change.');void dialog.dismiss();});await page.getByRole('button',{name:'Discard calendar draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Discard only this form');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard calendar draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('');expect(await page.evaluate(async()=>(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events.length)).toBe(0);
});
test('discard cannot erase a newer form from another tab',async({page,context})=>{
 await open(page);await begin(page,'First form');const other=await context.newPage();await open(other);await other.getByRole('button',{name:'New event',exact:true}).click();await other.getByRole('textbox',{name:'Title',exact:true}).fill('Newer form');await expectSavedCalendarDraft(other,'creation');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard calendar draft',exact:true}).click();await expect(page.getByText('The retained form changed or could not be cleared. Review both copies before discarding.')).toBeVisible();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('First form');
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Newer form');
});
test('damaged form recovery preserves existing calendar events',async({page})=>{
 await open(page);await page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');const store=await assistantDraftStore(JSON.stringify(['calendar-creation-form','app']));await store.save(null,'{"unsupported":"saved form bytes"}');const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title:'Keep saved event',begin:Date.parse('2027-03-13T10:00Z'),end:Date.parse('2027-03-13T11:00Z')});});await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'Recover saved form',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Calendar form recovery'});await dialog.getByRole('button',{name:'Reset app calendar form',exact:true}).click();await Promise.all([page.waitForEvent('load'),dialog.getByRole('button',{name:'Confirm calendar form reset',exact:true}).click()]);expect(await page.evaluate(async()=>(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events.map(e=>e.title))).toEqual(['Keep saved event']);
});

test('editing while discard is queued retains the newer current form',async({page})=>{
 await open(page);await begin(page,'Before queued discard');
 await page.evaluate(async()=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('alpha.browser.documents.v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=database.transaction('documents','readwrite'),store=transaction.objectStore('documents');let holding=true;
  (window as any).releaseDiscard=()=>{holding=false;};(window as any).discardLock=new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>{database.close();resolve();};transaction.onabort=()=>{database.close();reject(transaction.error);};});
  const keepAlive=()=>{const request=store.get('calendar-discard-transaction');request.onsuccess=()=>{(window as any).discardEntered=true;if(holding)keepAlive();};};keepAlive();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).discardEntered)).toBe(true);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard calendar draft',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Newer unsaved edit');await page.evaluate(async()=>{(window as any).releaseDiscard();await (window as any).discardLock;});
 await expect(page.getByText('The retained form changed or could not be cleared. Review both copies before discarding.')).toBeVisible();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Newer unsaved edit');
 await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Newer unsaved edit');
});
