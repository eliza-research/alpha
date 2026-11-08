// A provider-confirmed send removes the local copies of exactly the draft it came from, and nothing else.
// Real inbox-drafts.ts, inbox-provider-controls.ts and InboxOperation against an in-memory store and a
// synthetic provider. No account, network or mail is involved.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {InboxOperation, checkOutgoingAttachments, outgoingAttachmentLimits, attachmentBytes, composerKind, composerContent, reviewBinding, reviewBindingRefusal} from '../apps/app/src/runtime/inbox-operation.ts';
import {reviewMailAttachment} from '../apps/app/src/runtime/inbox-attachment.ts';
import {classifyGmailFailure} from '../apps/app/src/runtime/gmail-mailbox.ts';
import * as grants from '../apps/app/src/runtime/gmail-grants.ts';
import {encodeInboxUnsaved, readInboxUnsaved} from '../apps/app/src/runtime/inbox-unsaved-record.ts';
import {createMailReviewController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import {createMailDraftsController} from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';

const strip = async (file, name) => {
  let source = await readFile(new URL(`../apps/app/src/prototype/${file}`, import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace(/^export (?=(?:async )?function |const |let |interface |type )/gm, '') + `\nglobalThis.${name}=${name};`;
  return '{' + stripTypeScriptTypes(source, {mode: 'transform'}) + '}';
};
const sources = [await strip('inbox-provider-controls.ts', 'inboxProviderControls'), await strip('inbox-drafts.ts', 'inboxDrafts')];
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
/** Holds every dispatch in flight until `release()`. */
const hold = remote => { let open; remote.hold = new Promise(resolve => { open = resolve; }); return async () => { remote.hold = null; open(); await tick(); }; };
// Track real WebCrypto work in this isolated fixture process. A fixed number of
// timers cannot imply digest completion under thread-pool load. Provider dispatch
// holds remain independent, so in-flight/unknown-outcome assertions still run.
const pendingDigests = new Set();
const realDigest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = (...args) => {
  const pending = realDigest(...args);
  pendingDigests.add(pending);
  void pending.then(() => pendingDigests.delete(pending), () => pendingDigests.delete(pending));
  return pending;
};
const tick = async () => {
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (pendingDigests.size) await Promise.all([...pendingDigests]);
  }
};

/** One "device": slots and the retained copy persist across `boot()` (a reload); the provider is remote. */
function device() {
  const slots = new Map(), unsavedText = new Map(), toasts = [];
  const remote = {receipts: new Map(), dispatches: 0, outcome: 'succeeded', failRetainedClear: false, failReceiptRead: false, requests: []};
  // What the person answers to a confirmation, and every question asked.
  const ui = {answer: true, prompts: []};
  const client = {
    gmailInboxCapabilities: async () => ({send: true, providerDrafts: true, mailboxMutations: true, from: 'owner@example.invalid'}),
    gmailPrepareOperation: async (...args) => { const [_grant, requestId, proposal] = args; remote.requests.push(JSON.stringify(args.slice(0, 3)));
      const review = {...proposal, from: 'owner@example.invalid', attachments: []};
      const receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null};
      remote.receipts.set(requestId, receipt); return {receipt, review};
    },
    gmailDispatchOperation: async (...args) => { const [_grant, requestId, reviewDigest] = args; remote.requests.push(JSON.stringify(args.slice(0, 4)));
      remote.dispatches++;
      // `hold` keeps the request in flight: the provider has it, the phone has no answer yet.
      if (remote.hold) await remote.hold;
      if (remote.outcome === 'lost') { remote.receipts.set(requestId, {requestId, kind: 'send', state: 'succeeded', reviewDigest, providerResult: {messageId: 'sent-1'}, rejectionCode: null}); throw new TypeError('Failed to fetch'); }
      const receipt = {requestId, kind: remote.receipts.get(requestId).kind, state: remote.outcome, reviewDigest, providerResult: remote.outcome === 'succeeded' ? {messageId: 'sent-1'} : null, rejectionCode: remote.outcome === 'rejected' ? 'policy' : null};
      remote.receipts.set(requestId, receipt); return receipt;
    },
    gmailOperation: async (_grant, requestId) => { remote.requests.push(JSON.stringify([_grant, requestId])); if (remote.failReceiptRead) throw new TypeError('Failed to fetch');
      return remote.unsure ? {...remote.receipts.get(requestId), state: 'outcome-unknown', providerResult: null} : remote.receipts.get(requestId); },
  };
  const store = {
    read: async key => structuredClone(slots.get(key) ?? null),
    compareExchange: async (key, prior, next) => {
      if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(prior)) return {status: 'conflict'};
      if (next === null) slots.delete(key); else slots.set(key, structuredClone(next)); return {status: 'saved'};
    },
  };
  function boot(account = 'grant-a') {
    // Faithful stand-in for inbox-unsaved.ts: one retained text per owner, cleared only when unchanged.
    const inboxUnsaved = (owner, _publish, restore) => {
      const get = () => unsavedText.get(owner) || '';
      return {ready: Promise.resolve(), get available() { return !!get(); }, conflict: false, error: false, status: '',
        peek() { try { return get() ? readInboxUnsaved(get(), owner) : null; } catch { return null; } },
        edit(value) { unsavedText.set(owner, encodeInboxUnsaved(value)); },
        resume() { if (get()) restore(readInboxUnsaved(get(), owner)); },
        async clear() { if (remote.failRetainedClear) throw Error('Retained email changed.'); unsavedText.delete(owner); },
        retire() {}, replace() {}, retry: async () => {}, recover() {}};
    };
    const controller = {getCloudClient: () => ({client, sessionId: 'session-1'}), getSnapshot: () => ({cloudAccount: {environment: 'production', userId: 'owner-1', sessionId: 'session-1'}})};
    const sandbox = {createMailReviewController, createMailDraftsController, configureGmailBackground:async()=>{},withdrawGmailBackground:async()=>{},pendingGmailNotice:async()=>null,consumeGmailNotice:async()=>{},onGmailNotice:async()=>({remove:async()=>{}}),inboxUnsaved, InboxOperation, composerKind, composerContent, reviewBinding, reviewBindingRefusal, performance, queueMicrotask, checkOutgoingAttachments, outgoingAttachmentLimits,attachmentBytes, reviewMailAttachment, classifyGmailFailure, ...grants, crypto: globalThis.crypto, TextEncoder, structuredClone,
      secureConnectionStore: store, connectionController: controller, registerPlugin: () => ({}), DailyApps: {}, AbortController, DOMException, console, JSON, Promise, Set, Map, Error, Math, String, Array, Object,
      window: {confirm: text => { ui.prompts.push(text); return ui.answer; }}, document: {documentElement: {dataset: {connectionMode: 'live'}}}};
    sandbox.inboxLocalStore=sandbox.secureConnectionStore;vm.createContext(sandbox); for (const source of sources) vm.runInContext(source, sandbox);
    const provider = sandbox.inboxProviderControls(() => {}, text => toasts.push(text));
    const drafts = sandbox.inboxDrafts(() => {}, text => toasts.push(text), provider);
    // Wired exactly as inbox-cloud-adapter.ts wires them.
    provider.setComposer(() => drafts.email());
    provider.setObservers({sent: (source, proposal, grant) => void drafts.settleSent(source.draftId, proposal, grant, source.savedRevision), sentNote: source => drafts.sentNote(source.draftId)});
    const chips = () => [...drafts.chips((label, pick) => ({label, pick})), ...provider.chips((label, pick) => ({label, pick}))];
    const app = {provider, drafts, labels: () => chips().map(c => c.label), pick: label => chips().find(c => c.label === label).pick(),
      composer: () => drafts.render().c, receipt: () => provider.render().provider,
      async bind(next = account) { await Promise.all([provider.bind(next), drafts.bind(next, 'Fixture')]); await tick(); },
      async compose(subject, body = 'Body') { assert.equal(drafts.begin(), true); const c = drafts.render().c; c.onTo({target: {value: 'friend@example.invalid'}}); drafts.render().c.addRaw(); drafts.render().c.onSubj({target: {value: subject}}); drafts.render().c.onBody({target: {value: body}}); },
      async save() { drafts.render().c.save(); await tick(); },
      async send() { drafts.render().c.send(); await tick(); },
      async confirm() { provider.render().provider.confirm(); await tick(); },
      async check() { provider.render().provider.check(); await tick(); },
      async closeReceipt() { provider.render().provider.clear(); await tick(); }};
    return app;
  }
  const draftSlot = () => [...slots.entries()].find(([key]) => key.startsWith('inbox-drafts:v1:'))?.[1] ?? null;
  const operationSlot = () => [...slots.entries()].find(([key]) => key.startsWith('inbox-operation:v1:'))?.[1] ?? null;
  return {boot, client, remote, ui, slots, unsavedText, toasts, draftSlot, operationSlot};
}

