import {presentDeviceRecordOperation} from '../../apps/app/src/runtime/device-record-presentation.ts';
import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration and real browser reminder storage/review. Connection and journal
// boundaries are controlled fixtures; no real agent or external service is used.
for (const mode of ['create', 'read', 'update', 'complete', 'snooze', 'cancel', 'stale', 'recurring-complete'] as const) {
  test(`browser assistant reminder action: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map();
      if(!localStorage.getItem('alpha.browser.reminders.v1'))localStorage.setItem('alpha.browser.reminders.v1',JSON.stringify({sourceRevision:'b'.repeat(64),reminders:[{id:'selected-reminder',title:'Selected private reminder',body:'Private reminder details',at:Date.parse('2026-10-02T13:00:00Z'),dueAt:Date.parse('2026-10-02T13:00:00Z'),status:'scheduled',occurrenceId:'initial-occurrence',revision:'c'.repeat(64),mode:'inexact',createdAt:Date.now(),...(mode==='recurring-complete'?{recurrence:{rule:'daily',zone:'UTC',date:'2026-10-02',time:'13:00',leadMinutes:0}}:{})}]}));
      const agentId = '12345678-1234-4234-8234-123456789abc';
      const fixture = w.recoveryFixture = { posts: 0, lists: 0, decisions: 0, claims: 0, receipts: 0, effects: 0, journal: [] as string[], proposal: null as any };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      w.Capacitor = {
        PluginHeaders: [
          { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite','secureCompareExchange', 'secureRemove']) },
          { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'get', 'list']) },
        ],
        nativePromise: async (plugin: string, method: string, input: any) => {
          if (plugin === 'AlphaActionJournal') {
            fixture.journal.push(method);
            if (method === 'reserve') { w.calendarEntry={...structuredClone(input),phase:'reserved'}; return { created: true, entry: structuredClone(w.calendarEntry) }; }
            if (method === 'markApplying') { Object.assign(w.calendarEntry,{phase:'applying',attemptId:input.attemptId});return {}; }
            if(method==='get')return {entry:structuredClone(w.calendarEntry)};
            if(method==='list')return {entries:w.calendarEntry?[structuredClone(w.calendarEntry)]:[]};
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
            if (!input.headers['X-Eliza-Device-Capabilities']?.split(',').includes('reminders.local-record.v1')) throw Error('Reminder capability was not negotiated');
            fixture.posts++;
            const sent=JSON.parse(input.body);w.calendarSent=sent;
            const target=sent.metadata.clientDevice.context.selectedObject;
            const fields={title:'Assistant planned reminder',body:'Reviewed details',schedule:{at:Date.now()+7200000,recurrence:null}};
            const operation=mode==='create'?{type:'create_reminder',title:'Assistant created reminder',dueAt:new Date(Date.now()+7200000).toISOString()}:{type:mode==='read'?'reminder_read_selected':mode==='stale'||mode==='recurring-complete'?'reminder_complete':'reminder_'+mode,target:{sourceId:target.accountId,sourceRevision:target.sourceRevision,reminderId:target.id,occurrenceId:target.occurrenceId,revision:target.revision},...(mode==='update'?{fields}:{})};
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
    await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
    await page.goto('/?mode=dev');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
    await page.getByText('Local development agent', { exact: true }).click();
    const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
    await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
    await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
    await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
    await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
    await returnToApps(page);
    await page.getByRole('button',{name:'Calendar',exact:true}).click();
    await page.getByRole('button',{name:/^Selected private reminder,/}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.activeView)).toBe('calendar');
    await page.getByRole('button',{name:'Type',exact:true}).click();
    const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Review this reminder action before applying it.');await input.press('Enter');
    await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
    expect(await page.evaluate(()=>(window as any).calendarSent.metadata.clientDevice.context.selectedObject.kind)).toBe('reminder');
    const before=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders);expect(before).toHaveLength(1);
    expect(JSON.stringify(await page.evaluate(()=>(window as any).calendarSent))).not.toContain('Private reminder details');
    if(mode==='stale')await page.evaluate(async ()=>{await (await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].revision='d'.repeat(64);data.reminders[0].title='Changed elsewhere';});});
    await page.getByRole('button',{name:'Expand chat',exact:true}).click();
    const operation=await page.evaluate(()=>(window as any).recoveryFixture.proposal.payload.operation);
    const approvalLabel=presentDeviceRecordOperation(operation,'UTC').title;
    await page.getByText(approvalLabel,{exact:true}).click();
    if(mode==='cancel'){
      await page.getByRole('dialog',{name:'Delete reminder?',exact:true}).getByRole('button',{name:'Delete reminder',exact:true}).click();
      await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();
      const queued=await page.evaluate(async()=>JSON.parse((await(await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0]);
      expect(queued.pendingDeletion).toBeTruthy();expect(queued.status).not.toBe('cancelled');
    }
    await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts),{timeout:mode==='cancel'?20_000:5_000}).toBe(1);
    if(mode==='cancel')await expect.poll(()=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders[0].status),{timeout:20_000}).toBe('cancelled');
    const rows=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders);expect(rows).toHaveLength(mode==='create'?2:1);
    const receipt=await page.evaluate(()=>(window as any).calendarRetained);expect(receipt.summary).not.toContain('Android');expect(receipt.status).toBe(mode==='stale'?'failed':mode==='cancel'?'unknown':'succeeded');
    if(mode==='cancel'){
      const recovered=await page.evaluate(async()=>{const {deletions}=await import('/src/runtime/deletions.ts');return deletions.receipt({entry:(window as any).calendarEntry});});
      expect(recovered.recovery).toMatchObject({status:'succeeded',result:{reminderResult:{kind:'reminder_cancel',status:'cancelled'}}});
    }
    if(mode==='create')expect(rows[1]).toMatchObject({title:'Assistant created reminder',status:'scheduled',at:Date.parse('2026-10-02T14:00:00Z')});
    if(mode==='read'){expect(rows).toEqual(before);expect(receipt.result.reminderResult.fields.body).toBe('Private reminder details');}
    if(mode==='update')expect(rows[0]).toMatchObject({title:'Assistant planned reminder',body:'Reviewed details',at:Date.parse('2026-10-02T14:00:00Z')});
    if(mode==='recurring-complete'){expect(rows[0]).toMatchObject({status:'scheduled',at:Date.parse('2026-10-03T13:00:00Z'),recurrence:{date:'2026-10-03'}});expect(rows[0].occurrenceId).not.toBe(before[0].occurrenceId);expect(rows[0].history).toHaveLength(1);}
    if(mode==='complete')expect(rows[0].status).toBe('completed');
    if(mode==='cancel')expect(rows[0].status).toBe('cancelled');
    if(mode==='snooze')expect(rows[0]).toMatchObject({status:'scheduled',at:Date.parse('2026-10-02T12:10:00Z')});
    if(mode==='stale')expect(rows[0]).toMatchObject({title:'Changed elsewhere',status:'scheduled'});
    expect(await page.evaluate(()=>(window as any).recoveryFixture.journal)).toEqual(expect.arrayContaining(['reserve','markApplying','finish']));
    if(mode==='recurring-complete'){const replay=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const state=JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!),[id,receipt]=Object.entries(state.receipts)[0] as [string,any],[bindingHash,operation]=JSON.parse(receipt.binding);await registerPlugin<any>('DailyApps').operateReminder({operationId:id,bindingHash,operation});return JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders;});expect(replay).toEqual(rows);}
    await page.reload();expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!).reminders)).toEqual(rows);
  });
}
