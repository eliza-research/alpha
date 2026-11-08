// P-37 (#421): a withdrawn Gmail change grant discards the unsent review prepared under it, in every
// phase, and never dispatches it. Real inbox-provider-controls.ts and InboxOperation against an
// in-memory secure store and a synthetic provider. No account, OAuth consent, network or mail.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal} from '../apps/app/src/runtime/inbox-operation.ts';
import {classifyGmailFailure} from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import {createMailReviewController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import {reviewMailAttachment} from '../apps/app/src/runtime/inbox-attachment.ts';

let source = await readFile(new URL('../apps/app/src/prototype/inbox-provider-controls.ts', import.meta.url), 'utf8');
source = '{' + stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/^export (?=function )/gm, '') + '\nglobalThis.inboxProviderControls=inboxProviderControls;', {mode: 'transform'}) + '}';
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
// Timer turns do not establish readiness: WebCrypto and secure-store work may still be pending.
// Await public promises where available, and observable completion for fire-and-forget controls.
async function waitFor(ready, description) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
const archive = {kind: 'archive', messageId: 'message-1', expectedHistoryId: 'history-1'};

function device() {
  const slots = new Map(), toasts = [], remote = {prepares: 0, dispatches: 0, hold: null, caps: {send: true, providerDrafts: true, mailboxMutations: true, threads: true, from: 'owner@example.invalid'}};
  const client = {
    gmailInboxCapabilities: async (_grant, signal) => remote.capabilityRead ? remote.capabilityRead(signal) : ({...remote.caps}),
    gmailPrepareOperation: async (_grant, requestId, proposal) => {
      remote.prepares++; if (remote.hold) await remote.hold;
      const review = {...proposal, from: 'owner@example.invalid', attachments: []};
      return {review, receipt: {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null}};
    },
    gmailDispatchOperation: async (_grant, requestId, reviewDigest, proposal) => { remote.dispatches++; return {requestId, kind: proposal.kind, state: 'succeeded', reviewDigest, providerResult: {messageId: proposal.messageId, historyId: 'history-2'}, rejectionCode: null}; },
    gmailOperation: async () => null,
  };
  const store = {
    read: async key => { if (remote.readHold) { remote.readBlocked = true; await remote.readHold; } return structuredClone(slots.get(key) ?? null); },
    compareExchange: async (key, prior, next) => {
      if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(prior)) return {status: 'conflict'};
      if (next === null) slots.delete(key); else slots.set(key, structuredClone(next)); return {status: 'saved'};
    },
  };
  const controller = {getCloudClient: () => ({client, sessionId: 'session-1'}), getSnapshot: () => ({cloudAccount: {environment: 'production', userId: 'owner-1'}})};
  const sandbox = {createMailReviewController, reviewMailAttachment, InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal, classifyGmailFailure, ...grants, performance, queueMicrotask, crypto: globalThis.crypto, TextEncoder, structuredClone,
    inboxLocalStore: store, connectionController: controller, AbortController, DOMException, console, document: {documentElement: {dataset: {connectionMode: 'live'}}}};
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const provider = sandbox.inboxProviderControls(() => {}, text => toasts.push(text));
  const slot = () => [...slots.values()][0] ?? null;
  const holdPrepare = () => { let open; remote.hold = new Promise(resolve => { open = resolve; }); return () => { remote.hold = null; open(); }; };
  return {provider, remote, toasts, slot, holdPrepare, async bind(grant = 'grant-a') { await provider.bind(grant); }};
}