test('a confirmed send clears the open composer, the retained copy and the saved draft it came from', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Harbour'); await app.save();
  assert.ok(d.draftSlot(), 'saved local draft exists');
  await app.send();
  const record = d.operationSlot();
  assert.deepEqual(record.source, {draftId: d.draftSlot().id, savedRevision: d.draftSlot().revision}, 'the operation records its source draft and saved revision locally');
  assert.equal('source' in record.proposal, false, 'the provider proposal carries no local identity');
  assert.ok(d.draftSlot(), 'review alone clears nothing');
  assert.match(app.receipt().draftNote, /local draft stays on this device/);
  await app.confirm();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.equal(d.draftSlot(), null, 'saved local draft removed');
  assert.equal(d.unsavedText.size, 0, 'retained copy removed');
  assert.equal(app.composer(), null, 'composer closed');
  assert.deepEqual(app.labels(), ['Mail review / receipt']);
  assert.equal(app.receipt().draftNote, 'The local draft and unsaved copy of this sent email were removed from this device.');
  assert.equal(d.remote.dispatches, 1);
});

test('an unsaved email: the retained copy is cleared only after the provider confirms', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Unsaved only');
  assert.equal(d.unsavedText.size, 1);
  await app.send(); assert.equal(d.unsavedText.size, 1, 'kept during review');
  await app.confirm();
  assert.equal(d.unsavedText.size, 0); assert.equal(app.composer(), null);
  assert.deepEqual(app.labels(), ['Mail review / receipt']);
});

