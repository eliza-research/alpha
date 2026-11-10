// Gmail mailbox helpers against a closed provider-boundary fixture. No network, account or mail.
import assert from 'node:assert/strict';
import { CloudProtocol, CloudProtocolError, safeMailLink, type CloudCredential, type CloudCredentialStore, type CloudNativeRequest, type CloudProtocolOptions } from '../apps/app/src/runtime/cloud-protocol.ts';
import { reviewOpaqueAttachment } from '../apps/app/src/runtime/inbox-operation.ts';
import { classifyGmailFailure, disconnectGmailAccount, setGmailReadState } from '../apps/app/src/runtime/gmail-mailbox.ts';
import { sha256Hex } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/digest.ts';
import type { GmailInboxReceiptState } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
type ReadStateClient = Parameters<typeof setGmailReadState>[0];
type ReadStateCall = {grant: string; requestId: string; proposal: Record<string, unknown>};
type DisconnectOptions = {fail?: boolean; after?: boolean; readFails?: boolean};
const signal = () => new AbortController().signal;
function readStateClient({ state = 'succeeded', tamper = false, result }: {state?: GmailInboxReceiptState; tamper?: boolean; result?: Record<string, unknown>} = {}) {
  const calls: {prepare: ReadStateCall[]; dispatch: (ReadStateCall & {reviewDigest: string})[]} = {prepare: [], dispatch: []};
  const client: ReadStateClient = {
    async gmailPrepareOperation(grant, requestId, proposal) {
      assert.ok(proposal.kind === 'mark-read' || proposal.kind === 'mark-unread');
      calls.prepare.push({ grant, requestId, proposal });
      const review = { kind: proposal.kind, messageId: tamper ? 'other' : proposal.messageId, expectedHistoryId: proposal.expectedHistoryId, from: 'owner@example.invalid' };
      return { review, receipt: { requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await sha256Hex(JSON.stringify(review)), providerResult: null, rejectionCode: null } };
    },
    async gmailDispatchOperation(grant, requestId, reviewDigest, proposal) {
      assert.ok(proposal.kind === 'mark-read' || proposal.kind === 'mark-unread');
      calls.dispatch.push({ grant, requestId, reviewDigest, proposal });
      return { requestId, kind: proposal.kind, state, reviewDigest, providerResult: state === 'succeeded' ? (result ?? { messageId: proposal.messageId, unread: proposal.kind === 'mark-unread', historyId: 'h2', labelIds: [] }) : null, rejectionCode: null };
    } };
  return { ...client, calls };
}
for (const unread of [false, true]) {
  const client = readStateClient();
  assert.deepEqual(await setGmailReadState(client, 'grant', { messageId: 'm1', expectedHistoryId: 'h1', unread }, signal()), { unread, historyId: 'h2' });
  assert.deepEqual(client.calls.prepare[0].proposal, { kind: unread ? 'mark-unread' : 'mark-read', messageId: 'm1', expectedHistoryId: 'h1' });
  assert.equal(client.calls.dispatch.length, 1); assert.equal(client.calls.dispatch[0].requestId, client.calls.prepare[0].requestId);
}
{ const client = readStateClient({ tamper: true });
  await assert.rejects(setGmailReadState(client, 'grant', { messageId: 'm1', expectedHistoryId: 'h1', unread: false }, signal()), /does not match/);
  assert.equal(client.calls.dispatch.length, 0, 'a changed review is never dispatched'); }
for (const state of ['outcome-unknown', 'dispatched', 'rejected'] as const) {
  const client = readStateClient({ state });
  assert.equal(await setGmailReadState(client, 'grant', { messageId: 'm1', expectedHistoryId: 'h1', unread: false }, signal()), null);
  assert.equal(client.calls.dispatch.length, 1, `${state} is reported, never repeated`);
}
{ const client = readStateClient({ result: { messageId: 'm1', unread: true } });
  assert.equal(await setGmailReadState(client, 'grant', { messageId: 'm1', expectedHistoryId: 'h1', unread: false }, signal()), null, 'contradicting readback is not reported as success'); }

