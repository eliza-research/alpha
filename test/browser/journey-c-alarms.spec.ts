/*
 * Journey C (docs/mvp-completion-plan.md "C. Alarms"), browser build.
 *
 * Evidence level: a pass is SOURCE/TEST evidence for the browser development profile only. It is not APK,
 * emulator, AOSP image, physical-device or real-integration evidence.
 *
 * Synthetic parts:
 *  - The agent is the on-device DEVELOPMENT profile; its proposals are authored with the rendered
 *    "Development device actions" -> "Action JSON" control, then reviewed and approved in chat like any proposal.
 *  - The alarm owner is the DEVELOPMENT Clock (apps/app/src/browser/clock.ts, BrowserDaily.clockHandoff): a local
 *    reminder record that rings inside the page. That is why "Alarm saved." is a true statement here.
 *  - Time is moved with page.clock.setFixedTime; no audio device is involved.
 *
 * Native-only / not coverable here (not claimed):
 *  - The Android Clock intent itself (AlarmClock.ACTION_SET_ALARM / SHOW / SNOOZE / DISMISS), the native wording
 *    "Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.", and whether any
 *    installed Clock app created, rang, snoozed or dismissed an alarm.
 *  - No Clock handler, denied access, reboot, DST/time-zone change, Doze, DND, sound and vibration on a device.
 *  - Alarm ownership (docs/decisions.md A-11) is an owner decision; this spec does not decide it. It only checks
 *    that the recorded outcome of the reviewed handoff is "opened" and never a stronger claim.
 */
import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';