// A review waiting for confirmation: change access is withdrawn, the review is discarded, nothing dispatched.
{
  const d = device(); await d.bind();
  await d.provider.prepare(archive);
  assert.equal(d.slot()?.phase, 'review'); assert.equal(d.provider.render().provider.canConfirm, true);
  d.remote.caps.mailboxMutations = false; d.provider.withdrawn(); await d.provider.bind('grant-a');
  await waitFor(() => !d.provider.render().provider.busy, 'withdrawal completion');
  assert.equal(d.slot(), null, 'the saved review is removed from the secure store');
  assert.equal(d.provider.render().provider.canConfirm, false); assert.equal(d.provider.render().providerReview, false);
  d.provider.render().provider.confirm();
  await waitFor(() => !d.provider.render().provider.busy, 'confirmation completion');
  assert.equal(d.remote.dispatches, 0, 'a withdrawn review is never dispatched');
  assert.ok(d.toasts.some(t => /withdrawn, so the unsent review was discarded/.test(t)), 'the user is told the review was discarded');
  await d.provider.prepare(archive);
  assert.match(d.toasts.at(-1), /has not granted this provider action/, 'a new review needs the change grant again'); assert.equal(d.remote.prepares, 1);
}
// A review still being prepared (a provider run is active): the withdrawal waits for the run and then discards it.
{
  const d = device(); await d.bind();
  const release = d.holdPrepare(); const preparing = d.provider.prepare(archive);
  await waitFor(() => d.remote.prepares === 1, 'held provider preparation');
  assert.equal(d.slot()?.phase, 'preparing'); assert.equal(d.provider.render().provider.busy, true);
  d.remote.caps.mailboxMutations = false; d.provider.withdrawn(); await d.provider.bind('grant-a');
  release(); await preparing;
  await waitFor(() => d.slot() === null && !d.provider.render().provider.busy, 'in-flight withdrawal discard');
  assert.equal(d.slot(), null, 'the review prepared after the withdrawal is discarded once the run settles');
  assert.equal(d.provider.render().provider.canConfirm, false); assert.equal(d.provider.render().provider.busy, false);
  d.provider.render().provider.confirm();
  await waitFor(() => !d.provider.render().provider.busy, 'confirmation completion'); assert.equal(d.remote.dispatches, 0);
}
// Read access revoked with a pending review: the account is unbound in the same turn (as refreshAccounts does).
{
  const d = device(); await d.bind();
  await d.provider.prepare(archive); assert.equal(d.slot()?.phase, 'review');
  d.provider.withdrawn(); await d.provider.bind('');
  await waitFor(() => d.slot() === null, 'unbound review discard');
  assert.equal(d.slot(), null, 'the unbind does not abort the discard');
  await d.bind('grant-a');
  assert.equal(d.provider.render().providerReview, false, 'a reconnected account does not reload the withdrawn review');
  assert.equal(d.provider.chips((label) => label).length, 0); assert.equal(d.remote.dispatches, 0);
}
// Read access revoked while the review is still being prepared, and unbound in the same turn.
{
  const d = device(); await d.bind();
  const release = d.holdPrepare(); const preparing = d.provider.prepare(archive);
  await waitFor(() => d.remote.prepares === 1, 'held provider preparation');
  d.provider.withdrawn(); await d.provider.bind('');
  release(); await preparing;
  await waitFor(() => d.slot() === null && !d.provider.render().provider.busy, 'in-flight withdrawal discard');
  assert.equal(d.slot(), null, 'the reset discards after the stopped run settles');
  await d.bind('grant-a'); assert.equal(d.provider.chips((label) => label).length, 0); assert.equal(d.remote.dispatches, 0);
}
// A confirmed operation keeps its receipt: only undispatched reviews are discarded.
{
  const d = device(); await d.bind();
  await d.provider.prepare(archive); d.provider.render().provider.confirm();
  await waitFor(() => !d.provider.render().provider.busy, 'confirmation completion');
  assert.equal(d.remote.dispatches, 1); assert.equal(d.slot()?.phase, 'observed');
  d.provider.withdrawn(); await d.provider.bind('grant-a');
  await waitFor(() => !d.provider.render().provider.busy, 'withdrawal completion');
  assert.equal(d.slot()?.phase, 'observed', 'the receipt stays'); assert.equal(d.provider.render().provider.canUndo, true);
}
console.log('PASS: withdrawn Gmail change grant discards undispatched reviews in review and preparing phases, across a same-turn unbind, and keeps receipts. Synthetic provider only.');

// Newer explicit refresh owns capabilities even when an old transport ignores cancellation.
for (const staleFailure of [false, true]) {
  const d = device(); await d.bind();
  const pending = [];
  d.remote.capabilityRead = signal => new Promise((resolve, reject) => pending.push({signal, resolve, reject}));
  const older = d.provider.bind('grant-a');
  const newer = d.provider.bind('grant-a');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({...d.remote.caps, send: false}); await newer;
  if (staleFailure) pending[0].reject(new Error('late failure'));
  else pending[0].resolve({...d.remote.caps, send: true});
  await older;
  assert.equal(d.provider.capabilities().send, false, 'old success or failure cannot replace the latest capability read');
}
// Initial binding is also retired by a newer refresh and by account teardown.
{
  const d = device(), pending = [];
  d.remote.capabilityRead = signal => new Promise(resolve => pending.push({signal, resolve}));
  const initial = d.provider.bind('grant-a');
  await waitFor(() => pending.length === 1, 'initial capability read');
  const newer = d.provider.bind('grant-a');
  pending[1].resolve({...d.remote.caps, send: false}); await newer;
  pending[0].resolve({...d.remote.caps, send: true}); await initial;
  assert.equal(d.provider.capabilities().send, false);
  const retired = d.provider.bind('grant-a'); d.provider.reset();
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve({...d.remote.caps}); await retired;
  assert.equal(d.provider.capabilities(), null, 'teardown never restores capabilities');
}
console.log('PASS: capability refresh rejects stale success/failure, initial-bind overlap and account teardown.');

// A newer capability refresh does not cancel restoration of a saved review.
{
  const d = device(); await d.bind(); await d.provider.prepare(archive);
  assert.equal(d.slot().phase, 'review'); d.provider.reset();
  let release; d.remote.readHold = new Promise(resolve => { release = resolve; });
  const initial = d.provider.bind('grant-a');
  await waitFor(() => d.remote.readBlocked, 'held saved-review read');
  d.remote.caps.send = false; await d.provider.bind('grant-a');
  release(); d.remote.readHold = null; await initial;
  assert.equal(d.provider.capabilities().send, false);
  assert.equal(d.provider.render().providerReview, true, 'saved review is restored despite an overlapping refresh');
  assert.equal(d.provider.render().provider.canConfirm, true);
}
console.log('PASS: overlapping capabilities preserve saved review restoration.');