test('unknown and rejected outcomes clear nothing; a later confirmed receipt does', async () => {
  for (const outcome of ['rejected', 'outcome-unknown', 'dispatched']) {
    const d = device(), app = d.boot(); await app.bind(); d.remote.outcome = outcome;
    await app.compose('Kept ' + outcome); await app.save(); await app.send(); await app.confirm();
    assert.ok(d.draftSlot(), outcome + ' keeps the saved draft');
    assert.ok(app.composer(), outcome + ' keeps the composer');
    assert.match(app.receipt().draftNote, /local draft stays on this device/);
  }
  const d = device(), app = d.boot(); await app.bind(); d.remote.outcome = 'lost'; d.remote.unsure = true;
  await app.compose('Lost reply'); await app.save(); await app.send(); await app.confirm();
  assert.equal(d.operationSlot().phase, 'dispatching');
  assert.ok(d.draftSlot()); assert.ok(app.composer(), 'a lost reply clears nothing');
  await app.check();
  assert.ok(d.draftSlot(), 'an unknown receipt clears nothing'); assert.equal(d.unsavedText.size + (app.composer() ? 1 : 0) > 0, true);
  // Reload while unknown, then the provider resolves it.
  const again = d.boot(); await again.bind();
  assert.ok(d.draftSlot()); assert.ok(again.labels().includes('Restore local draft'));
  d.remote.unsure = false; await again.check();
  assert.equal(again.receipt().status, 'Provider confirmed this operation.');
  assert.equal(d.draftSlot(), null); assert.deepEqual(again.labels(), ['Mail review / receipt']);
  assert.equal(d.remote.dispatches, 1, 'never dispatched twice');
});

test('reload between the provider confirmation and local cleanup finishes the cleanup once', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Reload mid hand-off'); await app.save(); await app.send();
  // The page dies after the confirmed receipt was saved but before any local copy was removed.
  const saved = d.operationSlot(), receipt = {...d.remote.receipts.get(saved.requestId), state: 'succeeded', providerResult: {messageId: 'sent-1'}};
  d.remote.receipts.set(saved.requestId, receipt); d.slots.set([...d.slots.keys()].find(k => k.startsWith('inbox-operation:')), {...saved, phase: 'observed', receipt});
  assert.ok(d.draftSlot()); assert.equal(d.unsavedText.size, 0, 'saving cleared the retained copy; the saved draft remains');
  const again = d.boot(); await again.bind();
  assert.equal(d.draftSlot(), null, 'cleanup completes on load from the saved receipt');
  assert.deepEqual(again.labels(), ['Mail review / receipt']);
  const third = d.boot(); await third.bind(); await third.check(); await third.check();
  assert.equal(d.draftSlot(), null); assert.equal(d.remote.dispatches, 0);
  await third.closeReceipt(); assert.deepEqual(third.labels(), []);
});

test('cleanup resumed after a reload re-reads the provider receipt and removes nothing when it disagrees', async () => {
  for (const variant of ['different message', 'read fails', 'no receipt read']) {
    const d = device(), app = d.boot(); await app.bind();
    await app.compose('Disputed ' + variant); await app.save(); await app.send();
    // The page dies with a confirmed receipt saved and every local copy still present.
    const saved = d.operationSlot(), key = [...d.slots.keys()].find(k => k.startsWith('inbox-operation:'));
    const receipt = {...d.remote.receipts.get(saved.requestId), state: 'succeeded', providerResult: {messageId: 'sent-1'}};
    d.slots.set(key, {...saved, phase: 'observed', receipt});
    // The provider now reports something else, cannot be reached, or offers no receipt read at all.
    d.remote.receipts.set(saved.requestId, {...receipt, providerResult: {messageId: 'another-message'}});
    if (variant === 'read fails') d.remote.failReceiptRead = true;
    const read = d.client.gmailOperation; if (variant === 'no receipt read') delete d.client.gmailOperation;
    const before = d.remote.requests.length, draft = d.draftSlot();
    const again = d.boot(); await again.bind();
    assert.deepEqual(d.draftSlot(), draft, variant + ': the saved draft is not removed');
    assert.deepEqual(again.labels(), ['Restore local draft', 'Mail review / receipt'], variant);
    assert.match(again.receipt().draftNote, /local draft stays on this device/, variant + ': the receipt says the copy is kept');
    assert.deepEqual(d.remote.requests.slice(before), variant === 'no receipt read' ? [] : [JSON.stringify(['grant-a', saved.requestId])], variant + ': one receipt read, no dispatch');
    if (variant === 'no receipt read') d.client.gmailOperation = read;
    if (variant === 'different message') { await again.check(); assert.deepEqual(d.draftSlot(), draft, 'an explicit check that still disagrees removes nothing'); }
    assert.equal(d.remote.dispatches, 0, variant);
  }
  // A provider that agrees lets the resumed cleanup finish (the reload test above), also after a failed read.
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Read later'); await app.save(); await app.send();
  const saved = d.operationSlot(), receipt = {...d.remote.receipts.get(saved.requestId), state: 'succeeded', providerResult: {messageId: 'sent-1'}};
  d.remote.receipts.set(saved.requestId, receipt); d.slots.set([...d.slots.keys()].find(k => k.startsWith('inbox-operation:')), {...saved, phase: 'observed', receipt});
  d.remote.failReceiptRead = true; const again = d.boot(); await again.bind(); assert.ok(d.draftSlot(), 'kept while the provider cannot be asked');
  d.remote.failReceiptRead = false; await again.check(); assert.equal(d.draftSlot(), null, 'removed once the provider reports the same send');
});

