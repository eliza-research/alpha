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
  /** 'none': the billing snapshot reports a canceled plan, so no plan admits Cloud inference. */
  plan?: 'none' }
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
  /** The turn fails on the agent with this upstream failure kind, in a `done` or `error` frame. */
  | { failure: string; frame: 'done' | 'error' };
export interface ResidentStubOptions {
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
      if (plugin === 'Agent' && method === 'request' && input.path === '/api/client-devices/register' && options.offered) { f.calls.push('Agent.request'); return { status: 200, body: JSON.stringify({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: options.offered }) }; }
      if (plugin === 'DailyApps' && method === 'surfaceInfo' && options.clockRepeatDaysVersion !== undefined) { f.calls.push('DailyApps.surfaceInfo'); return { developmentBuild: false, assistant: false, clockRepeatDaysVersion: options.clockRepeatDaysVersion }; }
      if (plugin === 'Agent' && method === 'request') {
        const answer = conversations(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {});
        // Anything else reaches the harness, which records it as unexpected.
        if (answer) { f.calls.push('Agent.request'); return { status: answer.status, body: JSON.stringify(answer.data) }; }
      }
      if (plugin === 'AlphaConnection' && method === 'secureWrite' && input.slot === 'cloud:production') { s.order.push('store ' + JSON.parse(input.value).token); persist(); }
      if (plugin === 'AlphaConnection' && method === 'secureRemove' && input.slot === 'cloud:production') { s.order.push('remove cloud key'); persist(); }
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
        if (path === '/api/v1/api-keys/current' && input.method === 'DELETE') { s.order.push('revoke ' + auth); persist(); return { status: 200, data: { success: true, status: 'revoked', credentialId: null, revokedAt: new Date().toISOString() } }; }
        if (s.accounts.length) {
          const owner = account(auth);
          if (!owner) return { status: 401, data: {} };
          if (path === '/api/v1/user') { if (owner.userStatus && owner.userStatus !== 200) return { status: owner.userStatus, data: {} }; return { status: 200, data: { success: true, data: { id: owner.userId, email: owner.email } } }; }
          if (path === '/api/v1/credits/balance') { s.order.push('credits ' + owner.email); persist(); return { status: 200, data: { balance: owner.balance } }; }
          // The billing snapshot answers the plan while the entitlement route is absent (404, from the base harness).
          if (path === '/api/v1/billing/limits') { s.order.push('plan ' + owner.email); persist(); return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: owner.plan === 'none' ? 'canceled' : 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } }; }
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
        record(conversation, { id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() });
        setTimeout(() => {
          emit(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } });
          if (mode === 'drop') { emit(streamId, { type: 'complete', error: 'Stream interrupted. Outcome unknown; check history before retrying.' }); return; }
          const terminalFailure = { kind: mode.failure, message: 'PRIVATE_PROVIDER_ERROR_CANARY', transient: false };
          if (mode.frame === 'error') data(streamId, { type: 'error', message: 'PRIVATE_PROVIDER_ERROR_CANARY', failureKind: mode.failure, terminalFailure });
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

/** Complete the visible synthetic native email form after the product sign-in button is clicked. */
export async function enterNativeEmailCode(page: Page, email='owner@example.invalid') {
  const panel=page.getByRole('main',{name:'Sign in',exact:true}).or(page.getByRole('dialog',{name:'Sign in',exact:true}));
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox',{name:/^Email( or phone number)?$/}).fill(email);
  await panel.getByRole('button',{name:'Continue',exact:true}).click();
  await panel.getByLabel('Six-digit code').fill('123456');
}
