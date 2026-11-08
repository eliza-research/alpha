/*
 * Journey D (docs/mvp-completion-plan.md "D. Two hosted loops with the phone powered off"), browser build.
 *
 * Evidence level: a pass is SOURCE/TEST evidence for the browser development profile only. It is not APK,
 * emulator, AOSP image, physical-device, hosted-service or real-integration evidence.
 *
 * Synthetic parts:
 *  - The agent and the digest scheduler are the on-device DEVELOPMENT profile
 *    (apps/app/src/browser/development-digests.ts): schedules run in this page while it is open, and every digest
 *    "output" is the saved scripted development reply. No model, hosted worker, account or network.
 *  - The source is a typed snapshot reviewed in the panel; no mail, calendar or task provider is read.
 *  - Time is moved with page.clock, paused before the first occurrence so only the test advances it. "App closed"
 *    is modelled by navigating to about:blank across a scheduled time.
 *
 * Native-only / not coverable here (not claimed):
 *  - Hosted execution while the phone is POWERED OFF and delivery once on reconnect. That is owner decision A-09
 *    (docs/decisions.md); this spec does not decide it and proves nothing about it. The panel itself says
 *    "Schedules run while this app is open."
 *  - Resident-runtime restart/crash recovery (scripts/test-local-digest-restart.mjs), Doze/battery/lock, real
 *    provider sources, result notifications on a device.
 *
 * Missed occurrences follow the proposed scheduler policy ("explicit missed/overlap records", no backlog replay):
 * a scheduled time that passed while the app was closed (and is beyond the shared 30-minute run window,
 * DIGEST_RUN_WINDOW_MS) leaves exactly one `missed` record, is never run late, is
 * labelled "Missed — not run" in the panel and does not replace the last real brief on Home (asserted on the
 * rendered Home card; the development profile reads the same latestRetainedDigest source as the product profile). The resident engine's
 * own restart behaviour is covered by scripts/test-local-digest-restart.mjs, not here.
 */
import {test,expect,type Page} from '@playwright/test';

test.use({timezoneId:'UTC'});
const OUTPUT='Journey D digest text';
// Shape written by apps/app/src/browser/development-digests.ts (also asserted in dev-digest-schedule.spec.ts).
const MISSED={status:'missed',text:'The scheduled time was missed. No backlog was executed.'};
const panelOf=(page:Page)=>page.getByRole('dialog',{name:'Scheduled digests',exact:true});
/** Read-only view of the development digest document. */
const digests=(page:Page)=>page.evaluate(async()=>{
 const d:any=await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'));
 return {loops:d.loops.map((l:any)=>({id:l.id,template:l.spec.template,localTime:l.spec.localTime,timeZone:l.spec.timeZone,active:l.active})),results:d.results.map((r:any)=>({cursor:r.cursor,runId:r.runId,workflowId:r.workflowId,scheduledAt:r.scheduledAt,status:r.status,output:r.output})),acks:Object.values(d.acks) as number[]};
});
/**
 * The brief card as Home renders it (the workflows tile). Located in the DOM because the digest panel
 * is a modal over Home at some of the points it is read; where Home is the visible screen the
 * assertions below also require the card to be visible.
 */
const homeBrief=(page:Page)=>page.locator('button[aria-label^="Open workflows"]');
/** The dedicated "Latest brief" card (MVP-19): present only while a real brief is retained. */
const briefCard=(page:Page)=>page.locator('[data-alpha-home-brief]');
const BRIEF=(when:string)=>`Open workflows. Latest brief from On-device agent · development, ran ${when}: ${OUTPUT}`;
/** Move the page clock to an instant without running every intermediate timer. */
/** Read-only: the retained brief Home presents (apps/app/src/runtime/hosted-digests.ts). */
const retainedBrief=(page:Page)=>page.evaluate(async()=>(await import('/src/runtime/hosted-digests.ts')).latestRetainedDigest());
/**
 * Run the paused page clock forward one second at a time. The development scheduler ticks every 15s and
 * skips a tick while the previous one is still writing; one runFor over many ticks fires them all in
 * the same burst, so a slow write could swallow the tick that was due. Second by second, each tick's
 * write completes long before the next is due, so every scheduled tick is admitted.
 */