const accounts = (connected: boolean) => [{ connectionId: 'grant', label: 'Mailbox', configured: true, connected, reason: '', grantedCapabilities: connected ? ['google.gmail.triage'] : [] }];
const disconnectClient = ({ fail = false, after = false, readFails = false }: DisconnectOptions = {}) => { const calls = { disconnect: 0, reads: 0 }; return { calls,
  async disconnectGmail() { calls.disconnect++; if (fail) throw new CloudProtocolError('http', 502); },
  async gmailAccounts() { calls.reads++; if (readFails) throw new TypeError('Failed to fetch'); return accounts(after); } }; };
const disconnectCases: [DisconnectOptions, string][] = [[{}, 'disconnected'], [{ after: true }, 'still-connected'], [{ readFails: true }, 'unconfirmed'], [{ fail: true, after: true }, 'unconfirmed'], [{ fail: true }, 'disconnected'], [{ fail: true, readFails: true }, 'unconfirmed']];
for (const [options, outcome] of disconnectCases) {
  const client = disconnectClient(options);
  assert.equal((await disconnectGmailAccount(client, 'grant', signal())).outcome, outcome, JSON.stringify(options));
  assert.equal(client.calls.disconnect, 1, 'disconnect is requested once, never retried');
}
assert.equal(classifyGmailFailure(new CloudProtocolError('http', 409), 'read').kind, 'revoked');
assert.equal(classifyGmailFailure(new CloudProtocolError('http', 409), 'operation').kind, 'stale');
assert.equal(classifyGmailFailure(new CloudProtocolError('http', 403), 'operation').kind, 'revoked');
assert.equal(classifyGmailFailure(new TypeError('Failed to fetch'), 'read').kind, 'offline');
assert.equal(classifyGmailFailure(new Error('Connection timed out'), 'read').kind, 'offline');
assert.equal(classifyGmailFailure(new CloudProtocolError('invalid-response'), 'read').kind, 'unavailable');
assert.equal(classifyGmailFailure(new CloudProtocolError('http', 500), 'read', false).kind, 'offline');

