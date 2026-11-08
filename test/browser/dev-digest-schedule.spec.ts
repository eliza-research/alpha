import {test,expect as baseExpect} from '@playwright/test';
// After a load the digest panel fills from IndexedDB and its first tick; under machine load that has taken longer
// than the 5s default, so expectations wait up to 15s (as in home-daily-overview). What is expected is unchanged.
const expect=baseExpect.configure({timeout:15_000});
// Most tests here load the app more than once (a reload, a second tab or a restart). Each load of the development server
// fetches its ~700 unbundled modules; with four workers on a loaded machine one load has taken 10-20s
// (traces show single module responses of 10s), so the 30s default timed out mid-reload. The timeout
// is explicit and per file; no step, wait or assertion changes.
test.describe.configure({timeout:90_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
test('reviewed snapshot schedule delivers one retained result and survives reload',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});await panel.getByText('Share a snapshot',{exact:true}).click();await panel.getByLabel('Label',{exact:true}).fill('Daily source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Reviewed snapshot content');await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});await panel.getByLabel('Time zone',{exact:true}).fill('UTC');await panel.getByLabel('Morning',{exact:true}).fill('12:01');await panel.getByRole('button',{name:'Review morning schedule',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('button',{name:'Pause result checks',exact:true}).click();await page.clock.runFor(60000);await expect.poll(()=>page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).results.length)).toBe(1);await panel.getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel.getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toBeVisible();
 const first=await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).results);expect(first).toHaveLength(1);await page.reload();await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await expect(panel.getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'Refresh',exact:true}).click();expect(await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).results)).toEqual(first);
});
test('digest mutation replay, lost acknowledgements, revocation and account retirement retain exact identities',async({page})=>{
 await page.goto('/?mode=dev');const result=await page.evaluate(async()=>{
 const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'local'}));const identity=developmentIdentity('local'),call=(path:string,body?:any)=>request(identity,'/api/workflow/hosted/'+path,body),source={id:crypto.randomUUID(),kind:'notes',label:'Reviewed',text:'Saved text',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),confirmed:true};const saved:any=await call('sources',source),again=await call('sources',source);let changed=false;try{await call('sources',{...source,text:'Different'});}catch{changed=true;}
 const time=new Date().toISOString().slice(11,16),body={mutationId:crypto.randomUUID(),confirmed:true,spec:{version:1,template:'morning',sourceId:saved.source.id,sourceRevision:saved.source.revision,timeZone:'UTC',localTime:time,enabled:true}},loop:any=await call('loops',body);await (await import('/src/browser/development-digest-document.ts')).developmentDigestDocument(identity).edit(()=>({loops:[] as any[]}),state=>{state.loops[0].createdAt=Date.now()-120000;});
 const a:any=await call('results?clientId=reader'),b:any=await call('results?clientId=reader');await call('results/ack',{clientId:'reader',cursor:a.entries[0].cursor,runId:a.entries[0].runId});const empty:any=await call('results?clientId=reader');await call('sources/revoke',{id:source.id,confirmed:true});const after:any=await call('results?clientId=other');let stale=false;try{await call('loops',{...body,mutationId:crypto.randomUUID(),id:loop.loop.id,expectedVersionId:'old'});}catch{stale=true;}
 localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'remote'}));let retired=false;try{await call('sources');}catch{retired=true;}
 return {replayed:JSON.stringify(saved)===JSON.stringify(again),changed,same:JSON.stringify(a)===JSON.stringify(b),one:a.entries.length,empty:empty.entries.length,retained:JSON.stringify(a)===JSON.stringify(after),stale,retired};});expect(result).toEqual({replayed:true,changed:true,same:true,one:1,empty:0,retained:true,stale:true,retired:true});
});
for(const scenario of [{name:'repeated clock time runs once at the earlier offset',start:'2026-11-01T05:29:00Z',time:'01:30',ticks:['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'],statuses:['completed']},{name:'skipped clock time runs one gap later and missed days do not replay',start:'2026-03-08T06:59:00Z',time:'02:30',ticks:['2026-03-08T07:30:00Z','2026-03-09T07:00:01Z'],statuses:['completed','missed']}])test(scenario.name,async({page})=>{
 await page.clock.install({time:new Date(scenario.start)});await page.goto('/?mode=dev');await page.evaluate(async time=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'local'}));const i=developmentIdentity('local'),s:any=await request(i,'/api/workflow/hosted/sources',{id:crypto.randomUUID(),kind:'notes',label:'Clock source',text:'Clock text',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3*86400000).toISOString(),confirmed:true});await request(i,'/api/workflow/hosted/loops',{mutationId:crypto.randomUUID(),confirmed:true,spec:{version:1,template:'morning',sourceId:s.source.id,sourceRevision:s.source.revision,enabled:true,timeZone:'America/New_York',localTime:time}});},scenario.time);
 for(const time of scenario.ticks){await page.clock.setFixedTime(new Date(time));await page.evaluate(async()=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');await request(developmentIdentity('local'),'/api/workflow/hosted/tick',undefined);});}// The skipped 02:30 on March 8 runs one gap later, at 03:30 EDT, as the agent's cron scan does. The March 9
 // occurrence passed more than 30 minutes before the next tick (the agent's window, #680): it is recorded once as
 // missed and is never executed late.
 expect(await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).results.map(row=>row.status))).toEqual(scenario.statuses);
});


