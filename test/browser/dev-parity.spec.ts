import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
test('browser calendar persists events and rejects stale modifications',async({page})=>{
 await page.goto('/?tools=1');
 const result=await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar');
  const begin=Date.now()+3600000,end=begin+3600000;
  const input={creationId:crypto.randomUUID(),calendarId:'local',title:'Browser parity event',body:'Local record',location:'Desk',begin,end};
  const saved=await calendar.save(input),expected={title:input.title,body:input.body,location:input.location,begin,end};
  const inspected=await calendar.inspect({id:saved.id,calendarId:'local',expected});
  const edited=await calendar.save({...input,id:saved.id,expected,title:'Edited event'});
  const stale=await calendar.remove({id:saved.id,calendarId:'local',expected,revision:inspected.revision});
  return {saved:saved.status,edited:edited.status,stale:stale.status};
 });
 expect(result).toEqual({saved:'saved',edited:'saved',stale:'conflict'});
 await page.reload();await openBrowserCalendar(page);
 await expect(page.getByText('Edited event',{exact:true}).first()).toBeVisible();
});
test('browser reminder posts, snoozes and completes without repeating completion',async({page})=>{
 await page.goto('/?tools=1');
 const result=await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps'),notices=registerPlugin<any>('AlphaNotifications');
  await daily.scheduleReminder({id:'parity',title:'Parity reminder',at:Date.now()+10000});
  await (await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].at=Date.now()-1;});
  const posted=await notices.list(),row=(await daily.listReminders()).reminders[0];
  const snoozed=await daily.reminderDecision({id:row.id,occurrenceId:row.occurrenceId,action:'snooze'});
  const done=await daily.reminderDecision({id:row.id,occurrenceId:row.occurrenceId,action:'done'});
  const duplicate=await daily.reminderDecision({id:row.id,occurrenceId:row.occurrenceId,action:'done'});
  return {posted:posted.items.length,snoozed:snoozed.status,done:done.status,duplicate:duplicate.status};
 });expect(result).toEqual({posted:1,snoozed:'scheduled',done:'completed',duplicate:'stale'});
});
test('browser surface isolates pages, persists bookmarks and hides overlaid tabs',async({page})=>{
 await page.route('https://parity.example/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Embedded page</h1>'}));
 await page.goto('/?tools=1');
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const browser=registerPlugin<any>('AlphaBrowser');await browser.create({session:'test',id:'tab'});await browser.navigate({session:'test',id:'tab',url:'https://parity.example/page'});await browser.present({session:'test',id:'tab',x:0,y:100,width:400,height:500});await browser.setBookmark({url:'https://parity.example/page',saved:true});});
 await expect(page.frameLocator('[data-browser-surface="tab"] iframe').getByRole('heading',{name:'Embedded page'})).toBeVisible();
 await expect(page.locator('[data-browser-surface="tab"] iframe')).toHaveAttribute('sandbox',/allow-scripts/);
 expect(await page.locator('[data-browser-surface="tab"] iframe').getAttribute('sandbox')).not.toContain('allow-same-origin');
 await expect(page.locator('[data-browser-surface="tab"] a')).toHaveAttribute('rel','noopener noreferrer');
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaBrowser').present({session:'test',id:null});});
 await expect(page.locator('[data-browser-surface="tab"]')).toBeHidden();
 await page.reload();
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaBrowser').bookmarks()).urls;})).toEqual(['https://parity.example/page']);
});
test('local dev device exposes deferred apps without dispatching external effects',async({page})=>{
 const requests:string[]=[];page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))requests.push(request.url());});
 await page.goto('/?mode=dev&tools=1');
 await expect(page.getByText('Dev data',{exact:true})).toBeVisible();
 for(const name of ['Phone','Messages','Contacts','Wallet']){
  await page.getByRole('button',{name,exact:true}).first().click();
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 }
 expect(requests.filter(url=>!url.startsWith('data:')&&!url.startsWith('blob:'))).toEqual([]);
});
test('browser files keep exact bytes across reload, rename and move',async({page})=>{
 await page.goto('/?tools=1');
 const imported=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');const file=new File(['Line one\r\nCafé\n'],'parity.txt',{type:'text/plain'});const selection=await files.importFile(file);const listing=await files.list({});const entry=listing.entries.find((e:any)=>e.name==='parity.txt');const text=await registerPlugin<any>('DailyApps').readSelected(selection);await files.createFolder({id:'root',name:'Folder'});const folder=(await files.list({})).entries.find((e:any)=>e.directory);await files.move({id:entry.id,destinationId:folder.id,expectedRevision:entry.revision});return {text:text.text,folder:folder.id};});
 expect(imported.text).toBe('Line one\r\nCafé\n');await page.reload();
 const retained=await page.evaluate(async(folder)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');const listing=await files.list({id:folder});const entry=listing.entries[0];await files.rename({id:entry.id,name:'renamed.txt',expectedRevision:entry.revision});let stale=false;try{await files.delete({id:entry.id,expectedRevision:entry.revision,confirmPermanent:true});}catch{stale=true;}return {stale,name:(await files.list({id:folder})).entries[0].name};},imported.folder);
 expect(retained).toEqual({stale:true,name:'renamed.txt'});
});
test('browser device setting controls persist across reload',async({page})=>{
 await page.goto('/?tools=1');await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaDevice').openSettings({page:'wifi'});});
 const checkbox=page.getByRole('dialog',{name:'wifi settings'}).getByRole('checkbox',{name:'wifi Active',exact:true});await expect(checkbox).toBeChecked();await checkbox.uncheck();await expect(checkbox).toBeEnabled();await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaDevice').snapshot()).wifiActive;})).toBe(false);
});
test('calendar agent review cancels, rejects stale changes and replays one durable receipt',async({page})=>{
 await page.goto('/?tools=1');
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar');const source=await calendar.prepareAgentSource();(window as any).calendarOperation={type:'calendar_create',source:{sourceId:source.sourceId,sourceRevision:source.sourceRevision},fields:{title:'Reviewed event',description:'Details',location:'Desk',start:'2027-01-01T12:00:00.000Z',end:'2027-01-01T13:00:00.000Z',timeZone:'Europe/London'}};(window as any).calendarResult=calendar.executeAgent({operation:(window as any).calendarOperation,operationId:'review-create'});});
 await page.getByRole('dialog',{name:'Review calendar change'}).getByRole('button',{name:'Confirm',exact:true}).click();
 const created=await page.evaluate(()=>(window as any).calendarResult);expect(created.status).toBe('applied');
 const replay=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').executeAgent({operation:(window as any).calendarOperation,operationId:'review-create'});});expect(replay).toEqual(created);
 await page.evaluate(async(result)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar');(window as any).readOp={type:'calendar_read_selected',target:{...(window as any).calendarOperation.source,eventId:result.result.eventId,revision:result.result.revision}};(window as any).calendarResult=calendar.executeAgent({operation:(window as any).readOp,operationId:'review-read'});},created);
 await page.getByRole('dialog',{name:'Share calendar event with agent?'}).getByRole('button',{name:'Confirm',exact:true}).click();
 const read=await page.evaluate(()=>(window as any).calendarResult);expect(read.result.fields.title).toBe('Reviewed event');
 await page.evaluate(async()=>{await (await import('/src/runtime/deletion-owner.ts')).bindBrowserDeletionOwner(()=>'agent:'+JSON.stringify(['https://fixture.invalid','owner','agent','session','install','enroll']));const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar');(window as any).calendarResult=calendar.executeAgent({operation:{...(window as any).readOp,type:'calendar_delete'},operationId:'review-delete'});});
 await expect(page.getByRole('dialog',{name:'Review calendar change'})).toBeVisible();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').cancelAgent({operationId:'review-delete'});});
 expect(await page.evaluate(()=>(window as any).calendarResult)).toEqual({status:'cancelled'});
 await page.reload();
 const retained=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaCalendar').list({begin:0,end:Date.parse('2028-01-01')})).events;});expect(retained).toHaveLength(1);
});
test('reminder agent changes and receipts commit together and reject changed bindings',async({page})=>{
 await page.goto('/?tools=1');
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps');await daily.scheduleReminder({id:'agent_reminder',title:'Before',at:Date.now()+3600000});const target=await daily.selectedReminder({id:'agent_reminder'}),operation={type:'reminder_update',target,fields:{title:'After',body:'Updated'}};const request={operationId:'reminder_edit',bindingHash:'a'.repeat(64),operation};const response=await daily.operateReminder(request);const replay=await daily.operateReminder(request);let mismatch=false,stale=false;try{await daily.operateReminder({...request,bindingHash:'b'.repeat(64)});}catch{mismatch=true;}try{await daily.operateReminder({...request,operationId:'different_operation'});}catch{stale=true;}(window as any).reminderRequest=request;return {response,replay,mismatch,stale};});
 expect(result.response.status).toBe('succeeded');expect(result.replay).toEqual(result.response);expect(result.mismatch).toBe(true);expect(result.stale).toBe(true);
 const request=await page.evaluate(()=>(window as any).reminderRequest);await page.reload();
 const recovered=await page.evaluate(async(request)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('DailyApps').reminderOperationReceipt(request);},request);expect(recovered).toEqual(result.response);
});
test('browser device controls exercise HOME, power, unlock, background, assistant and role persistence',async({page})=>{
 await page.goto('/?tools=1');
 const command=async(name:string)=>{await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name,exact:true}).click();};
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await command('Home');await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await command('Power');await expect(page.getByRole('button',{name:'Unlock with fingerprint',exact:true})).toBeVisible();await command('Unlock');await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await command('Background');await expect(page.locator('html')).toHaveAttribute('data-dev-background','true');await command('Resume');await expect(page.locator('html')).not.toHaveAttribute('data-dev-background');
 await command('Assistant');await expect(page.locator('[data-alpha-layer=conversation]')).toHaveAttribute('aria-hidden','false');
 await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Use as home',exact:true}).click();await expect(page.getByText('home selected',{exact:true})).toBeVisible();await page.reload();
 const roles=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('ElizaSystem').getStatus()).roles;});expect(roles.find((r:any)=>r.role==='home').held).toBe(true);
});
test('calendar edits during review invalidate approval and durable receipts survive reload',async({page})=>{
 await page.goto('/?tools=1');
 const request=await page.evaluate(async()=>{await (await import('/src/runtime/deletion-owner.ts')).bindBrowserDeletionOwner(()=>'agent:'+JSON.stringify(['https://fixture.invalid','owner','agent','session','install','enroll']));const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar'),source=await calendar.prepareAgentSource(),begin=Date.parse('2027-03-01T12:00:00Z'),end=begin+3600000,expected={title:'Original',body:'',location:'',begin,end};const created=await calendar.save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',...expected}),inspected=await calendar.inspect({id:created.id,calendarId:'local',expected});const request={operationId:'race-calendar-delete',operation:{type:'calendar_delete',target:{sourceId:source.sourceId,sourceRevision:source.sourceRevision,eventId:created.id,revision:inspected.revision}}};(window as any).pendingCalendar=calendar.executeAgent(request);(window as any).calendarEdit={id:created.id,calendarId:'local',...expected,expected,title:'Concurrent edit'};return request;});
 await expect(page.getByRole('dialog',{name:'Review calendar change'})).toBeVisible();await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaCalendar').save((window as any).calendarEdit);});await page.getByRole('button',{name:'Confirm',exact:true}).click();expect(await page.evaluate(()=>(window as any).pendingCalendar)).toEqual({status:'conflict'});
 await page.reload();expect(await page.evaluate(async(request)=>{await (await import('/src/runtime/deletion-owner.ts')).bindBrowserDeletionOwner(()=>'agent:'+JSON.stringify(['https://fixture.invalid','owner','agent','session','install','enroll']));const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').executeAgent(request);},request)).toEqual({status:'conflict'});
 const source=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').prepareAgentSource();});const create={operationId:'reload-calendar',operation:{type:'calendar_create',source:{sourceId:source.sourceId,sourceRevision:source.sourceRevision},fields:{title:'Durable',description:'',location:'',start:'2027-01-01T12:00:00.000Z',end:'2027-01-01T13:00:00.000Z',timeZone:'UTC'}}};
 await page.evaluate(async(request)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');(window as any).pendingCalendar=registerPlugin<any>('AlphaCalendar').executeAgent(request);},create);await page.getByRole('button',{name:'Confirm',exact:true}).click();const result=await page.evaluate(()=>(window as any).pendingCalendar);await page.reload();expect(await page.evaluate(async(request)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').executeAgent(request);},create)).toEqual(result);await expect(page.getByRole('dialog',{name:'Review calendar change'})).toHaveCount(0);
});
