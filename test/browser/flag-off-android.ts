import {installNativeNavigationFixture} from './helpers/native-navigation-protocol';
// Production Android as the FLAG-OFF renderer sees it, for the *.production.spec.ts files that
// need mail, an agent conversation, scheduled-digest results or device calendars together.
//
// Everything synthetic lives at the test boundary: the Capacitor bridge (window.Capacitor and
// window.androidBridge) is replaced before the bundle loads. Nothing here is compiled into the
// product, and the bundle under test is the one `vite build` produces with
// ELIZA_DEV_ALLOW_TEST_MOCKS unset. The shipped renderer, CloudProtocol validation, the hosted
// digest protocol and the Keystore-slot journals (over the stubbed secure store) all run.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The stub is not the
// native plugins, the resident runtime, Eliza Cloud, Google, Android CalendarProvider, a WebView
// or a device. No account, grant, mail, calendar or digest here is real.
import { expect, type Page } from '@playwright/test';

export interface FlagOffMessage { externalId: string; threadId: string; subject: string; from: string; fromEmail: string; to: string[]; snippet: string; bodyText: string; historyId: string }
export interface FlagOffAccount { connectionId: string; email: string; connected: boolean; messages: FlagOffMessage[] }
export interface FlagOffCalendar { id: string; name?: string; account: string }
export interface FlagOffEvent { id: string; calendarId: string; title: string; begin: number; end: number }
/** A file the Android document picker offers, as the bytes the selected provider holds. */
export interface FlagOffDocument { name: string; mimeType: string; text: string }
export interface FlagOffOptions {
  /** Fresh onboarding owns real permission ports; other feature fixtures represent completed setup only. */
  freshAccess?: boolean;
  /** Managed Gmail accounts behind the synthetic Eliza Cloud. Omitted: the account list is refused. */
  accounts?: FlagOffAccount[];
  /** Scheduled digests: `native` = the Android result inbox delivers results (the phone's normal
   * route); `renderer` = background delivery could not be configured, so the renderer reads the
   * agent's result page itself. Omitted: the agent advertises no digest support. */
  digests?: 'native' | 'renderer';
  /** Device calendar permission and provider rows. Omitted: the calendar read is not granted. */
  calendar?: { access: 'granted' | 'not-granted'; request?: 'granted' | 'denied'; calendars: FlagOffCalendar[]; events: FlagOffEvent[] };
  /** The Android document picker (DailyApps) and attachment port (AlphaMailAttachments): picking
   * selects this document, and a retained source reference reopens only its exact bytes. Omitted:
   * neither is offered. */
  document?: FlagOffDocument;
  /** Scheduled digests as the pinned agent's plugin-workflow keeps them (with `digests`): reviewed
   * sources and loops saved by POST, receipts replayed by mutationId, edits checked against
   * expectedVersionId, and revocation. Omitted: every schedule or source POST is refused. */
  schedules?: FlagOffSchedules;
}
export interface FlagOffSchedules {
  /** The first response to a POST on this path is lost after the agent applied it. */
  dropFirstAck?: 'sources' | 'loops';
  /** Advertise phone sources (`hostedNativeSourceProtocol`) and accept native selections; stubs
   * the AlphaHostedResults consent port and AlphaCalendar's workflow calendars. */
  native?: { evening?: boolean; calendars: { id: string; name: string; account: string }[] };
  /** Serve POST /hosted/dossier (and advertise `hostedDossierProtocol: 1`). The agent pinned in
   * upstream.lock.json registers that route without advertising it, and the renderer offers the
   * dossier with resident phone sources either way; without this flag the stub refuses the POST. */
  dossier?: boolean;
}
export const AGENT_NAME = 'Alpha';

