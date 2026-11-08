import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration; synthetic HTTP/native boundaries, no provider or device effects.
for (const mode of ['place', 'route', 'stale-before-approval', 'stale-after-read', 'receipt-replay', 'stale-replay', 'basemap-ready'] as const) {
  test(`approved Maps snapshot: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map();
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
            if (method === 'reserve') { w.mapsEntry={...structuredClone(input),phase:'reserved'}; return { created: true, entry: structuredClone(w.mapsEntry) }; }
            if (method === 'markApplying') { Object.assign(w.mapsEntry,{phase:'applying',attemptId:input.attemptId});return {}; }
            if(method==='get')return {entry:structuredClone(w.mapsEntry)};
            if(method==='list')return {entries:w.mapsEntry?[structuredClone(w.mapsEntry)]:[]};
            if (method === 'finish') {
              w.mapsRetained = structuredClone(input);Object.assign(w.mapsEntry,structuredClone(input),{phase:'terminal'});
              if (mode === 'stale-after-read') await new Promise<void>(resolve => { w.releaseMapsFinish = resolve; });
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
            w.mapsInstallation=input.headers['X-Eliza-Device-Id'];
            return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: ['reminders.local-record.v1','maps.selected-read.v1'] });
          }
          if (pathname === '/api/workflow/status') return ok({});
          if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
          if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
            if (!input.headers['X-Eliza-Device-Capabilities']?.split(',').includes('maps.selected-read.v1')) throw Error('Maps capability was not negotiated');
            fixture.posts++;
            const sent=JSON.parse(input.body);w.mapsSent=sent;
            const target=sent.metadata.clientDevice.context.selectedObject;
            fixture.proposal={id:'fixture-proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+60000).toISOString(),subjectUserId:'fixture-owner',requestedBy:agentId,action:'device_action',payload:{action:'device_action',version:1,installationId:w.mapsInstallation,enrollmentId:'fixture-enrollment',operation:{type:'maps_read_selected',target:{kind:target.kind,id:target.id,revision:target.revision}}}};
            return ok({ text: 'The request remains incomplete because processing stopped unexpectedly. Recorded tool outcomes are preserved; remaining work has not been completed.', agentName: 'Recovery fixture', terminalFailure: { kind: 'handler_error', code: 'PLANNER_INTERRUPTED_AFTER_ACTION', transient: false } });
          }
          if (pathname === '/api/client-devices/proposals') { fixture.lists++; return ok({proposals:fixture.proposal?[fixture.proposal]:[]}); }
          const body = input.body ? JSON.parse(input.body) : {};
          if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
            if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
            if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; return ok({ proposal: { ...fixture.proposal, state: 'approved' }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/claim')) { fixture.claims++; fixture.proposal={...fixture.proposal,state:'executing',execution:{attemptId:'fixture-attempt'}}; return ok({ proposal: { ...fixture.proposal, state: 'executing', execution: { attemptId: 'fixture-attempt' } }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/receipt')) { if(mode.endsWith('replay')&&!w.mapsReceiptFailed){w.mapsReceiptFailed=true;return {status:503,data:{error:'Synthetic receipt interruption'}};} fixture.receipts++; w.mapsUploaded=structuredClone(body.receipt.result); return ok({ proposal: { ...fixture.proposal, state: 'succeeded' }, digest: fixture.proposal.digest }); }
          }
          throw Error('Unexpected fixture route ' + pathname);
        },
      };
    }, mode);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
    await page.getByText('Local development agent', { exact: true }).click();
    const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
    await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
    await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
    await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
    await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
    await page.evaluate(async () => {
      const { configureMapsProvider } = await import('/src/maps/runtime.ts');
      const point={latitude:43.7384,longitude:7.4246};
      const place={providerId:'fixture-region',id:'fixture-place',name:'Private fixture destination',coordinate:point,attribution:'Fixture attribution',fetchedAt:Date.now()};
      configureMapsProvider({status:'configured',providerId:'fixture-region',connectionId:'conn_fixture_region_123456',revision:'fixture1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive','walk','bicycle'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'fixture-region',connectionId:'conn_fixture_region_123456',search:async()=>[place],detail:async()=>place,route:async(from,to,mode)=>({providerId:'fixture-region',id:'fixture-route',from,to,mode,geometry:[from,to],distanceMeters:307,durationSeconds:223,steps:[{instruction:'Fixture turn',coordinate:to,distanceMeters:307}],attribution:'Fixture attribution',fetchedAt:Date.now(),traffic:'none'})});
    });
    await returnToApps(page);
    await page.getByRole('button',{name:'Maps',exact:true}).click();
    const query=page.getByRole('textbox',{name:'Search places',exact:true});
    await query.fill('Private fixture destination');await query.press('Enter');
    await page.getByRole('button',{name:/^Private fixture destination/}).first().click();
    if(mode==='route'){
      await page.getByRole('button',{name:'Directions',exact:true}).click();
      const origin=page.getByRole('textbox',{name:'Route origin coordinates'});await origin.fill('43.738,7.424');await origin.press('Enter');
      await expect(page.getByText(/no live traffic/).first()).toBeVisible();
    }
    if(mode==='basemap-ready'){
      const before=await page.evaluate(async()=>{const {getMapsSelectedObject}=await import('/src/maps/agent-context.ts');return getMapsSelectedObject();});
      expect(before?.kind).toBe('map-place');
      await page.locator('[data-alpha-map-plane]').evaluate(element=>element.setAttribute('data-map-ready','false'));
      await page.locator('[data-alpha-map-plane]').evaluate(element=>element.setAttribute('data-map-ready','true'));
      const after=await page.evaluate(async()=>{const {getMapsSelectedObject}=await import('/src/maps/agent-context.ts');return getMapsSelectedObject();});
      expect(after).toEqual(before);
    }
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    const input = page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Propose a synthetic action; await explicit approval.'); await input.press('Enter');
    await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
    const sent=await page.evaluate(()=>(window as any).mapsSent);
    expect(JSON.stringify(sent)).not.toContain('Private fixture destination');
    expect(JSON.stringify(sent)).not.toContain('43.738');
    expect(sent.metadata.alphaPhone.context.selectedObject.kind).toBe(mode==='route'?'map-route':'map-place');
    expect(sent.metadata.clientDevice.context).toEqual(sent.metadata.alphaPhone.context);
    expect(await page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(0);
    expect(await page.evaluate(()=>(window as any).mapsRetained)).toBeUndefined();
    await expect(page.getByText(/This shares location information/)).toBeVisible();
    if(mode==='stale-before-approval') {
      await page.evaluate(async()=>{const {clearMapsSelection}=await import('/src/maps/agent-context.ts');clearMapsSelection();});
    }
    await page.getByText('maps read selected',{exact:true}).click();
    if(mode==='stale-after-read'){
      await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseMapsFinish)).toBe('function');
      await page.evaluate(async()=>{const {clearMapsSelection}=await import('/src/maps/agent-context.ts');clearMapsSelection();(window as any).releaseMapsFinish();});
      await expect(page.getByText(/Server receipt is pending/).last()).toBeVisible();
      expect(await page.evaluate(()=>(window as any).mapsRetained.result.mapsResult.fields.label)).toBe('Private fixture destination');
    } else if(mode.endsWith('replay')) {
      await expect(page.getByText(/Server receipt is pending/).last()).toBeVisible();
      const retained=await page.evaluate(()=>(window as any).mapsRetained.result.mapsResult);
      await page.evaluate(async stale=>{
        if(stale){const {clearMapsSelection}=await import('/src/maps/agent-context.ts');clearMapsSelection();}
        const {connectionController}=await import('/src/runtime/connection-ui.tsx');await connectionController.actionHistory(true);
      },mode==='stale-replay');
      const replay=await page.evaluate(()=>(window as any).mapsUploaded);
      if(mode==='receipt-replay')expect(replay).toEqual(retained);else expect(replay).toBeUndefined();
      expect(await page.evaluate(()=>(window as any).recoveryFixture.journal.filter((x:string)=>x==='reserve').length)).toBe(1);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.journal.filter((x:string)=>x==='finish').length)).toBe(1);
    } else if(mode==='stale-before-approval') {
      await expect(page.getByText(/Review|context|confirmed result/i).last()).toBeVisible();
    } else {
      await expect(page.getByText(/Shared the exact selected Maps snapshot with approval/).last()).toBeVisible();
      const result=await page.evaluate(()=>(window as any).mapsUploaded);
      expect(result.target).toEqual(sent.metadata.alphaPhone.context.selectedObject);
      expect(result.fields.kind).toBe(mode==='route'?'map-route':'map-place');
      expect(result.fields.attribution).toBe('Fixture attribution');
      if(mode==='route'){expect(result.fields.distanceMeters).toBe(307);expect(result.fields.from).toEqual({latitude:43.738,longitude:7.424});}
      else expect(result.fields.label).toBe('Private fixture destination');
    }
    const f=await page.evaluate(()=>(window as any).recoveryFixture);
    expect(f.posts).toBe(1);expect(f.effects).toBe(0);
    expect(f.receipts).toBe(mode.startsWith('stale')?0:1);
    expect(f.decisions).toBe(mode==='stale-before-approval'?0:1);
  });
}
