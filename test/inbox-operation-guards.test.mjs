// Inbox delivery guards and bounded local work, with synthetic stores and a synthetic provider.
// No account, network, OAuth consent or mail.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {editCoalescer} from '../apps/app/src/runtime/inbox-edit-coalescer.ts';
import {ServiceReadCache} from '../apps/app/src/runtime/service-read-cache.ts';

/** Bundles one source with named ports replaced; the last path segment selects the replacement. */
async function bundle(entry, mocks = {}) {
  const result = await build({entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{name: 'ports', setup(b) {
    b.onResolve({filter: /.*/}, args => { const name = args.path.split('/').at(-1).replace(/\.ts$/, ''); if (name in mocks) return {path: name, namespace: 'fixture'}; });
    b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: mocks[args.path], loader: 'js'}));
  }}]});
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const attachmentPort = `export class AttachmentRefusedError extends Error{constructor(m='Attachment refused'){super(m);this.name='AttachmentRefusedError';}}
export const attachmentRefused=e=>e instanceof AttachmentRefusedError;export const reviewMailAttachment=async()=>{throw Error('Unexpected attachment read');};`;
const {InboxOperation, receiptReadGuard, regressedReceipt, regressedReceiptRefusal} = await bundle('apps/app/src/runtime/inbox-operation.ts', {'inbox-attachment': attachmentPort});
const mailbox = await bundle('apps/app/src/runtime/gmail-mailbox.ts', {'inbox-attachment': attachmentPort});

const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const until = async (ready, what) => { const deadline = performance.now() + 5000; while (!ready()) { assert.ok(performance.now() < deadline, 'Timed out waiting for ' + what); await new Promise(resolve => setTimeout(resolve, 2)); } };
const archive = {kind: 'archive', messageId: 'message-1', expectedHistoryId: 'history-1'};
function device(owner = 'owner') {
  const slots = new Map(), remote = {dispatches: 0, dispatchState: 'succeeded', answer: null, receipts: new Map(), caps: {send: true, providerDrafts: true, mailboxMutations: true, threads: true, from: 'owner@example.invalid'}};
  const client = {
    gmailInboxCapabilities: async () => ({...remote.caps}),
    gmailDraft: async () => { throw Error('Unexpected draft read'); },
    gmailPrepareOperation: async (_grant, requestId, proposal) => {
      const review = {...proposal, from: 'owner@example.invalid', attachments: []};
      const receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await sha(JSON.stringify(review)), providerResult: null, rejectionCode: null};
      remote.receipts.set(requestId, receipt); return {review, receipt};
    },
    gmailDispatchOperation: async (_grant, requestId, reviewDigest, proposal) => {
      remote.dispatches++; if (remote.dispatchFails) throw new TypeError('Failed to fetch');
      const receipt = {requestId, kind: proposal.kind, state: remote.dispatchState, reviewDigest, providerResult: remote.dispatchState === 'succeeded' ? {messageId: proposal.messageId, historyId: 'history-2'} : null, rejectionCode: null};
      remote.receipts.set(requestId, receipt); return receipt;
    },
    gmailOperation: async (_grant, requestId) => ({...remote.receipts.get(requestId), ...(remote.answer ? {state: remote.answer, providerResult: null} : {})}),
  };
  const store = {
    read: async key => structuredClone(slots.get(key) ?? null),
    compareExchange: async (key, prior, next) => {
      if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(prior)) return {status: 'conflict'};
      if (next === null) slots.delete(key); else slots.set(key, structuredClone(next)); return {status: 'saved'};
    },
  };
  // The journal as the app binds it: receipt reads pass through the saved-outcome guard.
  const guarded = {...client, gmailOperation: InboxOperation.receiptReads(client.gmailOperation, store, owner)};
  const make = () => new InboxOperation({owner, grantId: 'grant-a', active: () => true, store, client: guarded});
  return {slots, remote, client, store, make, slot: () => [...slots.values()][0] ?? null};
}

test('only a prepared answer for the request whose outcome is saved counts as regressed', () => {
  const saved = {requestId: 'r1', phase: 'observed'};
  assert.equal(regressedReceipt(saved, 'r1', 'prepared'), true);
  for (const state of ['dispatched', 'succeeded', 'rejected', 'outcome-unknown']) assert.equal(regressedReceipt(saved, 'r1', state), false);
  for (const phase of ['preparing', 'review', 'dispatching']) assert.equal(regressedReceipt({requestId: 'r1', phase}, 'r1', 'prepared'), false, phase + ' is handled by the journal');
  assert.equal(regressedReceipt(saved, 'r2', 'prepared'), false, 'another request');
  assert.equal(regressedReceipt(null, 'r1', 'prepared'), false);
  assert.equal(InboxOperation.receiptReads.length, receiptReadGuard.length);
});