// Missed-occurrence policy (docs/decisions.md A-09 option under the current documentation): nothing runs
// while the host is down. Development schedules run only while this app is open, so "down" here is a
// closed or sleeping app. The resident agent's own overdue path is scripts/test-local-digest-restart.mjs.
const digestState=(page:import('@playwright/test').Page)=>page.evaluate(async()=>{const state=await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'));return {results:state.results,loops:state.loops};});
const digestCall=(page:import('@playwright/test').Page,path:string,body?:unknown)=>page.evaluate(async({path,body})=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'local'}));return request(developmentIdentity('local'),'/api/workflow/hosted/'+path,body) as Promise<any>;},{path,body});
async function seedLoops(page:import('@playwright/test').Page,templates:Array<{template:'morning'|'evening';localTime:string;text:string}>,zone='UTC'){
 const loops:any[]=[];for(const item of templates){const source=await digestCall(page,'sources',{id:crypto.randomUUID(),kind:'notes',label:item.template+' source',text:item.text,observedAt:new Date(await page.evaluate(()=>Date.now())).toISOString(),expiresAt:new Date(await page.evaluate(()=>Date.now())+6*86400000).toISOString(),confirmed:true});
  loops.push({source:source.source,loop:(await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,spec:{version:1,template:item.template,sourceId:source.source.id,sourceRevision:source.source.revision,enabled:true,timeZone:zone,localTime:item.localTime}})).loop});}
 return loops;
}
test('a schedule whose time passed while the app was closed yields exactly one missed record and no backlog',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T07:55:00Z')});await page.goto('/?mode=dev');
 const [{loop}]=await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}]);
 // Three scheduled days pass with no page (the "host") running at all.
 await page.goto('about:blank');await page.clock.setFixedTime(new Date('2026-10-06T09:30:00Z'));await page.goto('/?mode=dev');
 await digestCall(page,'tick');const first=await digestState(page);
 expect(first.results.map(row=>[row.status,row.scheduledAt,row.workflowId,row.workflowVersionId])).toEqual([['missed','2026-10-06T08:00:00.000Z',loop.id,loop.versionId]]);
 expect(first.results[0].output).toEqual({status:'missed',text:'The scheduled time was missed. No backlog was executed.'});expect(first.results[0].error).toBeNull();
 expect(first.results[0].source).toMatchObject({id:loop.spec.sourceId,revision:loop.spec.sourceRevision});
 // Restart, repeated and concurrent admission of the same occurrence settle nothing further.
 await Promise.all([digestCall(page,'tick'),digestCall(page,'tick'),digestCall(page,'results?clientId=reader-a'),digestCall(page,'results?clientId=reader-b')]);await page.reload();await digestCall(page,'tick');
 expect((await digestState(page)).results).toEqual(first.results);
 // The next occurrence runs normally and is a distinct result.
 await page.clock.setFixedTime(new Date('2026-10-07T08:00:20Z'));await digestCall(page,'tick');await digestCall(page,'tick');
 const later=await digestState(page);expect(later.results.map(row=>[row.status,row.scheduledAt])).toEqual([['missed','2026-10-06T08:00:00.000Z'],['completed','2026-10-07T08:00:00.000Z']]);expect(new Set(later.results.map(row=>row.runId)).size).toBe(2);
});

