import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({context})=>guardNoMedia(context));
const key='alpha.browser.execution.local.v1';
async function open(page:Page){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();}
async function setup(page:Page){await page.goto('/?mode=dev');await open(page);await page.getByRole('button',{name:'Connect development profile'}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByText('Development device actions',{exact:true}).click();}
async function queue(page:Page){await page.getByRole('button',{name:'Queue action for review'}).click();await expect(page.getByText('Action queued. Send a chat message to review it on the current screen.',{exact:true})).toBeVisible();}
async function chat(page:Page){await page.getByRole('button',{name:'Close connection settings'}).click();await returnToApps(page);await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Review my development action');await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');await expect(page.getByText('Create note',{exact:true})).toBeVisible();}
const state=(page:Page)=>page.evaluate(async()=>(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'actions',()=>({proposals:[],journal:[]}))));
test('queued development action executes once only after review and preserves its receipt on reload',async({page})=>{
 await setup(page);await queue(page);expect((await state(page)).proposals[0].state).toBe('pending');expect((await state(page)).journal).toHaveLength(0);await chat(page);await expect(page.getByText('Create note',{exact:true})).toHaveCount(1);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.some((n:any)=>n.title==='Development note'))).toBe(false);await page.getByText('Create note',{exact:true}).click();await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');expect((await state(page)).journal[0].phase).toBe('terminal');await page.reload();await open(page);await page.getByText('Development device actions',{exact:true}).click();await page.getByRole('button',{name:'Sync recorded receipts'}).click();await expect(page.getByText('completed',{exact:true})).toBeVisible();expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.filter((n:any)=>n.title==='Development note').length)).toBe(1);
});
test('rejected chat review becomes unavailable after refresh and cannot dispatch',async({page})=>{
 await setup(page);await queue(page);await chat(page);
 const before=(await state(page)).proposals[0];
 await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');connectionController.open();});
 await page.getByText('Development device actions',{exact:true}).click();await page.getByRole('button',{name:'Refresh actions'}).click();await page.getByRole('button',{name:'Reject proposal'}).click();
 await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('rejected');await page.getByRole('button',{name:'Close connection settings'}).click();
 const unavailable=page.getByRole('button',{name:/Review unavailable/});await expect(unavailable).toBeVisible();await expect(unavailable).toBeDisabled();await expect(page.getByText('Create note',{exact:true})).toHaveCount(0);
 expect((await state(page)).proposals[0].id).toBe(before.id);expect((await state(page)).journal).toHaveLength(0);
});
test('invalid operations and failed queue persistence cannot publish proposals',async({page})=>{
 await setup(page);await page.getByRole('textbox',{name:'Action JSON'}).fill('{"type":"send_money","amount":100}');await page.getByRole('button',{name:'Queue action for review'}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async key=>(await (await import('/src/browser/documents.ts')).browserDocuments.read(key))??null,key)).toBeNull();await page.getByRole('textbox',{name:'Action JSON'}).fill('{"type":"open_view","view":"notes"}');await page.evaluate(key=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k===key)throw Error('Full');return put.call(this,v,k);};},key);await page.getByRole('button',{name:'Queue action for review'}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async key=>(await (await import('/src/browser/documents.ts')).browserDocuments.read(key))??null,key)).toBeNull();
});
test('voice binding stays stable for repeated reads and changes on reconnect',async({page})=>{
 await setup(page);const get=()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');return c.getPairedVoiceBinding();});const first=await get();expect(await get()).toEqual(first);await page.getByRole('button',{name:'Disconnect agent'}).click();expect(await get()).toBeNull();await page.getByRole('button',{name:'Connect development profile'}).click();expect((await get())!.sessionId).not.toBe(first!.sessionId);
});
test('journal write failure never dispatches the reviewed effect',async({page})=>{
 await setup(page);await queue(page);await chat(page);await page.evaluate(key=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k===key&&JSON.parse(JSON.parse(JSON.parse(v.raw).value).actions).journal.length)throw Error('Full');return put.call(this,v,k);};},key);await page.getByText('Create note',{exact:true}).click();await expect(page.getByText(/Action did not reach a confirmed result/).first()).toBeVisible();expect((await state(page)).journal).toHaveLength(0);expect((await state(page)).proposals[0].state).toBe('pending');expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.some((n:any)=>n.title==='Development note'))).toBe(false);
});
test('two tabs cannot execute the same development proposal twice',async({page,context})=>{
 await setup(page);await queue(page);await chat(page);
 const other=await context.newPage();await other.goto('/?mode=dev');
 await expect.poll(()=>other.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');return !!c.getSnapshot().session;})).toBe(true);
 await other.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Review this proposal');
 await other.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');
 await expect(other.getByText('Create note',{exact:true})).toBeVisible();
 // Queue both real UI intents before either storage claim can complete. Without
 // this barrier the winning tab can disable the other button before its click,
 // testing Playwright timing rather than the document's one-execution claim.
 await page.evaluate(async key=>{
  await new Promise<void>(ready=>{
   void navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1',key]),async()=>{
    ready();await new Promise<void>(resolve=>(window as any).releaseProposalClaim=resolve);
   });
  });
 },key);
 try{
  await Promise.all([
   page.getByText('Create note',{exact:true}).click(),
   other.getByText('Create note',{exact:true}).click(),
  ]);
 }finally{
  await page.evaluate(()=>(window as any).releaseProposalClaim());
 }
 await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');
 expect((await state(page)).journal).toHaveLength(1);
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.filter((n:any)=>n.title==='Development note').length)).toBe(1);
});
test('Home cancels proposal authoring queued behind storage without publishing it',async({page})=>{
 await setup(page);await page.evaluate(async key=>{await new Promise<void>(ready=>{void navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1',key]),async()=>{ready();await new Promise<void>(resolve=>(window as any).releaseActionStore=resolve);});});},key);await page.getByRole('button',{name:'Queue action for review'}).click();await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(page.getByRole('dialog',{name:'Development connections'})).toHaveCount(0);await page.evaluate(()=>(window as any).releaseActionStore());await page.evaluate(key=>navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1',key]),()=>{}),key);expect(await page.evaluate(async key=>(await (await import('/src/browser/documents.ts')).browserDocuments.read(key))??null,key)).toBeNull();
});