for (const outcome of ['outcome-unknown', 'dispatched', 'succeeded']) {
  test(`a regressed provider answer after a ${outcome} dispatch cannot re-arm Confirm`, async () => {
    const d = device(), operation = d.make();
    await operation.prepare(archive); d.remote.dispatchState = outcome;
    await operation.confirm();
    assert.equal(operation.snapshot().phase, 'observed'); assert.equal(d.remote.dispatches, 1);
    const receipt = structuredClone(d.slot().receipt);
    // The provider now reports the request as merely prepared.
    d.remote.answer = 'prepared';
    await assert.rejects(operation.refresh(), error => error.message === regressedReceiptRefusal);
    assert.equal(operation.snapshot().phase, 'observed', 'an observed operation stays observed');
    assert.deepEqual(d.slot().receipt, receipt, 'the saved receipt is not replaced by the regressed answer');
    assert.equal(d.slot().phase, 'observed');
    await assert.rejects(operation.confirm(), /fresh exact review/);
    assert.equal(d.remote.dispatches, 1, 'the same request is never dispatched twice');
    // A reload sees the same durable state, and the regressed answer still cannot change it.
    const reloaded = d.make(); await reloaded.load();
    await assert.rejects(reloaded.refresh(), error => error.message === regressedReceiptRefusal);
    await assert.rejects(reloaded.confirm(), /fresh exact review/);
    assert.equal(d.remote.dispatches, 1); assert.equal(d.slot().phase, 'observed');
    // An honest answer is still recorded.
    d.remote.answer = null; d.remote.receipts.set(receipt.requestId, {...receipt, state: 'succeeded', providerResult: {messageId: 'message-1', historyId: 'history-2'}});
    assert.equal((await reloaded.refresh()).receipt.state, 'succeeded');
  });
}

test('a dispatch whose reply was lost stays dispatching on a prepared answer', async () => {
  const d = device(), operation = d.make();
  await operation.prepare(archive); d.remote.dispatchFails = true;
  await assert.rejects(operation.confirm(), /Failed to fetch/);
  assert.equal(d.slot().phase, 'dispatching');
  assert.equal((await operation.refresh()).phase, 'dispatching');
  await assert.rejects(operation.confirm(), /fresh exact review/);
  assert.equal(d.remote.dispatches, 1);
});

test('an unsent review is still refreshed and confirmed through the guarded read', async () => {
  const d = device(), operation = d.make();
  await operation.prepare(archive);
  assert.equal((await operation.refresh()).phase, 'review');
  assert.equal((await operation.confirm()).phase, 'observed'); assert.equal(d.remote.dispatches, 1);
});

// The real controls over the fixture of the running test; the ports read it on every call.
let controlsModule;
const controls = () => controlsModule ??= bundle('apps/app/src/prototype/inbox-provider-controls.ts', {
  'inbox-local-store': `const f=()=>globalThis.inboxControlsFixture.store;export const inboxLocalStore={read:key=>f().read(key),compareExchange:(key,before,next)=>f().compareExchange(key,before,next)};`,
  'connection-ui': `const f=()=>globalThis.inboxControlsFixture.controller;export const connectionController={getCloudClient:()=>f().getCloudClient(),getSnapshot:()=>f().getSnapshot()};`,
  'inbox-attachment': attachmentPort,
});