test('a clock set back, a paused schedule and a revoked source never settle an occurrence twice or late',async({page})=>{
 // Held at 07:59:30 while the app loads and the schedule is seeded: with a running clock, a slow load or seed
 // under machine load carried the creation itself past 08:00, so the first occurrence was never due.
 await page.clock.install({time:new Date('2026-10-03T07:59:30Z')});await page.clock.setFixedTime(new Date('2026-10-03T07:59:30Z'));await page.goto('/?mode=dev');
 const [{loop,source}]=await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}]);
 await page.clock.setFixedTime(new Date('2026-10-03T08:00:05Z'));await digestCall(page,'tick');expect((await digestState(page)).results.map(row=>row.status)).toEqual(['completed']);
 // Clock moved back across the same occurrence, then forward again within the day.
 await page.clock.setFixedTime(new Date('2026-10-03T07:58:00Z'));await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-03T08:00:30Z'));await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-02T08:00:10Z'));await digestCall(page,'tick');
 expect((await digestState(page)).results.map(row=>row.status)).toEqual(['completed']);
 // Paused over the next occurrence: no record at all. Re-enabling starts from the re-enable time.
 await page.clock.setFixedTime(new Date('2026-10-03T12:00:00Z'));const paused=(await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,id:loop.id,expectedVersionId:loop.versionId,spec:{...loop.spec,enabled:false}})).loop;
 await page.clock.setFixedTime(new Date('2026-10-04T08:00:10Z'));await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-04T12:00:00Z'));await digestCall(page,'tick');
 const enabled=(await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,id:loop.id,expectedVersionId:paused.versionId,spec:{...loop.spec,enabled:true}})).loop;await digestCall(page,'tick');
 expect((await digestState(page)).results.map(row=>row.status)).toEqual(['completed']);expect(enabled.versionId).not.toBe(loop.versionId);
 // Revoked before the next occurrence: no run and no failure brief. Like the agent, one explicit
 // "unavailable" record is written for that occurrence and the schedule is then paused: no later catch-up.
 await digestCall(page,'sources/revoke',{id:source.id,confirmed:true});await page.clock.setFixedTime(new Date('2026-10-05T08:00:10Z'));await digestCall(page,'tick');await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-05T10:00:00Z'));await digestCall(page,'tick');
 await page.clock.setFixedTime(new Date('2026-10-06T08:00:10Z'));await digestCall(page,'tick');
 const state=await digestState(page);expect(state.results.map(row=>[row.status,row.scheduledAt,row.workflowVersionId])).toEqual([['completed','2026-10-03T08:00:00.000Z',loop.versionId],['unavailable','2026-10-05T08:00:00.000Z',enabled.versionId]]);
 expect(state.results[1].output).toEqual({status:'unavailable',sourceState:'revoked',paused:true,text:'Source revoked. This schedule is paused until you review a new source. No fresh phone data was read.'});
 expect(state.results[1].error).toBeNull();expect(state.results[1].source).toMatchObject({id:source.id,revision:source.revision});
});

// Parity with the pinned agent's digestAdmission (vendor/eliza plugin-workflow hosted-digest.ts): the
// source state is decided before lateness, the run window is 30 minutes, and an occurrence settles once.
test('an expired source yields one unavailable record, even when late, and a renewed schedule runs again',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T07:55:00Z')});await page.goto('/?mode=dev');
 const made=await digestCall(page,'sources',{id:crypto.randomUUID(),kind:'notes',label:'Short source',text:'Short text',observedAt:'2026-10-03T07:55:00.000Z',expiresAt:'2026-10-04T07:00:00.000Z',confirmed:true});
 const loop=(await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,spec:{version:1,template:'morning',sourceId:made.source.id,sourceRevision:made.source.revision,enabled:true,timeZone:'UTC',localTime:'08:00'}})).loop;
 await page.clock.setFixedTime(new Date('2026-10-03T08:00:10Z'));await digestCall(page,'tick');
 // The source expired an hour before the next occurrence, and the app was closed until well after it.
 await page.clock.setFixedTime(new Date('2026-10-04T11:00:00Z'));await Promise.all([digestCall(page,'tick'),digestCall(page,'tick'),digestCall(page,'results?clientId=reader-a')]);await page.reload();await digestCall(page,'tick');
 await page.clock.setFixedTime(new Date('2026-10-05T08:00:10Z'));await digestCall(page,'tick');
 const lapsed=await digestState(page);expect(lapsed.results.map(row=>[row.status,row.scheduledAt])).toEqual([['completed','2026-10-03T08:00:00.000Z'],['unavailable','2026-10-04T08:00:00.000Z']]);
 expect(lapsed.results[1].output).toEqual({status:'unavailable',sourceState:'expired',paused:true,text:'Source expired. This schedule is paused until you renew the source. No fresh phone data was read.'});
 expect(new Set(lapsed.results.map(row=>row.runId)).size).toBe(2);
 // Reviewing a new source for the same schedule resumes it from the next occurrence; nothing is caught up.
 const renewed=await digestCall(page,'sources',{id:crypto.randomUUID(),kind:'notes',label:'Renewed source',text:'Renewed text',observedAt:'2026-10-05T08:00:10.000Z',expiresAt:'2026-10-09T08:00:00.000Z',confirmed:true});
 await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,id:loop.id,expectedVersionId:loop.versionId,spec:{...loop.spec,sourceId:renewed.source.id,sourceRevision:renewed.source.revision}});
 await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-06T08:00:10Z'));await digestCall(page,'tick');await digestCall(page,'tick');
 expect((await digestState(page)).results.map(row=>[row.status,row.scheduledAt])).toEqual([['completed','2026-10-03T08:00:00.000Z'],['unavailable','2026-10-04T08:00:00.000Z'],['completed','2026-10-06T08:00:00.000Z']]);
});

