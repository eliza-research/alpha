// Local Inbox draft copies: the real inbox-drafts.ts and inbox-unsaved.ts against in-memory stores.
// No provider, account or network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {encodeInboxUnsaved, readInboxUnsaved} from '../apps/app/src/runtime/inbox-unsaved-record.ts';

async function bundle(entry, mocks = {}) {
  const result = await build({entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{name: 'ports', setup(b) {
    b.onResolve({filter: /.*/}, args => { const name = args.path.split('/').at(-1).replace(/\.ts$/, ''); if (name in mocks) return {path: name, namespace: 'fixture'}; });
    b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: mocks[args.path], loader: 'js'}));
  }}]});
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let turn = 0; turn < 8; turn++) await tick(); };

// The recovery port keeps what the real one would: the encoded record, or nothing when it is refused.
const fixture = {rows: new Map(), retained: new Map(), edits: [], invalid: false, toasts: [], failShelf: false, encode: encodeInboxUnsaved, read: readInboxUnsaved};
globalThis.draftCopiesFixture = fixture; globalThis.window = {confirm: () => true};
const {inboxDrafts} = await bundle('apps/app/src/prototype/inbox-drafts.ts', {
  'inbox-unsaved': `export function inboxUnsaved(owner,publish,restore){const s=globalThis.draftCopiesFixture;return {ready:Promise.resolve(),get available(){return s.retained.has(owner)},peek(){try{return s.retained.has(owner)?s.read(s.retained.get(owner),owner):null;}catch{return null;}},edit(v){s.edits.push(v);try{s.retained.set(owner,s.encode(v));s.invalid=false;}catch{s.invalid=true;}},clear:async()=>{s.retained.delete(owner)},resume(){const v=this.peek();if(v)restore(v);},retire(){},error:false,conflict:false,get status(){return s.invalid?'not retained':'';}};}`,
  'platform-plugins': `export const registerPlugin=()=>({});`,
  daily: `export const DailyApps={perform(){throw Error('Unexpected external operation')}};`,
  'inbox-attachment': `export const reviewMailAttachment=()=>{throw Error('Unexpected attachment read')};`,
  'inbox-operation': `export const outgoingAttachmentLimits={maximumFiles:10,maximumTotalBytes:5*1024*1024};export const checkOutgoingAttachments=()=>{};export const attachmentBytes=()=>0;`,
  'inbox-local-store': `export const inboxLocalStore={read:async key=>structuredClone(globalThis.draftCopiesFixture.rows.get(key)||null),compareExchange:async(key,before,next)=>{const s=globalThis.draftCopiesFixture;if(s.failShelf&&key.includes(':shelf:'))throw Error('Synthetic storage failure');if(JSON.stringify(s.rows.get(key)||null)!==JSON.stringify(before))return {status:'conflict'};if(next===null)s.rows.delete(key);else s.rows.set(key,structuredClone(next));return {status:'saved'};}};`,
  'connection-ui': `export const connectionController={getCloudClient:()=>({sessionId:'session-A',credentialId:'credential'}),getSnapshot:()=>({cloudAccount:{environment:'production',userId:'owner',organizationId:'organization',sessionId:'session-A'}})};`,
});
const ownerOf = grant => JSON.stringify(['production', 'owner', 'organization', grant]);
const savedSlot = grant => 'inbox-drafts:v1:' + ownerOf(grant);
const shelfSlot = async grant => 'inbox-drafts:v1:shelf:' + await sha(ownerOf(grant));
const local = (grant, extra = {}) => ({version: 1, id: 'local-1', revision: 'revision-1', owner: ownerOf(grant), to: ['friend@example.invalid'], cc: [], bcc: [], subject: 'Local only', body: 'Unsent local words', mode: 'compose', ...extra});
const make = () => inboxDrafts(() => {}, text => fixture.toasts.push(text), {prepare: async () => { throw Error('Unexpected provider operation'); }, capabilities: () => ({send: true, providerDrafts: true, from: 'owner@example.invalid'})});
const chip = (label, pick) => ({label, pick});
const field = (d, key, value) => d.render().c[key]({target: {value}});
const reset = () => { fixture.rows.clear(); fixture.retained.clear(); fixture.edits.length = 0; fixture.toasts.length = 0; fixture.invalid = false; fixture.failShelf = false; };

test('an earlier version opened from Drafts is retained, and what is saved from it is not labelled earlier', async () => {
  reset(); const grant = 'grant-earlier', owner = ownerOf(grant);
  fixture.rows.set(await shelfSlot(grant), {version: 1, owner, items: [{draft: local(grant, {id: 'sent-draft', subject: 'Earlier', body: 'Earlier text', earlierThanSent: true}), toQ: ''}]});
  const d = make(); await d.bind(grant, 'owner@example.invalid');
  d.chips(chip).find(row => row.subject === 'Earlier').pick(); await settle();
  const c = d.render().c;
  assert.equal(c.subject, 'Earlier');
  assert.equal(fixture.invalid, false, 'the opened draft has a recovery copy');
  assert.equal(fixture.edits.at(-1).draft.earlierThanSent, undefined);
  field(d, 'onBody', 'New words after the send');
  assert.equal(fixture.invalid, false, 'an edit is retained');
  assert.equal(readInboxUnsaved(fixture.retained.get(owner), owner).draft.body, 'New words after the send');
  d.render().c.save(); await settle();
  const saved = fixture.rows.get(savedSlot(grant));
  assert.equal(saved.body, 'New words after the send'); assert.equal('earlierThanSent' in saved, false, 'new content is not an earlier version');
  assert.equal(d.chips(chip).some(row => row.label === 'Earlier version of a sent email'), false);
});