test('the review sheet keeps a confirmed receipt when Check gets a regressed answer, and never dispatches again', async () => {
  const account = {environment: 'production', userId: 'owner-1'}, owner = JSON.stringify(['production', 'owner-1', '']);
  const d = device(owner), toasts = [];
  globalThis.inboxControlsFixture = {store: d.store, controller: {getCloudClient: () => ({client: d.client, sessionId: 'session-1'}), getSnapshot: () => ({cloudAccount: account})}};
  globalThis.document = {documentElement: {dataset: {connectionMode: 'live'}}};
  try {
    const {inboxProviderControls} = await controls();
    const provider = inboxProviderControls(() => {}, text => toasts.push(text));
    await provider.bind('grant-a');
    await provider.prepare(archive);
    assert.equal(provider.render().provider.canConfirm, true);
    provider.render().provider.confirm();
    await until(() => d.slot()?.phase === 'observed' && !provider.render().provider.busy, 'the confirmed archive');
    assert.equal(d.remote.dispatches, 1); assert.equal(d.slot().receipt.state, 'succeeded');
    // The provider regresses; the owner taps Check, then Confirm, twice.
    d.remote.answer = 'prepared';
    provider.render().provider.check();
    await until(() => toasts.length > 0 && !provider.render().provider.busy, 'the refused check');
    const shown = provider.render().provider;
    assert.equal(shown.canConfirm, false, 'Confirm is not offered again');
    assert.equal(d.slot().phase, 'observed'); assert.equal(d.slot().receipt.state, 'succeeded');
    shown.confirm(); await new Promise(resolve => setTimeout(resolve, 20)); provider.render().provider.confirm();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(d.remote.dispatches, 1, 'one dispatch for the request');
    // After a restart the saved receipt is loaded and the regressed answer is refused again.
    const restarted = inboxProviderControls(() => {}, text => toasts.push(text));
    await restarted.bind('grant-a');
    assert.equal(restarted.render().provider.canConfirm, false);
    assert.equal(d.slot().phase, 'observed'); assert.equal(d.remote.dispatches, 1);
  } finally { delete globalThis.inboxControlsFixture; delete globalThis.document; }
});

test('the review sheet does not offer or dispatch a saved review after a restart under a withdrawn grant', async () => {
  const account = {environment: 'production', userId: 'owner-1'}, owner = JSON.stringify(['production', 'owner-1', '']);
  const d = device(owner), toasts = [];
  await d.make().prepare(archive);
  assert.equal(d.slot().phase, 'review');
  // A new process: no earlier account read exists to report the withdrawal; only capabilities do.
  d.remote.caps.mailboxMutations = false;
  globalThis.inboxControlsFixture = {store: d.store, controller: {getCloudClient: () => ({client: d.client, sessionId: 'session-1'}), getSnapshot: () => ({cloudAccount: account})}};
  globalThis.document = {documentElement: {dataset: {connectionMode: 'live'}}};
  try {
    const {inboxProviderControls} = await controls();
    const provider = inboxProviderControls(() => {}, text => toasts.push(text));
    await provider.bind('grant-a');
    const shown = provider.render().provider;
    assert.equal(shown.canConfirm, false, 'Confirm is not offered');
    shown.confirm(); await until(() => toasts.length > 0, 'the refusal');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(d.remote.dispatches, 0, 'nothing is dispatched'); assert.equal(d.slot().phase, 'review');
    // With the capability restored the same review can be confirmed.
    d.remote.caps.mailboxMutations = true; await provider.bind('grant-a');
    assert.equal(provider.render().provider.canConfirm, true);
  } finally { delete globalThis.inboxControlsFixture; delete globalThis.document; }
});

function clock() {
  let now = 0, next = 1; const timers = new Map();
  return {timers: {set(run, ms) { const id = next++; timers.set(id, {run, at: now + ms}); return id; }, clear(id) { timers.delete(id); }, now: () => now},
    advance(ms) { const end = now + ms; for (;;) { const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].run(); } now = end; },
    count: () => timers.size};
}
test('a burst of edits is written once, with the latest value', () => {
  const c = clock(), written = [], queue = editCoalescer(value => written.push(value), {delay: 300, maximumWait: 1500, timers: c.timers});
  for (let i = 0; i < 20; i++) { queue.push('text-' + i); c.advance(50); }
  assert.deepEqual(written, [], 'nothing is written while typing continues');
  assert.equal(c.count(), 1, 'one timer, never one per keystroke'); assert.equal(queue.peek(), 'text-19'); assert.equal(queue.pending, true);
  c.advance(300);
  assert.deepEqual(written, ['text-19']); assert.equal(queue.pending, false); assert.equal(c.count(), 0);
  c.advance(5000); assert.equal(written.length, 1, 'no write is scheduled while idle');
});
test('continuous typing is still written within the maximum wait', () => {
  const c = clock(), written = [], queue = editCoalescer(value => written.push(value), {delay: 300, maximumWait: 1500, timers: c.timers});
  for (let i = 0; i < 100; i++) { queue.push(i); c.advance(100); }
  assert.ok(written.length >= 6 && written.length <= 7, `one write per maximum wait, got ${written.length}`);
  assert.deepEqual(written.slice(0, 2), [14, 29]);
});
test('flush writes at once, and a busy writer holds the next write without queueing more than one value', () => {
  const c = clock(), written = [], queue = editCoalescer(value => written.push(value), {delay: 300, maximumWait: 1500, timers: c.timers});
  queue.push('a'); assert.equal(queue.flush(), true); assert.deepEqual(written, ['a']); assert.equal(queue.flush(), false);
  queue.hold(); queue.push('b'); c.advance(1000); queue.push('c'); c.advance(1000);
  assert.deepEqual(written, ['a'], 'held: the due write waits'); assert.equal(queue.peek(), 'c');
  queue.release(); assert.deepEqual(written, ['a', 'c'], 'released: only the latest value is written');
  queue.hold(); queue.push('d'); assert.equal(queue.flush(), true, 'an explicit flush writes even while held'); queue.release();
  queue.push('e'); queue.discard(); c.advance(5000); assert.deepEqual(written, ['a', 'c', 'd']);
});