for(const action of ['set','show','dismiss','snooze'] as const)test(`approved development Clock ${action} reaches the browser Clock`,async({page})=>{
 await setup(page);
 const operation=await page.evaluate(action=>action==='set'?{type:'clock_handoff',action,hour:7,minute:30,label:'Agent alarm',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}:action==='snooze'?{type:'clock_handoff',action,snoozeMinutes:12}:{type:'clock_handoff',action},action);
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));await queue(page);await page.getByRole('button',{name:'Close connection settings'}).click();await returnToApps(page);await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Review Clock action');await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');await expect(page.getByText('clock handoff',{exact:true})).toBeVisible();
 // Seed the ringing alarm after navigation, then close its modal explicitly.
 // Closing Clock silences its UI without dismissing or snoozing the alarm.
 if(action==='dismiss'||action==='snooze'){
  await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');await DailyApps.scheduleReminder({id:'alarm_reviewed',title:'Ringing alarm',at:Date.now()+60000});await (await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].status='posted';data.reminders[0].at=Date.now()-1000;});});
  const clock=page.getByRole('dialog',{name:'Clock alarms',exact:true});await expect(clock).toBeVisible();await clock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(clock).toHaveCount(0);
  expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0].status)).toBe('posted');
 }
 expect((await state(page)).journal).toHaveLength(0);await page.getByText('clock handoff',{exact:true}).click();await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');expect((await state(page)).journal[0].result.clockResult).toEqual({kind:'clock-handoff',action,status:'opened'});
 if(action==='show')await expect(page.getByRole('dialog',{name:'Clock alarms',exact:true})).toBeVisible();
 else{const rows=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders);expect(rows).toHaveLength(1);expect(rows[0].status).toBe(action==='dismiss'?'completed':'scheduled');if(action==='set')expect(rows[0].title).toBe('Agent alarm');if(action==='snooze')expect(rows[0].at-Date.now()).toBeGreaterThan(11*60000);}
});

test('development reminder recovers an applied effect after terminal journal persistence fails',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));await setup(page);const operation=await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');await DailyApps.scheduleReminder({id:'recovery_reminder',title:'Recovery reminder',at:Date.now()+3600000});window.dispatchEvent(new Event('alpha:reminders-committed'));return {type:'reminder_complete',target:await DailyApps.selectedReminder({id:'recovery_reminder'})};});
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));await queue(page);await page.getByRole('button',{name:'Close connection settings'}).click();await returnToApps(page);await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Recovery reminder,/}).click();await page.getByRole('button',{name:'Type',exact:true}).click();const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();await input.fill('Review completion');await input.press('Enter');await expect(page.getByText('Complete selected reminder',{exact:true})).toBeVisible();
 await page.evaluate(key=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k===key&&JSON.parse(JSON.parse(JSON.parse(v.raw).value).actions).journal.some((e:any)=>e.phase==='terminal'))throw Error('Full');return put.call(this,v,k);};},key);await page.getByText('Complete selected reminder',{exact:true}).click();await expect.poll(()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0].status)).toBe('completed');await expect(page.getByText(/Action did not reach a confirmed result/).first()).toBeVisible();expect((await state(page)).journal[0].phase).toBe('applying');const before=await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()));
 await page.reload();await open(page);await page.getByText('Development device actions',{exact:true}).click();await page.getByRole('button',{name:'Sync recorded receipts'}).click();await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');expect((await state(page)).journal[0].summary).toContain('No action was repeated');expect(await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()))).toBe(before);await page.getByRole('button',{name:'Sync recorded receipts'}).click();expect(await page.evaluate(async ()=>(await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw()))).toBe(before);
});