test('a saved older version of a sent email is kept, labelled, and reused only after a confirmation', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Versioned', 'Saved text'); await app.save();
  app.composer().onBody({target: {value: 'Sent text'}}); await app.send(); await app.confirm();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.equal(app.composer(), null, 'the copy that was sent is removed');
  assert.equal(d.draftSlot().body, 'Saved text', 'the older saved version is kept');
  assert.equal(d.draftSlot().id, d.operationSlot().source.draftId, 'matched by the local draft the send came from');
  assert.equal(d.draftSlot().earlierThanSent, true, 'and marked in storage');
  assert.deepEqual(app.labels(), ['Earlier version of a sent email', 'Mail review / receipt']);
  assert.match(app.receipt().draftNote, /earlier saved version of this email is still on this device/);
  // The label survives a reload and closing the receipt; nothing removes the copy on its own.
  const again = d.boot(); await again.bind(); await again.closeReceipt();
  assert.deepEqual(again.labels(), ['Earlier version of a sent email']);
  assert.equal(again.drafts.begin(), false, 'a new email waits for a choice about the earlier version');
  // Declining the confirmation leaves it closed; accepting opens it as an earlier version.
  d.ui.answer = false; again.pick('Earlier version of a sent email');
  assert.equal(again.composer(), null); assert.match(d.ui.prompts.at(-1), /earlier version of an email that was already sent/);
  d.ui.answer = true; again.pick('Earlier version of a sent email');
  assert.equal(again.composer().body, 'Saved text'); assert.match(again.composer().status, /Earlier version of a sent email/);
  assert.equal(d.ui.prompts.length, 2); assert.equal(d.draftSlot().earlierThanSent, true, 'opening it changes nothing stored');
  // Saving it on purpose makes it an ordinary draft again.
  again.composer().onBody({target: {value: 'Saved text, revised'}}); await again.save();
  assert.equal(d.draftSlot().earlierThanSent, undefined); assert.equal(d.remote.dispatches, 1);
});

test('a different draft is never cleared, even with identical content', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Same words'); await app.save(); await app.send();
  // Send is confirmed; while the request is in flight the user discards that draft and writes it again.
  const release = hold(d.remote); await app.confirm();
  assert.equal(d.operationSlot().phase, 'dispatching');
  app.composer().discard(); app.drafts.render().c.confirmDiscard(); await tick();
  assert.equal(d.draftSlot(), null);
  await app.compose('Same words'); await app.save();
  const other = d.draftSlot(); assert.notEqual(other.id, d.operationSlot().source.draftId);
  await release();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.deepEqual(d.draftSlot(), other, 'the second draft is untouched');
  assert.ok(app.composer(), 'its composer stays open');
  assert.equal(app.receipt().draftNote, 'The local draft and unsaved copy of this sent email were removed from this device.');
  assert.equal(d.remote.dispatches, 1);
});

test('a review is never confirmed for another draft, even one with identical content', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Same words'); await app.save(); await app.send();
  const first = d.operationSlot();
  // The reviewed draft is discarded before Confirm and the same words are written as a new draft.
  app.composer().discard(); app.drafts.render().c.confirmDiscard(); await tick();
  assert.equal(app.receipt().canConfirm, false, 'no email in the composer: the review cannot be confirmed');
  assert.match(app.receipt().status, /not open in the composer/);
  await app.confirm(); assert.equal(d.remote.dispatches, 0);
  assert.deepEqual(d.operationSlot(), first, 'it stays saved until it is cancelled or replaced');
  await app.compose('Same words'); await app.save();
  assert.equal(app.receipt().canConfirm, false);
  await app.confirm();
  assert.equal(d.operationSlot(), null, 'the review of the discarded draft is discarded, not sent');
  assert.ok(d.toasts.some(text => /made for a different email/.test(text)));
  assert.equal(d.remote.dispatches, 0); assert.ok(d.draftSlot(), 'the new draft is untouched');
  // Its own Send is a new review under a new request, and that one is sent and cleaned up.
  await app.send(); assert.notEqual(d.operationSlot().requestId, first.requestId);
  assert.deepEqual(d.operationSlot().source, {draftId: d.draftSlot().id, savedRevision: d.draftSlot().revision});
  await app.confirm();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.equal(d.remote.dispatches, 1); assert.equal(d.draftSlot(), null);
});

test('a copy edited after Send is kept and the receipt says so', async () => {
  // Edited in the open composer and saved: neither the composer nor the saved draft is removed.
  let d = device(), app = d.boot(); await app.bind();
  await app.compose('Edited later', 'First'); await app.save(); await app.send();
  let release = hold(d.remote); await app.confirm();
  app.composer().onBody({target: {value: 'First, then changed'}}); await app.save();
  await release();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.'); assert.equal(d.remote.dispatches, 1);
  assert.equal(d.draftSlot().body, 'First, then changed'); assert.ok(app.composer());
  assert.match(app.receipt().draftNote, /still on this device because it was edited after sending or could not be removed/);
  // Edited but not saved: the saved copy still equals what was sent, but the draft is in use.
  d = device(); app = d.boot(); await app.bind();
  await app.compose('Edited unsaved', 'First'); await app.save(); await app.send();
  release = hold(d.remote); await app.confirm();
  app.composer().onBody({target: {value: 'Typing more'}});
  await release();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.equal(app.composer().body, 'Typing more'); assert.equal(d.draftSlot().body, 'First'); assert.equal(d.unsavedText.size, 1);
  assert.match(app.receipt().draftNote, /still on this device/);
  // A half-typed recipient counts as an edit.
  d = device(); app = d.boot(); await app.bind();
  await app.compose('Typing a recipient'); await app.send();
  app.composer().onTo({target: {value: 'second@exam'}});
  await app.confirm();
  assert.ok(app.composer()); assert.equal(d.unsavedText.size, 1);
  // After reload only the retained (edited) copy and the older saved draft exist: both are kept.
  d = device(); app = d.boot(); await app.bind();
  await app.compose('Older saved copy', 'Saved text'); await app.save();
  app.composer().onBody({target: {value: 'Sent text'}}); await app.send();
  d.remote.outcome = 'lost'; d.remote.unsure = true; await app.confirm();
  const again = d.boot(); await again.bind(); d.remote.unsure = false; await again.check();
  assert.equal(d.unsavedText.size, 0, 'the retained copy held exactly the sent text and is removed');
  assert.equal(d.draftSlot().body, 'Saved text', 'the saved draft holds different text and is kept');
  assert.deepEqual(again.labels(), ['Earlier version of a sent email', 'Mail review / receipt']);
  assert.match(again.receipt().draftNote, /still on this device/);
});

