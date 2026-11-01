// Extra resident-agent and Eliza Cloud behaviour for the flag-off Android harness
// (flag-off-android.ts), for the production specs that sign in, change accounts or fail a reply.
//
// It wraps the harness's Capacitor bridge stub in a second init script, so it must be installed
// after flagOffAndroid(). Everything synthetic stays at that bridge: the bundle under test is the
// flag-off build, and the shipped renderer, CloudProtocol and native-stream reader all run.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. Nothing here is the
// native Agent or AlphaConnection plugin, the resident runtime, Eliza Cloud, Cerebras or a device.
import { expect, type Page } from '@playwright/test';

export interface StubAccount { token: string; userId: string; email: string; balance: number; userStatus?: number; inbox?: string;
  /** 'none': the billing snapshot reports a canceled plan, so no plan admits Cloud inference.
   * 'credits': no subscription (Cloud's organization-credit mode, every new account); a redeemed
   * code turns it into an active membership. Absent: an active Plus membership. */
  plan?: 'none' | 'credits' }
export type StubStream =
  /** Native refuses the stream call before anything reaches the runtime. */
  | 'reject'
  /** The runtime refuses admission with HTTP 429; nothing is recorded. */
  | 'busy'
  /** The runtime answers 401: the resident's owner session is no longer accepted. */
  | 'expired'
  /** HTTP 200 and the user turn is recorded, then the stream fails before a terminal frame. */
  | 'drop'
  /** The reply is held until `release()`; the user turn is recorded first. */
  | 'hold'
  /** The turn fails on the agent with this upstream failure kind, in a `done` or `error` frame.
   * `runtime`: the exact `done` frame the agent's conversation stream writes when a Cloud 402 ends a
   * turn before any text (fullText is upstream's credits reply, `failureKind` with no terminalFailure). */
  | { failure: string; frame: 'done' | 'error'; runtime?: boolean };
/** One Cloud Maps place in the deployed `/api/v1/maps` shape. */
export interface StubMapsPlace { id: string; name: string; latitude: number; longitude: number; address?: string }
/** Eliza Cloud Maps (#412) behind the synthetic Cloud: capabilities, places/search and routes only.
 * Every request is recorded in `residentStub.maps.requests`. `residentStub.maps.hold` holds the next
 * search answer until `residentStub.releaseSearch()`, even after the renderer cancels it (recorded in
 * `cancelled`); `limit` refuses
 * the next search or route once with HTTP 429 and that Retry-After header. */
export interface StubMaps {
  regions: { id: string; name: string; bounds: [number, number, number, number] }[];
  /** Search answers by exact query text; anything else finds nothing. */
  places: Record<string, StubMapsPlace[]>;
  /** Route candidates per request, recommended first (minutes, metres, via street). */
  routes: { minutes: number; meters: number; via: string }[];
  modes?: string[];
}
export interface ResidentStubOptions {
  /** Eliza Cloud Maps routes. Omitted: the base harness refuses them (404, Maps not deployed). */
  maps?: StubMaps;
  /** Synthetic native email-code boundary; no real code is sent. */
  nativeSignIn?: boolean;
  /** First run: no Cloud key is saved on this phone. */
  emptyKeystore?: boolean;
  /** Eliza Cloud accounts, answered by bearer token. The first is the harness's saved key unless emptyKeystore. */
  accounts?: StubAccount[];
  /** Device capabilities the resident agent offers at registration (the harness offers none). */
  offered?: string[];
  /** What native DailyApps.surfaceInfo reports for Clock repeat days (absent: not reported). */
  clockRepeatDaysVersion?: number;
}