test('an occurrence runs up to 30 minutes late and is missed after that',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T07:55:00Z')});await page.goto('/?mode=dev');
 await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}]);
 // Exactly 30 minutes late still runs, recorded against its scheduled time.
 await page.clock.setFixedTime(new Date('2026-10-03T08:30:00Z'));await digestCall(page,'tick');await digestCall(page,'tick');
 expect((await digestState(page)).results.map(row=>[row.status,row.scheduledAt])).toEqual([['completed','2026-10-03T08:00:00.000Z']]);
 // One second more is missed, once.
 await page.clock.setFixedTime(new Date('2026-10-04T08:30:01Z'));await digestCall(page,'tick');await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-04T08:31:00Z'));await digestCall(page,'tick');
 const state=await digestState(page);expect(state.results.map(row=>[row.status,row.scheduledAt])).toEqual([['completed','2026-10-03T08:00:00.000Z'],['missed','2026-10-04T08:00:00.000Z']]);
 expect(state.results[1].output).toEqual({status:'missed',text:'The scheduled time was missed. No backlog was executed.'});
});

test('a clock jump forward then back still runs the real occurrence once and never repeats the jumped one',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T07:55:00Z')});await page.goto('/?mode=dev');
 await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}]);
 const statuses=async()=>(await digestState(page)).results.map(row=>[row.status,row.scheduledAt]);
 await page.clock.setFixedTime(new Date('2026-10-03T08:00:05Z'));await digestCall(page,'tick');
 // The clock jumps two days ahead onto a scheduled time, which runs; then it is corrected.
 await page.clock.setFixedTime(new Date('2026-10-05T08:00:10Z'));await digestCall(page,'tick');
 await page.clock.setFixedTime(new Date('2026-10-04T07:59:00Z'));await digestCall(page,'tick');
 expect(await statuses()).toEqual([['completed','2026-10-03T08:00:00.000Z'],['completed','2026-10-05T08:00:00.000Z']]);
 // The real October 4 occurrence is due and runs exactly once, across repeated, concurrent and reloaded ticks.
 await page.clock.setFixedTime(new Date('2026-10-04T08:00:05Z'));await Promise.all([digestCall(page,'tick'),digestCall(page,'tick'),digestCall(page,'results?clientId=reader-a')]);await page.reload();await digestCall(page,'tick');
 const ran=[['completed','2026-10-03T08:00:00.000Z'],['completed','2026-10-05T08:00:00.000Z'],['completed','2026-10-04T08:00:00.000Z']];
 expect(await statuses()).toEqual(ran);
 // Time reaches the jumped record again: it already ran and does not run twice. The next day is new.
 await page.clock.setFixedTime(new Date('2026-10-05T08:00:10Z'));await digestCall(page,'tick');await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));await digestCall(page,'tick');
 expect(await statuses()).toEqual(ran);
 await page.clock.setFixedTime(new Date('2026-10-06T08:00:10Z'));await digestCall(page,'tick');await digestCall(page,'tick');
 expect(await statuses()).toEqual([...ran,['completed','2026-10-06T08:00:00.000Z']]);
 expect(new Set((await digestState(page)).results.map(row=>row.runId)).size).toBe(4);
});