async function tickFor(page:Page,ms:number){for(let left=ms;left>0;left-=1000)await page.clock.runFor(Math.min(1000,left));}
async function advanceTo(page:Page,iso:string){const delta=Date.parse(iso)-await page.evaluate(()=>Date.now());expect(delta).toBeGreaterThan(0);await page.clock.fastForward(delta);}
async function connect(page:Page){
 await page.goto('/?mode=dev');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Development connections'});
 await dialog.getByRole('textbox',{name:'Scripted reply'}).fill(OUTPUT);
 await dialog.getByRole('button',{name:'Save development reply'}).click();
 await expect(page.getByRole('status').filter({hasText:'Development reply saved.'})).toBeVisible();
 await dialog.getByRole('button',{name:'Connect development profile'}).click();
 await expect(dialog).toHaveCount(0);
}
/** Settings -> Scheduled digests is the rendered entry point. */
async function openDigests(page:Page){
 if(!await page.getByRole('heading',{name:'Settings',exact:true}).isVisible())await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Scheduled digests',exact:true}).click();
 const panel=panelOf(page);await expect(panel).toBeVisible();return panel;
}
async function createSchedules(page:Page){
 const panel=await openDigests(page);
 await expect(panel.getByText('Schedules run while this app is open. If scheduled times pass while it is not running, one is recorded below as missed and none is run later.',{exact:true})).toBeVisible();
 await panel.getByText('Share a snapshot',{exact:true}).click();
 await panel.getByLabel('Label',{exact:true}).fill('Journey source');
 await panel.getByLabel('Snapshot text',{exact:true}).fill('Reviewed snapshot content');
 await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();
 await expect(panel.getByText(/^Share this tasks snapshot with the connected agent\./)).toBeVisible();
 await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});
 await panel.getByLabel('Time zone',{exact:true}).fill('UTC');
 for(const [template,label,time] of [['morning','Morning','07:00'],['evening','Evening','19:00']] as const){
  await panel.getByLabel(label,{exact:true}).fill(time);
  await panel.getByRole('button',{name:`Review ${template} schedule`,exact:true}).click();
  await expect(panel.getByText(new RegExp(`^Enable ${template} digest at ${time} in UTC, every day\\. Source: Journey source\\.`))).toBeVisible();
  await expect(panel.getByText(/No email delivery or device action is authorized\.$/)).toBeVisible();
  await panel.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(panel.getByRole('region',{name:'Digest schedules'}).getByRole('listitem').filter({hasText:`${label} at ${time} (UTC) · Journey source · On`})).toHaveCount(1);
 }
 await expect(panel.getByRole('region',{name:'Digest schedules'}).getByRole('listitem')).toHaveCount(2);
 return panel;
}