test('a saved draft changed in another window is not removed', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Two windows'); await app.save(); await app.send();
  const key = [...d.slots.keys()].find(k => k.startsWith('inbox-drafts:')), other = {...d.slots.get(key), revision: 'other-window', body: 'Changed elsewhere'};
  d.slots.set(key, other);
  await app.confirm();
  assert.deepEqual(d.draftSlot(), other, 'the compare-exchange refuses the stale copy');
  const again = d.boot(); await again.bind();
  assert.deepEqual(d.draftSlot(), other); assert.match(again.receipt().draftNote, /still on this device/);
});

test('a retained copy that cannot be cleared is reported, not hidden', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Clear fails'); await app.send(); d.remote.failRetainedClear = true; await app.confirm();
  assert.equal(d.unsavedText.size, 1); assert.deepEqual(app.labels(), ['Resume unsaved email', 'Mail review / receipt']);
  assert.match(app.receipt().draftNote, /could not be removed/);
  d.remote.failRetainedClear = false; await app.check();
  assert.equal(d.unsavedText.size, 0, 'checking the receipt again retries the cleanup');
});

test('non-send operations and operations saved before this change clear nothing', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Gmail draft'); await app.save();
  app.composer().saveProvider(); await tick(); await app.confirm();
  assert.equal(d.operationSlot().source, undefined); assert.ok(d.draftSlot(), 'saving a Gmail draft keeps the local draft');
  await app.closeReceipt();
  await app.send(); const key = [...d.slots.keys()].find(k => k.startsWith('inbox-operation:')), {source: _source, ...legacy} = d.slots.get(key); d.slots.set(key, legacy);
  const again = d.boot(); await again.bind();
  // After a reload the review is confirmable only once its email is back in the composer.
  assert.equal(again.receipt().canConfirm, false); again.pick('Restore local draft'); assert.equal(again.receipt().canConfirm, true);
  await again.confirm();
  assert.equal(again.receipt().status, 'Provider confirmed this operation.'); assert.ok(d.draftSlot(), 'no recorded source, nothing cleared');
  assert.match(again.receipt().draftNote, /local draft stays on this device/);
  d.slots.set(key, {...d.slots.get(key), source: {draftId: ''}});
  const bad = d.boot(); await bad.bind(); assert.equal(bad.receipt().requestId, '', 'a malformed source is rejected on load'); assert.ok(d.draftSlot());
});

/** Leaves the device as a reload finds it: the confirmed receipt is saved, no local copy removed yet. */
async function confirmedBeforeCleanup(d, providerResult = {messageId: 'sent-1'}) {
  const key = [...d.slots.keys()].find(k => k.startsWith('inbox-operation:')), saved = d.slots.get(key);
  const receipt = {...d.remote.receipts.get(saved.requestId), state: 'succeeded', providerResult};
  d.remote.receipts.set(saved.requestId, receipt); d.slots.set(key, {...saved, phase: 'observed', receipt});
}
const draftKey = d => [...d.slots.keys()].find(k => k.startsWith('inbox-drafts:'));

test('a succeeded receipt that names no provider message clears nothing', async () => {
  for (const providerResult of [{}, {messageId: ''}, {messageId: 7}, {threadId: 'thread-only'}]) {
    const d = device(), app = d.boot(); await app.bind();
    await app.compose('No message id'); await app.save(); await app.send();
    const before = d.draftSlot(); await confirmedBeforeCleanup(d, providerResult);
    const again = d.boot(); await again.bind(); await again.check();
    assert.deepEqual(d.draftSlot(), before, 'the saved draft stays without a provider message id');
    assert.match(again.receipt().draftNote, /local draft stays on this device/);
  }
});