// Protocol parsing for the 0055-0059 extensions and session revocation, against a closed in-process
// request function. No network.
{
  type RequestInput = Parameters<CloudNativeRequest>[0];
  const routes = new Map<string, (input: RequestInput) => {status: number; data: unknown}>();
  const sent: {method: RequestInput['method']; path: string}[] = [];
  let stored: CloudCredential | null = { token: 'synthetic-session', credentialId: 'local-1' };
  const store: CloudCredentialStore = { read: async () => stored ? { ...stored } : null, write: async () => {}, clear: async () => { stored = null; } };
  const request: CloudNativeRequest = async input => {
    const url = new URL(input.url);
    sent.push({ method: input.method, path: url.pathname + url.search });
    for (const [path, handler] of routes) if (input.url.includes(path)) return handler(input);
    return { status: 404, data: {} };
  };
  const protocol = (options?: CloudProtocolOptions) => new CloudProtocol('production', request, store, async () => {}, options);
  const message = { externalId: 'm1', threadId: 't1', subject: 'S', from: 'F', fromEmail: 'f@example.invalid', to: ['o@example.invalid'], snippet: '', receivedAt: '2026-10-08T00:00:00Z', isUnread: true };
  routes.set('/gmail/read?', () => ({ status: 200, data: { message: { ...message, hasAttachments: true }, bodyText: 'Body', links: [
    { href: 'https://example.org/a', text: 'A\u0007 link' }, { href: 'javascript:alert(1)', text: 'x' }, { href: 'https://user:pw@example.org/', text: 'creds' },
    { href: 'https://example.org/a', text: 'duplicate' }, { href: 'http://plain.example.org/', text: '' }, { href: 'data:text/html,hi', text: 'data' }] } }));
  const read = await protocol().gmailRead('grant', 'm1', signal());
  assert.deepEqual(read.links, [{ href: 'https://example.org/a', text: 'A link' }, { href: 'http://plain.example.org/', text: 'plain.example.org' }], 'only absolute http(s) without credentials, deduplicated, labels sanitized');
  assert.equal(read.message.hasAttachments, true);
  assert.equal(safeMailLink({ href: 'https://example.org', text: 7 }), null);
  routes.set('/gmail/read?', () => ({ status: 200, data: { message: { ...message, hasAttachments: 'yes' }, bodyText: 'Body' } }));
  await assert.rejects(protocol().gmailRead('grant', 'm1', signal()), /invalid-response/);
  routes.set('/gmail/read?', () => ({ status: 200, data: { message, bodyText: 'Body' } }));
  assert.deepEqual((await protocol().gmailRead('grant', 'm1', signal())).links, [], 'older servers omit links');
  const caps = { version: 1, from: 'o@example.invalid', threads: true, send: true, providerDrafts: true, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false };
  routes.set('/inbox-v1/capabilities', () => ({ status: 200, data: caps }));
  const old = await protocol().gmailInboxCapabilities('grant', signal());
  assert.deepEqual([old.readState, old.draftsList, old.forwardAttachments, old.opaqueAttachments, old.searchTrash, old.attachmentPolicy], [false, false, false, false, false, { maximumOutgoing: 1, maximumBytes: 5242880, maximumTotalBytes: 5242880 }], 'absent capabilities are false; one attachment');
  routes.set('/inbox-v1/capabilities', () => ({ status: 200, data: { ...caps, draftsList: true, forwardAttachments: true, opaqueAttachments: true, searchTrash: true, attachmentPolicy: { mimeTypes: [], maximumBytes: 5242880, maximumOutgoing: 10, maximumTotalBytes: 5242880 } } }));
  const next = await protocol().gmailInboxCapabilities('grant', signal());
  assert.deepEqual([next.draftsList, next.forwardAttachments, next.opaqueAttachments, next.searchTrash, next.attachmentPolicy.maximumOutgoing], [true, true, true, true, 10]);
  routes.set('/inbox-v1/capabilities', () => ({ status: 200, data: { ...caps, attachmentPolicy: { maximumOutgoing: 0 } } }));
  await assert.rejects(protocol().gmailInboxCapabilities('grant', signal()), /invalid-response/);
  routes.set('/inbox-v1/drafts?', () => ({ status: 200, data: { version: 1, drafts: [{ draftId: 'd1', messageId: 'dm1', subject: 'Plan', to: ['a@example.invalid'], snippet: 'x', updatedAt: '2026-10-08T00:00:00Z' }], nextPageToken: 'next' } }));
  assert.deepEqual(await protocol().gmailDrafts('grant', signal()), { drafts: [{ draftId: 'd1', messageId: 'dm1', subject: 'Plan', to: ['a@example.invalid'], snippet: 'x', updatedAt: '2026-10-08T00:00:00Z' }], nextPageToken: 'next' });
  await assert.rejects(protocol().gmailDrafts('grant', signal(), 'next'), /invalid-response/, 'a repeated cursor is refused');
  routes.set('/inbox-v1/draft?', input => { assert.match(input.url, /content=1/); return { status: 200, data: { id: 'd1', messageId: 'dm1', providerDigest: 'a'.repeat(64), content: { to: ['a@example.invalid'], cc: [], bcc: [], subject: 'Plan', bodyText: 'Body', threaded: false, attachmentCount: 0, plainText: true } } }; });
  assert.equal((await protocol().gmailDraftContent('grant', 'd1', signal())).bodyText, 'Body');
  routes.set('/inbox-v1/draft?', () => ({ status: 200, data: { id: 'd1', messageId: 'dm1', providerDigest: 'a'.repeat(64) } }));
  await assert.rejects(protocol().gmailDraftContent('grant', 'd1', signal()), /invalid-response/, 'older servers without content are refused, not guessed');
  const zip = Buffer.from('PK\u0003\u0004zip-bytes');
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', zip)), b => b.toString(16).padStart(2, '0')).join('');
  routes.set('/inbox-v1/attachment?', input => { assert.match(input.url, /opaque=1/); return { status: 200, data: { version: 1, opaque: true, messageId: 'm1', partId: '3', historyId: 'h1', name: 'archive.zip', mimeType: 'application/zip', dataBase64: zip.toString('base64'), size: zip.length, sha256: sha } }; });
  const file = await protocol().gmailOpaqueAttachment('grant', 'm1', '3', 'h1', signal());
  assert.deepEqual([file.name, file.mimeType, file.size, file.opaque], ['archive.zip', 'application/zip', zip.length, true]);
  routes.set('/inbox-v1/attachment?', () => ({ status: 200, data: { version: 1, opaque: true, messageId: 'm1', partId: '3', historyId: 'h1', name: 'archive.zip', mimeType: 'application/zip', dataBase64: zip.toString('base64'), size: zip.length, sha256: 'f'.repeat(64) } }));
  await assert.rejects(protocol().gmailOpaqueAttachment('grant', 'm1', '3', 'h1', signal()), /invalid-response/, 'changed bytes are refused');
  for (const name of ['../x', 'a/b', '', 'x'.repeat(121), 'bad\u0000name']) await assert.rejects(reviewOpaqueAttachment({ name, mimeType: 'application/zip', dataBase64: 'YQ==' }));
  assert.equal((await reviewOpaqueAttachment({ name: 'x.bin', mimeType: 'text/html; charset=utf-8', dataBase64: 'YQ==' })).mimeType, 'application/octet-stream', 'unsafe declared types become octet-stream');
  // Session revocation: the native transport cannot send DELETE, so nothing is sent; local sign-out still happens.
  sent.length = 0;
  assert.deepEqual(await protocol().revokeSession(signal()), { supported: false, reason: 'transport' });
  assert.equal(sent.length, 0); assert.equal(stored, null, 'local credential cleared');
  assert.deepEqual(await protocol().revokeSession(signal()), { supported: false, reason: 'no-credential' });
  stored = { token: 'synthetic-session', credentialId: 'local-2' };
  routes.set('/api/v1/api-keys/current', input => { assert.equal(input.method, 'DELETE'); assert.equal(input.headers.Authorization, 'Bearer synthetic-session'); return { status: 200, data: { success: true, credentialId: 'key-1', revokedAt: '2026-10-08T00:00:00Z', status: 'revoked' } }; });
  assert.deepEqual(await protocol({ deleteRequests: true }).revokeSession(signal()), { supported: true, revoked: true, credentialId: 'key-1', revokedAt: '2026-10-08T00:00:00Z' });
  assert.equal(stored, null); assert.equal(sent.filter(r => r.method === 'DELETE').length, 1, 'one revocation request');
  stored = { token: 'synthetic-session', credentialId: 'local-3' };
  routes.set('/api/v1/api-keys/current', () => ({ status: 405, data: {} }));
  assert.deepEqual(await protocol({ deleteRequests: true }).revokeSession(signal()), { supported: false, reason: 'server' });
  assert.equal(stored, null);
  stored = { token: 'synthetic-session', credentialId: 'local-4' };
  routes.set('/api/v1/api-keys/current', () => ({ status: 503, data: {} }));
  await assert.rejects(protocol({ deleteRequests: true }).revokeSession(signal()), /http/);
  assert.equal(stored, null, 'an unconfirmed revocation still signs out locally');
}
console.log('PASS: reviewed read-state dispatch once with digest/readback checks, confirmed disconnect outcomes without retry, and offline/revoked/stale classification. Protocol parsing for links, hasAttachments, capabilities, drafts, opaque bytes and session revocation. Fixture only.');