test('mail keeps its offline snapshots apart from the account document', async () => {
  const slots = new Map(); globalThis.readCacheSlots = slots;
  const {serviceReadCache, readCacheIdentity} = await bundle('apps/app/src/runtime/service-read-cache-store.ts', {
    core: `export const Capacitor={isNativePlatform:()=>true};`,
    'native-connection': `const s=()=>globalThis.readCacheSlots;export const secureConnectionStore={read:async slot=>structuredClone(s().get(slot)??null),compareExchange:async(slot,before,value)=>{if(JSON.stringify(s().get(slot)??null)!==JSON.stringify(before))return {status:'conflict'};if(value===null)s().delete(slot);else s().set(slot,structuredClone(value));return {status:'saved'};}};`,
    'json-domain-document': `export class BrowserJsonDomainDocument{}`,
  });
  try {
    const account = {environment: 'production', userId: 'user', organizationId: 'org', credentialId: 'credential'};
    assert.equal(readCacheIdentity(account), JSON.stringify(['production', 'user', 'org', 'credential']), 'the account document keeps its identity');
    assert.notEqual(readCacheIdentity(account, 'gmail'), readCacheIdentity(account));
    // Mail saved in the account document by an earlier version is erased there, not read; Calendar's entries stay.
    const shared = 'connected-read-cache:v1:' + await sha(readCacheIdentity(account));
    slots.set(shared, {version: 1, owner: readCacheIdentity(account), entries: [{key: 'gmail:mailbox', value: 'old mail', at: Date.now()}, {key: 'calendar:owner:v1', value: 'saved owner', at: Date.now()}]});
    const calendar = await serviceReadCache(account), mail = await serviceReadCache(account, 'gmail');
    assert.notEqual(mail, calendar); assert.equal(await serviceReadCache(account, 'gmail'), mail, 'one handle per document'); assert.equal(await serviceReadCache(account), calendar);
    assert.equal(await mail.get('gmail:mailbox'), null, 'the earlier snapshot is not migrated');
    await until(() => slots.get(shared).entries.find(entry => entry.key === 'gmail:mailbox')?.value === null, 'the retired mail snapshot');
    assert.equal((await calendar.get('calendar:owner:v1')).value, 'saved owner');
    await mail.put('gmail:mailbox', {messages: ['saved mail']}); await calendar.put('calendar:feed', {events: ['saved event']});
    assert.equal(slots.size, 2); for (const slot of slots.keys()) assert.match(slot, /^connected-read-cache:v1:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(slots.get(shared)).includes('saved mail'), false, 'mail is never written to the account document');
    // Mail loses its grant and clears its cache: Calendar's saved entries stay, and a Calendar write in flight lands.
    const pending = calendar.put('calendar:next', 'in flight'); await mail.clear(); await pending;
    assert.equal(await mail.get('gmail:mailbox'), null);
    assert.deepEqual((await calendar.get('calendar:feed')).value, {events: ['saved event']});
    assert.equal((await calendar.get('calendar:next')).value, 'in flight');
    assert.equal((await calendar.get('calendar:owner:v1')).value, 'saved owner');
    // And the reverse.
    await mail.put('gmail:mailbox', {messages: ['again']}); await calendar.clear();
    assert.deepEqual((await mail.get('gmail:mailbox')).value, {messages: ['again']});
    await assert.rejects(serviceReadCache(account, 'other'), /unavailable/);
    await assert.rejects(serviceReadCache({...account, credentialId: ''}, 'gmail'), /unavailable/);
  } finally { delete globalThis.readCacheSlots; }
});

