import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import {prepareClientFeatures} from '../scripts/prepare-client-features.mjs';

prepareClientFeatures();
const {outputFiles} = buildSync({
  stdin: {contents: `
    export {createMailDraftsController} from './.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
    export {createMailReviewController} from './.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
    export {readInboxUnsaved} from './.eliza/client-features/plugins/plugin-inbox/src/mailbox/retained-draft.ts';
    export {createScanDocument} from './.eliza/client-features/plugins/plugin-native-camera/src/scan-document.ts';
  `, resolveDir: process.cwd()},
  bundle: true, write: false, format: 'iife', globalName: 'serviceModules', platform: 'browser',
});
const context = vm.createContext({crypto, AbortController, DOMException, TextEncoder, structuredClone, performance, queueMicrotask});
vm.runInContext(outputFiles[0].text, context);
const library = context.serviceModules;

async function until(ready, label) {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(setImmediate);
  }
}

function mailFixture() {
  const stored = new Map(), retained = new Map();
  const state = {dispatches: 0, clock: 1000, failSavedRemoval: false, failShelfClear: false};
  const caps = {send: true, providerDrafts: true, mailboxMutations: true, forwardAttachments: true};
  const store = {
    async read(key) { return structuredClone(stored.get(key) ?? null); },
    async compareExchange(key, before, value) {
      if (state.failSavedRemoval && key.startsWith('inbox-drafts:v1:[') && value === null) throw Error('Saved removal refused');
      if (state.failShelfClear && key.includes(':shelf:') && value?.items?.length === 0) throw Error('Shelf clear refused');
      if (JSON.stringify(stored.get(key) ?? null) !== JSON.stringify(before)) return {status: 'conflict'};
      if (value === null) stored.delete(key); else stored.set(key, structuredClone(value));
      return {status: 'saved'};
    },
  };
  const client = {
    async gmailInboxCapabilities() { return {...caps}; },
    async gmailPrepareOperation(_grant, requestId, proposal) {
      const review = {...proposal, from: 'sender@example.test', attachments: []};
      if (proposal.forwardAttachments) {
        review.forwardSource = {messageId: proposal.forwardAttachments.messageId, historyId: proposal.forwardAttachments.historyId};
        review.forwardedAttachments = proposal.forwardAttachments.partIds.map(partId => ({partId, name: 'part.txt', mimeType: 'text/plain', size: 1, sha256: 'a'.repeat(64)}));
      }
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(review)));
      const receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: Buffer.from(bytes).toString('hex'), providerResult: null, rejectionCode: null};
      return {review, receipt};
    },
    async gmailDispatchOperation(_grant, requestId, reviewDigest, proposal) {
      state.dispatches++;
      return {requestId, kind: proposal.kind, reviewDigest, state: 'succeeded', rejectionCode: null,
        providerResult: proposal.kind === 'send' ? {messageId: 'sent-message'} : {draftId: 'provider-draft', providerDigest: 'a'.repeat(64)}};
    },
    async gmailDraft() { return {draftId: 'provider-draft', messageId: 'readback-only', providerDigest: 'a'.repeat(64)}; },
  };
  const reviewer = async () => { throw Error('Unexpected byte attachment'); };
  const provider = library.createMailReviewController({publish() {}, toast() {}, store, reviewAttachment: reviewer,
    binding: () => ({client, sessionId: 'session', owner: JSON.stringify(['production', 'owner', 'organization'])}), now: () => state.clock});
  function createDrafts() {
    return library.createMailDraftsController({publish() {}, toast() {}, provider, store, reviewAttachment: reviewer, confirm: () => true,
      identity: () => ({sessionId: 'session', account: {environment: 'production', userId: 'owner', organizationId: 'organization', sessionId: 'session'}}),
      attachments: {async select() { throw Error('Unexpected picker'); }, async read() { throw Error('Unexpected read'); }, async forget() {}},
      retained: (owner, _publish, restore) => ({
        ready: Promise.resolve(), get available() { return retained.has(owner); }, error: false, conflict: false, status: '',
        peek: () => retained.get(owner) ?? null,
        edit(value) { library.readInboxUnsaved(JSON.stringify(value), owner); retained.set(owner, structuredClone(value)); },
        async clear() { retained.delete(owner); },
        resume() { if (retained.has(owner)) restore(retained.get(owner)); },
        replace() {}, retry() {}, recover() {}, retire() {},
      }),
    });
  }
  const drafts = createDrafts();
  provider.setComposer(() => drafts.email());
  provider.setEditor((proposal, reference, review) => drafts.editProvider(proposal, reference, review));
  provider.setObservers({sent: (source, proposal, grant) => void drafts.settleSent(source.draftId, proposal, grant), sentNote: source => drafts.sentNote(source.draftId)});
  const saved = () => [...stored.values()].find(value => value?.id);
  const operation = () => [...stored.values()].find(value => value?.requestId);
  return {stored, retained, state, caps, store, provider, drafts, createDrafts, saved, operation,
    async bind() { await Promise.all([provider.bind('grant'), drafts.bind('grant', 'Account')]); },
    async prepare(kind = 'draft-create') { await provider.prepare({kind, ...drafts.proposal()}, {draftId: drafts.email().draftId}); },
    async confirm() { state.clock += 1000; provider.render().provider.confirm(); await until(() => operation()?.phase === 'observed' && !provider.render().provider.busy, 'provider confirmed'); },
    async adopt() { state.clock += 1000; provider.render().provider.editDraft(); await until(() => saved()?.provider && !provider.render().provider.busy, 'provider reference saved'); },
  };
}