test('development selected no-alert reminder completes only after approval and keeps its receipt on reload',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));await setup(page);
 const operation=await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');await DailyApps.scheduleReminder({id:'silent_review',title:'Silent reviewed reminder',at:Date.now()+3600000,dueAt:Date.now()+3600000,alertMinutes:null});window.dispatchEvent(new Event('alpha:reminders-committed'));return {type:'reminder_complete',target:await DailyApps.selectedReminder({id:'silent_review'})};});
 expect(operation.target.timingVersion).toBe(2);
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));await queue(page);await page.getByRole('button',{name:'Close connection settings'}).click();await returnToApps(page);await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Silent reviewed reminder,/}).click();await page.getByRole('button',{name:'Type',exact:true}).click();const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();await input.fill('Review completion');await input.press('Enter');
 const rows=()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders);
 await expect(page.getByText('Complete selected reminder',{exact:true})).toBeVisible();expect((await rows())[0].status).toBe('pending');expect((await state(page)).journal).toHaveLength(0);
 await page.getByText('Complete selected reminder',{exact:true}).click();await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');expect((await rows())[0].status).toBe('completed');expect((await rows())[0].alertMinutes).toBeNull();expect((await state(page)).journal).toHaveLength(1);expect((await state(page)).journal[0].phase).toBe('terminal');const recorded=await rows();
 await page.reload();await open(page);await page.getByText('Development device actions',{exact:true}).click();await page.getByRole('button',{name:'Sync recorded receipts'}).click();await expect(page.getByText('completed',{exact:true})).toBeVisible();expect(await rows()).toEqual(recorded);expect((await state(page)).journal).toHaveLength(1);
});

test('agent legacy reminder refuses unsupported no-alert intent before approval',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));await setup(page);
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify({type:'create_reminder',title:'Silent requested task',dueAt:'2026-10-02T13:00:00Z',alertMinutes:null}));
 await page.getByRole('button',{name:'Queue action for review'}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(async key=>(await (await import('/src/browser/documents.ts')).browserDocuments.read(key))??null,key)).toBeNull();
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders)).toEqual([]);
});

for(const mode of ['none','lead','repeat','lost-response','old-native'] as const)test(`reviewed reminder creation preserves ${mode} through approval and restart`,async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));await setup(page);
 const schedule={at:Date.parse('2026-10-02T13:00:00Z')-(mode==='lead'?600000:0),dueAt:Date.parse('2026-10-02T13:00:00Z'),alertMinutes:mode==='lead'?10:null,recurrence:mode==='repeat'?{rule:'daily',zone:'UTC',date:'2026-10-02',time:'13:00',leadMinutes:0}:null};
 const operation={type:'reminder_create',fields:{title:'Reviewed creation',body:'Exact private details',schedule}};
 await page.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));await queue(page);await page.getByRole('button',{name:'Close connection settings'}).click();await returnToApps(page);await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Review reminder creation');await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');await expect(page.getByText('Create reminder',{exact:true})).toBeVisible();
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders)).toEqual([]);
 if(mode==='lost-response'||mode==='old-native')await page.evaluate(async mode=>{const {BrowserDaily}=await import('/src/browser/daily.ts');const DailyApps=BrowserDaily.prototype;if(mode==='old-native'){(DailyApps as any).surfaceInfo=async()=>({reminderTimingVersion:2});return;}const original=DailyApps.operateReminder;(DailyApps as any).operateReminder=async function(input:any){await original.call(this,input);throw Error('Lost native response');};},mode);
 await page.getByText('Create reminder',{exact:true}).click();
 if(mode==='old-native'){await expect.poll(async()=>(await state(page)).journal[0]?.phase).toBe('terminal');expect((await state(page)).journal[0].status).toBe('failed');expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders)).toEqual([]);return;}
 await expect.poll(()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())||'{"reminders":[]}').reminders.length)).toBe(1);
 if(mode==='lost-response')await expect.poll(async()=>(await state(page)).journal[0]?.status).toBe('unknown');else await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');
 const before=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!));expect(before.reminders[0]).toMatchObject({title:operation.fields.title,body:operation.fields.body,at:schedule.at,dueAt:schedule.dueAt,alertMinutes:schedule.alertMinutes,status:mode==='lead'?'scheduled':'pending'});if(mode==='repeat')expect(before.reminders[0].recurrence).toEqual(schedule.recurrence);
 expect(Object.keys(before.receipts)).toHaveLength(1);
 await page.reload();await open(page);await page.getByText('Development device actions',{exact:true}).click();await page.getByRole('button',{name:'Sync recorded receipts'}).click();await expect.poll(async()=>(await state(page)).proposals[0].state).toBe('completed');expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!))).toEqual(before);await page.getByRole('button',{name:'Sync recorded receipts'}).click();expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!))).toEqual(before);
});