export async function flagOffAndroid(page: Page, options: FlagOffOptions = {}) {
  await page.addInitScript(installNativeNavigationFixture);
  await page.addInitScript(({ options, agentName }) => {
    const w = window as any; w.androidBridge = {};
    if(!options.freshAccess)localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4}));
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5', agentId = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
    const kept = (key: string, initial: unknown) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? initial; } catch { return initial; } };
    // Keystore-backed slots and the resident agent's own store survive a reload of the page.
    const slots: Record<string, string> = kept('flag-off-slots', { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 86_400_000 }) });
    const agent: { conversations: { id: string; title: string }[]; history: Record<string, any[]> } = kept('flag-off-agent', { conversations: [], history: {} });
    // So do the results the agent produced and what the Android result inbox committed.
    const produced: { results: any[]; acked: number; acks: number[]; inbox: any[] } = kept('flag-off-digests', { results: [], acked: 0, acks: [], inbox: [] });
    // Source references Android retained for picked documents: reference -> the bytes' SHA-256.
    const references: Record<string, string> = kept('flag-off-references', {});
    const persist = () => { sessionStorage.setItem('flag-off-references', JSON.stringify(references)); sessionStorage.setItem('flag-off-slots', JSON.stringify(slots)); sessionStorage.setItem('flag-off-agent', JSON.stringify(agent)); sessionStorage.setItem('flag-off-digests', JSON.stringify({ results: f.digests.results, acked: f.digests.acked, acks: f.digests.acks, inbox: f.digests.inbox })); };
    const f = w.flagOff = {
      calls: [] as string[], unexpected: [] as string[], installationId: '', posts: [] as string[], replies: [] as string[], streams: 0,
      mail: { accounts: structuredClone(options.accounts ?? null) as any[] | null, accountReads: 0, searches: 0, reads: [] as string[], prepares: [] as any[], dispatches: [] as any[], operations: {} as Record<string, any>, sent: [] as string[] },
      // Results the resident agent has produced, in cursor order. `acked` is the agent's cursor for
      // the renderer route; `inbox` is what the Android result inbox has committed for the native one.
      digests: { ...produced, pages: 0, syncs: 0, histories: 0, configured: [] as any[], runs: 0, refused: [] as string[],
        // The agent's hosted store (with `schedules`): sources, loops, typed-mutation receipts by
        // mutationId, every POST it received (path and exact body) and the responses it lost.
        sources: [] as any[], loops: [] as any[], receipts: {} as Record<string, { request: string; receipt: any }>, posts: [] as { path: string; body: any }[], dropped: [] as string[], dossiers: [] as any[],
        // AlphaHostedResults phone-source consent: grants by source id, and renewal notices armed or cleared.
        consents: [] as any[], grants: {} as Record<string, any>, renewals: [] as string[], pendingRenewal: null as string | null },
      calendar: { ...structuredClone(options.calendar ?? { access: 'not-granted', calendars: [], events: [] }), lists: 0, requests: 0 } as any,
      // Picker requests, reads of the selected bytes, retained references and linked-source opens.
      documents: { picks: [] as any[], reads: [] as string[], references, opened: [] as any[], forgotten: [] as string[] },
      emit: (plugin: string, event: string, value: unknown = {}) => { listeners.filter(l => l.plugin === plugin && l.event === event).forEach(l => l.callback(value)); },
      slots, persist: () => persist(),
    };
    const listeners: Array<{ plugin: string; event: string; callback: (value: unknown) => void }> = [];
    const emitStream = (streamId: string, event: unknown) => f.emit('Agent', 'alphaAgentStream', { streamId, event });
    const data = (streamId: string, value: unknown) => emitStream(streamId, { type: 'chunk', dataBase64: btoa('data: ' + JSON.stringify(value) + '\n\n') });
    const ok = (value: unknown) => ({ status: 200, data: value });
    let fixtureNavigation: any;
    const navigation=()=>fixtureNavigation??=(window as any).createNativeNavigationFixture(id,agentId,f);
    const request = async (method: string, path: string, body: any, headers: Record<string, string>, owner?: unknown): Promise<{ status: number; data: unknown }> => {
      const navigationResult=navigation().request(method,path,body,headers,owner);if(navigationResult)return navigationResult;
      // Mounted canonical views probe these sources; this native fixture provides none.
      if (method === 'GET' && ['/api/notes/state', '/api/lifeops/calendar/feed', '/api/lifeops/calendar/calendars', '/api/lifeops/calendar/next-context'].includes(path.split('?')[0])) return { status: 503, data: { error: 'Canonical records unavailable in this fixture' } };
      if (path === '/api/auth/me') return ok({ identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/notes/state' && method === 'GET') return ok({success:true,data:{notes:[],trash:[],revision:0}});
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: agentName, status: 'running' }] });
      if (path === '/api/client-devices/register') { f.installationId = headers['X-Eliza-Device-Id']; navigation().register(headers); }
      if (path === '/api/client-devices/register') return ok({ installationId: headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
      if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
      // The agent advertises scheduled digests only; the workflow engine itself is not offered here.
      if (path === '/api/workflow/status') return ok(!options.digests ? { status: 'unavailable' } : !options.schedules ? { status: 'unavailable', hostedDigestProtocol: 1 }
        : { status: 'unavailable', hostedDigestProtocol: 1, hostedDigestSourcePauseProtocol: 1, ...(options.schedules.native ? { hostedNativeSourceProtocol: 1, ...(options.schedules.native.evening ? { hostedNativeEveningProtocol: 1 } : {}) } : {}), ...(options.schedules.dossier ? { hostedDossierProtocol: 1 } : {}) });
      if (options.digests && options.schedules && path.startsWith('/api/workflow/hosted/') && path !== '/api/workflow/hosted/cloud-delegation/revocations' && !path.startsWith('/api/workflow/hosted/results')) return hosted(method, path.slice('/api/workflow/hosted/'.length), body);
      if (options.digests) {
        if (path === '/api/workflow/hosted/sources') return ok({ sources: [] });
        if (path === '/api/workflow/hosted/loops') return ok({ loops: [] });
        if (path.startsWith('/api/workflow/hosted/results?clientId=') && method === 'GET') { f.digests.pages++; return ok({ entries: f.digests.results.filter(row => row.cursor > f.digests.acked).slice(0, 50) }); }
        if (path === '/api/workflow/hosted/results/ack' && method === 'POST') { f.digests.acks.push(body.cursor); f.digests.acked = Math.max(f.digests.acked, body.cursor); persist(); return ok({}); }
        // The digests list asks which Google access revocations are still pending. It is a read sent
        // as a POST (the agent's cloud-delegation route); this agent has none.
        if (path === '/api/workflow/hosted/cloud-delegation/revocations' && method === 'POST') return ok({ grants: [] });
        // Every other POST would start, restart or change a schedule, a source or a delegation: it is
        // counted, its path is recorded and it is refused.
        if (path.startsWith('/api/workflow/hosted/') && method === 'POST') { f.digests.runs++; f.digests.refused.push(path); return { status: 409, data: {} }; }
      }
      if (path === '/api/conversations' && method === 'POST') { const row = { id: 'resident-chat-' + (agent.conversations.length + 1), title: String(body.title || 'Alpha Phone') }; agent.conversations.push(row); agent.history[row.id] = []; persist(); return ok({ conversation: row }); }
      if (path === '/api/conversations') return ok({ conversations: agent.conversations });
      const history = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path.split('?')[0]);
      if (history && method === 'GET') return ok({ messages: (agent.history[history[1]] || []).slice(-200) });
      f.unexpected.push(method + ' ' + path); return { status: 404, data: {} };
    };
    // The phone enrollment the resident agent registered (the binding a phone-source consent names).
    const enrollment = () => ({ ownerId: id, agentId, installationId: f.installationId, enrollmentId: 'fixture-enrollment' });
    // Hosted digests as the pinned agent's plugin-workflow keeps them (embedded-workflow-service.ts
    // at upstream.lock.json's commit): same request keys, refusals, receipts and replay rules. It
    // never runs a schedule or a model; results stay whatever `f.digests.results` holds.
    const hosted = async (method: string, route: string, body: any): Promise<{ status: number; data: unknown }> => {
      const d = f.digests, refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => ({ status, data: { error, ...extra } });
      const keys = (allowed: string[]) => Object.keys(body ?? {}).every(key => allowed.includes(key));
      const listed = (source: any) => { const { text: _private, ...metadata } = source; return metadata; };
      const state = (source: any) => !source || source.revoked ? 'revoked' : Date.parse(source.expiresAt) <= Date.now() ? 'expired' : 'current';
      const lost = (response: { status: number; data: unknown }) => {
        if (options.schedules!.dropFirstAck !== route || d.dropped.includes(route)) return response;
        d.dropped.push(route); return { status: 0, data: response.data };
      };
      if (method === 'GET' && route === 'sources') return ok({ sources: d.sources.map(listed) });
      if (method === 'GET' && route === 'loops') return ok({ loops: d.loops.map(loop => ({ ...loop, sourceState: state(d.sources.find(s => s.id === loop.spec.sourceId)) })) });
      if (method !== 'POST') return refuse(404, 'Hosted digest route not found');
      d.posts.push({ path: route, body: structuredClone(body) });
      if (route === 'sources') {
        if (!keys(['id', 'kind', 'label', 'text', 'observedAt', 'expiresAt', 'confirmed', 'live']) || body.confirmed !== true || !['tasks', 'calendar', 'email', 'notes'].includes(body.kind)) return refuse(400, 'Review and confirm the exact snapshot');
        const live = body.live;
        if (live && (live.provider !== 'native' || !options.schedules!.native || body.kind !== 'tasks' || body.text !== undefined)) return refuse(400, 'Live source must match selected kind and cannot include snapshot text');
        const fields = { id: body.id, kind: body.kind, label: body.label, text: live ? 'Fresh selected-account read is resolved only at the scheduled occurrence.' : body.text, ...(live ? { live } : {}), observedAt: body.observedAt, expiresAt: body.expiresAt };
        const source = { ...fields, revision: await sha(JSON.stringify(fields)), revoked: false };
        const prior = d.sources.find(s => s.id === body.id);
        // The pinned agent answers a save with the whole stored source (text included); only GET lists strip it.
        if (prior) return prior.revision === source.revision ? lost(ok({ source: structuredClone(prior) })) : refuse(409, 'Snapshot identity conflict');
        if (live) { const grant = d.grants[live.sourceId]; if (!grant || grant.revoked || grant.revision !== live.revision || Object.entries(enrollment()).some(([key, value]) => live[key] !== value)) return refuse(409, 'Selected source permission changed before saving', { code: 'HOSTED_SOURCE_NOT_SAVED', mutationId: body.id }); }
        const observed = Date.parse(body.observedAt), expires = Date.parse(body.expiresAt), now = Date.now();
        if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now + 60000 || observed < now - 7 * 86400000 || expires <= now || expires > observed + 7 * 86400000) return refuse(400, 'Source must have a valid explicit freshness window of at most seven days', { code: 'HOSTED_SOURCE_NOT_SAVED', mutationId: body.id });
        d.sources.push(source);
        return lost(ok({ source: structuredClone(source) }));
      }
      if (route === 'sources/revoke') {
        if (!keys(['id', 'confirmed']) || body.confirmed !== true) return refuse(400, 'Confirm source revocation');
        const source = d.sources.find(s => s.id === body.id);
        if (!source) return refuse(404, 'Digest source not found');
        source.revoked = true;
        return lost(ok({ id: source.id, revoked: true }));
      }
      if (route === 'dossier' && options.schedules!.dossier) {
        if (!keys(['sourceId', 'sourceRevision', 'mutationId', 'confirmed']) || body.confirmed !== true) return refuse(400, 'Confirm this on-demand model execution');
        const source = d.sources.find(s => s.id === body.sourceId);
        if (!source || source.revision !== body.sourceRevision || source.live?.provider !== 'native' || state(source) !== 'current') return refuse(409, 'Dossier source binding changed');
        d.dossiers.push(structuredClone(body));
        return ok({ execution: { id: 'dossier-' + body.mutationId, status: 'running' } });
      }
      if (route === 'loops') {
        if (!keys(['spec', 'id', 'expectedVersionId', 'mutationId', 'confirmed']) || body.confirmed !== true) return refuse(400, 'Review and confirm recurring model execution');
        const spec = body.spec;
        if (!spec || spec.version !== 1 || !['morning', 'evening'].includes(spec.template) || typeof spec.enabled !== 'boolean' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(spec.localTime) || Object.keys(spec).some(key => !['version', 'template', 'sourceId', 'sourceRevision', 'timeZone', 'localTime', 'enabled'].includes(key))) return refuse(400, 'Invalid digest specification');
        const source = d.sources.find(s => s.id === spec.sourceId);
        if (!source) return refuse(404, 'Digest source not found');
        if (source.revision !== spec.sourceRevision) return refuse(409, 'Reviewed snapshot revision changed');
        if (source.live?.provider === 'native' && spec.enabled) {
          if (state(source) !== 'current') return refuse(409, 'Native source grant expired or revoked');
          if (d.grants[source.live.sourceId]?.scope.timeZone !== spec.timeZone) return refuse(409, 'Review a native source grant for this schedule time zone');
          if (spec.template === 'evening' && !options.schedules!.native!.evening) return refuse(400, 'Invalid digest specification');
        }
        // A replayed mutationId returns its first receipt; a different request under it is refused.
        const operation = body.id ? 'edit' : 'create', identity = JSON.stringify({ operation, id: body.id ?? null, expectedVersionId: body.expectedVersionId ?? null, spec });
        const prior = d.receipts[body.mutationId];
        if (prior) return prior.request === identity ? lost(ok({ receipt: prior.receipt })) : refuse(409, 'Typed mutation identity conflict');
        const current = body.id ? d.loops.find(loop => loop.id === body.id) : undefined;
        if (body.id && !current) return refuse(404, 'Workflow not found');
        if (current && current.versionId !== body.expectedVersionId) return refuse(409, 'Typed workflow changed before editing', { code: 'WORKFLOW_TYPED_NOT_APPLIED', workflowId: body.id, mutationId: body.mutationId, expectedVersionId: body.expectedVersionId });
        if (spec.enabled && state(source) !== 'current') return refuse(409, 'Reviewed snapshot unavailable');
        const workflowId = body.id ?? crypto.randomUUID(), versionId = crypto.randomUUID();
        const receipt = { mutationId: body.mutationId, workflowId, operation, previousVersionId: body.expectedVersionId ?? null, versionId, specDigest: await sha(JSON.stringify(spec)), compilerRevision: 'fixture-compiler', appliedAt: new Date().toISOString() };
        d.receipts[body.mutationId] = { request: identity, receipt };
        const loop = { id: workflowId, versionId, name: (spec.template === 'morning' ? 'Morning' : 'Evening') + ' digest', spec: structuredClone(spec), active: spec.enabled, removed: false };
        d.loops = current ? d.loops.map(row => row.id === workflowId ? loop : row) : [...d.loops, loop];
        return lost(ok({ receipt }));
      }
      return refuse(404, 'Hosted digest route not found');
    };
    // Synthetic managed Gmail behind Eliza Cloud, in the server's own response shapes. The product's
    // CloudProtocol validates every one of these replies.
    const google = '/api/v1/eliza/google';
    const wire = (m: any) => ({ externalId: m.externalId, threadId: m.threadId, subject: m.subject, from: m.from, fromEmail: m.fromEmail, to: m.to, cc: [], snippet: m.snippet, receivedAt: '2026-10-06T12:00:00Z', isUnread: false });
    const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
    const cloud = async (input: any): Promise<{ status: number; data: unknown }> => {
      const url = new URL(input.url), path = url.pathname, m = f.mail, body = input.body ? JSON.parse(input.body) : null;
      if (url.origin !== 'https://api.eliza.app') throw Error('Connection request failed');
      if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
      if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
      if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } }; // Synthetic active plan from the billing snapshot.
      if (!m.accounts) return { status: 404, data: {} };
      const grant = () => m.accounts!.find(a => a.connectionId === (url.searchParams.get('grantId') ?? body?.grantId) && a.connected);
      if (path === google + '/accounts') { m.accountReads++; return { status: 200, data: m.accounts.map(a => ({ configured: true, connected: a.connected, reason: a.connected ? 'connected' : 'needs_reauth', connectionId: a.connectionId, grantedCapabilities: a.connected ? ['google.gmail.triage'] : [], identity: { email: a.email } })) }; }
      if (!grant()) return { status: 403, data: { error: 'Grant is not connected' } };
      const account = grant()!;
      if (path === google + '/gmail/inbox-v1/capabilities') return { status: 200, data: { version: 1, from: account.email, threads: true, send: true, providerDrafts: false, mailboxMutations: false, attachments: false, providerExactlyOnce: false, atomicDraftReplacement: false } };
      if (path === google + '/gmail/search') { m.searches++; return { status: 200, data: { messages: account.messages.map(wire), syncedAt: new Date().toISOString(), nextPageToken: null } }; }
      if (path === google + '/gmail/read') { const found = account.messages.find((row: any) => row.externalId === url.searchParams.get('messageId')); m.reads.push(String(url.searchParams.get('messageId'))); return found ? { status: 200, data: { message: wire(found), bodyText: found.bodyText, links: [] } } : { status: 404, data: {} }; }
      if (path === google + '/gmail/inbox-v1/thread') {
        const rows = account.messages.filter((row: any) => row.threadId === url.searchParams.get('threadId'));
        return rows.length ? { status: 200, data: { version: 1, threadId: rows[0].threadId, messages: rows.map((row: any) => ({ message: wire(row), bodyText: row.bodyText, links: [], historyId: row.historyId, attachments: [] })), total: rows.length, offset: 0, nextOffset: null, historyId: rows[rows.length - 1].historyId } } : { status: 404, data: {} };
      }
      const reply = (receipt: unknown, extra: Record<string, unknown> = {}) => ({ status: 200, data: { version: 1, providerExactlyOnce: false, receipt, ...extra } });
      if (path === google + '/gmail/inbox-v1/operations' && input.method === 'POST') {
        // The server's review echoes the proposal (including the message a reply answers) and names the From account.
        const p = body.proposal, review = { ...p, from: account.email, attachments: [] };
        const receipt = { requestId: body.requestId, kind: p.kind, state: 'prepared', reviewDigest: await sha(JSON.stringify(review)), providerResult: null, rejectionCode: null };
        m.prepares.push({ requestId: body.requestId, grantId: body.grantId, digest: receipt.reviewDigest, bodyText: p.bodyText }); m.operations[body.requestId] = receipt;
        return reply(receipt, { review });
      }
      const operation = /^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/([^/]+)(\/dispatch)?$/.exec(path);
      if (operation && operation[2] && input.method === 'POST') {
        const request = decodeURIComponent(operation[1]);
        m.dispatches.push({ requestId: request, grantId: body.grantId, digest: body.reviewDigest, bodyText: body.proposal.bodyText });
        if (m.operations[request]?.reviewDigest !== body.reviewDigest) return { status: 409, data: { error: 'Review digest changed' } };
        if (m.operations[request].state !== 'succeeded') { m.sent.push(body.proposal.subject + ' | ' + body.proposal.bodyText); m.operations[request] = { ...m.operations[request], state: 'succeeded', providerResult: { messageId: 'sent-' + m.sent.length, threadId: 'thread-sent' } }; }
        return reply(m.operations[request]);
      }
      if (operation && !operation[2]) return m.operations[decodeURIComponent(operation[1])] ? reply(m.operations[decodeURIComponent(operation[1])]) : { status: 404, data: {} };
      f.unexpected.push('cloud ' + input.method + ' ' + path); return { status: 404, data: {} };
    };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const withListeners = (names: string[]) => [...promise(names), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }];
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaDeletions', methods: promise(['pending']) },
        { name: 'ElizaSystem', methods: promise(['getBuildInfo']) },
        { name: 'DailyApps', methods: withListeners(['surfaceInfo', 'listReminders', 'pendingReminderTap', ...(options.document ? ['perform', 'readSelected', 'forgetSelected', 'describeSelected'] : [])]) },
        ...(options.document ? [{ name: 'AlphaMailAttachments', methods: promise(['readSelected', 'retainSourceReference', 'openSourceReference', 'cancel']) }] : []),
        // Files browser with all-files access (AlphaFilesPlugin storage* methods): the document sits in Documents/.
        ...(options.document ? [{ name: 'AlphaFiles', methods: withListeners(['storageState', 'storageRequestAccess', 'storageList', 'storageCategory', 'storageQuery', 'storageTrashList', 'storageSelect', 'storageWatch', 'storageUnwatch']) }] : []),
        { name: 'Agent', methods: withListeners(['getStatus', 'start', 'stop', 'configureCloudProvider', 'clearProvider', 'request', 'providerStatus', 'requestStream', 'cancelStream']) },
        { name: 'AlphaConnection', methods: withListeners(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
        { name: 'AlphaActionJournal', methods: promise(['list', 'get']) },
        { name: 'AlphaNotifications', methods: promise(['status', 'crossAppStatus']) },
        { name: 'AlphaVoiceCloud', methods: promise(['checkPermissions']) },
        ...(options.digests ? [{ name: 'AlphaHostedResults', methods: withListeners(['beginBackground', 'cancelBackground', 'configureBackground', 'disableBackground', 'syncInbox', 'inboxHistory', 'status', 'pendingResult', 'consumeResult', 'pendingSourceRenewal', 'settleSourceRenewal',
          ...(options.schedules?.native ? ['nativeSourceIdentity', 'nativeSourceConsent', 'scheduleSourceRenewal', 'clearSourceRenewal'] : [])]) }] : []),
        ...(options.calendar || options.schedules?.native ? [{ name: 'AlphaCalendar', methods: withListeners(['list', 'requestAccess', 'pendingCreations', 'listAlerts', ...(options.schedules?.native ? ['requestWorkflowReadAccess', 'workflowCalendars'] : [])]) }] : []),
      ],
      nativeCallback: (plugin: string, method: string, input: any, callback: (value: unknown) => void) => { if (method === 'addListener') listeners.push({ plugin, event: input?.eventName, callback }); return String(listeners.length); },
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
        f.calls.push(plugin + '.' + method);
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: true, version: 'flag-off-harness' };
        if (plugin === 'DailyApps' && method === 'surfaceInfo') return { developmentBuild: false, assistant: false };
        // No reminders are saved on this phone.
        if (plugin === 'DailyApps' && method === 'listReminders') return { reminders: [] };
        if (plugin === 'DailyApps' && method === 'pendingReminderTap') return {};
        if (options.document && (plugin === 'DailyApps' || plugin === 'AlphaMailAttachments' || plugin === 'AlphaFiles')) {
          const doc = options.document, d = f.documents, bytes = new TextEncoder().encode(doc.text);
          const selected = { status: 'selected', action: 'files', selectionId: 'selection-' + (d.picks.length || 1), name: doc.name, mimeType: doc.mimeType, uri: 'content://fixture.documents/' + encodeURIComponent(doc.name) };
          if (plugin === 'AlphaFiles') {
            const entry = { path: 'Documents/' + doc.name, name: doc.name, directory: false, mimeType: doc.mimeType, size: bytes.length, modified: 1_790_000_000_000 };
            if (method === 'storageState' || method === 'storageRequestAccess') return { status: 'ready', access: 'granted', volumes: [{ id: 'primary', name: 'Internal storage', primary: true, free: 8e9, total: 64e9 }] };
            if (method === 'storageCategory') return { status: 'ready', entries: input.category === 'documents' ? [entry] : [] };
            if (method === 'storageQuery') return { status: 'ready', entries: [entry] };
            if (method === 'storageList') return { status: 'ready', entries: input.path === 'Documents' ? [entry] : input.path ? [] : [{ path: 'Documents', name: 'Documents', directory: true, mimeType: '', size: 0, modified: entry.modified, children: 1 }] };
            if (method === 'storageTrashList') return { status: 'ready', items: [] };
            if (method === 'storageSelect') { d.picks.push({ action: 'files', path: input.path }); return input.path === entry.path ? selected : { status: 'missing', message: 'This item is no longer there.' }; }
            return { status: 'ready' };
          }
          if (plugin === 'DailyApps' && method === 'perform') { d.picks.push(structuredClone(input)); return input.action === 'files' ? selected : { status: 'cancelled' }; }
          if (plugin === 'DailyApps' && method === 'describeSelected') return selected;
          if (plugin === 'DailyApps' && method === 'readSelected') { d.reads.push('text:' + input.selectionId); return { status: 'read', text: doc.text, mimeType: doc.mimeType, bytes: bytes.length }; }
          if (plugin === 'DailyApps' && method === 'forgetSelected') { d.forgotten.push(input.selectionId); return {}; }
          if (plugin === 'AlphaMailAttachments' && method === 'readSelected') { d.reads.push('bytes:' + input.selectionId); let binary = ''; bytes.forEach(b => { binary += String.fromCharCode(b); }); return { name: doc.name, mimeType: doc.mimeType, dataBase64: btoa(binary), sha256: await sha(doc.text), size: bytes.length, sourceReferenceVersion: 1 }; }
          if (plugin === 'AlphaMailAttachments' && method === 'retainSourceReference') { const reference = 'b1:' + crypto.randomUUID(); references[reference] = input.sha256; persist(); return { reference }; }
          // Android reopens a reference only while the provider still holds the same bytes.
          if (plugin === 'AlphaMailAttachments' && method === 'openSourceReference') { d.opened.push(structuredClone(input)); if (references[input.reference] !== input.sha256 || input.sha256 !== await sha(doc.text)) throw Error('Source changed'); return { message: 'Opened ' + doc.name + '.' }; }
          if (plugin === 'AlphaMailAttachments' && method === 'cancel') return {};
        }
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin === 'AlphaCalendar') {
          const c = f.calendar;
          if (method === 'requestAccess') { c.requests++; if (c.request === 'granted') c.access = 'granted'; return { status: c.access === 'granted' ? 'granted' : 'denied' }; }
          if (method === 'list') {
            c.lists++;
            if (c.access !== 'granted') return { status: 'permission-required' };
            // CalendarReadAccess shapes: ids are decimal strings, and a calendar with no display name has no `name`.
            return { status: 'ready', calendars: c.calendars.map((row: any) => ({ id: row.id, ...(row.name === undefined ? {} : { name: row.name }), writable: true, account: row.account, local: false })),
              events: c.events.filter((row: any) => row.end > input.begin && row.begin < input.end).map((row: any) => ({ id: row.id, calendarId: row.calendarId, title: row.title, body: '', location: '', begin: row.begin, end: row.end, allDay: false, recurring: false })), truncated: false };
          }
          if (method === 'pendingCreations') return { status: 'ready', creations: [] };
          if (method === 'listAlerts') return { items: [] };
          if (method === 'requestWorkflowReadAccess') return { status: 'granted' };
          if (method === 'workflowCalendars') return { status: 'ready', calendars: options.schedules!.native!.calendars.map(row => ({ ...row, sourceRevision: 'cal-rev-' + row.id })) };
        }
        if (plugin === 'AlphaHostedResults') {
          const d = f.digests;
          if (method === 'beginBackground' || method === 'cancelBackground' || method === 'disableBackground') return {};
          if (method === 'configureBackground') { if (options.digests !== 'native') throw Error('Background delivery is not available'); d.configured.push({ mode: input.mode, agentId: input.agentId }); return { generation: '1', scope: 'fixture-scope' }; }
          // The Android inbox commits what the agent has produced, then returns its retained history.
          if (method === 'syncInbox') { d.syncs++; for (const row of d.results) if (!d.inbox.some(saved => saved.runId === row.runId)) d.inbox.push(structuredClone(row)); persist(); return { entries: structuredClone(d.inbox) }; }
          if (method === 'inboxHistory') { d.histories++; return { entries: structuredClone(d.inbox) }; }
          if (method === 'status') return { enabled: false, backgroundEnabled: false };
          // A Renew tap (#485): the native record's token, the exact selection and expiry it was armed
          // for. It stays pending until the renderer settles it.
          if (method === 'pendingSourceRenewal') { const source = d.sources.find((row: any) => row.id === d.pendingRenewal); return source?.live ? { token: 'renewal-' + source.id, question: false, selection: source.live, expiresAt: Date.parse(source.expiresAt) } : {}; }
          if (method === 'settleSourceRenewal') { if (input.token !== 'renewal-' + d.pendingRenewal) throw Error('Renewal tap changed'); d.pendingRenewal = null; return {}; }
          if (method === 'pendingResult') return {};
          // The phone enrollment the consent is bound to, and the consent Android records for one source.
          if (method === 'nativeSourceIdentity') return { provider: 'native', ...enrollment() };
          if (method === 'nativeSourceConsent') {
            d.consents.push(structuredClone(input));
            if (input.confirmed !== true) throw Error('Consent not confirmed');
            if (input.revoke) { if (d.grants[input.sourceId]) d.grants[input.sourceId].revoked = true; return { sourceId: input.sourceId, revoked: true }; }
            // A consent is recorded only for the enrollment the user reviewed.
            if (JSON.stringify(input.expectedBinding) !== JSON.stringify({ provider: 'native', ...enrollment() })) throw Error('Enrollment changed');
            const grant = { provider: 'native', ...enrollment(), sourceId: input.sourceId, revision: await sha(JSON.stringify([input.sourceId, input.scope, input.expiresAt])) };
            d.grants[input.sourceId] = { ...grant, scope: structuredClone(input.scope), expiresAt: input.expiresAt, revoked: false };
            return grant;
          }
          if (method === 'scheduleSourceRenewal') { d.renewals.push('arm:' + (input.selection?.sourceId ?? input.sourceId)); return {}; }
          if (method === 'clearSourceRenewal') { d.renewals.push('clear:' + (input.selection?.sourceId ?? input.sourceId)); return {}; }
        }
        if (plugin === 'Agent') {
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          // The native provider slot (never renderer-readable): bound by configureCloudProvider, removed by clearProvider.
          if (method === 'providerStatus') return slots['native:local-agent-provider'] ? { provider: 'elizacloud', configured: true, model: 'cerebras/qwen-3.8-27b' } : { provider: 'elizacloud', configured: false };
          if (method === 'configureCloudProvider') { slots['native:local-agent-provider'] = String(input.credentialId); persist(); return {}; }
          if (method === 'clearProvider') { delete slots['native:local-agent-provider']; persist(); return { configured: false }; }
          if (method === 'request') {
            const result = await request(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {}, input.ownerId);
            // A lost acknowledgement: the agent applied the request, but its response never arrives.
            if (result.status === 0) throw Error('Agent response lost');
            return { status: result.status, body: JSON.stringify(result.data) };
          }
          if (method === 'requestStream') {
            // The resident agent records the user turn, then streams its reply over native IPC.
            const conversation = /^\/api\/conversations\/([^/]+)\/messages\/stream$/.exec(input.path)![1], body = JSON.parse(input.body), streamId = input.streamId as string;
            f.streams++; f.posts.push(String(body.text));
            agent.history[conversation].push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() }); persist();
            const reply = f.replies.shift() ?? 'Resident reply ' + f.streams;
            setTimeout(() => {
              emitStream(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } });
              agent.history[conversation].push({ id: crypto.randomUUID(), role: 'assistant', text: reply, timestamp: Date.now() + 1 }); persist();
              data(streamId, { type: 'token', text: reply }); data(streamId, { type: 'done', fullText: reply, agentName }); emitStream(streamId, { type: 'complete' });
            }, 0);
            return { streamId };
          }
          return {};
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: slots[input.slot] ?? null };
          if (method === 'secureWrite') { slots[input.slot] = input.value; persist(); return {}; }
          if (method === 'secureRemove') { delete slots[input.slot]; persist(); return {}; }
          if (method === 'secureCompareExchange') { if ((slots[input.slot] ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) delete slots[input.slot]; else slots[input.slot] = input.value; persist(); return { status: 'saved' }; }
          if (method === 'request') return cloud(input);
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation ' + plugin + '.' + method);
      },
    };
  }, { options, agentName: AGENT_NAME });
}