test('journey D: morning and evening digests run once each, are retained and acknowledged, and a missed time is not replayed',async({page})=>{
 test.setTimeout(300_000);
 // The clock runs (from well before the first occurrence) while the panel is driven, then is paused
 // just before 07:00: from there the page's time moves only when this test moves it, so the
 // "restart inside the scheduled minute" step no longer depends on how long a reload takes.
 await page.clock.install({time:new Date('2026-10-03T06:50:00Z')});
 await connect(page);

 // 1. Create both schedules through the rendered panel.
 let panel=await createSchedules(page);
 let state=await digests(page);
 expect(state.loops.map(l=>[l.template,l.localTime,l.timeZone,l.active])).toEqual([['morning','07:00','UTC',true],['evening','19:00','UTC',true]]);
 expect(state.results).toEqual([]);
 const [morning,evening]=state.loops.map(l=>l.id);
 // Schedules exist and nothing has run: Home says there is no brief.
 await expect(homeBrief(page)).toHaveAttribute('aria-label','Open workflows');
 await expect(homeBrief(page)).toContainText('No brief yet');
 await expect(briefCard(page)).toHaveCount(0);

 // 2. Morning occurrence: exactly one retained result, shown once, delivery acknowledged.
 // The development scheduler ticks every 15s; 16s past 07:00 always holds one tick at or after it,
 // and the restart below still lands inside the 07:00 minute.
 await page.clock.pauseAt(new Date('2026-10-03T06:59:58Z'));
 await tickFor(page,18_000);
 await expect.poll(async()=>(await digests(page)).results.length).toBe(1);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('article')).toHaveCount(1);
 await expect(panel.getByRole('article').getByText('10/3/2026, 7:00:00 AM · completed',{exact:true})).toHaveCount(1);
 await expect(panel.getByRole('article').first()).toContainText(OUTPUT);
 await expect.poll(async()=>(await digests(page)).acks).toEqual([1]);
 state=await digests(page);
 expect(state.results.map(r=>[r.workflowId,r.scheduledAt,r.status,r.output])).toEqual([[morning,'2026-10-03T07:00:00.000Z','completed',OUTPUT]]);
 const first=state.results[0];

 // 3. Restart inside the scheduled minute: the occurrence is not admitted a second time.
 expect(new Date(await page.evaluate(()=>Date.now())).toISOString().slice(0,16)).toBe('2026-10-03T07:00');
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await tickFor(page,20_000);
 expect(new Date(await page.evaluate(()=>Date.now())).toISOString().slice(0,16)).toBe('2026-10-03T07:00');
 expect((await digests(page)).results).toEqual([first]);
 // Home, the visible screen after the restart, shows that morning brief: its text, its agent and when it ran.
 await expect(homeBrief(page)).toBeVisible();
 await expect(homeBrief(page)).toHaveAttribute('aria-label',BRIEF('7:00 AM'));
 await expect(homeBrief(page)).toContainText(OUTPUT);
 await expect(homeBrief(page)).toContainText('Ran 7:00 AM');
 await expect(briefCard(page)).toBeVisible();await expect(briefCard(page)).toContainText(OUTPUT);
 await expect(briefCard(page)).toHaveAttribute('data-alpha-home-brief-failed','false');

 // 4. Evening occurrence after that restart: one more result, for the evening schedule only.
 await advanceTo(page,'2026-10-03T18:59:30Z');
 await tickFor(page,60_000);
 await expect.poll(async()=>(await digests(page)).results.length).toBe(2);
 panel=await openDigests(page);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('article')).toHaveCount(2);
 await expect(panel.getByRole('article').getByText('10/3/2026, 7:00:00 AM · completed',{exact:true})).toHaveCount(1);
 await expect(panel.getByRole('article').getByText('10/3/2026, 7:00:00 PM · completed',{exact:true})).toHaveCount(1);
 await expect.poll(async()=>(await digests(page)).acks).toEqual([2]);
 state=await digests(page);
 expect(state.results[0]).toEqual(first);
 expect([state.results[1].workflowId,state.results[1].scheduledAt,state.results[1].status,state.results[1].output]).toEqual([evening,'2026-10-03T19:00:00.000Z','completed',OUTPUT]);
 expect(new Set(state.results.map(r=>r.runId)).size).toBe(2);
 const firstDay=state.results;

 // 5. Missed occurrence: the app is closed across the next morning time, then started again.
 await page.goto('about:blank');
 await advanceTo(page,'2026-10-04T07:40:00Z');
 await page.goto('/?mode=dev');
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await tickFor(page,60_000);
 // Exactly one explicit record for 2026-10-04 07:00: status missed, never run late (no model output), and the
 // first day's results are untouched. No backlog replay.
 await expect.poll(async()=>(await digests(page)).results.length).toBe(3);
 state=await digests(page);
 expect(state.results.slice(0,2)).toEqual(firstDay);
 expect([state.results[2].workflowId,state.results[2].scheduledAt,state.results[2].status,state.results[2].output]).toEqual([morning,'2026-10-04T07:00:00.000Z','missed',MISSED]);
 expect(new Set(state.results.map(r=>r.runId)).size).toBe(3);
 panel=await openDigests(page);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('status')).toHaveText('Synced with this agent.');
 await expect(panel.getByRole('article')).toHaveCount(3);
 await expect(panel.getByText(/A missed schedule does not replay a backlog\./)).toBeVisible();
 await expect(panel.getByRole('region',{name:'Digest schedules'}).getByRole('listitem')).toHaveCount(2);
 // The panel labels it as not run, once, and shows no scripted output for it.
 const missedArticle=panel.getByRole('article').filter({hasText:'10/4/2026, 7:00:00 AM'});
 await expect(missedArticle).toHaveCount(1);
 await expect(missedArticle).toContainText('Missed — not run');
 await expect(missedArticle).toContainText(MISSED.text);
 await expect(missedArticle).not.toContainText(OUTPUT);
 await expect(panel.getByRole('article').filter({hasText:'Missed — not run'})).toHaveCount(1);
 await expect.poll(async()=>(await digests(page)).acks).toEqual([3]);
 // The missed record does not replace the last real brief: the value Home reads (latestRetainedDigest,
 // filled by this sync) and the card Home renders both still carry the evening brief of the day before.
 expect(await retainedBrief(page)).toMatchObject({summary:OUTPUT,ranAt:expect.stringMatching(/^2026-10-03T19:0/),status:'completed'});
 await expect(homeBrief(page)).toHaveAttribute('aria-label',BRIEF('Sat, Oct 3 7:00 PM'));
 await expect(homeBrief(page)).not.toContainText(/missed|not run/i);
 // A later tick and a restart settle nothing further for that occurrence.
 await tickFor(page,120_000);
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await tickFor(page,60_000);
 // After the restart Home is the visible screen and shows the same last real brief, never the missed record.
 await expect(homeBrief(page)).toBeVisible();
 await expect(homeBrief(page)).toHaveAttribute('aria-label',BRIEF('Sat, Oct 3 7:00 PM'));
 await expect(homeBrief(page)).toContainText(OUTPUT);
 await expect(homeBrief(page)).toContainText('Ran Sat, Oct 3 7:00 PM');
 await expect(briefCard(page)).toBeVisible();await expect(briefCard(page)).toContainText(OUTPUT);
 await expect(briefCard(page)).not.toContainText(/missed|not run/i);
 await expect(homeBrief(page)).not.toContainText(/missed|not run/i);
 expect((await digests(page)).results).toEqual(state.results);
 panel=await openDigests(page);

 // 6. The schedules survived: the next evening occurrence runs once.
 await advanceTo(page,'2026-10-04T18:59:30Z');
 await tickFor(page,60_000);
 await expect.poll(async()=>(await digests(page)).results.length).toBe(4);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('article')).toHaveCount(4);
 await expect(panel.getByRole('article').getByText('10/4/2026, 7:00:00 PM · completed',{exact:true})).toHaveCount(1);
 await expect.poll(async()=>(await digests(page)).acks).toEqual([4]);
 const afterMissed=state.results;
 state=await digests(page);
 expect(state.results.slice(0,3)).toEqual(afterMissed);
 expect([state.results[3].workflowId,state.results[3].scheduledAt,state.results[3].status,state.results[3].output]).toEqual([evening,'2026-10-04T19:00:00.000Z','completed',OUTPUT]);
 const all=state.results;

 // 7. Final restart: history and acknowledgement are retained exactly; nothing is delivered or run again.
 await page.reload();
 panel=await openDigests(page);
 await expect(panel.getByRole('article')).toHaveCount(4);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('status')).toHaveText('Synced with this agent.');
 await expect(panel.getByRole('article')).toHaveCount(4);
 state=await digests(page);
 expect(state.results).toEqual(all);
 expect(state.acks).toEqual([4]);
 expect(new Set(state.results.map(r=>r.workflowId+'|'+r.scheduledAt)).size).toBe(4);
});

