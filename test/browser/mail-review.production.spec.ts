import {seedCompletedAccessSetup} from './flag-off-android';
import {completeAccessSetup} from './flag-off-android';
import { test, expect, type Page } from '@playwright/test';
import { installResidentAgentPlugin } from './helpers/resident-agent-plugin';

// Reviewed send on the FLAG-OFF bundle with the Android bridge stubbed (docs/core-loop-audit.md
// F-5, F-10). The mailbox is a synthetic managed Gmail answered at the native HTTP boundary
// (AlphaConnection.request) in the Cloud server's own response shapes, so the shipped renderer,
// the real CloudProtocol validation and the Keystore-slot operation journal (the stubbed secure
// store) all run. No account, grant, Gmail request or mail delivery is real.
//
// Evidence boundary: source/test evidence for the shipped renderer. It is not evidence for the
// native encrypted journal, Eliza Cloud, Google or delivery.
const AGENT = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
type Wire = { requestId: string; digest: string; proposal: string };
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });
const button = (page: Page, name: string) => name==='Inbox'
  ? page.getByRole('button', { name, exact: true }).and(page.locator('[data-mobile-shell-tile]'))
  : page.getByRole('button', { name, exact: true });

async function androidWithMailbox(page: Page) {
  await installResidentAgentPlugin(page);
  await page.addInitScript(({ agentId }) => {
    const w = window as any;
    w.androidBridge = {};
    const store = new Map<string, string>();
    const future = Date.now() + 86_400_000, account = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    store.set('cloud:production', JSON.stringify({ token: 'synthetic-cloud-key', credentialId: account, expiresAt: future }));
    const f = w.declineFixture = { decisions: [] as string[], reconciliations: [] as unknown[], effects: 0, journal: [] as string[], unexpected: [] as string[], proposals: [] as any[], installationId: '', calendar: [] as any[], receipts: [] as any[], entry: null as any, lists: 0,
      mail: { prepares: [] as { requestId: string; digest: string; proposal: string }[], dispatches: [] as { requestId: string; digest: string; proposal: string }[], operations: {} as Record<string, any>, sent: [] as string[], searches: 0 } };
    const resident = w.residentAgent = w.createResidentAgentPlugin({ owner: () => 'fixture-owner', agentId, unexpected: f.unexpected });
    // One synthetic resident agent: authenticated identity, device enrollment and proposal store.
    const agent = (method: string, path: string, body: any, headers: Record<string, string>): { status: number; data: unknown } => {
      const ok = (data: unknown) => ({ status: 200, data });
      if (path === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Decline fixture', status: 'running' }] });
      if (path === '/api/client-devices/register') {
        f.installationId = headers['X-Eliza-Device-Id'];
        return ok({ installationId: f.installationId, enrollmentId: 'fixture-enrollment', capabilities: [] });
      }
      if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
      if (path === '/api/conversations') return ok({ conversations: [] });
      if (path === '/api/client-devices/proposals') { f.lists++; return ok({ proposals: f.proposals }); }
      const match = /^\/api\/client-devices\/proposals\/([^/]+)\/(decision|reconciliation|claim|receipt)$/.exec(path);
      if (match && method === 'POST') {
        const item = f.proposals.find(p => p.id === match[1]);
        if (!item || body.digest !== item.digest) return { status: 409, data: {} };
        if (match[2] === 'decision') {
          f.decisions.push(body.decision);
          if (item.state !== 'pending') return { status: 409, data: {} };
          item.state = body.decision === 'approve' ? 'approved' : 'rejected';
        } else if (match[2] === 'claim') {
          if (item.state !== 'approved') return { status: 409, data: {} };
          item.state = 'executing'; item.execution = { attemptId: 'fixture-attempt' };
        } else if (match[2] === 'receipt') {
          if (item.state !== 'executing' || body.attemptId !== 'fixture-attempt') return { status: 409, data: {} };
          f.receipts.push(body.receipt); item.state = body.receipt.outcome === 'applied' ? 'succeeded' : 'failed';
        } else return { status: 409, data: {} };
        return ok({ proposal: item, digest: item.digest });
      }
      f.unexpected.push(method + ' ' + path);
      return { status: 404, data: {} };
    };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
        { name: 'Agent', methods: resident.methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus']) },
        { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal', 'addListener', 'removeListener', 'pauseNotificationCollection']) },
        { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'list', 'get']) },
        { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
        { name: 'AlphaCalendar', methods: methods(['requestAccess', 'executeAgent', 'cancelAgent', 'calendars', 'range', 'listAlerts', 'prepareAgentSource', 'addListener', 'removeListener']) },
      ],
      nativeCallback: resident.nativeCallback,
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'decline-fixture' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') {
          f.journal.push(method);
          if (method === 'list') return { entries: f.entry ? [structuredClone(f.entry)] : [] };
          if (method === 'get') return { entry: f.entry ? structuredClone(f.entry) : null };
          if (method === 'reserve') { if (f.entry) return { created: false, entry: structuredClone(f.entry) }; f.entry = { ...structuredClone(input), phase: 'reserved' }; return { created: true, entry: structuredClone(f.entry) }; }
          if (method === 'markApplying') { Object.assign(f.entry, { phase: 'applying', attemptId: input.attemptId }); return {}; }
          if (method === 'finish') { Object.assign(f.entry, { phase: 'terminal', status: input.status, summary: input.summary, result: input.result }); return {}; }
          throw Error('Unexpected journal effect');
        }
        // The native Calendar plugin: Android shows its own review dialog inside executeAgent. The
        // stub records exactly what the renderer handed over and answers as an approved save.
        if (plugin === 'AlphaCalendar') {
          if (method === 'requestAccess') return { status: 'granted' };
          if (method === 'executeAgent') { f.calendar.push(structuredClone(input)); return { status: 'applied', result: { version: 1, kind: input.operation.type, sourceId: '7', eventId: '42', revision: 'c'.repeat(64) } }; }
          if (method === 'cancelAgent') return { status: 'cancelled' };
          if (method === 'calendars') return { calendars: [] };
          if (method === 'range') return { events: [], truncated: false };
          if (method === 'listAlerts') return { items: [] };
          return {};
        }
        if (plugin === 'Agent') {
          const owned = resident.answer(method, input); if (owned) return owned;
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          // Retained direct inference and the independent Cloud Gmail credential
          // above must coexist; selecting own keys must not sign Cloud services out.
          if (method === 'providerStatus') return { provider: 'cerebras', configured: true, model: 'qwen-3.8-27b' };
          if (method === 'request') {
            const result = agent(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {});
            return { status: result.status, body: JSON.stringify(result.data) };
          }
          return {};
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
          if (method === 'secureCompareExchange') { if ((store.get(input.slot) ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) store.delete(input.slot); else store.set(input.slot, input.value); return { status: 'saved' }; }
          if (method === 'secureWrite') { store.set(input.slot, input.value); return {}; }
          if (method === 'secureRemove') { store.delete(input.slot); return {}; }
          if (method === 'request') {
            const path = new URL(input.url).pathname;
            if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id: account } } };
            if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
            if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
            // Synthetic managed Gmail behind Eliza Cloud, in the server's own response shapes. The
            // product's CloudProtocol validates every one of these replies.
            const m = f.mail, google = '/api/v1/eliza/google', body = input.body ? JSON.parse(input.body) : null;
            const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
            const reply = (receipt: unknown, extra: Record<string, unknown> = {}) => ({ status: 200, data: { version: 1, providerExactlyOnce: false, receipt, ...extra } });
            if (path === google + '/accounts') return { status: 200, data: [{ configured: true, connected: true, reason: 'connected', connectionId: 'grant-1', grantedCapabilities: ['google.gmail.triage','google.gmail.send','google.gmail.drafts','google.gmail.mailbox'], identity: { email: 'owner@example.invalid' } }] };
            if (path === google + '/gmail/inbox-v1/capabilities') return { status: 200, data: { version: 1, from: 'owner@example.invalid', threads: true, send: true, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false } };
            if (path === google + '/gmail/search') { m.searches++; return { status: 200, data: { messages: [{ externalId: 'm1', threadId: 't1', subject: 'Harbour schedule', from: 'Synthetic sender', fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], cc: [], snippet: 'Preview', receivedAt: '2026-10-06T12:00:00Z', isUnread: false }], syncedAt: '2026-10-08T12:00:00Z', nextPageToken: null } }; }
            if(path===google+'/gmail/read')return {status:200,data:{message:{externalId:'m1',threadId:'t1',subject:'Harbour schedule',from:'Synthetic sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],cc:[],snippet:'Preview',receivedAt:'2026-10-06T12:00:00Z',isUnread:false},bodyText:'Owned fixture body',links:[]}};
            if (path === google + '/gmail/inbox-v1/operations' && input.method === 'POST') {
              const p = body.proposal, review = { kind: p.kind, mode: p.mode, from: 'owner@example.invalid', to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, bodyText: p.bodyText, attachments: [] };
              const receipt = { requestId: body.requestId, kind: p.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null };
              // The proposal exactly as it arrived on the wire.
              m.prepares.push({ requestId: body.requestId, digest: receipt.reviewDigest, proposal: JSON.stringify(body.proposal) }); m.operations[body.requestId] = receipt;
              return reply(receipt, { review });
            }
            const operation = /^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/([^/]+)(\/dispatch)?$/.exec(path);
            if (operation && operation[2] && input.method === 'POST') {
              const id = decodeURIComponent(operation[1]);
              m.dispatches.push({ requestId: id, digest: body.reviewDigest, proposal: JSON.stringify(body.proposal) });
              if (m.operations[id]?.reviewDigest !== body.reviewDigest) return { status: 409, data: { error: 'Review digest changed' } };
              if (m.operations[id].state !== 'succeeded') { m.sent.push(body.proposal.subject + ' | ' + body.proposal.bodyText); m.operations[id] = { ...m.operations[id], state: 'succeeded', providerResult: { messageId: 'sent-' + m.sent.length, threadId: 'thread-sent' } }; }
              return reply(m.operations[id]);
            }
            if (operation && !operation[2]) return m.operations[decodeURIComponent(operation[1])] ? reply(m.operations[decodeURIComponent(operation[1])]) : { status: 404, data: {} };
            f.unexpected.push('cloud ' + path); return { status: 404, data: {} };
          }
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation');
      },
    };
  }, { agentId: AGENT });
}
const fixture = (page: Page) => page.evaluate(() => {
  const f = (window as any).declineFixture;
  return { ...(f.mail as { prepares: Wire[]; dispatches: Wire[]; sent: string[]; searches: number }), unexpected: (f.unexpected as string[]).filter(entry => entry.startsWith('cloud ')) };
});
async function connected(page: Page) {
  await page.goto('/');
  // Development builds offer an explicit start; production starts the funded resident agent itself.
  const start = page.locator('.alpha-connection').getByRole('button', { name: 'Start local agent', exact: true });
  await expect.poll(async () => await start.isVisible().catch(() => false) || await page.evaluate(() => (window as any).declineFixture.installationId !== ''), { timeout: 30_000 }).toBe(true);
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect.poll(() => page.evaluate(() => (window as any).declineFixture.installationId), { timeout: 30_000 }).not.toBe('');
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);
}

