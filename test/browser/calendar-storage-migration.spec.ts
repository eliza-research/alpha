import {calendarEditorReady} from './calendar-draft-readiness';
import {holdCalendarTransactions} from './calendar-fixture';
import {test,expect} from '@playwright/test';
const key='alpha.browser.calendar.v1';
test('legacy import preserves exact bytes, then reload uses the committed document',async({page,context})=>{
 const original=' {"sourceRevision":"legacy-owner","events":[],"preferences":{"visible":false,"color":"fg"}} ';
 await page.addInitScript(({key,original})=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!localStorage.getItem(key))localStorage.setItem(key,original);},{key,original});
 await page.route('**/__storage-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Storage migration</title>'}));
 await page.goto('/__storage-fixture');
 const first=await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.readRaw();return calendarDocument.capture();});
 expect(first.raw).toBe(original);
 await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.edit(()=>({}),data=>{(data as any).preferences.visible=true;});});
 const after=await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.readRaw();return calendarDocument.capture();});
 expect(after.snapshot?.revision).not.toBe(first.snapshot?.revision);expect(JSON.parse(after.raw!).preferences.visible).toBe(true);
 expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(original);
 const other=await context.newPage();await other.goto('/?mode=dev');
 expect(await other.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');return (await calendarDocument.read(()=>({preferences:{visible:false}}))).preferences.visible;})).toBe(true);
 await page.goto('/?mode=dev');expect(await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');return (await calendarDocument.read(()=>({preferences:{visible:false}}))).preferences.visible;})).toBe(true);
});

