import {openBrowserCalendar} from './helpers/browser-calendar';
import {presentDeviceRecordOperation} from '../../apps/app/src/runtime/device-record-presentation.ts';
import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration and real browser Calendar storage/review. Connection and journal
// boundaries are controlled fixtures; no real agent or external calendar is used.
for (const mode of ['read', 'update', 'delete', 'cancel', 'stale'] as const) {
  test(`browser assistant recurring Calendar action: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map();
      if(!localStorage.getItem('alpha.browser.calendar.v1')){const start=new Date();start.setHours(12,0,0,0);(localStorage.getItem('alpha.browser.calendar.v1')===null&&localStorage.setItem('alpha.browser.calendar.v1',JSON.stringify({sourceRevision:'b'.repeat(64),events:[{id:'selected-event',calendarId:'local',title:'Selected private event',body:'Private description',location:'Private location',begin:start.getTime(),end:start.getTime()+3600000,revision:'c'.repeat(64),repeat:'daily',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}]})));}
      const agentId = '12345678-1234-4234-8234-123456789abc';
      const fixture = w.recoveryFixture = { posts: 0, lists: 0, decisions: 0, claims: 0, receipts: 0, effects: 0, journal: [] as string[], proposal: null as any };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      w.Capacitor = {
        PluginHeaders: [
          { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite','secureCompareExchange', 'secureRemove']) },
          { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'get', 'list', 'recoverDeletion']) },
        ],
        nativePromise: async (plugin: string, method: string, input: any) => {
          if (plugin === 'AlphaActionJournal') {
            fixture.journal.push(method);
            if (method === 'reserve') { w.calendarEntry={...structuredClone(input),phase:'reserved'}; return { created: true, entry: structuredClone(w.calendarEntry) }; }
            if (method === 'markApplying') { Object.assign(w.calendarEntry,{phase:'applying',attemptId:input.attemptId});return {}; }
            if(method==='get')return {entry:structuredClone(w.calendarEntry)};
            if(method==='list')return {entries:w.calendarEntry?[structuredClone(w.calendarEntry)]:[]};
            if(method==='recoverDeletion'){const {deletions}=await import('/src/runtime/deletions.ts');const {recovery}=await deletions.receipt({entry:structuredClone(w.calendarEntry)});if(recovery){Object.assign(w.calendarEntry,recovery,{phase:'terminal'});w.calendarRetained=structuredClone(w.calendarEntry);}return {entry:structuredClone(w.calendarEntry)};}
            if (method === 'finish') {
              w.calendarRetained = structuredClone(input);Object.assign(w.calendarEntry,structuredClone(input),{phase:'terminal'});

              return {};
            }
            throw Error('Unexpected journal call');
          }
          if (plugin !== 'AlphaConnection') throw Error('Unexpected native effect');
          if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
          if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
          if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
          if (method === 'secureRemove') { store.delete(input.slot); return {}; }
          if (method === 'cancel') return {};
          const pathname = new URL(input.url).pathname;
          const ok = (data: any) => ({ status: 200, data });
          if (pathname === '/api/auth/status') return ok({ required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'recovery-fixture', expiresAt: Date.now() + 60000 });
          if (pathname === '/api/auth/pair') return ok({ token: 'synthetic-session', identityId: 'fixture-owner', access: 'owner', instanceId: 'recovery-fixture' });
          if (input.headers.Authorization !== 'Bearer synthetic-session') throw Error('Unpaired request');
          if (pathname === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', displayName: 'Fixture owner', kind: 'owner' }, session: { id: 'synthetic-session', kind: 'machine', expiresAt: Date.now() + 600000 }, access: { role: 'OWNER', mode: 'session' } });
          if (pathname === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Recovery fixture', status: 'running' }] });
          if (pathname === '/api/client-devices/register') {
            w.calendarInstallation=input.headers['X-Eliza-Device-Id'];
            return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: ['reminders.local-record.v1','calendar.local-event.v1'] });
          }
          if (pathname === '/api/workflow/status') return ok({});
          if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
          if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
            if (!input.headers['X-Eliza-Device-Capabilities']?.split(',').includes('calendar.local-event.v1')) throw Error('Calendar capability was not negotiated');
            fixture.posts++;
            const sent=JSON.parse(input.body);w.calendarSent=sent;
            const target=sent.metadata.clientDevice.context.selectedObject;
            const fields={title:'Assistant planned event',description:'Reviewed details',location:'Desk',start:'2027-03-01T12:00:00.000Z',end:'2027-03-01T13:00:00.000Z',timeZone:'Europe/London'};
            const operation={type:mode==='read'?'calendar_read_selected':mode==='delete'?'calendar_delete':'calendar_update',target:{sourceId:target.accountId,sourceRevision:target.sourceRevision,eventId:target.id,revision:target.revision},...(mode!=='read'&&mode!=='delete'?{fields}:{})};
            fixture.proposal={id:'fixture-proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+60000).toISOString(),subjectUserId:'fixture-owner',requestedBy:agentId,action:'device_action',payload:{action:'device_action',version:1,installationId:w.calendarInstallation,enrollmentId:'fixture-enrollment',operation}};
            return ok({ text: 'The request remains incomplete because processing stopped unexpectedly. Recorded tool outcomes are preserved; remaining work has not been completed.', agentName: 'Recovery fixture', terminalFailure: { kind: 'handler_error', code: 'PLANNER_INTERRUPTED_AFTER_ACTION', transient: false } });
          }
          if (pathname === '/api/client-devices/proposals') { fixture.lists++; return ok({proposals:fixture.proposal?[fixture.proposal]:[]}); }
          const body = input.body ? JSON.parse(input.body) : {};
          if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
            if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
            if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; return ok({ proposal: { ...fixture.proposal, state: 'approved' }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/claim')) { fixture.claims++; fixture.proposal={...fixture.proposal,state:'executing',execution:{attemptId:'fixture-attempt'}}; return ok({ proposal: { ...fixture.proposal, state: 'executing', execution: { attemptId: 'fixture-attempt' } }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/receipt')) {  fixture.receipts++; w.calendarUploaded=structuredClone(body.receipt.result); return ok({ proposal: { ...fixture.proposal, state: 'succeeded' }, digest: fixture.proposal.digest }); }
          }
          throw Error('Unexpected fixture route ' + pathname);
        },
      };
    }, mode);
    await page.clock.install();await page.goto('/?mode=dev');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
    await page.getByText('Local development agent', { exact: true }).click();
    const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
    await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
    await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
    await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
    await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
    await returnToApps(page);


    await openBrowserCalendar(page);
    await page.getByRole('button',{name:/^Selected private event,/}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.activeView)).toBe('calendar');
    await page.getByRole('button',{name:'Type',exact:true}).click();
    const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Plan a Calendar event; await my review.');await input.press('Enter');
    await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
    expect(await page.evaluate(()=>(window as any).calendarSent.metadata.clientDevice.context.selectedObject.kind)).toBe('calendar-event');
    const before=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events);expect(before).toHaveLength(1);
    expect(JSON.stringify(await page.evaluate(()=>(window as any).calendarSent))).not.toContain('Private description');
    const operation=await page.evaluate(()=>(window as any).recoveryFixture.proposal.payload.operation);
    await page.getByText(presentDeviceRecordOperation(operation,'UTC').title,{exact:true}).click();
    const review=page.getByRole('dialog',{name:mode==='read'?'Share calendar event with agent?':'Review calendar change'});
    await expect(review).toBeVisible();await expect(review).toContainText(mode==='read'||mode==='delete'?'Selected private event':'Assistant planned event');
    await expect(review).toContainText('This occurrence only');
    const selected=await page.evaluate(()=>(window as any).calendarSent.metadata.clientDevice.context.selectedObject.id);expect(selected).toContain(':occ:');
    if(mode==='stale')await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.edit(()=>({events:[] as any[]}),data=>{data.events[0].revision='d'.repeat(64);data.events[0].title='Changed series';});});
    await review.getByRole('button',{name:mode==='cancel'?'Cancel':'Confirm',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(1);
    if(mode==='delete'){
      const retained=await page.evaluate(()=>(window as any).calendarRetained);expect(retained.status).toBe('unknown');expect(retained.summary).toContain('Final outcome remains pending');
      expect(await page.evaluate(async()=>JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events)).toEqual(before);
      await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();await page.clock.fastForward(11000);
      await expect.poll(()=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0].excluded)).toContain(before[0].begin);
      const recovered=await page.evaluate(async()=>{const w=window as any;return w.Capacitor.nativePromise('AlphaActionJournal','recoverDeletion',{scope:w.calendarEntry.scope,proposalId:w.calendarEntry.proposalId});});expect(recovered.entry.status).toBe('succeeded');
    }
    const events=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events);
    const receipt=await page.evaluate(()=>(window as any).calendarRetained);expect(receipt.status).toBe(mode==='cancel'||mode==='stale'?'failed':'succeeded');
    if(mode==='read'){expect(events).toEqual(before);expect(receipt.result.calendarResult.fields.description).toBe('Private description');}
    if(mode==='cancel')expect(events).toEqual(before);
    if(mode==='stale'){expect(events).toHaveLength(1);expect(events[0]).toMatchObject({title:'Changed series',revision:'d'.repeat(64)});}
    if(mode==='update'){expect(events).toHaveLength(2);expect(events.find((r:any)=>r.id===selected)).toMatchObject({title:'Assistant planned event',seriesId:'selected-event'});}
    if(mode==='delete'){expect(events).toHaveLength(1);expect(events[0].excluded).toContain(before[0].begin);}
    if(mode!=='stale'&&mode!=='cancel'){
      expect(receipt.result.calendarResult.eventId).toBe(selected);
      const rows=await page.evaluate(async(begin)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaCalendar').list({begin:begin+86400000,end:begin+3*86400000})).events;},before[0].begin);expect(rows).toHaveLength(2);expect(rows.every((r:any)=>r.title==='Selected private event')).toBe(true);
      const replay=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const state=JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!),[id,binding]=Object.entries(state.deleteClaims||{}).length?Object.entries(state.deleteClaims)[0] as [string,string]:Object.entries(state.receipts).map(([id,receipt]:[string,any])=>[id,receipt.binding])[0] as [string,string];const replay=await registerPlugin<any>('AlphaCalendar').executeAgent({operationId:id,operation:JSON.parse(binding)});if(Object.keys(state.deleteClaims||{}).length&&replay.status!=='unknown')throw Error('A retained deletion claim must refuse redispatch');return JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events;});expect(replay).toEqual(events);
    }
    await page.reload();
    expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events)).toEqual(events);
  });
}
