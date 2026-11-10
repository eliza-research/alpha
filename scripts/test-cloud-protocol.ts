// Synthetic HTTP lifecycle exercise. No request leaves loopback; this is not
// evidence of live Cloud login, provider consent, native storage, or deployment.
import {startLoopback, stopLoopback} from './fixtures/loopback.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import type {CloudCredential, CloudCredentialStore, CloudEnvironment, CloudNativeRequest} from '../apps/app/src/runtime/cloud-protocol.ts';
import type {CloudSignInPort} from '../apps/app/src/runtime/cloud-sign-in.ts';
if (!process.execArgv.some(arg => arg === '--import=tsx' || arg === 'tsx')) {
  const child = spawnSync(process.execPath, ['--import=tsx', process.argv[1]], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
const { CloudProtocol, CloudProtocolError } = await import('../apps/app/src/runtime/cloud-protocol.ts');
// Hosted agents are development infrastructure (#406): the product adapter has no agent route.
const { DevelopmentCloudAgentProtocol } = await import('../apps/app/src/runtime/development-cloud-agents.ts');
// The browser hand-off survives only as a test-mocks diagnostic fallback for one release.
const { CloudSignInError } = await import('../apps/app/src/runtime/cloud-sign-in.ts');
assert.equal(typeof CloudProtocol.prototype.login, 'function', 'the Cloud sign-in hand-off stays on the shipped class until the in-app readiness probe passes');
for (const method of ['listAgents', 'agentDetail', 'personal', 'phoneRequest', 'setPhoneTarget', 'listConversations', 'messages', 'createConversation', 'send'])
  assert.equal(method in CloudProtocol.prototype, false, `production CloudProtocol has no ${method}`);
const id = '72475cd0-e135-4c42-a9e2-fb5fe0820ada';
const sessionId = 'd32f7f34-962b-47b7-8f0d-f2fe7f12610a';
const token = 'synthetic-cloud-session';
let mode = 'ok', agentReads = 0, polls = 0;
const memory: {saved: CloudCredential | null} = {saved: null};
function savedCredential() {
  const credential = memory.saved;
  assert.ok(credential, 'Expected a stored Cloud fixture credential');
  return credential;
}
const hasCode = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
// Order of the replaced key's revocation and the new key's storage.
const replacement: string[] = [];
const runtimeTargets: string[] = [];
const mapsRequests: {path: string; method?: string; key?: string | string[]; body: unknown}[] = [];
const mail = { externalId: 'mail/id', threadId: 'thread', subject: 'Synthetic subject', from: 'Fixture sender', fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], snippet: 'Synthetic preview', receivedAt: '2026-09-29T12:00:00Z', isUnread: true };
const grant = 'grant/one';
const formattedMail = '<table><tr><td><img src="https://images.example.invalid/logo.png">Formatted mail</td></tr></table>';
const htmlBody = () => mode === 'bad-html' ? 7 : mode === 'large-html' ? '😀'.repeat(131073) : formattedMail;
const conversationId = 'ed694c7a-d9a7-4a8c-a547-533040bc1c79';
let pendingObserved: (() => void) | undefined;
const agent = () => ({ id, agentName: 'Synthetic agent', status: 'running', executionTier: mode === 'shared' ? 'shared' : 'dedicated-lazy',
  webUiUrl: mode === 'shared' ? null : mode === 'foreign-runtime' ? 'https://attacker.invalid/' : `https://${id}.cloud.eliza.app` });
const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = req.url ?? '';
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    let status = 200, data;
    if (requestUrl === '/api/auth/cli-session') {
      assert.equal(req.method, 'POST'); assert.deepEqual(body, {});
      data = { sessionId, status: 'pending', expiresAt: new Date(Date.now() + (mode === 'expiry' ? 80 : 60000)).toISOString() };
    } else if (requestUrl === `/api/auth/cli-session/${sessionId}`) {
      polls++;
      if (mode === 'pending' || mode === 'expiry') { data = { status: 'pending' }; pendingObserved?.(); }
      else if (mode === 'consumed') data = { status: 'authenticated', message: 'API key already retrieved' };
      else data = { status: 'authenticated', token, apiKey: 'synthetic-legacy-key', expiresAt: new Date(Date.now() + 60000).toISOString() };
    } else if (requestUrl === '/api/v1/api-keys/current') {
      assert.equal(req.method, 'DELETE'); replacement.push('delete ' + req.headers.authorization);
      if (mode === 'revoke-fails') status = 500;
      data = mode === 'revoke-fails' ? {} : { success: true, status: 'revoked', credentialId: 'previous-credential', revokedAt: '2026-10-11T00:00:00Z' };
    } else {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (requestUrl === '/api/v1/eliza/agents') agentReads++;
      if (mode === 'outage') { status = 503; data = {}; }
      else if (requestUrl.startsWith('/api/v1/maps/')) {
       mapsRequests.push({ path:requestUrl,method:req.method,key:req.headers['idempotency-key'],body });
       if(req.method==='POST'||/^\/api\/v1\/maps\/tiles\/\d+\//.test(requestUrl)) {
        const key = req.headers['idempotency-key'];
        assert.equal(typeof key, 'string');
        assert.match(String(key),/^[a-f0-9-]{36}$/);
       } else assert.equal(req.headers['idempotency-key'],undefined);
       status=mode==='maps-unknown'?503:200;data=mode==='maps-unknown'?{code:'maps_admission_unknown'}:/^\/api\/v1\/maps\/tiles\/\d+\//.test(requestUrl)?{encoding:'base64',contentType:'image/png',data:mode==='tile-invalid'?'not base64':Buffer.from([137,80,78,71]).toString('base64')}:{};
      }
      else if (requestUrl === '/api/v1/user') data = { success: true, data: { id, organization_id: sessionId } };
      else if (requestUrl.endsWith('/api/conversations') && req.method === 'POST') data = { conversation: { id: conversationId, title: body.title } };
      else if (requestUrl.endsWith('/api/conversations')) data = { conversations: [{ id: conversationId, title: 'Fixture' }] };
      else if (requestUrl.endsWith(`/api/conversations/${conversationId}/messages`) && req.method === 'GET') data = { messages: [{ id: 'history-user', role: 'user', text: 'Earlier question', timestamp: 1 }, { id: 'history-agent', role: 'assistant', text: 'Earlier answer', timestamp: 2 }] };
      else if (requestUrl.endsWith(`/api/conversations/${conversationId}/messages`)) {
        assert.equal(body.text, 'Hello'); assert.equal(body.channelType, 'DM');
        assert.equal(body.clientMessageId, 'synthetic-message');
        data = { text: 'Synthetic response', agentName: 'Fixture' };
      }
      else if (requestUrl === '/api/v1/eliza/agents') { assert.equal(req.method, 'GET'); data = { success: true, data: [agent()] }; }
      else if (requestUrl === `/api/v1/eliza/agents/${id}`) { assert.equal(req.method, 'GET'); data = { success: true, data: agent() }; }
      else if (requestUrl === '/api/v1/eliza/google/connect/initiate') {
        // Authorizing on an account that already holds send asks for what it holds too: Cloud grants exactly what is named.
        assert.deepEqual(body, { side: 'owner', capabilities: mode === 'gmail-modify'
          ? ['google.basic_identity', 'google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox']
          : mode === 'cumulative' ? ['google.basic_identity', 'google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts'] : ['google.basic_identity', 'google.gmail.triage'] });
        data = { authUrl: mode === 'foreign-oauth' ? 'https://attacker.invalid/' : 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' };
      } else if (requestUrl === '/api/v1/eliza/google/accounts?side=owner') data = [{ configured: true, connected: true, reason: 'connected', connectionId: grant, grantedCapabilities: ['google.gmail.triage'], identity: { email: 'owner@example.invalid' } }];
      else if (requestUrl.startsWith('/api/v1/eliza/google/gmail/')) {
        const url = new URL(requestUrl, 'http://localhost'); assert.equal(url.searchParams.get('grantId'), grant); assert.equal(req.method, 'GET');
        if (url.pathname.endsWith('/search')) {
          assert.ok(['in:inbox', 'in:sent'].includes(url.searchParams.get('query') ?? '')); assert.ok(['25', '50'].includes(url.searchParams.get('maxResults') ?? ''));
          const pageToken = url.searchParams.get('pageToken');
          data = { messages: [mail], syncedAt: '2026-09-29T12:00:00Z', ...(mode === 'paged' ? { nextPageToken: pageToken ? null : 'opaque+/token=' } : mode === 'repeat-token' ? { nextPageToken: pageToken } : {}), ...(mode === 'revision' ? { mailboxHistoryId: '18446744073709551615' } : mode === 'bad-revision' ? { mailboxHistoryId: 12345 } : {}) };
        }
        else if (url.pathname.endsWith('/inbox-v1/capabilities')) data = { version: 1, from: 'owner@example.invalid', threads: true, send: false, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, ...(mode === 'read-state' ? { readState: true } : mode === 'bad-read-state' ? { readState: 'yes' } : {}) };
        else if (url.pathname.endsWith('/inbox-v1/thread')) {
          assert.equal(url.searchParams.get('threadId'), mail.threadId);
          data = { version: 1, threadId: mail.threadId, historyId: 'thread-revision', total: 1, offset: 0, nextOffset: null,
            messages: [{ message: mail, bodyText: 'Complete plain alternative', bodyHtml: htmlBody(), historyId: 'message-revision', attachments: [] }] };
        }
        else { assert.equal(url.searchParams.get('messageId'), mail.externalId); data = { message: mail, bodyText: '<script>plain untrusted email text</script>', bodyHtml: htmlBody() }; }
      }
      else if (requestUrl === '/api/v1/eliza/google/disconnect') { assert.equal(req.method, 'POST'); assert.deepEqual(body, { side: 'owner', connectionId: grant }); data = mode === 'bad-disconnect' ? {} : { ok: true }; }
      else if (requestUrl === '/api/v1/eliza/google/status?side=owner') data = { configured: true, connected: false, reason: 'disconnected', connectionId: null, grantedCapabilities: [] };
      else throw new Error('Unexpected synthetic route');
    }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ fixtureError: error instanceof Error ? error.message : String(error) })); }
});
const loopback = await startLoopback(server);
const request: CloudNativeRequest = async ({ url, method, headers, body, signal, redirect }) => {
  const target = new URL(url);
  assert.ok(['https://api.eliza.app', 'https://api-staging.eliza.app', `https://${id}.cloud.eliza.app`].includes(target.origin));
  if (target.pathname.includes('/api/conversations')) runtimeTargets.push(target.origin + target.pathname);
  assert.equal(redirect, 'error');
  const response = await fetch(loopback + target.pathname + target.search, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect });
  return { status: response.status, data: await response.json() };
};
const store: CloudCredentialStore = {
  async read() { return memory.saved; },
  async write(_environment, value, signal) { signal.throwIfAborted(); replacement.push('write ' + value.token); memory.saved = structuredClone(value); },
  async clear() { memory.saved = null; },
};
const opened: string[] = [];
const browser = async (url: string, signal: AbortSignal) => { signal.throwIfAborted(); opened.push(url); };
// Synthetic in-app sign-in host (AlphaCloudSignInPlugin's contract): it owns every secret, stores the
// key in the credential store before reporting success, and returns only non-secret outcomes.
const hostCalls: string[][] = [];
let hostMode = 'ok', releaseGoogle: ((reason: Error) => void) | null = null;
const host: CloudSignInPort = {
  async startGoogle(input) { hostCalls.push(['google', input.environment]); if (hostMode === 'hold') return new Promise<never>((_, reject) => { releaseGoogle = reject; });
    if (hostMode === 'unstored') return { status: 'authenticated', environment: input.environment, expiresAt: Date.now() + 60000, accountCreated: false };
    memory.saved = { credentialId: 'local-generation-1', token, expiresAt: Date.now() + 30 * 86400000, serverCredentialId: id };
    return { status: 'authenticated', environment: input.environment, expiresAt: memory.saved.expiresAt, accountCreated: hostMode === 'created' }; },
  async startEmail(input) { hostCalls.push(['email', input.environment]); assert.equal(input.email, 'owner@example.invalid', 'the address is trimmed, never altered');
    if (hostMode === 'cooldown') throw Object.assign(new Error('cooldown'), { code: 'cooldown' });
    return { attemptId: sessionId, expiresAt: Date.now() + 600000, resendAt: Date.now() + 60000 }; },
  async verifyEmail(input) { hostCalls.push(['verify', input.code]);
    if (input.code !== '123456') throw Object.assign(new Error('invalid-code'), { code: 'invalid-code' });
    if (hostMode === 'mfa') return { status: 'mfa', method: 'totp', expiresAt: Date.now() + 300000 };
    if (hostMode === 'foreign') return { status: 'authenticated', environment: 'staging', expiresAt: Date.now() + 60000, accountCreated: null };
    if (hostMode === 'leak') return { status: 'authenticated', environment: 'production', expiresAt: Date.now() + 60000, accountCreated: false, secret: 'eliza_mobile_must-not-cross' };
    if (hostMode === 'bad-previous') return { status: 'authenticated', environment: 'production', expiresAt: Date.now() + 60000, accountCreated: false, previousSignIn: 'kept' };
    if (hostMode === 'replaced') { memory.saved = { credentialId: 'local-generation-4', token, expiresAt: Date.now() + 30 * 86400000, serverCredentialId: id };
      return { status: 'authenticated', environment: 'production', expiresAt: memory.saved.expiresAt, accountCreated: false, previousSignIn: 'unconfirmed' }; }
    memory.saved = { credentialId: 'local-generation-2', token, expiresAt: Date.now() + 30 * 86400000, serverCredentialId: id };
    return { status: 'authenticated', environment: 'production', expiresAt: memory.saved.expiresAt, accountCreated: false }; },
  async verifyMfa(input) { hostCalls.push(['mfa', input.code]); memory.saved = { credentialId: 'local-generation-3', token };
    return { status: 'authenticated', environment: 'production', expiresAt: Date.now() + 60000, accountCreated: null }; },
  async cancel() { hostCalls.push(['cancel']); releaseGoogle?.(Object.assign(new Error('cancelled'), { code: 'cancelled' })); releaseGoogle = null; },
};
// Managed services (login, identity, Gmail, revocation) run on the CloudProtocol that product builds ship;
// only the hosted-agent routes use the development subclass, over the same credential store.
const make = (environment: CloudEnvironment = 'production', signIn: CloudSignInPort | null = host) => new CloudProtocol(environment, request, store, browser, {signIn: signIn ?? undefined});
const makeAgents = (environment: CloudEnvironment = 'production') => new DevelopmentCloudAgentProtocol(environment, request, store, browser);
const signal = () => new AbortController().signal;
try {
  const client = make();
  assert.equal(Object.getPrototypeOf(client), CloudProtocol.prototype, 'managed services are tested on the shipped class');
  const agents = makeAgents();
  // In-app email sign-in: the host stores the key; no web page is opened and no Cloud route is called here.
  const started = await client.startEmailSignIn('  owner@example.invalid ', signal());
  assert.equal(started.attemptId, sessionId);
  await assert.rejects(client.verifyEmailSignIn(started.attemptId, '000000', signal()), error => error instanceof CloudSignInError && error.code === 'invalid-code');
  assert.equal(memory.saved, null, 'a wrong code stores nothing');
  const signedIn = await client.verifyEmailSignIn(started.attemptId, '123456', signal());
  assert.deepEqual({ ...signedIn, expiresAt: typeof signedIn.expiresAt }, { status: 'authenticated', environment: 'production', expiresAt: 'number', accountCreated: false });
  assert.equal(savedCredential().token, token); assert.equal(opened.length, 0, 'in-app sign-in opens no Eliza Cloud page');
  await client.mapsRequest('capabilities',signal());
  await client.mapsRequest('places/search',signal(),{query:'Synthetic place'});
  await client.mapsRequest('places/search',signal(),{query:'Synthetic place'});
  assert.equal(mapsRequests.length,3);assert.notEqual(mapsRequests[1].key,mapsRequests[2].key);
  mode='maps-unknown';await assert.rejects(client.mapsRequest('routes',signal(),{from:{latitude:1,longitude:2}}),error => error instanceof CloudProtocolError && error.code === 'http' && error.status === 503);
  assert.equal(mapsRequests.length,4,'an unknown admission never retries');mode='ok';
  assert.deepEqual(new Uint8Array(await client.mapsTile(2,1,3,signal())),new Uint8Array([137,80,78,71]));
  const tile = mapsRequests.at(-1); assert.ok(tile);
  assert.equal(tile.method,'GET');assert.equal(typeof tile.key, 'string');assert.match(String(tile.key),/^[a-f0-9-]{36}$/);
  const tileCalls=mapsRequests.length;await assert.rejects(client.mapsTile(2,4,0,signal()),error => hasCode(error, 'invalid-response'));assert.equal(mapsRequests.length,tileCalls);
  mode='tile-invalid';await assert.rejects(client.mapsTile(2,1,3,signal()),error => hasCode(error, 'invalid-response'));mode='ok';
  assert.equal((await client.identity(signal())).userId, id);
  assert.equal((await agents.listAgents(signal()))[0].id, id);
  assert.equal((await agents.listConversations(id, signal()))[0].id, conversationId);
  assert.equal((await agents.createConversation(id, 'Fixture', signal())).id, conversationId);
  assert.equal((await agents.send(id, conversationId, 'Hello', { clientMessageId: 'synthetic-message', signal: signal() })).text, 'Synthetic response');
  assert.ok(runtimeTargets.every(target => target.startsWith(`https://${id}.cloud.eliza.app/`)));
  assert.equal((await agents.messages(id, conversationId, signal())).messages[1].text, 'Earlier answer');
  mode = 'shared';
  assert.equal((await agents.messages(id, conversationId, signal())).messages[0].role, 'user');
  await agents.send(id, conversationId, 'Hello', { clientMessageId: 'synthetic-message', signal: signal() });
  assert.equal(runtimeTargets.at(-1), `https://api.eliza.app/api/v1/eliza/agents/${id}/api/conversations/${conversationId}/messages`);
  mode = 'ok';
  assert.equal((await makeAgents().agentDetail(id, signal())).id, id, 'new client restores injected credentials');
  assert.match(await client.initiateGmail(signal()), /^https:\/\/accounts.google.com\//);
  // Incremental grant (P-37): the modify step is one consent that keeps read and adds every change capability.
  mode = 'gmail-modify'; assert.match(await client.initiateGmail(signal(), 'modify'), /^https:\/\/accounts.google.com\//); mode = 'ok';
  assert.equal((await client.gmailStatus(signal())).connected, false);
  assert.equal((await client.gmailAccounts(signal()))[0].connectionId, grant);
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal())).messages[0].id, mail.externalId);
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal(), 50)).messages[0].id, mail.externalId);
  assert.equal((await client.gmailRead(grant, mail.externalId, signal())).bodyText, '<script>plain untrusted email text</script>');
  assert.equal((await client.gmailRead(grant, mail.externalId, signal())).bodyHtml, formattedMail);
  const formattedThread = await client.gmailThread(grant, mail.threadId, signal());
  assert.equal(formattedThread.messages[0].bodyHtml, formattedMail, 'conversation loading preserves the complete formatted body');
  assert.equal(formattedThread.messages[0].historyId, 'message-revision');
  mode = 'bad-html';
  await assert.rejects(client.gmailRead(grant, mail.externalId, signal()), error => hasCode(error, 'invalid-response'));
  await assert.rejects(client.gmailThread(grant, mail.threadId, signal()), error => hasCode(error, 'invalid-response'));
  mode = 'large-html';
  assert.equal((await client.gmailRead(grant, mail.externalId, signal())).bodyHtml, undefined);
  const oversizedThread = await client.gmailThread(grant, mail.threadId, signal());
  assert.equal(oversizedThread.messages[0].bodyHtml, undefined, 'an oversized formatted body is never silently truncated');
  assert.equal(oversizedThread.messages[0].bodyText, 'Complete plain alternative');
  mode = 'ok';
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal())).nextPageToken, null, 'absent cursor means last page');
  mode = 'paged';
  const first = await client.gmailSearch(grant, 'in:inbox', signal());
  assert.equal(first.nextPageToken, 'opaque+/token=');
  assert.equal((await client.gmailSearch(grant, 'in:sent', signal(), 25, first.nextPageToken)).nextPageToken, null, 'opaque cursor is sent back exactly');
  mode = 'repeat-token'; await assert.rejects(client.gmailSearch(grant, 'in:inbox', signal(), 25, 'same'), error => hasCode(error, 'invalid-response'), 'a repeated cursor cannot loop');
  await assert.rejects(client.gmailSearch(grant, 'in:inbox', signal(), 25, ''), TypeError);
  // Mailbox revision (elizaOS/eliza#35908): an optional decimal string; absent from older servers.
  mode = 'ok'; assert.equal('mailboxHistoryId' in await client.gmailSearch(grant, 'in:inbox', signal()), false, 'older servers send no revision');
  mode = 'revision'; assert.equal((await client.gmailSearch(grant, 'in:inbox', signal())).mailboxHistoryId, '18446744073709551615');
  mode = 'bad-revision'; await assert.rejects(client.gmailSearch(grant, 'in:inbox', signal()), error => hasCode(error, 'invalid-response'), 'a malformed revision is refused');
  mode = 'ok'; assert.equal((await client.gmailInboxCapabilities(grant, signal())).readState, false, 'older servers do not advertise read state');
  mode = 'read-state'; assert.equal((await client.gmailInboxCapabilities(grant, signal())).readState, true);
  mode = 'bad-read-state'; await assert.rejects(client.gmailInboxCapabilities(grant, signal()), error => hasCode(error, 'invalid-response'));
  mode = 'ok'; await client.disconnectGmail(grant, signal());
  mode = 'bad-disconnect'; await assert.rejects(client.disconnectGmail(grant, signal()), error => hasCode(error, 'invalid-response'));
  mode = 'ok';
  mode = 'foreign-runtime'; await assert.rejects(agents.listAgents(signal()), error => hasCode(error, 'invalid-response'));
  mode = 'cumulative';
  assert.match(await client.initiateGmail(signal(), 'drafts', ['google.gmail.triage', 'google.gmail.send', 'google.unknown.scope']), /^https:\/\/accounts.google.com\//);
  mode = 'ok';
  mode = 'foreign-oauth'; await assert.rejects(client.initiateGmail(signal()), error => hasCode(error, 'invalid-response'));
  const readsBeforeOutage = agentReads;
  mode = 'outage'; await assert.rejects(agents.listAgents(signal()), error => error instanceof CloudProtocolError && error.status === 503);
  assert.equal(agentReads, readsBeforeOutage + 1); assert.ok(memory.saved);
  await client.disconnect(); assert.equal(memory.saved, null);
  await assert.rejects(agents.listAgents(signal()), error => hasCode(error, 'credentials-missing'));
  // Google through the host: one sign-in at a time, cancellation burns the host's attempt.
  hostMode = 'created';
  const created = await client.signInWithGoogle(signal());
  assert.equal(created.status, 'authenticated');
  assert.equal(created.accountCreated, true, 'a created account is reported, never silent');
  await client.disconnect(); assert.equal(memory.saved, null);
  hostMode = 'hold';
  const googleCancel = new AbortController();
  const google = assert.rejects(client.signInWithGoogle(googleCancel.signal), isAbort);
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(client.startEmailSignIn('owner@example.invalid', signal()), error => hasCode(error, 'login-active'));
  googleCancel.abort(); await google; assert.equal(memory.saved, null);
  assert.deepEqual(hostCalls.at(-1), ['cancel'], 'cancelling burns the pending attempt in the host');
  hostMode = 'mfa'; const mfaAttempt = await client.startEmailSignIn('owner@example.invalid', signal());
  const step = await client.verifyEmailSignIn(mfaAttempt.attemptId, '123456', signal());
  assert.equal(step.status, 'mfa'); assert.equal(step.method, 'totp'); assert.equal(memory.saved, null);
  assert.equal((await client.verifyMfaSignIn(mfaAttempt.attemptId, '654321', signal())).status, 'authenticated'); await client.disconnect();
  hostMode = 'cooldown'; await assert.rejects(client.startEmailSignIn('owner@example.invalid', signal()), error => hasCode(error, 'cooldown'));
  hostMode = 'foreign'; await assert.rejects(client.verifyEmailSignIn(sessionId, '123456', signal()), error => hasCode(error, 'unavailable'), 'an outcome for another environment is refused');
  hostMode = 'leak'; await assert.rejects(client.verifyEmailSignIn(sessionId, '123456', signal()), error => hasCode(error, 'unavailable'), 'an outcome carrying extra fields is refused');
  // The host revokes a replaced key itself; only its non-secret outcome crosses, from a fixed set.
  hostMode = 'replaced';
  const replaced = await client.verifyEmailSignIn(sessionId, '123456', signal());
  assert.equal(replaced.status, 'authenticated');
  assert.equal(replaced.previousSignIn, 'unconfirmed'); await client.disconnect();
  hostMode = 'bad-previous'; await assert.rejects(client.verifyEmailSignIn(sessionId, '123456', signal()), error => hasCode(error, 'unavailable'), 'an unknown replacement outcome is refused');
  hostMode = 'unstored'; await assert.rejects(client.signInWithGoogle(signal()), error => hasCode(error, 'credentials-missing'), 'success without a stored key is not a sign-in');
  hostMode = 'ok'; await assert.rejects(make('production', null).signInWithGoogle(signal()), error => error instanceof CloudSignInError && error.code === 'unavailable', 'no host, no sign-in');
  await make('staging').signInWithGoogle(signal()); assert.deepEqual([...hostCalls].reverse().find(call => call[0] === 'google'), ['google', 'staging']);
  await client.disconnect();
  // The Cloud sign-in hand-off: the product path until the in-app readiness probe passes, and the
  // test-mocks diagnostic afterwards.
  const legacy = make();
  await legacy.login(signal());
  assert.equal(savedCredential().token, token, 'session token preferred over legacy API key');
  assert.equal(opened.at(-1), `https://eliza.app/auth/cli-login?session=${sessionId}&app=alpha`);
  assert.ok(!opened.at(-1)?.includes(token) && !opened.at(-1)?.includes('synthetic-legacy-key'), 'the browser URL carries neither the session token nor the legacy API key');
  await legacy.disconnect();
  mode = 'consumed'; await assert.rejects(legacy.login(signal()), error => hasCode(error, 'credential-consumed'));
  assert.equal(memory.saved, null);
  mode = 'expiry'; await assert.rejects(legacy.login(signal()), error => hasCode(error, 'expired'));
  assert.equal(memory.saved, null);
  mode = 'pending';
  const seen = new Promise<void>(resolve => { pendingObserved = resolve; });
  const cancel = new AbortController();
  const login = legacy.login(cancel.signal);
  const rejection = assert.rejects(login, isAbort);
  await seen;
  await assert.rejects(legacy.login(signal()), error => hasCode(error, 'login-active'));
  cancel.abort(); await rejection; assert.equal(memory.saved, null);
  const pollsAtCancel = polls; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(polls, pollsAtCancel);
  // A new sign-in over a saved one revokes the saved key exactly once, before the new key is stored.
  const replacing = new CloudProtocol('production', request, store, async (url, signal) => { signal.throwIfAborted(); opened.push(url); }, { deleteRequests: true });
  mode = 'ok'; replacement.length = 0;
  memory.saved = { token: 'previous-key', credentialId: 'previous-credential' };
  assert.deepEqual(await replacing.login(signal()), { previousSignIn: 'revoked' });
  assert.deepEqual(replacement, ['delete Bearer previous-key', 'write ' + token]);
  // A failed revocation is reported unconfirmed and never blocks the new sign-in.
  mode = 'revoke-fails'; replacement.length = 0;
  memory.saved = { token: 'previous-key', credentialId: 'previous-credential' };
  assert.deepEqual(await replacing.login(signal()), { previousSignIn: 'unconfirmed' });
  assert.deepEqual(replacement, ['delete Bearer previous-key', 'write ' + token]);
  assert.equal(savedCredential().token, token);
  // Nothing saved: nothing to revoke.
  mode = 'ok'; replacement.length = 0; memory.saved = null;
  assert.deepEqual(await replacing.login(signal()), {});
  assert.deepEqual(replacement, ['write ' + token]);
  // Cloud handing back the key already saved replaces nothing, so the live key is never revoked.
  replacement.length = 0; memory.saved = { token, credentialId: 'same-credential' };
  assert.deepEqual(await replacing.login(signal()), {});
  assert.deepEqual(replacement, ['write ' + token]);
  memory.saved = null;
  mode = 'ok'; await make('staging').login(signal());
  assert.equal(opened.at(-1), `https://staging.eliza.app/auth/cli-login?session=${sessionId}&app=alpha`);
  assert.ok(!opened.at(-1)?.includes(token) && !opened.at(-1)?.includes('synthetic-legacy-key'), 'the browser URL carries neither the session token nor the legacy API key');
  await client.disconnect();
  process.stdout.write('PASS: synthetic in-app Cloud sign-in (email, MFA, Google, cancellation, one at a time, refused foreign/extra/unstored outcomes, previous-key revocation outcome), synthetic HTTP Cloud sign-in hand-off, credential preference/storage, restart, revocation of a replaced key before the new one is stored (failed revocation does not block), agent list/detail, dedicated/shared conversation routing and send, Gmail scopes (cumulative grants)/status/account/search/read/thread, complete HTML preservation and malformed/oversized HTML handling, search paging, read-state capability, disconnect, URL rejection, outage without retry, consumed claim, expiry, cancellation and staging routing. No live account acceptance.\n');
} finally {
  server.closeAllConnections(); await stopLoopback(server);
}
