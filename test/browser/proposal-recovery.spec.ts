import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration; synthetic HTTP/native boundaries, no provider or device effects.
for (const mode of ['pending', 'wrong-owner', 'expired', 'wrong-reminder-context', 'rate-limit-empty', 'stale-session', 'notes-from-calendar'] as const) {
  test(`interrupted reply recovers only reviewable proposals: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map();
      const agentId = '12345678-1234-4234-8234-123456789abc';
      const fixture = w.recoveryFixture = { posts: 0, lists: 0, decisions: 0, claims: 0, receipts: 0, effects: 0, journal: [] as string[], proposal: null as any };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      w.Capacitor = {
        PluginHeaders: [
          { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite','secureCompareExchange', 'secureRemove']) },
          { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish']) },
        ],
        nativePromise: async (plugin: string, method: string, input: any) => {
          if (plugin === 'AlphaActionJournal') {
            fixture.journal.push(method);
            if (method === 'reserve') return { created: true, entry: { ...input, phase: 'reserved' } };
            if (method === 'markApplying' || method === 'finish') return {};
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
            fixture.proposal = {
              id: 'fixture-proposal', digest: 'a'.repeat(64), state: 'pending', expiresAt: new Date(Date.now() + (mode === 'expired' ? -1 : 60000)).toISOString(),
              subjectUserId: mode === 'wrong-owner' ? 'another-owner' : 'fixture-owner', requestedBy: agentId, action: 'device_action',
              payload: { action: 'device_action', version: 1, installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', operation: mode === 'notes-from-calendar'
                ? {type:'notes_query',query:{kind:'title',text:'Owned synthetic title'}} : mode === 'wrong-reminder-context'
                ? { type: 'reminder_read_selected', target: { sourceId: 'fixture-source', sourceRevision: 'a'.repeat(64), reminderId: 'fixture-reminder', occurrenceId: 'fixture-occurrence', revision: 'b'.repeat(64) } }
                : { type: 'create_note', title: 'Synthetic recovered note', body: 'Reviewed fixture only' } },
            };
            return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: ['reminders.local-record.v1','notes.query.v1'] });
          }
          if (pathname === '/api/workflow/status') return ok({});
          if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
          if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
            fixture.posts++;
            return ok({ text: 'The request remains incomplete because processing stopped unexpectedly. Recorded tool outcomes are preserved; remaining work has not been completed.', agentName: 'Recovery fixture', terminalFailure: { kind: mode === 'rate-limit-empty' ? 'rate_limited' : 'handler_error', code: 'PLANNER_INTERRUPTED_AFTER_ACTION', transient: false } });
          }
          if (pathname === '/api/client-devices/proposals') {
            fixture.lists++;
            if (fixture.posts && mode === 'stale-session') {
              await new Promise<void>(resolve => { w.releaseRecoveryProposals = resolve; });
              w.recoveryProposalsReleased = true;
            }
            return ok({ proposals: fixture.posts && mode !== 'rate-limit-empty' ? [fixture.proposal] : [] });
          }
          const body = input.body ? JSON.parse(input.body) : {};
          if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
            if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
            if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; return ok({ proposal: { ...fixture.proposal, state: 'approved' }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/claim')) { fixture.claims++; return ok({ proposal: { ...fixture.proposal, state: 'executing', execution: { attemptId: 'fixture-attempt' } }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/receipt')) { fixture.receipts++; return ok({ proposal: { ...fixture.proposal, state: 'succeeded' }, digest: fixture.proposal.digest }); }
          }
          throw Error('Unexpected fixture route ' + pathname);
        },
      };
    }, mode);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await openConnectionDiagnostics(page);
    await page.getByText('Local development agent', { exact: true }).click();
    const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
    await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
    await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
    await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
    await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
    await page.evaluate(async () => {
      const { connectionController } = await import('/src/runtime/connection-ui.tsx');
      connectionController.setDeviceExecutor(async () => {
        (window as any).recoveryFixture.effects++;
        return { status: 'succeeded', summary: 'Synthetic approved effect recorded' };
      });
    });
    if(mode==='notes-from-calendar'){
      await page.getByRole('button',{name:'Back to apps',exact:true}).click();
      await page.getByRole('button',{name:'Calendar',exact:true}).click();
    }
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    const input = page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Propose a synthetic action; await explicit approval.'); await input.press('Enter');
    if (mode === 'stale-session') {
      await expect.poll(() => page.evaluate(() => typeof (window as any).releaseRecoveryProposals)).toBe('function');
      await page.evaluate(async () => {
        const { connectionController } = await import('/src/runtime/connection-ui.tsx');
        await connectionController.disconnect();
        (window as any).releaseRecoveryProposals();
      });
      await expect.poll(() => page.evaluate(() => (window as any).recoveryProposalsReleased)).toBe(true);
      await expect(page.getByText(/Request cancelled\. A dispatched action may still need status reconciliation\./).first()).toBeVisible();
    } else if(mode==='notes-from-calendar'){
      await expect(page.getByText('Review Notes on Home',{exact:true})).toBeVisible();
    } else {
      const failure = mode === 'rate-limit-empty' ? /The AI request rate limit was reached/
        : mode === 'pending' ? /The agent could not complete this response\./ : /Sorry, I couldn’t finish that reply\./;
      await expect(page.getByText(failure).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
    }
    const counts = () => page.evaluate(() => {
      const f = (window as any).recoveryFixture;
      return { posts: f.posts, decisions: f.decisions, claims: f.claims, receipts: f.receipts, effects: f.effects, journal: f.journal };
    });
    expect(await counts()).toEqual({ posts: 1, decisions: 0, claims: 0, receipts: 0, effects: 0, journal: [] });
    if(mode==='notes-from-calendar'){
      await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
      await page.getByText('Review Notes on Home',{exact:true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
      await expect(page.getByText('notes query',{exact:true})).toBeVisible();
      expect(await counts()).toEqual({posts:1,decisions:0,claims:0,receipts:0,effects:0,journal:[]});
    } else if (mode === 'pending') {
      await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
      await page.getByText('Create note', { exact: true }).click();
      await expect(page.getByText('Synthetic approved effect recorded', { exact: true }).last()).toBeVisible();
      expect(await counts()).toEqual({ posts: 1, decisions: 1, claims: 1, receipts: 1, effects: 1, journal: ['reserve', 'markApplying', 'finish'] });
    } else {
      await expect(page.locator('.alpha-action-review')).toHaveCount(0);
      expect(await counts()).toEqual({ posts: 1, decisions: 0, claims: 0, receipts: 0, effects: 0, journal: [] });
    }
  });
}