test('morning and evening at the same minute produce distinct source-backed results, and an edited time runs once at its new time',async({page})=>{
 // Held before 18:00 while the app loads and both schedules are seeded, whatever that takes.
 await page.clock.install({time:new Date('2026-10-03T17:58:00Z')});await page.clock.setFixedTime(new Date('2026-10-03T17:58:00Z'));await page.goto('/?mode=dev');
 const [morning,evening]=await seedLoops(page,[{template:'morning',localTime:'18:00',text:'Morning source text'},{template:'evening',localTime:'18:00',text:'Evening source text'}]);
 await page.clock.setFixedTime(new Date('2026-10-03T18:00:10Z'));await Promise.all([digestCall(page,'tick'),digestCall(page,'tick')]);
 const both=(await digestState(page)).results;expect(both.map(row=>row.status)).toEqual(['completed','completed']);
 expect(both.map(row=>row.workflowId).sort()).toEqual([morning.loop.id,evening.loop.id].sort());expect(new Set(both.map(row=>row.runId)).size).toBe(2);
 expect(both.find(row=>row.workflowId===morning.loop.id)!.source).toMatchObject({id:morning.source.id,revision:morning.source.revision});expect(both.find(row=>row.workflowId===evening.loop.id)!.source).toMatchObject({id:evening.source.id,revision:evening.source.revision});
 // Edit the evening time after it already ran today: the new, later time is its own occurrence and runs exactly once under the new version.
 const edited=(await digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,id:evening.loop.id,expectedVersionId:evening.loop.versionId,spec:{...evening.loop.spec,localTime:'18:05'}})).loop;
 await page.clock.setFixedTime(new Date('2026-10-03T18:05:10Z'));await digestCall(page,'tick');await digestCall(page,'tick');
 const after=(await digestState(page)).results;expect(after.map(row=>[row.workflowId,row.workflowVersionId,row.scheduledAt])).toEqual([...both.map(row=>[row.workflowId,row.workflowVersionId,row.scheduledAt]),[evening.loop.id,edited.versionId,'2026-10-03T18:05:00.000Z']]);
 // A stale version cannot edit, and its mutation replay returns the same receipt without another schedule.
 await expect(digestCall(page,'loops',{mutationId:crypto.randomUUID(),confirmed:true,id:evening.loop.id,expectedVersionId:evening.loop.versionId,spec:{...evening.loop.spec,localTime:'19:00'}})).rejects.toThrow(/Digest version changed/);
 expect((await digestState(page)).loops.filter(row=>!row.removed)).toHaveLength(2);
});

test('reopening after a missed time shows one honest missed record and one notice, never a late brief',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
 await expect(panel).toContainText('Schedules run while this app is open. If scheduled times pass while it is not running, one is recorded below as missed and none is run later.');
 await panel.getByText('Share a snapshot',{exact:true}).click();await panel.getByLabel('Label',{exact:true}).fill('Daily source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Reviewed snapshot content');await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});await panel.getByLabel('Time zone',{exact:true}).fill('UTC');await panel.getByLabel('Morning',{exact:true}).fill('12:05');
 await expect(panel).toContainText('Only these digests are scheduled; workflows you build run when you start them.');
 await panel.getByRole('button',{name:'Review morning schedule',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();await expect(panel.getByRole('region',{name:'Digest schedules',exact:true})).toContainText('Morning at 12:05 (UTC)');
 // The app is closed across two scheduled days, then reopened 40 minutes after the latest one.
 await page.goto('about:blank');await page.clock.setFixedTime(new Date('2026-10-05T12:45:00Z'));await page.goto('/?mode=dev');await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));
 const records=panel.locator('article');await expect(records).toHaveCount(1);await expect(records).toContainText('Missed — not run');await expect(records).toContainText('The scheduled time was missed. No backlog was executed.');
 await expect(records.getByText('Execution details',{exact:true})).toHaveCount(0);await expect(panel.getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toHaveCount(0);
 const notices=()=>page.evaluate(async()=>(await (await import('/src/browser/hosted-results.ts')).browserHostedResults.list()).length);await expect.poll(notices).toBe(1);
 // Refresh, a second open tab's tick and a reload neither add a record nor post a second notice.
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel.getByText('Synced with this agent.',{exact:true})).toBeVisible();
 const second=await page.context().newPage();await second.clock.install({time:new Date('2026-10-05T12:45:30Z')});await second.goto('/?mode=dev');await second.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await expect(second.getByRole('dialog',{name:'Scheduled digests',exact:true}).locator('article')).toHaveCount(1);await second.close();
 await page.reload();await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await expect(records).toHaveCount(1);await expect(records).toContainText('Missed — not run');
 expect((await digestState(page)).results.map(row=>[row.status,row.scheduledAt])).toEqual([['missed','2026-10-05T12:05:00.000Z']]);expect(await notices()).toBe(1);
});

