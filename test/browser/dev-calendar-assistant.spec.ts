import {openBrowserCalendar} from './helpers/browser-calendar';
import {presentDeviceRecordOperation} from '../../apps/app/src/runtime/device-record-presentation.ts';
import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration and real browser Calendar storage/review. Connection and journal
// boundaries are controlled fixtures; no real agent or external calendar is used.
for (const mode of ['confirm', 'cancel', 'read', 'update', 'delete'] as const) {
  test(`browser assistant Calendar action: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map();
      if(mode!=='confirm'&&mode!=='cancel'&&!localStorage.getItem('alpha.browser.calendar.v1')){const start=new Date();start.setHours(12,0,0,0);(localStorage.getItem('alpha.browser.calendar.v1')===null&&localStorage.setItem('alpha.browser.calendar.v1',JSON.stringify({sourceRevision:'b'.repeat(64),events:[{id:'selected-event',calendarId:'local',title:'Selected private event',body:'Private description',location:'Private location',begin:start.getTime(),end:start.getTime()+3600000,revision:'c'.repeat(64)}]})));}
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
            const operation=mode==='confirm'||mode==='cancel'?{type:'calendar_create',source:{sourceId:target.id,sourceRevision:target.revision},fields}:{type:mode==='read'?'calendar_read_selected':mode==='update'?'calendar_update':'calendar_delete',target:{sourceId:target.accountId,sourceRevision:target.sourceRevision,eventId:target.id,revision:target.revision},...(mode==='update'?{fields}:{})};
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
    const creating=mode==='confirm'||mode==='cancel';

    await openBrowserCalendar(page);
    if(creating)await page.getByRole('button',{name:'New event',exact:true}).click();else await page.getByRole('button',{name:/^Selected private event,/}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.activeView)).toBe('calendar');
    await page.getByRole('button',{name:'Type',exact:true}).click();
    const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Plan a Calendar event; await my review.');await input.press('Enter');
    await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
    expect(await page.evaluate(()=>(window as any).calendarSent.metadata.clientDevice.context.selectedObject.kind)).toBe(creating?'calendar-source':'calendar-event');
    const before=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events);expect(before).toHaveLength(creating?0:1);
    expect(JSON.stringify(await page.evaluate(()=>(window as any).calendarSent))).not.toContain('Private description');
    const operation=await page.evaluate(()=>(window as any).recoveryFixture.proposal.payload.operation);
    await page.getByText(presentDeviceRecordOperation(operation,'UTC').title,{exact:true}).click();
    const review=page.getByRole('dialog',{name:mode==='read'?'Share calendar event with agent?':'Review calendar change'});
    await expect(review).toBeVisible();await expect(review).toContainText(creating||mode==='update'?'Assistant planned event':'Selected private event');
    await review.getByRole('button',{name:mode==='cancel'?'Cancel':'Confirm',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(1);
    if(mode==='delete'){
      const retained=await page.evaluate(()=>(window as any).calendarRetained);expect(retained.status).toBe('unknown');expect(retained.summary).toContain('Final outcome remains pending');
      expect(await page.evaluate(async()=>JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events)).toEqual(before);
      await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();await page.clock.fastForward(11000);
      await expect.poll(()=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events.length)).toBe(0);
      const recovered=await page.evaluate(async()=>{const w=window as any;return w.Capacitor.nativePromise('AlphaActionJournal','recoverDeletion',{scope:w.calendarEntry.scope,proposalId:w.calendarEntry.proposalId});});expect(recovered.entry.status).toBe('succeeded');
    }
    const events=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events);
    expect(events).toHaveLength(mode==='cancel'||mode==='delete'?0:1);
    if(mode==='confirm'||mode==='update')expect(events[0].title).toBe('Assistant planned event');
    const receipt=await page.evaluate(()=>(window as any).calendarRetained);
    expect(receipt.status).toBe(mode==='cancel'?'failed':'succeeded');
    if(mode==='read'){expect(events).toEqual(before);expect(receipt.result.calendarResult.fields.description).toBe('Private description');}
    await page.reload();
    expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events)).toEqual(events);
  });
}