test('retained edits are written once per task with the latest copy, and read back without parsing again', async t => {
  const store = {slots: new Map(), writes: 0};
  globalThis.unsavedStoreFixture = store;
  const listeners = new Map(); globalThis.document = {hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)};
  try {
    const {inboxUnsaved} = await bundle('apps/app/src/prototype/inbox-unsaved.ts', {
      core: `export const Capacitor={getPlatform:()=>'android',isNativePlatform:()=>true};`,
      'native-connection': `const s=()=>globalThis.unsavedStoreFixture;export const secureConnectionStore={read:async slot=>structuredClone(s().slots.get(slot)??null),readRaw:async()=>null,compareExchangeRaw:async()=>({status:'saved'}),compareExchange:async(slot,before,value)=>{if(JSON.stringify(s().slots.get(slot)??null)!==JSON.stringify(before))return {status:'conflict'};s().slots.set(slot,structuredClone(value));s().writes++;return {status:'saved'};}};`,
      'native-assistant-draft-recovery': `export const nativeAssistantDraftRecovery=()=>({capture:async()=>({}),reset:async()=>{}});`,
      'domain-recovery': `export const openDomainRecovery=()=>{};`,
      'dev-profile': `export const browserDevProfile=false;`,
      'json-domain-document': `export class BrowserJsonDomainDocument{}`,
    });
    const owner = ownerOf('grant-unsaved'), value = body => ({version: 1, owner, baseRevision: null, draft: local('grant-unsaved', {body}), toQ: ''});
    const stored = () => [...store.slots.values()][0]?.text || '';
    // Keep the next-task timer separate from the asynchronous storage work.
    t.mock.timers.enable({apis: ['setTimeout']});
    const runScheduledEdit = async () => { t.mock.timers.tick(0); await settle(); };
    let restored = null; const unsaved = inboxUnsaved(owner, () => {}, v => { restored = v; });
    await unsaved.ready;
    let last; for (let i = 0; i < 40; i++) unsaved.edit(last = value('keystroke ' + i));
    await settle();
    assert.equal(store.writes, 0, 'typing alone writes nothing'); assert.equal(unsaved.available, true);
    assert.equal(unsaved.peek(), last, 'the waiting edit is the retained copy');
    await runScheduledEdit();
    assert.equal(store.writes, 1, 'forty edits, one store write'); assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'keystroke 39');
    const parse = JSON.parse; let parses = 0; JSON.parse = (...args) => { parses++; return parse(...args); };
    let copy; try { copy = unsaved.peek(); assert.equal(unsaved.peek(), copy, 'the same parsed object'); unsaved.peek(); } finally { JSON.parse = parse; }
    assert.equal(parses, 1, 'the stored text is parsed once'); assert.equal(copy.draft.body, 'keystroke 39');
    // Leaving the app writes the waiting edit at once.
    unsaved.edit(value('before leaving')); globalThis.document.hidden = true; listeners.get('visibilitychange')(); globalThis.document.hidden = false;
    await settle(); assert.equal(store.writes, 2, 'hide writes without advancing the timer');
    assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'before leaving'); assert.notEqual(unsaved.peek(), copy);
    // Resume and clear act on the latest edit, not the last written one.
    unsaved.edit(value('resumed')); unsaved.resume(); assert.equal(restored.draft.body, 'resumed');
    unsaved.edit(value('cleared')); await unsaved.clear();
    assert.equal(stored(), ''); assert.equal(unsaved.available, false); assert.equal(unsaved.peek(), null);
    // An edit made while the retained copy is being cleared is not cleared with it.
    unsaved.edit(value('kept')); const clearing = unsaved.clear(); unsaved.edit(value('typed during the clear'));
    await assert.rejects(clearing); await runScheduledEdit();
    assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'typed during the clear');
    // A copy the record refuses is reported once it is written, and the stored copy stays.
    unsaved.edit({...value('refused'), draft: {...value('refused').draft, body: 'x'.repeat(64001)}}); await runScheduledEdit();
    assert.equal(unsaved.status, 'Too large to keep');
    assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'typed during the clear');
    // An app update waits for the waiting edit to be stored.
    unsaved.edit(value('before update')); await unsaved.flushForAppUpdate(() => true);
    assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'before update');
    // Retiring writes the waiting edit before the account changes.
    let published = 0; const leaving = inboxUnsaved(owner, () => { published++; }, () => {}); await leaving.ready;
    leaving.edit(value('before retire')); const before = published; leaving.retire();
    assert.equal(published, before, 'retiring publishes nothing to the view being left'); assert.equal(leaving.retired, true);
    await leaving.flushForAppUpdate(() => true);
    assert.equal(readInboxUnsaved(stored(), owner).draft.body, 'before retire');
    unsaved.retire(); assert.equal(listeners.has('visibilitychange'), false);
  } finally { delete globalThis.unsavedStoreFixture; delete globalThis.document; }
});