test.describe('device in another time zone',()=>{
 test.use({timezoneId:'Europe/Paris'});
 test('a schedule reviewed in one time zone says so when the device clock is in another',async({page})=>{
  await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});
  await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
  await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}],'America/New_York');await seedLoops(page,[{template:'evening',localTime:'18:00',text:'Evening text'}],'Europe/Paris');
  await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const schedules=page.getByRole('dialog',{name:'Scheduled digests',exact:true}).getByRole('region',{name:'Digest schedules',exact:true});
  await expect(schedules.getByRole('listitem').filter({hasText:'Morning at 08:00 (America/New_York)'})).toContainText('Runs at 08:00 America/New_York time, not this device’s current time zone (Europe/Paris). Review the schedule to change it.');
  await expect(schedules.getByRole('listitem').filter({hasText:'Evening at 18:00 (Europe/Paris)'})).not.toContainText('Runs at');
 });
});

test('two tabs ticking the same occurrence settle it once, run or missed, and a zone change keeps the first occurrence in the new zone',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T07:55:00Z')});await page.goto('/?mode=dev');
 await seedLoops(page,[{template:'morning',localTime:'08:00',text:'Morning text'}]);
 const other=await page.context().newPage();await other.clock.install({time:new Date('2026-10-03T07:55:00Z')});await other.goto('/?mode=dev');
 const statuses=async()=>(await digestState(page)).results.map(row=>[row.status,row.scheduledAt]);
 const both=async(time:string)=>{for(const tab of [page,other])await tab.clock.setFixedTime(new Date(time));
  await Promise.all([digestCall(page,'tick'),digestCall(other,'tick'),digestCall(page,'results?clientId=reader-a'),digestCall(other,'results?clientId=reader-b'),digestCall(other,'tick'),digestCall(page,'tick')]);};
 await both('2026-10-03T08:00:05Z');await other.reload();await both('2026-10-03T08:00:40Z');
 expect(await statuses()).toEqual([['completed','2026-10-03T08:00:00.000Z']]);
 // Both tabs wake after the next day's time has passed: one missed record between them.
 await both('2026-10-04T09:10:00Z');await both('2026-10-04T09:10:30Z');
 expect(await statuses()).toEqual([['completed','2026-10-03T08:00:00.000Z'],['missed','2026-10-04T08:00:00.000Z']]);
 // Round-4 case: one tab's clock had jumped ahead and settled a later day; the real day is slept through.
 // It is recorded once as missed rather than passing without a record.
 await both('2026-10-07T08:00:05Z');await both('2026-10-06T08:40:00Z');await both('2026-10-06T08:41:00Z');
 const jumped=[['completed','2026-10-03T08:00:00.000Z'],['missed','2026-10-04T08:00:00.000Z'],['completed','2026-10-07T08:00:00.000Z'],['missed','2026-10-06T08:00:00.000Z']];
 expect(await statuses()).toEqual(jumped);
 // The schedule moves to America/Los_Angeles, same local time. "2026-10-07T08:00" was settled in UTC, but in
 // Los Angeles it is a later instant that has not happened: it still runs, once across both tabs.
 await both('2026-10-07T09:00:00Z');
 const state=await digestState(page),loop=state.loops[0];expect(loop.lastOccurrence).toBe('2026-10-07T08:00');
 await digestCall(page,'loops',{confirmed:true,mutationId:'zone-change',id:loop.id,expectedVersionId:loop.versionId,spec:{...loop.spec,timeZone:'America/Los_Angeles'}});
 const moved=(await digestState(page)).loops[0];expect([moved.lastOccurrence,moved.settledOccurrences,moved.settledFloor]).toEqual([undefined,undefined,undefined]);
 await both('2026-10-07T15:00:05Z');await both('2026-10-07T15:00:30Z');
 expect(await statuses()).toEqual([...jumped,['completed','2026-10-07T15:00:00.000Z']]);
 expect(new Set((await digestState(page)).results.map(row=>row.runId)).size).toBe(5);
});