test('a saved draft that differs from the sent email in any reviewed field is kept', async () => {
  const pdf = {name: 'a.txt', mimeType: 'text/plain', dataBase64: 'YQ=='};
  const changes = {
    'trailing whitespace': s => ({...s, body: s.body + ' '}),
    'a trailing newline': s => ({...s, body: s.body + '\n'}),
    'Unicode normalisation': s => ({...s, body: s.body.normalize('NFD')}),
    'subject case': s => ({...s, subject: s.subject.toUpperCase()}),
    'an added recipient': s => ({...s, to: [...s.to, 'second@example.invalid']}),
    'a replaced recipient': s => ({...s, to: ['other@example.invalid']}),
    'recipient case': s => ({...s, to: s.to.map(a => a.toUpperCase())}),
    'an added Cc': s => ({...s, cc: ['copy@example.invalid']}),
    'an added Bcc': s => ({...s, bcc: ['hidden@example.invalid']}),
    'an added attachment': s => ({...s, attachments: [pdf]}),
    'a reply target': s => ({...s, reply: {messageId: 'm-1', threadId: 't-1'}}),
    'a forward mode': s => ({...s, mode: 'forward'}),
    'forwarded originals': s => ({...s, forward: {messageId: 'm-1', historyId: 'h-1', parts: [{partId: 'p1', name: 'x.pdf', mimeType: 'application/pdf', size: 3}]}}),
  };
  for (const [name, change] of Object.entries(changes)) {
    const d = device(), app = d.boot(); await app.bind();
    await app.compose('Café plan', 'Résumé attached'); await app.save(); await app.send();
    const changed = change(d.draftSlot()); assert.notDeepEqual(changed, d.draftSlot(), name);
    d.slots.set(draftKey(d), changed); await confirmedBeforeCleanup(d);
    const again = d.boot(); await again.bind(); await again.check();
    // Kept with its content; at the revision Send was reviewed from, it is labelled an earlier version.
    assert.deepEqual(d.draftSlot(), {...changed, earlierThanSent: true}, name + ' keeps the saved draft');
    assert.match(again.receipt().draftNote, /still on this device/, name);
  }
  // Same content, different attachment bytes under the same name.
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('With a file'); await app.save();
  d.slots.set(draftKey(d), {...d.draftSlot(), attachments: [pdf]});
  const withFile = d.boot(); await withFile.bind(); withFile.pick('Restore local draft'); await withFile.send();
  assert.deepEqual(d.operationSlot().proposal.attachments, [pdf]);
  const swapped = {...d.draftSlot(), attachments: [{...pdf, dataBase64: 'Yg=='}]};
  d.slots.set(draftKey(d), swapped); await confirmedBeforeCleanup(d);
  const again = d.boot(); await again.bind();
  assert.deepEqual(d.draftSlot(), {...swapped, earlierThanSent: true}, 'changed attachment bytes keep the saved draft');
});

test('edits retained after Send keep the saved draft they are based on, also after a reload', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Based on saved', 'Sent text'); await app.save(); await app.send();
  app.composer().onBody({target: {value: 'Sent text, then more'}});
  const saved = d.draftSlot(); assert.equal(d.unsavedText.size, 1);
  await confirmedBeforeCleanup(d);
  const again = d.boot(); await again.bind(); await again.check();
  assert.deepEqual(d.draftSlot(), saved, 'the saved draft the retained edits are based on stays');
  assert.equal(d.unsavedText.size, 1, 'the edited retained copy stays');
  assert.match(again.receipt().draftNote, /still on this device/);
  again.pick('Resume unsaved email'); await tick();
  assert.equal(again.composer().body, 'Sent text, then more'); assert.equal(again.composer().staleBase, false, 'the edits can still be saved');
  await again.save(); assert.equal(d.draftSlot().body, 'Sent text, then more');
});

test('a retained copy that cannot be cleared keeps the saved draft until the retry removes both', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Both or neither'); await app.save();
  app.composer().onBody({target: {value: 'Body again'}}); app.composer().onBody({target: {value: 'Body'}});
  assert.equal(d.unsavedText.size, 1); await app.send();
  d.remote.failRetainedClear = true; await app.confirm();
  assert.ok(d.draftSlot(), 'the saved draft waits for the retained copy'); assert.equal(d.unsavedText.size, 1);
  assert.match(app.receipt().draftNote, /could not be removed/);
  d.remote.failRetainedClear = false; await app.check();
  assert.equal(d.draftSlot(), null); assert.equal(d.unsavedText.size, 0);
});

test("another account's draft is never cleared, even with the same id and content", async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Two accounts'); await app.save(); await app.send();
  const key = draftKey(d), mine = d.slots.get(key), otherOwner = JSON.stringify(['production', 'owner-1', '', 'grant-b']);
  const otherKey = 'inbox-drafts:v1:' + otherOwner, other = {...mine, owner: otherOwner};
  d.slots.set(otherKey, other); d.slots.delete(key); await confirmedBeforeCleanup(d);
  // The receipt belongs to grant-a while the composer shows grant-b.
  const again = d.boot(); void again.provider.bind('grant-a'); void again.drafts.bind('grant-b', 'Other'); await tick();
  assert.deepEqual(d.slots.get(otherKey), other, 'the other account keeps its draft');
  await again.check(); assert.deepEqual(d.slots.get(otherKey), other);
  // Switching back to the sending account does not carry the pending cleanup across either.
  void again.drafts.bind('grant-a', 'Fixture'); await tick(); void again.drafts.bind('grant-b', 'Other'); await tick();
  assert.deepEqual(d.slots.get(otherKey), other);
});

test('the source draft id stays out of every provider request', async () => {
  const d = device(), app = d.boot(); await app.bind();
  const seen = [];
  await app.compose('Local identity'); await app.save();
  const id = d.draftSlot().id, original = JSON.stringify;
  await app.send(); await app.confirm(); await app.check();
  for (const receipt of d.remote.receipts.values()) seen.push(original(receipt));
  assert.equal(seen.some(text => text.includes(id)), false, 'no receipt echoes the local draft id');
  assert.equal(d.remote.requests.some(text => text.includes(id)), false, 'no provider request carries the local draft id');
  assert.ok(d.remote.requests.length >= 3);
});

// A review is bound to the email it was made from: the same local draft (which belongs to one From
// account) holding exactly the reviewed content at the moment Send is confirmed.
const dispatched = d => d.remote.requests.map(text => JSON.parse(text)).filter(request => request.length === 4);
const operationSlots = d => [...d.slots.keys()].filter(key => key.startsWith('inbox-operation:v1:')).length;