test('agent cancellation while storage read is queued cannot open a late review',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const calendar=new BrowserCalendar();(window as any).queuedCalendar=calendar;(window as any).queuedSource=await calendar.prepareAgentSource();});
 await page.evaluate(holdCalendarTransactions);
 await page.evaluate(async()=>{const calendar=(window as any).queuedCalendar,source=(window as any).queuedSource,id=crypto.randomUUID();(window as any).queuedOperation=calendar.executeAgent({operationId:id,operation:{type:'calendar_create',source:{sourceId:source.sourceId,sourceRevision:source.sourceRevision},fields:{title:'Cancelled before read',description:'',location:'',start:new Date(Date.now()+60000).toISOString(),end:new Date(Date.now()+120000).toISOString(),timeZone:'UTC'}}}).then(result=>(window as any).queuedOutcome=result);await calendar.cancelAgent({operationId:id});(window as any).releaseCalendarTransactions();await (window as any).calendarTransactionsHeld;});
 await expect.poll(()=>page.evaluate(()=>(window as any).queuedOutcome)).toEqual({status:'cancelled'});
 await expect(page.getByRole('dialog',{name:'Review calendar change'})).toHaveCount(0);
 expect(await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');return (await calendarDocument.read(()=>({events:[]}))).events;})).toEqual([]);
});
test('backgrounding while an event read is queued cannot open a late editor',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const calendar=new BrowserCalendar();await calendar.save({creationId:crypto.randomUUID(),calendarId:'local',title:'Retired editor',begin:Date.now()+60000,end:Date.now()+120000});const {calendarDocument}=await import('/src/browser/calendar-store.ts');(window as any).queuedCalendar=calendar;(window as any).queuedRow=(await calendarDocument.read(()=>({events:[]}))).events[0];});
 await page.evaluate(holdCalendarTransactions);
 await page.evaluate(async()=>{const row=(window as any).queuedRow;(window as any).queuedEditor=(window as any).queuedCalendar.edit({id:row.id,revision:row.revision}).then(result=>(window as any).queuedEditorOutcome=result);window.dispatchEvent(new Event('alpha:device-state'));(window as any).releaseCalendarTransactions();await (window as any).calendarTransactionsHeld;});
 await expect.poll(()=>page.evaluate(()=>(window as any).queuedEditorOutcome)).toEqual({status:'cancelled'});
 await expect(page.getByRole('dialog',{name:'Edit calendar event'})).toHaveCount(0);
});
for(const kind of ['event','response'] as const)test(`${kind} dismissal aborts a write before its transaction commits`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const before=await page.evaluate(async kind=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const calendar=new BrowserCalendar();await calendar.save({creationId:crypto.randomUUID(),calendarId:'local',title:'Original',begin:Date.now()+60000,end:Date.now()+120000,who:['maya']});const {calendarDocument}=await import('/src/browser/calendar-store.ts');const snapshot=await calendarDocument.capture(),row=JSON.parse(snapshot.raw!).events[0];(window as any).dismissedEdit=kind==='event'?calendar.edit({id:row.id,revision:row.revision}):calendar.editResponse({id:row.id,revision:row.revision,person:'maya',name:'Maya'});return snapshot.raw;},kind);
 const dialog=page.getByRole('dialog',{name:kind==='event'?'Edit calendar event':'Local guest response'});
 if(kind==='event'){await calendarEditorReady(dialog);await dialog.getByLabel('Event title',{exact:true}).fill('Must roll back');}else await dialog.getByLabel('Guest response',{exact:true}).selectOption('yes');
 await page.evaluate(kind=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const request=put.call(this,value,key);if(key==='alpha.browser.calendar.v1'&&(kind==='response'||JSON.stringify(value).includes('Must roll back'))){IDBObjectStore.prototype.put=put;this.transaction.addEventListener('abort',()=>(window as any).editAbortObserved=true);const cancel=[...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button=>button.textContent==='Cancel');if(!cancel)throw Error('No owned editor cancel action');cancel.click();}return request;};},kind);
 await dialog.getByRole('button',{name:kind==='event'?'Save event':'Save response',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>(window as any).dismissedEdit)).toEqual({status:'cancelled'});
 await expect.poll(()=>page.evaluate(()=>(window as any).editAbortObserved)).toBe(true);
 expect(await page.evaluate(async()=>await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())).toBe(before);
});
test('Calendar reads retain the current receipt instead of invalidating reset review',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const result=await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const {calendarDocument}=await import('/src/browser/calendar-store.ts');const calendar=new BrowserCalendar();await calendar.prepareAgentSource();const before=await calendarDocument.capture();await Promise.all([calendar.prepareAgentSource(),calendar.pendingCreations(),calendar.list({begin:Date.now(),end:Date.now()+86400000}),calendar.listAlerts()]);return {before,after:await calendarDocument.capture()};});
 expect(result.after).toEqual(result.before);
});
test('Undo polling retains the calendar receipt while no deletion has expired',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const before=await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title:'Polled',begin:Date.now()+60000,end:Date.now()+120000});return (await import('/src/browser/calendar-store.ts')).calendarDocument.capture();});
 // The pending-deletion poll runs every 500ms; several cycles must not replace the receipt.
 await page.waitForTimeout(2000);
 expect(await page.evaluate(async()=>(await import('/src/browser/calendar-store.ts')).calendarDocument.capture())).toEqual(before);
});
for(const kind of ['response','series-edit','series-delete','meeting','open'] as const)test(`Home during queued ${kind} read prevents late presentation`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const calendar=new BrowserCalendar(),begin=Date.now()+60000;await calendar.save({creationId:crypto.randomUUID(),calendarId:'local',title:'Retired presentation',begin,end:begin+60000,repeat:'daily',who:['maya'],video:true});(window as any).queuedCalendar=calendar;(window as any).queuedRow=(await calendar.list({begin,end:begin+86400000})).events[0];});
 await page.evaluate(holdCalendarTransactions);
 await page.evaluate(async kind=>{const calendar=(window as any).queuedCalendar,row=(window as any).queuedRow,input={id:row.id,revision:row.revision};const pending=kind==='response'?calendar.editResponse({...input,person:'maya',name:'Maya'}):kind==='series-edit'?calendar.editSeries(input):kind==='series-delete'?calendar.removeSeries(input):kind==='meeting'?calendar.joinMeeting(input):calendar.open({id:row.id});(window as any).presentationOutcome=pending;window.dispatchEvent(new Event('launcher-home'));(window as any).releaseCalendarTransactions();await (window as any).calendarTransactionsHeld;},kind);
 expect(await page.evaluate(()=>(window as any).presentationOutcome)).toEqual({status:'cancelled'});
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('empty Calendar queries do not create data before an agent source is requested',async({page})=>{
 await page.route('**/__empty-calendar',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Empty Calendar</title>'}));await page.goto('/__empty-calendar');
 const result=await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),{calendarDocument}=await import('/src/browser/calendar-store.ts');const calendar=new BrowserCalendar();
  await Promise.all([calendar.list({begin:Date.now(),end:Date.now()+86400000}),calendar.listAlerts(),calendar.pendingCreations(),calendar.inspect({id:'missing',calendarId:'local'})]);
  const empty=await calendarDocument.capture(),first=await calendar.prepareAgentSource(),saved=await calendarDocument.capture(),second=await calendar.prepareAgentSource(),after=await calendarDocument.capture();return {empty,first,second,saved,after};
 });
 expect(result.empty.snapshot).toBeUndefined();expect(result.empty.raw).toBeNull();expect(result.first.sourceRevision).toMatch(/^[a-f0-9]{64}$/);expect(result.second).toEqual(result.first);expect(result.after).toEqual(result.saved);
});