test('shared provider references and legacy saved references retain subsequent edits', async () => {
  const fixture = mailFixture(); await fixture.bind();
  fixture.drafts.begin(undefined, undefined, '', {to: ['recipient@example.test'], subject: 'Subject', body: 'original'});
  await fixture.prepare(); await fixture.confirm(); await fixture.adopt();
  assert.deepEqual(Object.keys(fixture.saved().provider).sort(), ['draftId', 'providerDigest']);
  fixture.drafts.render().c.onBody({target: {value: 'edited'}});
  assert.equal([...fixture.retained.values()][0].draft.body, 'edited');
  const [key, saved] = [...fixture.stored].find(([, value]) => value?.id);
  fixture.stored.set(key, {...saved, provider: {...saved.provider, messageId: 'legacy-readback'}});
  fixture.retained.clear();
  const reloaded = fixture.createDrafts(); await reloaded.bind('grant', 'Account');
  reloaded.chips((label, pick) => ({label, pick})).find(row => row.label === 'Restore local draft').pick();
  reloaded.render().c.onBody({target: {value: 'legacy edit'}});
  assert.deepEqual(Object.keys([...fixture.retained.values()][0].draft.provider).sort(), ['draftId', 'providerDigest']);
});

test('shared provider editing retains reviewed forward parts and current capability gates confirmation', async () => {
  const fixture = mailFixture(); await fixture.bind();
  await fixture.drafts.newEmail({id: 'message', threadId: 'thread', from: 'Sender', fromEmail: 'sender@example.test', to: [], subject: 'Source'}, 'forward', 'source',
    {forward: {messageId: 'message', historyId: 'history', parts: [{partId: '1', name: 'part.txt', mimeType: 'text/plain', size: 1}]}});
  fixture.drafts.render().c.onTo({target: {value: 'recipient@example.test'}}); fixture.drafts.render().c.addRaw();
  await fixture.prepare(); await fixture.confirm(); await fixture.adopt();
  assert.equal(fixture.drafts.render().c.atts.length, 1);
  assert.equal(fixture.drafts.proposal().forwardAttachments.historyId, 'history');
  await fixture.prepare('draft-replace');
  fixture.caps.forwardAttachments = false; await fixture.provider.bind('grant');
  assert.equal(fixture.provider.render().provider.canConfirm, false);
  fixture.state.clock += 1000; fixture.provider.render().provider.confirm();
  assert.equal(fixture.state.dispatches, 1);
});

test('shared shelf cleanup failure preserves remaining copies after a successful send', async () => {
  const fixture = mailFixture(); await fixture.bind();
  fixture.drafts.begin(undefined, undefined, '', {to: ['recipient@example.test'], subject: 'Subject', body: 'original'});
  fixture.drafts.render().c.save(); await until(() => fixture.saved() && fixture.drafts.ready, 'local save');
  fixture.state.failSavedRemoval = true;
  assert.equal(await fixture.drafts.newEmail(), false);
  fixture.state.failSavedRemoval = false;
  fixture.drafts.render().c.onBody({target: {value: 'original'}});
  await fixture.prepare('send'); fixture.state.failShelfClear = true;
  await fixture.confirm(); await until(() => fixture.drafts.ready, 'cleanup settled');
  assert.ok(fixture.saved());
  assert.equal([...fixture.stored.values()].find(value => value?.items).items.length, 1);
});

test('shared scan autosave preserves explicitly saved and loaded drafts while cleaning automatic drafts', async () => {
  for (const explicit of [false, true]) {
    let row, revision = 0, removals = 0;
    const image = {type: 'image/png', size: 1};
    const drafts = {
      async read() { return row; },
      async save(pages, _expected, _signal, textLayers) { row = {pages: [...pages], textLayers, revision: String(++revision)}; return row; },
      async remove() { removals++; row = undefined; },
    };
    const document = library.createScanDocument({first: image, drafts, autosave: true});
    await document.settled();
    if (explicit) await document.saveDraft();
    document.put(image); await document.settled();
    assert.equal(document.snapshot().autoSaved, !explicit);
    await document.exportPages(async () => ({status: 'exported'}));
    await document.settled(); await new Promise(setImmediate);
    assert.equal(removals, explicit ? 0 : 1);
    if (explicit) {
      const restored = library.createScanDocument({drafts, autosave: true});
      assert.equal(await restored.loadDraft(() => true), 'loaded');
      restored.put(image); await restored.settled();
      await restored.exportPages(async () => ({status: 'exported'}));
      await new Promise(setImmediate);
      assert.ok(row); assert.equal(removals, 0);
    }
  }
});