test('an email edited after its review is sent once, under its second review, and that draft is cleaned up', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Edited', 'First'); await app.save(); await app.send();
  const first = d.operationSlot();
  app.composer().onBody({target: {value: 'Second'}});
  assert.equal(app.receipt().canConfirm, false, 'not confirmable from the first render after the edit');
  await tick();
  assert.equal(d.operationSlot(), null, 'the unsent review is discarded');
  assert.ok(d.toasts.some(text => /edited after this review/.test(text)));
  assert.ok(d.draftSlot(), 'discarding a review never touches the local draft'); assert.equal(app.composer().body, 'Second');
  await app.save(); await app.send();
  const second = d.operationSlot(); assert.notEqual(second.requestId, first.requestId);
  assert.deepEqual(second.source, {draftId: d.draftSlot().id, savedRevision: d.draftSlot().revision});
  await app.confirm();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.deepEqual(dispatched(d).map(request => [request[1], request[2]]), [[second.requestId, second.receipt.reviewDigest]]);
  assert.equal(d.draftSlot(), null, 'the sent draft is removed'); assert.equal(app.composer(), null);
});

test('an edit that returns to the reviewed text before the review is discarded leaves it confirmable', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Round trip', 'Same'); await app.send();
  app.composer().onBody({target: {value: 'Other'}}); app.composer().onBody({target: {value: 'Same'}});
  assert.equal(app.receipt().canConfirm, true); await tick();
  await app.confirm();
  assert.equal(JSON.parse(d.remote.requests.at(-1))[0], 'grant-a'); assert.equal(d.remote.dispatches, 1);
  assert.equal(d.operationSlot().proposal.bodyText, 'Same');
});

test('after a reload a saved review cannot be confirmed until its email is back, and the edited email discards it', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Reloaded', 'First'); await app.send();
  const first = d.operationSlot();
  // The page dies after the first edited keystroke was retained and before the review was discarded.
  app.composer().onBody({target: {value: 'Second'}});
  const again = d.boot(); await again.bind();
  assert.deepEqual(d.operationSlot(), first, 'the saved review is still there');
  assert.equal(again.composer(), null); assert.equal(again.receipt().canConfirm, false);
  assert.match(again.receipt().status, /not open in the composer, so it cannot be confirmed/);
  await again.confirm(); assert.equal(d.remote.dispatches, 0, 'Confirm does nothing while the email is not open');
  again.pick('Resume unsaved email');
  assert.equal(again.composer().body, 'Second'); assert.equal(again.receipt().canConfirm, false);
  await tick();
  assert.equal(d.operationSlot(), null, 'the resumed email no longer matches: the review is discarded');
  await again.send(); await again.confirm();
  assert.equal(dispatched(d).length, 1); assert.equal(dispatched(d)[0][3].bodyText, 'Second');
  assert.notEqual(dispatched(d)[0][1], first.requestId);
});

test('after a reload an unchanged email makes its saved review confirmable again', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Unchanged', 'Body'); await app.send();
  const first = d.operationSlot(), again = d.boot(); await again.bind();
  assert.equal(again.receipt().canConfirm, false);
  again.pick('Resume unsaved email');
  assert.equal(again.receipt().canConfirm, true);
  await again.confirm();
  assert.deepEqual(dispatched(d).map(request => request[1]), [first.requestId]);
});

test('a review saved under one From account cannot be sent after the email moved to another account', async () => {
  const d = device(), app = d.boot(); await app.bind('grant-a');
  await app.compose('Moved', 'Body'); await app.send();
  const first = d.operationSlot(); assert.equal(first.grantId, 'grant-a');
  // The From switcher moves the email: it leaves grant-a and becomes a new draft under grant-b.
  const moved = await app.drafts.transfer(); assert.ok(moved);
  assert.equal(app.receipt().canConfirm, false, 'the email left this account');
  await app.bind('grant-b');
  assert.equal(app.drafts.begin(undefined, 'reply', '', {...moved, moved: true}), true);
  assert.equal(app.receipt().requestId, '', 'no review exists under the other account');
  await app.send(); await app.confirm();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.');
  assert.deepEqual(dispatched(d).map(request => request[0]), ['grant-b']);
  // Back on the first account its saved review reappears. It must not send the email a second time.
  await app.bind('grant-a');
  assert.equal(app.receipt().requestId, first.requestId); assert.equal(app.receipt().canConfirm, false);
  await app.confirm(); assert.equal(d.remote.dispatches, 1);
  // Not even when the same words are written again under the first account.
  await app.compose('Moved', 'Body'); assert.equal(app.receipt().canConfirm, false); await app.confirm();
  assert.equal(d.remote.dispatches, 1); assert.equal(operationSlots(d), 1, 'only the receipt under grant-b remains');
  assert.ok(d.toasts.some(text => /made for a different email/.test(text)));
  // Also across a reload on the first account, with no composer open.
  const e = device(), one = e.boot(); await one.bind('grant-a');
  await one.compose('Moved', 'Body'); await one.send(); await one.drafts.transfer();
  const two = e.boot(); await two.bind('grant-a');
  assert.equal(two.receipt().canConfirm, false); await two.confirm(); assert.equal(e.remote.dispatches, 0);
  await two.closeReceipt(); assert.equal(operationSlots(e), 0, 'the unsent review can be cancelled');
});