test.use({timezoneId:'UTC'});
const LABEL='Journey alarm';
const actions=(page:Page)=>page.evaluate(async()=>(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'actions',()=>({proposals:[],journal:[]}))) as any);
/** Read-only view of persisted development Clock alarms. */
const alarms=(page:Page)=>page.evaluate(async()=>{const raw=await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw();return raw?JSON.parse(raw).reminders.filter((r:any)=>r.id.startsWith('alarm_')).map((r:any)=>({title:r.title,at:r.at,status:r.status})):[];});
const clock=(page:Page)=>page.getByRole('dialog',{name:'Clock alarms',exact:true});
async function openClock(page:Page){await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Clock alarms',exact:true}).click();await expect(clock(page)).toBeVisible();return clock(page);}
async function queue(page:Page,operation:object){
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Development connections'});
 await dialog.getByText('Development device actions',{exact:true}).click();
 await dialog.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify(operation));
 await dialog.getByRole('button',{name:'Queue action for review'}).click();
 await expect(dialog.getByText('Action queued. Send a chat message to review it on the current screen.',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close connection settings'}).click();
 await returnToApps(page);
}
const approve=(page:Page)=>page.getByRole('button',{name:/^clock handoff /});

test('journey C: agent-proposed alarm is reviewed, saved once, survives reload, rings, snoozes, rings again and is dismissed',async({page})=>{
 test.setTimeout(240_000);
 await page.clock.setFixedTime(new Date('2027-06-01T06:00:00Z'));
 await page.goto('/?mode=dev');
 const ask=page.getByRole('textbox',{name:'Ask Alpha',exact:true}),conversation=page.locator('[data-alpha-layer="conversation"]');

 // 1. The development Clock starts empty.
 let dialog=await openClock(page);
 await expect(dialog.getByText('No alarms',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await returnToApps(page);

 // 2. Connect the development agent and let it propose a Clock handoff.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByRole('button',{name:'Connect development profile'}).click();
 await expect(page.getByRole('dialog',{name:'Development connections'})).toHaveCount(0);
 await returnToApps(page);
 await queue(page,{type:'clock_handoff',action:'set',hour:7,minute:15,label:LABEL,timeZone:'UTC'});
 await ask.fill('Set an alarm for 07:15');await ask.press('Enter');

 // 3. Review: the exact request is shown, with no claim about the result, and nothing has run.
 await expect(conversation.getByText('Ask Clock to set 07:15 in UTC named “Journey alarm”. Review the alarm in Clock; Alpha cannot confirm creation or ringing.',{exact:true}).first()).toBeVisible();
 await expect(approve(page)).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Cancel Keep things as they are.',exact:true})).toHaveCount(1);
 expect(await alarms(page)).toEqual([]);
 let state=await actions(page);
 expect(state.proposals.map((p:any)=>p.state)).toEqual(['pending']);expect(state.journal).toEqual([]);

 // 4. Approve once. The durable receipt records only that the handoff was opened.
 await approve(page).click();
 await expect(conversation.getByText('Alarm saved.',{exact:true})).toHaveCount(1);
 await expect(approve(page)).toHaveCount(0);
 state=await actions(page);
 expect(state.proposals).toHaveLength(1);
 expect(state.proposals[0].state).toBe('completed');
 expect(state.proposals[0].receipt.outcome).toBe('applied');
 expect(state.proposals[0].receipt.result).toEqual({kind:'clock-handoff',action:'set',status:'opened'});
 expect(state.journal).toHaveLength(1);
 expect(state.journal[0]).toMatchObject({phase:'terminal',status:'succeeded',summary:'Alarm saved.',result:{clockResult:{kind:'clock-handoff',action:'set',status:'opened'}}});
 // "Alarm saved." is only shown because the development Clock really holds exactly this one alarm.
 const at=Date.parse('2027-06-01T07:15:00Z');
 expect(await alarms(page)).toEqual([{title:LABEL,at,status:'scheduled'}]);
 // Nothing in the conversation claims the alarm rang or will certainly ring.
 await expect(conversation).not.toContainText(/will ring|has rung|alarm (is|was) confirmed|confirmed (the|your) alarm/i);

 // 5. A second reviewed handoff ("show") opens the development Clock on that one alarm.
 await returnToApps(page);
 await queue(page,{type:'clock_handoff',action:'show'});
 await ask.fill('Show my alarms');await ask.press('Enter');
 await expect(approve(page)).toHaveCount(1);
 await expect(clock(page)).toHaveCount(0);
 await approve(page).click();
 dialog=clock(page);await expect(dialog).toBeVisible();
 await expect(dialog.getByText(LABEL,{exact:true})).toHaveCount(1);
 await expect(dialog.getByRole('button',{name:'Delete '+LABEL,exact:true})).toHaveCount(1);
 await expect(dialog.getByText('Ringing',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(async()=>(await actions(page)).proposals.map((p:any)=>[p.payload.operation.action,p.state,p.receipt?.result?.status])).toEqual([['set','completed','opened'],['show','completed','opened']]);
 expect(await alarms(page)).toEqual([{title:LABEL,at,status:'scheduled'}]);

 // 6. Reload: still exactly one alarm, reachable through Calendar -> Clock alarms.
 await page.reload();
 dialog=await openClock(page);
 await expect(dialog.getByText(LABEL,{exact:true})).toHaveCount(1);
 await expect(dialog.getByText('Ringing',{exact:true})).toHaveCount(0);
 expect(await alarms(page)).toEqual([{title:LABEL,at,status:'scheduled'}]);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);

 // 7. Ring in the foreground, snooze, ring again, dismiss.
 await page.clock.setFixedTime(new Date('2027-06-01T07:15:02Z'));
 dialog=clock(page);
 await expect(dialog.getByText('Ringing',{exact:true})).toBeVisible();
 await expect(dialog.getByText(LABEL,{exact:true})).toHaveCount(1);
 await dialog.getByLabel('Snooze minutes',{exact:true}).fill('2');
 await dialog.getByRole('button',{name:'Snooze '+LABEL,exact:true}).click();
 await expect(dialog.getByText('Ringing',{exact:true})).toHaveCount(0);
 await expect(dialog.getByText(LABEL,{exact:true})).toHaveCount(1);
 expect(await alarms(page)).toEqual([{title:LABEL,at:Date.parse('2027-06-01T07:17:02Z'),status:'scheduled'}]);
 await page.clock.setFixedTime(new Date('2027-06-01T07:17:03Z'));
 await expect(dialog.getByText('Ringing',{exact:true})).toBeVisible();
 await expect(dialog.getByText(LABEL,{exact:true})).toHaveCount(1);
 await dialog.getByRole('button',{name:'Dismiss '+LABEL,exact:true}).click();
 await expect(dialog.getByText('No alarms',{exact:true})).toBeVisible();

 // 8. Restart: the dismissed alarm does not ring again, no second alarm appeared, receipts are retained.
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 const after=await alarms(page);
 expect(after).toHaveLength(1);expect(after[0].title).toBe(LABEL);expect(['scheduled','posted']).not.toContain(after[0].status);
 dialog=await openClock(page);
 await expect(dialog.getByText('No alarms',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Ringing',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await returnToApps(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 const connection=page.getByRole('dialog',{name:'Development connections'});
 await connection.getByText('Development device actions',{exact:true}).click();
 await connection.getByRole('button',{name:'Sync recorded receipts'}).click();
 await expect(connection.getByText('completed',{exact:true})).toHaveCount(2);
 state=await actions(page);
 expect(state.proposals.map((p:any)=>[p.payload.operation.action,p.state,p.receipt.result.status])).toEqual([['set','completed','opened'],['show','completed','opened']]);
 expect(state.journal.map((j:any)=>[j.status,j.result.clockResult.status])).toEqual([['succeeded','opened'],['succeeded','opened']]);
});

// Journey hardening (docs/core-loop-audit.md, work order 14): Decline was rendered and never pressed.
test('journey C: a declined alarm proposal hands nothing to Clock, before or after a reload',async({page})=>{
 test.setTimeout(120_000);
 await page.clock.setFixedTime(new Date('2027-06-01T06:00:00Z'));
 await page.goto('/?mode=dev');
 const ask=page.getByRole('textbox',{name:'Ask Alpha',exact:true}),conversation=page.locator('[data-alpha-layer="conversation"]');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByRole('button',{name:'Connect development profile'}).click();
 await expect(page.getByRole('dialog',{name:'Development connections'})).toHaveCount(0);
 await returnToApps(page);
 await queue(page,{type:'clock_handoff',action:'set',hour:7,minute:15,label:LABEL,timeZone:'UTC'});
 await ask.fill('Set an alarm for 07:15');await ask.press('Enter');
 await expect(conversation.getByText('Ask Clock to set 07:15 in UTC named “Journey alarm”. Review the alarm in Clock; Alpha cannot confirm creation or ringing.',{exact:true}).first()).toBeVisible();
 const decline=page.getByRole('button',{name:'Cancel Keep things as they are.',exact:true});
 await expect(approve(page)).toHaveCount(1);
 // A double press is one rejection.
 await decline.dblclick();
 await expect(conversation.getByText('Declined. No phone action was performed.',{exact:true})).toHaveCount(1);
 // The declined card offers neither action again.
 await expect(approve(page)).toHaveCount(0);
 await expect(decline).toHaveCount(0);
 // Nothing was handed off: no alarm, no journal entry, no receipt, and the proposal reads back as rejected.
 expect(await alarms(page)).toEqual([]);
 let state=await actions(page);
 expect(state.proposals.map((p:any)=>[p.payload.operation.action,p.state,p.receipt??null])).toEqual([['set','rejected',null]]);
 expect(state.journal).toEqual([]);
 await expect(conversation).not.toContainText(/Alarm saved|Clock request sent|will ring/);
 await returnToApps(page);
 let dialog=await openClock(page);
 await expect(dialog.getByText('No alarms',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();

 // The alarm's time passes: nothing rings, because nothing was set.
 await page.clock.setFixedTime(new Date('2027-06-01T07:15:02Z'));
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await expect(clock(page)).toHaveCount(0);
 expect(await alarms(page)).toEqual([]);
 // A later message does not bring the declined proposal back for approval.
 await ask.fill('Anything pending?');await ask.press('Enter');
 await expect(page.getByRole('button',{name:/^Message actions: Development reply/})).toHaveCount(1);
 await expect(approve(page)).toHaveCount(0);
 state=await actions(page);
 expect(state.proposals.map((p:any)=>p.state)).toEqual(['rejected']);
 expect(state.journal).toEqual([]);
});