test('Android: the send review shows Cc and Bcc, an edit after review is reviewed again, and only the last reviewed request is dispatched, byte for byte', async ({ page }) => {
  test.setTimeout(120_000);
  await androidWithMailbox(page);
  await connected(page);
  await button(page, 'Inbox').click();
  await expect(button(page, 'Synthetic sender, Harbour schedule')).toBeVisible({ timeout: 30_000 });
  await button(page, 'Compose').click();
  await page.getByRole('textbox', {name: 'To', exact: true}).fill('friend@example.invalid');
  await page.getByRole('textbox', {name: 'To', exact: true}).press('Enter');
  await expect(page.getByRole('textbox', {name: 'Cc', exact: true})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Bcc', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Cc and Bcc', exact: true}).click();
  await page.getByRole('textbox', {name: 'Cc', exact: true}).fill('carol@example.invalid');
  await page.getByRole('textbox', { name: 'Bcc', exact: true }).fill('audit@example.invalid');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Flag-off reviewed send');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('First body');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', { name: 'Review mail operation' });
  await expect(review.getByRole('status')).toHaveText('Review every field before confirming. No mail has been sent.');
  expect((await review.locator('p').nth(1).innerText()).split('\n').map(line => line.trimEnd()).slice(0, 5)).toEqual([
    'From: owner@example.invalid', 'To: friend@example.invalid', 'Cc: carol@example.invalid', 'Bcc: audit@example.invalid', 'Subject: Flag-off reviewed send']);
  await expect(review.locator('[data-alpha-review-attachments]')).toHaveText('No attachments.');
  await expect(review.getByText('First body', { exact: true })).toBeVisible();
  let state = await fixture(page);
  expect(state.prepares).toHaveLength(1);
  expect(state.dispatches).toEqual([]);

  // Close without cancelling, edit the body: the saved review is discarded and cannot be sent.
  await review.getByRole('button', { name: 'Close mail review', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Second body');
  await expect(page.getByText('This email was edited after this review, so the review was discarded. Nothing was sent. Review the current email before sending.', { exact: true })).toBeVisible();
  await button(page, 'Send email').click();
  await expect(review.getByText('Second body', { exact: true })).toBeVisible();
  await expect(review.getByText('First body', { exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: 'Send this email', exact: true }).dblclick();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  state = await fixture(page);
  expect(state.prepares).toHaveLength(2);
  expect(state.prepares[1].requestId).not.toBe(state.prepares[0].requestId);
  // One dispatch: the second request, under the second digest, with the proposal text it was prepared with.
  expect(state.dispatches).toEqual([state.prepares[1]]);
  expect(JSON.parse(state.dispatches[0].proposal)).toEqual({ kind: 'send', mode: 'compose', to: ['friend@example.invalid'], cc: ['carol@example.invalid'], bcc: ['audit@example.invalid'], subject: 'Flag-off reviewed send', bodyText: 'Second body', attachments: [] });
  expect(state.sent).toEqual(['Flag-off reviewed send | Second body']);
  expect(state.unexpected).toEqual([]);
});

test('Android: Home withholds the old count until a changed account is reverified', async ({ page }) => {
  test.setTimeout(120_000);
  await androidWithMailbox(page);
  await connected(page);
  await button(page, 'Inbox').click();
  await expect(button(page, 'Synthetic sender, Harbour schedule')).toBeVisible({ timeout: 30_000 });
  await button(page, 'Back to apps').click();
  const card = page.locator('[data-alpha-layer="home"] [data-alpha-home-inbox]');
  await expect(card).toContainText(/Updated \d{1,2}:\d{2}/);
  await expect(card).not.toContainText('Not updated since');
  // Hold the new account lookup: the old read cannot become current merely because
  // Settings announced a change. Home now refreshes its authorized source itself.
  const searches = (await fixture(page)).searches;
  await page.evaluate(() => {
    const w=window as any,base=w.Capacitor.nativePromise;
    let held=true,release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    w.releaseHomeAccountRead=()=>{held=false;release();};
    w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
      if(held&&plugin==='AlphaConnection'&&method==='request'&&new URL(input.url).pathname==='/api/v1/eliza/google/accounts')await gate;
      return base(plugin,method,input);
    };
    window.dispatchEvent(new CustomEvent('alpha:gmail-accounts-changed', { detail: { source: 'settings' } }));
  });
  // The current-account background reader clears the old identity while it is
  // unverified, rather than retaining another account's count or timestamp.
  await expect(card).toHaveAccessibleName('Inbox');
  await expect(card).not.toContainText(/Updated|Read \d|unread/);
  await expect(card.locator('[data-overview-part="count"]')).toHaveText('');
  expect((await fixture(page)).searches).toBe(searches);
  await page.evaluate(()=>(window as any).releaseHomeAccountRead());
  await expect(card).toContainText(/Updated \d{1,2}:\d{2}/);
  await expect(card).not.toContainText('Not updated since');
  await expect.poll(async()=>(await fixture(page)).searches).toBeGreaterThan(searches);
  // The current card still opens the same verified mailbox.
  await card.click();
  await expect(button(page, 'Synthetic sender, Harbour schedule')).toBeVisible({ timeout: 30_000 });
  expect((await fixture(page)).unexpected).toEqual([]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