test('a review saved without its email identity is discarded, never confirmed', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('Legacy', 'Body'); await app.save(); await app.send();
  const key = [...d.slots.keys()].find(k => k.startsWith('inbox-operation:')), {composer: _composer, ...legacy} = d.slots.get(key); d.slots.set(key, legacy);
  const again = d.boot(); await again.bind(); again.pick('Restore local draft');
  assert.equal(again.receipt().canConfirm, false); await again.confirm();
  assert.equal(d.operationSlot(), null); assert.equal(d.remote.dispatches, 0); assert.ok(d.draftSlot());
  d.slots.set(key, {...legacy, composer: {draftId: ''}});
  const bad = d.boot(); await bad.bind(); assert.equal(bad.receipt().requestId, '', 'a malformed binding is rejected on load');
});

test('InboxOperation.confirm refuses before any write when the composer does not hold the reviewed email', async () => {
  const d = device(), slots = d.slots;
  const store = {read: async key => structuredClone(slots.get(key) ?? null), compareExchange: async (key, prior, next) => { if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(prior)) return {status: 'conflict'}; if (next === null) slots.delete(key); else slots.set(key, structuredClone(next)); return {status: 'saved'}; }};
  const app = d.boot(); await app.bind();
  const client = {gmailPrepareOperation: async (_g, requestId, proposal) => { const review = {...proposal, from: 'owner@example.invalid', attachments: []}; return {review, receipt: {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null}}; },
    gmailDispatchOperation: async (_g, requestId, reviewDigest, proposal) => { d.remote.dispatches++; return {requestId, kind: proposal.kind, state: 'succeeded', reviewDigest, providerResult: {messageId: 'sent-1'}, rejectionCode: null}; }, gmailOperation: async () => { throw Error('unused'); }};
  for (const kind of ['send', 'draft-create']) {
    slots.clear();
    const operation = new InboxOperation({owner: 'owner', grantId: 'grant-a', active: () => true, store, client});
    const proposal = {kind, mode: 'compose', to: ['friend@example.invalid'], cc: [], bcc: ['hidden@example.invalid'], subject: 'S', bodyText: 'B', attachments: []};
    await operation.prepare(proposal, {draftId: 'draft-1'});
    const saved = structuredClone(d.operationSlot()); assert.deepEqual(saved.composer, {draftId: 'draft-1'});
    assert.equal('source' in saved, kind === 'send');
    const {kind: _kind, ...email} = proposal;
    for (const [current, message] of [
      [null, /not open in the composer/],
      [{draftId: 'draft-2', proposal: email}, /different email/],
      [{draftId: '', proposal: email}, /different email/],
      [{draftId: 'draft-1', proposal: {...email, bodyText: 'B '}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, bcc: []}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, cc: ['copy@example.invalid']}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, to: ['other@example.invalid']}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, attachments: [{name: 'a.txt', mimeType: 'text/plain', dataBase64: 'YQ=='}]}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, replyMessageId: 'm1'}}, /edited after this review/],
      [{draftId: 'draft-1', proposal: {...email, forwardAttachments: {messageId: 'm', historyId: 'h', partIds: ['p']}}}, /edited after this review/],
    ]) {
      await assert.rejects(operation.confirm(current), message);
      assert.deepEqual(d.operationSlot(), saved, 'nothing was written');
    }
    assert.equal(d.remote.dispatches, 0);
    await operation.confirm({draftId: 'draft-1', proposal: structuredClone(email)});
    assert.equal(d.operationSlot().phase, 'observed'); assert.equal(d.remote.dispatches, 1); d.remote.dispatches = 0;
  }
});

test('an edit or a cancel while Send is in flight never discards the operation or sends twice; a lost reply stays unknown', async () => {
  const d = device(), app = d.boot(); await app.bind();
  await app.compose('In flight', 'First'); await app.send();
  const first = d.operationSlot();
  const release = hold(d.remote); d.remote.outcome = 'lost'; d.remote.unsure = true;
  await app.confirm();
  assert.equal(d.operationSlot().phase, 'dispatching');
  // Everything a person can press while the request is out: edit, Send again, Confirm again, Cancel.
  app.composer().onBody({target: {value: 'Second'}}); app.receipt(); await tick();
  await app.send(); await app.confirm(); await app.closeReceipt();
  assert.equal(d.operationSlot().requestId, first.requestId); assert.equal(d.operationSlot().phase, 'dispatching');
  await release();
  // The reply was lost: the outcome is unknown, the record survives, and nothing can repeat or drop it.
  assert.equal(d.operationSlot().phase, 'dispatching'); assert.equal(app.receipt().canConfirm, false); assert.equal(app.receipt().canClear, false);
  assert.match(app.receipt().status, /do not send this message again|check the saved receipt/i);
  await app.confirm(); await app.closeReceipt(); await app.send();
  assert.equal(d.operationSlot().requestId, first.requestId, 'the edited email cannot start a second send while the first is unresolved');
  assert.equal(d.remote.dispatches, 1); assert.equal(dispatched(d).length, 1); assert.equal(dispatched(d)[0][3].bodyText, 'First');
  assert.equal(app.composer().body, 'Second', 'the edit is kept');
  // Resolved by an explicit check only: one message, and the edited copy stays.
  d.remote.unsure = false; await app.check();
  assert.equal(app.receipt().status, 'Provider confirmed this operation.'); assert.equal(d.remote.dispatches, 1);
  assert.ok(app.composer()); assert.match(app.receipt().draftNote, /still on this device/);
});