/** Reads (or changes) the harness state from the test. */
export const harness = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.flagOff)`) as Promise<T>;
export const button = (page: Page, name: string) => name==='Inbox'
  ? page.getByRole('button', { name, exact: true }).and(page.locator('[data-mobile-shell-tile]'))
  : page.getByRole('button', { name, exact: true });

/** Aborts and records every request that leaves the preview server. */
export async function fenceNetwork(page: Page) {
  const foreign: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    // Closed public-imagery fixture: never allow a real external request or coordinate leak.
    if(route.request().method()==='GET'&&url.href==='https://tiles.openfreemap.org/styles/bright')return route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}});
    if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol)) return route.fallback();
    foreign.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  return foreign;
}
/** No mock, fixture or development surface is present in the build under test. */
export async function expectNoDevelopmentSurface(page: Page) {
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
  await expect(button(page, 'Device controls')).toHaveCount(0);
  await expect(page.getByText(/Development (connections|device actions|reply|provider|inbox)/)).toHaveCount(0);
}
/** Existing-installation fixtures seed UI progress only. OS/plugin grants remain independent. */
export async function seedCompletedAccessSetup(page: Page) {
  await page.addInitScript(()=>localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4})));
}
/** Dismiss the explicit post-auth Ready card; quiet restoration of completed setup opens no card. */
export async function completeAccessSetup(page: Page) {
  const panel=page.locator('dialog.alpha-startup-permissions');
  const ready=panel.getByRole('heading',{name:'You’re all set',exact:true});
  if(await panel.count()){
    await expect(ready).toBeVisible();
    await panel.getByRole('button',{name:'Go to Alpha',exact:true}).click();
    await expect(panel).toHaveCount(0);
  }
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')||'null')?.status)).toBe('completed');
}
/** A funded resident account connects by itself; no Welcome dialog and no chooser remain. */
export async function residentHome(page: Page) {
  await page.goto('/');
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await expect(button(page, 'Notes')).toBeVisible();
  await completeAccessSetup(page);
}
/** Production sign-in is a page; signed-in agent controls live in Settings. */
export async function openYourAgent(page: Page) {
  const gate = page.locator('[role="main"].alpha-cloud-sign-in');
  if (await gate.isVisible()) return gate;
  // A touch outside the open chat only collapses it, so collapse it before going to Settings.
  const minimize = page.getByRole('button', { name: 'Minimize chat', exact: true });
  if (await minimize.isVisible()) await minimize.click();
  await button(page, 'Settings').click();
  await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Settings', exact: true });
  await expect(panel.getByRole('heading', {name:'Agent connection',exact:true})).toBeVisible();
  return panel;
}