// Proposed policy (docs/mvp-completion-plan.md section D): "explicit missed/overlap records". A schedule whose
// only occurrence so far passed while the app was closed has no earlier brief: the single record is the missed one.
test('journey D: an occurrence missed while the app was closed leaves one explicit missed record and no brief for Home',async({page})=>{
 test.setTimeout(240_000);
 await page.clock.install({time:new Date('2026-10-03T06:50:00Z')});
 await connect(page);
 await createSchedules(page);
 // Frozen before the occurrence, however long the panel took: 07:00 must pass only while the app is closed.
 await page.clock.pauseAt(new Date('2026-10-03T06:59:00Z'));
 await page.goto('about:blank');
 await advanceTo(page,'2026-10-03T07:40:00Z');
 await page.goto('/?mode=dev');
 await tickFor(page,60_000);
 const state=await digests(page);
 expect(state.results.map(r=>[r.scheduledAt,r.status,r.output])).toEqual([['2026-10-03T07:00:00.000Z','missed',MISSED]]);
 const panel=await openDigests(page);
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(panel.getByRole('article').filter({hasText:'Missed — not run'})).toHaveCount(1);
 await expect(panel.getByRole('article')).toHaveCount(1);
 await expect.poll(async()=>(await digests(page)).acks).toEqual([1]);
 // The delivered missed record is not a brief: Home has nothing to show for this schedule.
 expect(await retainedBrief(page)).toBeNull();
 await expect(homeBrief(page)).toHaveAttribute('aria-label','Open workflows');
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await tickFor(page,60_000);
 // The card Home renders says so, and names neither a brief nor the missed occurrence.
 await expect(homeBrief(page)).toBeVisible();
 await expect(homeBrief(page)).toHaveAttribute('aria-label','Open workflows');
 await expect(homeBrief(page)).toContainText('No brief yet');
 await expect(briefCard(page)).toHaveCount(0);
 await expect(homeBrief(page)).not.toContainText(/missed|not run|Journey D/i);
 expect((await digests(page)).results).toEqual(state.results);
});