test('cache eviction measures each entry once instead of encoding the document per evicted entry', async () => {
  let raw = null, encodes = 0;
  const store = {read: async () => raw, compareExchange: async (before, value) => { if (before !== raw) return 'conflict'; raw = value; return 'saved'; }};
  const cache = new ServiceReadCache('owner', store, () => 10_000_000_000);
  // The newest entry counts how often it is serialised.
  const counted = {toJSON() { encodes++; return 'counted'; }};
  const block = 'x'.repeat(400 * 1024);
  for (let i = 0; i < 9; i++) await cache.put('page-' + i, block, 9_000_000_000 + i);
  await cache.put('counted', counted, 9_500_000_000);
  encodes = 0;
  // 1.9 MiB more: several of the oldest pages must go.
  await cache.put('large', 'y'.repeat(1900 * 1024), 9_900_000_000);
  const keys = raw.entries.map(entry => entry.key);
  assert.ok(new TextEncoder().encode(JSON.stringify(raw)).length <= 4 * 1024 * 1024);
  assert.ok(keys.includes('large') && keys.includes('counted'));
  const evicted = 9 - keys.filter(key => key.startsWith('page-')).length;
  assert.ok(evicted >= 3, `expected several evictions, got ${evicted}`);
  assert.deepEqual(keys.filter(key => key.startsWith('page-')), Array.from({length: 9 - evicted}, (_, i) => 'page-' + (i + evicted)), 'the oldest entries are the ones evicted');
  // One read-side size check and one measurement; the final assert above added one more.
  assert.ok(encodes <= 3, `an entry was serialised ${encodes} times for ${evicted} evictions`);
  // The bound is exact: one more byte than fits evicts, a document that fits keeps everything.
  raw = null; const exact = new ServiceReadCache('owner', store, () => 10_000_000_000);
  const overhead = new TextEncoder().encode(JSON.stringify({version: 1, owner: 'owner', entries: [{key: 'a', value: '', at: 9_999_999_001}, {key: 'b', value: '', at: 9_999_999_002}]})).length;
  const half = Math.floor((4 * 1024 * 1024 - overhead) / 2);
  await exact.put('a', 'x'.repeat(half), 9_999_999_001); await exact.put('b', 'x'.repeat(4 * 1024 * 1024 - overhead - half), 9_999_999_002);
  assert.equal(raw.entries.length, 2); assert.equal(new TextEncoder().encode(JSON.stringify(raw)).length, 4 * 1024 * 1024);
  await exact.put('b', 'x'.repeat(4 * 1024 * 1024 - overhead - half + 1), 9_999_999_003);
  assert.deepEqual(raw.entries.map(entry => entry.key), ['b']);
});

test('the saved mailbox keeps the newest bodies that fit, each measured once', () => {
  const {cachedJsonBytes, newestMailBodies} = mailbox;
  let encodes = 0; const body = (id, size) => ({id, text: 'x'.repeat(size), toJSON() { encodes++; return {id, text: this.text}; }});
  const first = body('a', 10);
  const bytes = cachedJsonBytes(first); assert.equal(bytes, new TextEncoder().encode(JSON.stringify({id: 'a', text: 'x'.repeat(10)})).length);
  encodes = 0; assert.equal(cachedJsonBytes(first), bytes); assert.equal(encodes, 0, 'a second measurement does not serialise');
  const list = ['a', 'b', 'c', 'd'].map(id => ({at: 1, body: body(id, 1000)})), one = cachedJsonBytes(list[0].body);
  assert.deepEqual(newestMailBodies(list, one * 2).map(row => row.body.id), ['c', 'd'], 'the newest bodies that fit, in order');
  assert.deepEqual(newestMailBodies(list, one * 2 - 1).map(row => row.body.id), ['d']);
  assert.deepEqual(newestMailBodies(list, 0), []); assert.equal(newestMailBodies(list, one * 9).length, 4);
  encodes = 0; newestMailBodies(list, one * 9); newestMailBodies(list, one); assert.equal(encodes, 0, 'saving again serialises no body to measure it');
});