export async function residentStub(page: Page, options: ResidentStubOptions = {}) {
  await page.addInitScript(({ options }) => {
    const w = window as any, f = w.flagOff, base = w.Capacitor.nativePromise;
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    let kept: any = null;
    try { kept = JSON.parse(sessionStorage.getItem('resident-stub') || 'null'); } catch { /* first load */ }
    if (!kept) {
      if (options.emptyKeystore) delete f.slots['cloud:production'];
      else if (options.accounts?.length) f.slots['cloud:production'] = JSON.stringify({ token: options.accounts[0].token, credentialId: id, expiresAt: Date.now() + 86_400_000 });
      f.persist();
    }
    // Ordered native and Cloud events that the specs assert on, kept across a reload.
    const s = w.residentStub = {
      order: [] as string[], cloud: [] as Array<{ method: string; path: string; auth?: string }>, bodies: [] as any[], opened: [] as string[],
      accounts: structuredClone(options.accounts ?? []) as any[], login: 'authenticated' as 'authenticated' | 'expired' | 'hold', nextToken: '', polls: 0,
      start: 'ok' as 'ok' | 'reject' | 'reject-once' | 'starting', held: null as null | { conversation: string; reply: string },
      ...kept,
      // Per page load: the stream mode and a held reply do not survive a restart.
      stream: null as any, release: null as null | (() => void), recoveries: [] as string[], capabilities: '',
      // Cloud's answer to the next code redemption: 'ok' grants Plus; 'invalid' is Cloud's one answer
      // for unknown, expired, disabled and used-up codes (400 invalid_subscription_code).
      redeem: 'ok' as 'ok' | 'invalid', redeemed: [] as Array<{ code: string; idempotencyKey: string }>,
      maps: { requests: [] as Array<{ route: string; body: any; requestId: string }>, cancelled: [] as string[], hold: false, limit: null as null | string },
    };
    const persist = () => sessionStorage.setItem('resident-stub', JSON.stringify({ order: s.order, cloud: s.cloud, bodies: s.bodies, opened: s.opened, accounts: s.accounts, login: s.login, nextToken: s.nextToken, polls: s.polls, start: s.start, held: s.held }));
    s.persist = persist; persist();
    const emit = (streamId: string, event: unknown) => f.emit('Agent', 'alphaAgentStream', { streamId, event });
    const data = (streamId: string, value: unknown) => emit(streamId, { type: 'chunk', dataBase64: btoa('data: ' + JSON.stringify(value) + '\n\n') });
    // This stub keeps the resident agent's conversations itself (the harness's store is private to it),
    // so a recorded turn without a reply is visible to history reads and survives a reload.
    let agent: { conversations: { id: string; title: string }[]; history: Record<string, any[]> } = { conversations: [], history: {} };
    try { agent = JSON.parse(sessionStorage.getItem('resident-stub-agent') || 'null') ?? agent; } catch { /* first load */ }
    const record = (conversation: string, row: any) => { agent.history[conversation].push(row); sessionStorage.setItem('resident-stub-agent', JSON.stringify(agent)); };
    const conversations = (method: string, path: string, body: any): { status: number; data: unknown } | null => {
      if (path === '/api/conversations' && method === 'POST') { const row = { id: 'resident-chat-' + (agent.conversations.length + 1), title: String(body.title || 'Alpha Phone') }; agent.conversations.push(row); agent.history[row.id] = []; sessionStorage.setItem('resident-stub-agent', JSON.stringify(agent)); return { status: 200, data: { conversation: row } }; }
      if (path === '/api/conversations') return { status: 200, data: { conversations: agent.conversations } };
      const read = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path.split('?')[0]);
      if (read && method === 'GET') return { status: 200, data: { messages: (agent.history[read[1]] || []).slice(-200) } };
      if (/^\/api\/turns\/[^/]+\/abort$/.test(path)) return { status: 404, data: {} };
      // The renderer's one non-streaming re-read of a dropped stream, under the same clientMessageId.
      // Upstream answers it from the durable outcome; this runtime is unavailable for it.
      if (/^\/api\/conversations\/[^/]+\/messages$/.test(path) && method === 'POST') { s.recoveries.push(body.clientMessageId); return { status: 503, data: {} }; }
      return null;
    };
    // The agent finishes a reply it held across a restart of the phone app: it is recorded, and only
    // a history read can show it (the stream that would have carried it ended with the old page).
    s.finishHeld = () => { if (!s.held) return; record(s.held.conversation, { id: crypto.randomUUID(), role: 'assistant', text: s.held.reply, timestamp: Date.now() + 1 }); s.held = null; persist(); };
    const account = (auth?: string) => s.accounts.find((row: any) => auth === 'Bearer ' + row.token);
    // Retiring a connection pauses native background digest delivery. The harness declares that
    // plugin only with digests; here only its pause exists, recorded as a step.
    const pauseOnly = !w.Capacitor.PluginHeaders.some((row: any) => row.name === 'AlphaHostedResults');
    if (pauseOnly) w.Capacitor.PluginHeaders.push({ name: 'AlphaHostedResults', methods: [{ name: 'disableBackground', rtype: 'promise' }] });
    let rejectSignIn: null | ((error: Error) => void) = null;
    if(options.nativeSignIn)w.Capacitor.PluginHeaders.push({name:'AlphaCloudSignIn',methods:['status','startEmail','verifyEmail','cancel','addListener','removeListener'].map(name=>({name,rtype:'promise'}))});
    w.Capacitor.nativePromise = async (plugin: string, method: string, input: any) => {
      if(options.nativeSignIn && plugin==='AlphaCloudSignIn'){
        s.order.push('native sign-in '+method);persist();
        if(method==='status')return {active:false,inApp:true,email:true,google:false};
        if(method==='addListener'||method==='removeListener')return {};
        if(method==='cancel'){rejectSignIn?.(Object.assign(new Error('cancelled'),{code:'cancelled'}));rejectSignIn=null;return {};}
        if(method==='startEmail')return {attemptId:'33333333-3333-4333-8333-333333333333',expiresAt:Date.now()+600000,resendAt:Date.now()+60000};
        if(method==='verifyEmail'){
          if(input.code!=='123456')throw Object.assign(new Error('invalid-code'),{code:'invalid-code'});
          if(s.login==='hold')return new Promise((_,reject)=>{rejectSignIn=reject;});
          if(s.login==='expired')throw Object.assign(new Error('expired'),{code:'expired'});
          const old=f.slots['cloud:production']?JSON.parse(f.slots['cloud:production']):null;
          const credential={credentialId:crypto.randomUUID(),token:s.nextToken,expiresAt:Date.now()+30*86400000};
          await base('AlphaConnection','secureWrite',{slot:'cloud:production',value:JSON.stringify(credential)});
          s.order.push('store '+s.nextToken);
          // Native stores the acknowledged replacement before best-effort revocation. This is
          // a synthetic native outcome, not proof of the real plugin's network ordering.
          if(old?.token && old.token!==s.nextToken)s.order.push('revoke Bearer '+old.token);
          persist();return {status:'authenticated',environment:'production',expiresAt:credential.expiresAt,...(old?.token?{previousSignIn:'revoked'}:{})};
        }
        throw Error('Unexpected native sign-in method '+method);
      }

      if (pauseOnly && plugin === 'AlphaHostedResults' && method === 'disableBackground') { s.order.push('pause background delivery'); persist(); return {}; }
      // Removing a stored provider stops the process launched with it (AlphaCredentialStore requiresShutdown).
      if (plugin === 'Agent' && method === 'clearProvider' && f.slots['native:local-agent-provider']) { s.order.push('Agent.stop'); persist(); }
      if (plugin === 'Agent' && ['start', 'stop', 'configureCloudProvider'].includes(method)) { s.order.push(method === 'configureCloudProvider' ? 'configureCloudProvider ' + input.credentialId : 'Agent.' + method); persist(); }
      if (plugin === 'Agent' && method === 'start' && (s.start === 'reject' || s.start === 'reject-once')) { if (s.start === 'reject-once') { s.start = 'ok'; persist(); } f.calls.push('Agent.start'); throw Error('Local agent failed to start.'); }
      if (plugin === 'Agent' && method === 'request' && input.path === '/api/agents' && s.start === 'starting') { f.calls.push('Agent.request'); return { status: 200, body: JSON.stringify({ agents: [{ id: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', name: 'Alpha', status: 'starting' }] }) }; }
      // The harness still registers the device (it answers the committed-enrollment read from that
      // registration); only the capabilities the agent offers in its answer change.
      if (plugin === 'Agent' && method === 'request' && input.path === '/api/client-devices/register' && options.offered) { const registered = await base(plugin, method, input); return { ...registered, body: JSON.stringify({ ...JSON.parse(registered.body), capabilities: options.offered }) }; }
      if (plugin === 'DailyApps' && method === 'surfaceInfo' && options.clockRepeatDaysVersion !== undefined) { f.calls.push('DailyApps.surfaceInfo'); return { developmentBuild: false, assistant: false, clockRepeatDaysVersion: options.clockRepeatDaysVersion }; }
      if (plugin === 'Agent' && method === 'request') {
        const answer = conversations(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {});
        // Anything else reaches the harness, which records it as unexpected.
        if (answer) { f.calls.push('Agent.request'); return { status: answer.status, body: JSON.stringify(answer.data) }; }
      }
      if (plugin === 'AlphaConnection' && method === 'secureWrite' && input.slot === 'cloud:production') { s.order.push('store ' + JSON.parse(input.value).token); persist(); }
      if (plugin === 'AlphaConnection' && method === 'secureRemove' && input.slot === 'cloud:production') { s.order.push('remove cloud key'); persist(); }
      if (options.maps && plugin === 'AlphaConnection' && method === 'cancel') { s.maps.cancelled.push(input.requestId); return {}; }
      if (plugin === 'AlphaConnection' && method === 'openExternal') { f.calls.push('AlphaConnection.openExternal'); s.opened.push(input.url); s.order.push('openExternal ' + new URL(input.url).origin); persist(); return {}; }
      if (plugin === 'AlphaConnection' && method === 'request') {
        const url = new URL(input.url), path = url.pathname, auth = input.headers?.Authorization;
        if (url.origin !== 'https://api.eliza.app') return base(plugin, method, input);
        f.calls.push('AlphaConnection.request');
        s.cloud.push({ method: input.method, path, auth }); persist();
        if (path === '/api/auth/cli-session' && input.method === 'POST') return { status: 200, data: { sessionId: 'b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d', status: 'pending', expiresAt: new Date(Date.now() + 600_000).toISOString() } };
        if (path === '/api/auth/cli-session/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d') {
          // One pending poll, then the outcome the test chose. `hold` stays pending until changed.
          s.polls++; persist();
          if (s.polls === 1 || s.login === 'hold') { s.order.push('poll pending'); return { status: 200, data: { status: 'pending' } }; }
          s.order.push('poll ' + s.login);
          return { status: 200, data: s.login === 'expired' ? { status: 'expired' } : { status: 'authenticated', token: s.nextToken } };
        }
        if (options.maps && path.startsWith('/api/v1/maps/')) {
          const m = options.maps, route = path.slice('/api/v1/maps/'.length), body = input.body ? JSON.parse(input.body) : null, maps = s.maps;
          maps.requests.push({ route, body, requestId: input.requestId });
          const provider = 'eliza-cloud-osm', attribution = '© OpenStreetMap contributors (ODbL). Search: Nominatim. Routing: GraphHopper.';
          if (route === 'capabilities' && input.method === 'GET') return { status: 200, data: { providerId: provider, connectionId: 'conn_eliza_cloud_maps_osm', revision: 'osm-fixture-2026-10', attribution, sources: { data: 'OpenStreetMap', search: 'Nominatim', routing: 'GraphHopper' },
            disclosure: { recipients: [{ role: 'gateway', name: 'Eliza Cloud Maps', operator: 'Eliza Labs' }, { role: 'search', name: 'Nominatim', operator: 'Eliza Labs' }, { role: 'routing', name: 'GraphHopper', operator: 'Eliza Labs' }], cloudRecords: 'operation-and-result-code' },
            regions: m.regions, capabilities: { map: false, search: true, placeDetails: true, geocode: true, reverseGeocode: true, modes: m.modes ?? ['drive', 'walk', 'bicycle'], alternatives: true, traffic: 'none', transit: 'none', offline: { map: false, search: false, routing: false } } } };
          if (input.method !== 'POST' || !input.headers?.['Idempotency-Key']) { f.unexpected.push('maps ' + input.method + ' ' + route); return { status: 400, data: { code: 'maps_request_id_required' } }; }
          if (maps.limit) { const retryAfter = maps.limit; maps.limit = null; persist(); return { status: 429, data: { error: 'Rate limited', code: 'rate_limited' }, retryAfter }; }
          const wire = (p: any) => ({ providerId: provider, id: p.id, name: p.name, coordinate: { latitude: p.latitude, longitude: p.longitude }, ...(p.address ? { address: p.address } : {}), attribution, fetchedAt: Date.now() });
          if (route === 'places/search') {
            const answer = { status: 200, data: { providerId: provider, attribution, places: (m.places[body.query] ?? []).map(wire) } };
            if (!maps.hold) return answer;
            maps.hold = false;
            // Held until the test calls releaseSearch(), even after a cancel: a late answer still arrives.
            return new Promise(resolve => { s.releaseSearch = () => { s.releaseSearch = null; resolve(answer); }; });
          }
          if (route === 'places/details') { const found = Object.values(m.places).flat().find(p => p.id === body.id); return { status: 200, data: { providerId: provider, attribution, place: found ? wire(found) : null } }; }
          if (route === 'routes') return { status: 200, data: { providerId: provider, attribution, routes: m.routes.slice(0, body.alternatives ? m.routes.length : 1).map((r, i) => ({ providerId: provider, id: 'route_fixture_' + body.mode + '_' + i, from: body.from, to: body.to, mode: body.mode,
            geometry: [body.from, { latitude: (body.from.latitude + body.to.latitude) / 2 + i * 0.001, longitude: (body.from.longitude + body.to.longitude) / 2 }, body.to], distanceMeters: r.meters, durationSeconds: r.minutes * 60,
            steps: [{ instruction: 'Head along ' + r.via, coordinate: body.from, distanceMeters: r.meters, maneuver: 'depart' }, { instruction: 'Arrive at the destination', coordinate: body.to, distanceMeters: 0, maneuver: 'arrive' }], attribution, fetchedAt: Date.now(), traffic: 'none' })) } };
          f.unexpected.push('maps ' + route); return { status: 404, data: {} };
        }
        if (path === '/api/v1/api-keys/current' && input.method === 'DELETE') { s.order.push('revoke ' + auth); persist(); return { status: 200, data: { success: true, status: 'revoked', credentialId: null, revokedAt: new Date().toISOString() } }; }
        if (s.accounts.length) {
          const owner = account(auth);
          if (!owner) return { status: 401, data: {} };
          if (path === '/api/v1/user') { if (owner.userStatus && owner.userStatus !== 200) return { status: owner.userStatus, data: {} }; return { status: 200, data: { success: true, data: { id: owner.userId, email: owner.email } } }; }
          // The billing snapshot answers the plan while the entitlement route is absent (404, from the base
          // harness), and carries the organization credit balance (the retired /api/v1/credits/balance is never read).
          if (path === '/api/v1/subscription/redeem' && input.method === 'POST') {
            const body = JSON.parse(input.body); s.redeemed.push({ code: body.code, idempotencyKey: body.idempotencyKey }); s.order.push('redeem ' + owner.email); persist();
            if (s.redeem === 'invalid') return { status: 400, data: { success: false, error: 'This subscription code cannot be redeemed.', code: 'invalid_subscription_code' } };
            owner.plan = undefined; persist();
            return { status: 200, data: { success: true, replayed: false, grant: { id: 'synthetic-grant', planKey: 'plus_monthly', startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2027-04-30T00:00:00.000Z', revoked: false, paidPlanTakesPrecedence: false }, entitlement: { plan: { id: 'plus_monthly', name: 'Plus', status: 'active' }, source: 'grant', effectiveUntil: '2027-04-30T00:00:00.000Z' } } };
          }
          if (path === '/api/v1/billing/limits') { s.order.push('plan ' + owner.email); persist(); return { status: 200, data: { success: true, data: { schemaVersion: 2, v2: {
            subscription: owner.plan === 'credits' ? { status: 'not_applicable', reason: 'no_organization_subscription' } : { status: 'available', value: { planKey: 'plus_monthly', state: owner.plan === 'none' ? 'canceled' : 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } },
            balance: { status: 'available', source: 'organizations', observedAt: new Date().toISOString(), value: { balance: { value: String(owner.balance), unit: 'usd', currency: 'USD' }, revision: '1' } } } } } }; }
          if (path === '/api/v1/eliza/google/accounts') return { status: 200, data: owner.inbox ? [{ configured: true, connected: true, reason: 'connected', connectionId: 'grant-' + owner.userId.slice(0, 8), grantedCapabilities: ['google.gmail.triage'], identity: { email: owner.inbox } }] : [] };
        }
        return base(plugin, method, input);
      }
      if (plugin === 'Agent' && method === 'requestStream') {
        s.bodies.push(JSON.parse(input.body)); s.capabilities = String(input.headers?.['X-Eliza-Device-Capabilities'] ?? ''); persist();
        const mode = s.stream;
        f.calls.push('Agent.requestStream'); f.streams++;
        const conversation = /^\/api\/conversations\/([^/]+)\/messages\/stream$/.exec(input.path)![1], body = JSON.parse(input.body), streamId = input.streamId as string;
        if (mode === 'reject') throw Error('Local stream unavailable.');
        if (!mode || mode === 'hold') {
          // The resident agent records the user turn, then streams its reply (held until release()).
          f.posts.push(String(body.text));
          record(conversation, { id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() });
          const reply = f.replies.shift() ?? (mode === 'hold' ? 'Held reply ' : 'Resident reply ') + f.streams;
          const finish = () => { s.release = null; s.held = null; persist(); record(conversation, { id: crypto.randomUUID(), role: 'assistant', text: reply, timestamp: Date.now() + 1 }); data(streamId, { type: 'token', text: reply }); data(streamId, { type: 'done', fullText: reply, agentName: 'Alpha' }); emit(streamId, { type: 'complete' }); };
          if (mode === 'hold') { s.held = { conversation, reply }; persist(); }
          setTimeout(() => { emit(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } }); if (mode === 'hold') s.release = finish; else finish(); }, 0);
          return { streamId };
        }
        if (mode === 'busy' || mode === 'expired') { setTimeout(() => { emit(streamId, { type: 'response', status: mode === 'busy' ? 429 : 401, headers: { 'content-type': 'application/json' } }); emit(streamId, { type: 'complete' }); }, 0); return { streamId }; }
        f.posts.push(String(body.text));
        const userMessageId = crypto.randomUUID();
        record(conversation, { id: userMessageId, role: 'user', text: body.text, timestamp: Date.now() });
        setTimeout(() => {
          emit(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } });
          if (mode === 'drop') { emit(streamId, { type: 'complete', error: 'Stream interrupted. Outcome unknown; check history before retrying.' }); return; }
          const terminalFailure = { kind: mode.failure, message: 'PRIVATE_PROVIDER_ERROR_CANARY', transient: false };
          if (mode.runtime) data(streamId, { agentName: 'Alpha', messageId: crypto.randomUUID(), userMessageId, failureKind: mode.failure, type: 'done', fullText: 'The configured AI provider is out of credits or quota. Add credits or increase its quota, then try again.' });
          else if (mode.frame === 'error') data(streamId, { type: 'error', message: 'PRIVATE_PROVIDER_ERROR_CANARY', failureKind: mode.failure, terminalFailure });
          else data(streamId, { type: 'done', fullText: 'PRIVATE_PROVIDER_ERROR_CANARY', agentName: 'Alpha', failureKind: mode.failure, terminalFailure });
          emit(streamId, { type: 'complete' });
        }, 0);
        return { streamId };
      }
      return base(plugin, method, input);
    };
  }, { options });
}
/** Reads (or changes) this stub's state from the test. */
export const stub = <T>(page: Page, read: (s: any) => T) => page.evaluate(`(${read.toString()})(window.residentStub)`) as Promise<T>;
/** Changes this stub's settings (stream mode, accounts, login outcome) from the test. */
export const setStub = (page: Page, patch: Record<string, unknown>) => page.evaluate(patch => { Object.assign((window as any).residentStub, patch); (window as any).residentStub.persist(); }, patch);

/** Explicit synthetic email/code journey through the shipped renderer. */
export async function emailCode(page: Page, verify = true) {
  const dialog=page.locator('.alpha-cloud-sign-in');
  await expect(dialog).toBeVisible();
  const otherMethods=dialog.getByRole('button',{name:'Other sign-in methods',exact:true});
  if(await otherMethods.isVisible())await otherMethods.click();
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('fixture@example.invalid');
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByLabel('Six-digit code')).toBeVisible();
  if(verify){await dialog.getByLabel('Six-digit code').fill('123456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();}
}

/** Complete the visible native email form on the required page or an optional sign-in dialog. */
export async function enterNativeEmailCode(page: Page, email='owner@example.invalid') {
  const panel=page.locator('.alpha-cloud-sign-in');
  await expect(panel).toBeVisible();
  const otherMethods=panel.getByRole('button',{name:'Other sign-in methods',exact:true});
  if(await otherMethods.isVisible())await otherMethods.click();
  await panel.getByRole('textbox',{name:'Email',exact:true}).fill(email);
  await panel.getByRole('button',{name:'Email me a code',exact:true}).click();
  await panel.getByLabel('Six-digit code').fill('123456');
  await panel.getByRole('button',{name:'Verify',exact:true}).click();
}
