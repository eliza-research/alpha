import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration; synthetic HTTP/native boundaries, no provider or device effects.
for (const mode of ['pending', 'wrong-owner', 'expired'] as const) {
  test(`approved navigation opens Workflows only after claim: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map(), entries = new Map();
      const agentId = '12345678-1234-4234-8234-123456789abc';
      const fixture = w.navigationFixture = { posts: 0, lists: 0, decisions: 0, claims: 0, receipts: 0, receiptBodies: [] as string[], automationLists: 0, journal: [] as string[], proposal: null as any };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      w.Capacitor = {
        PluginHeaders: [
          { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite','secureCompareExchange', 'secureRemove']) },
          { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'list', 'get']) },
        ],
        nativePromise: async (plugin: string, method: string, input: any) => {
          if (plugin === 'AlphaActionJournal') {
            if(method==='list')return {entries:[...entries.values()]};
            if(method==='get')return {entry:entries.get(input.proposalId)??null};
            fixture.journal.push(method);
            if (method === 'reserve') {
              if(entries.has(input.proposalId))return {created:false,entry:entries.get(input.proposalId)};
              const entry={...input,phase:'reserved'};entries.set(input.proposalId,entry);return {created:true,entry};
            }
            if(method==='markApplying'){Object.assign(entries.get(input.proposalId),input,{phase:'applying'});return {};}
            if(method==='finish'){if(input.status!=='succeeded')throw Error('Navigation was not confirmed');Object.assign(entries.get(input.proposalId),input,{phase:'terminal'});return {};}
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
          if (pathname === '/api/auth/status') return ok({ required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'navigation-fixture', expiresAt: Date.now() + 60000 });
          if (pathname === '/api/auth/pair') return ok({ token: 'synthetic-session', identityId: 'fixture-owner', access: 'owner', instanceId: 'navigation-fixture' });
          if (input.headers.Authorization !== 'Bearer synthetic-session') throw Error('Unpaired request');
          if (pathname === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', displayName: 'Fixture owner', kind: 'owner' }, session: { id: 'synthetic-session', kind: 'machine', expiresAt: Date.now() + 600000 }, access: { role: 'OWNER', mode: 'session' } });
          if (pathname === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Navigation fixture', status: 'running' }] });
          if (pathname === '/api/client-devices/register') {
            fixture.proposal = {
              id: 'fixture-proposal', digest: 'a'.repeat(64), state: 'pending', expiresAt: new Date(Date.now() + (mode === 'expired' ? -1 : 60000)).toISOString(),
              subjectUserId: mode === 'wrong-owner' ? 'another-owner' : 'fixture-owner', requestedBy: agentId, action: 'device_action',
              payload: { action: 'device_action', version: 1, installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', operation: { type: 'open_view', view: 'workflows' } },
            };
            return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
          }
          if (pathname === '/api/automations') {fixture.automationLists++;return ok({automations:[]});}
          if (pathname === '/api/lifeops/reminders') return ok({reminders:[]});
          if (pathname === '/api/lifeops/scheduled-tasks') return ok({tasks:[]});
          if (pathname === '/api/workflow/status') return ok({engine:'smthrs',status:'ready'});
          if (pathname === '/api/workflow/workflows') return ok({workflows:[]});
          if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
          if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
            fixture.posts++;
            return ok({ text: 'Review navigation request', agentName: 'Navigation fixture' });
          }
          if (pathname === '/api/client-devices/proposals') {
            fixture.lists++;
            return ok({ proposals: fixture.posts ? [fixture.proposal] : [] });
          }
          const body = input.body ? JSON.parse(input.body) : {};
          if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
            if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
            if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; fixture.proposal.state='approved'; return ok({ proposal: { ...fixture.proposal }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/claim')) { fixture.claims++; Object.assign(fixture.proposal,{state:'executing',execution:{attemptId:'fixture-attempt'}}); return ok({ proposal: { ...fixture.proposal }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/receipt')) { if(body.receipt.outcome!=='applied'||body.attemptId!=='fixture-attempt')throw Error('Invalid navigation receipt'); fixture.receipts++; fixture.receiptBodies.push(JSON.stringify(body)); fixture.proposal.state='done'; return ok({ proposal: { ...fixture.proposal }, digest: fixture.proposal.digest }); }
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
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    const input = page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Propose a synthetic action; await explicit approval.'); await input.press('Enter');
    await expect(page.getByText('Review navigation request',{exact:true})).toBeVisible();
    const counts = () => page.evaluate(() => {
      const f = (window as any).navigationFixture;
      return { posts: f.posts, decisions: f.decisions, claims: f.claims, receipts: f.receipts, automationLists: f.automationLists, journal: f.journal };
    });
    expect(await counts()).toEqual({ posts: 1, decisions: 0, claims: 0, receipts: 0, automationLists: 0, journal: [] });
    if (mode === 'pending') {
      await page.getByText('open view', { exact: true }).click();
      await expect(page.getByRole('region',{name:'Workflows',exact:true}).getByText('No workflows yet',{exact:true})).toBeVisible();
      await expect.poll(async()=> (await counts()).journal).toEqual(['reserve', 'markApplying', 'finish']);
      // Receipt upload can finish before navigation retires the request epoch.
      // Otherwise the explicit recovery control uploads the durable result.
      // Explicit sync uploads a receipt only while the agent still awaits this
      // attempt (eliza fd6d778412, #38163): once the proposal is done it is not resent.
      const afterNavigation=await counts();expect([0,1]).toContain(afterNavigation.receipts);
      expect({...afterNavigation,receipts:0}).toEqual({ posts: 1, decisions: 1, claims: 1, receipts: 0, automationLists: 1, journal: ['reserve', 'markApplying', 'finish'] });
      await returnToApps(page);
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.getByRole('button',{name:'Agent connection',exact:true}).click();
      await page.getByText('Phone action history',{exact:true}).click();
      await page.getByRole('button',{name:'Sync recorded receipts',exact:true}).click();
      await expect.poll(async()=> (await counts()).receipts).toBe(1);
      // History shows the agent state, then this phone's journal outcome.
      await expect(page.getByText('done · this phone: succeeded',{exact:true})).toBeVisible();
      expect(await counts()).toEqual({ posts: 1, decisions: 1, claims: 1, receipts: 1, automationLists: 1, journal: ['reserve', 'markApplying', 'finish'] });
      expect(await page.evaluate(()=>new Set((window as any).navigationFixture.receiptBodies).size)).toBe(1);
    } else {
      await expect(page.locator('.alpha-action-review')).toHaveCount(0);
      expect(await counts()).toEqual({ posts: 1, decisions: 0, claims: 0, receipts: 0, automationLists: 0, journal: [] });
    }
  });
}
