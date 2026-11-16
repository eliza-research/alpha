// AP-16 Messages (docs/agentic-comms.md): the one bottom bar each Messages screen declares, the
// thread's draft slot behind it and the draft bubble, driven through bar(st, api) and the Android
// adapter with a stub view api. No browser, device, SIM or provider: nothing here is sent anywhere.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const D = await import('../apps/app/src/runtime/message-draft.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const model = readFileSync('apps/app/src/prototype/model.js', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
/** Source of one top-level `function name(` declaration of model.js. */
function top(name) {
  const start = model.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} is declared at the top level`);
  const rest = model.slice(start + 1), end = rest.search(/\n(?=[^\s}])/);
  return rest.slice(0, end < 0 ? rest.length : end);
}
const MESSAGES = ['msgPeople', 'msgWho', 'msgFind', 'msgFirst', 'msgFmt', 'msgMaxK', 'msgNowK', 'msgLastIn', 'msgOpen', 'msgPush', 'msgFiles', 'msgSend',
  'msgDraft', 'msgDraftsPatch', 'msgSetDraft', 'msgSubmit', 'msgBubbleSend', 'msgMatches', 'msgWhen', 'msgBriefing', 'msgBar'];
function devMessages() {
  const filters = [];
  const ctx = vm.createContext({Object, String, Math, JSON, Array, crypto, MSG_BOT: {}, formatHours: h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`,
    emptyDraft: D.emptyDraft, typed: D.typed, askedDraftPlaced: D.askedDraftPlaced, draftStageFit: () => 42, applyListFilter: (...args) => filters.push(args)});
  vm.runInContext(MESSAGES.map(top).join('\n') + `\nglobalThis.VIEWS={messages:{submit:msgSubmit}};globalThis.out={${MESSAGES.join(',')}};`, ctx);
  return ctx.out;
}
const people = [{id: 'maya', name: 'Maya Chen', ini: 'MC', phone: '555'}, {id: 'jordan', name: 'Jordan Park', ini: 'JP', phone: '556'}];
/** A view api that records its writes and calls, applying each write at once. */
function stubApi(initial) {
  let state = structuredClone(initial);
  const log = {sets: [], notes: [], later: [], toPerson: 0};
  const api = {name: 'Alpha', people, S: {view: 'messages', chat: 'input'}, now: new Date(2026, 10, 15, 15, 0),
    person: id => people.find(p => p.id === id) || null, get: key => key === 'messages' ? state : {},
    set: patch => { log.sets.push(plain(patch)); state = {...state, ...patch}; },
    note: (text, opts) => log.notes.push([text, opts]), later: (fn, ms) => log.later.push({fn, ms}), toPerson: () => { log.toPerson++; }};
  Object.defineProperty(api, 'st', {get: () => state});
  return {api, log, state: () => state};
}
const seed = {threads: {maya: [{id: 'm1', me: false, text: 'Still on for 3?', k: 840}], jordan: [{id: 'j1', me: true, text: 'Works.', k: 600}]}, unread: {maya: 1}, thread: null, compose: null, drafts: {}, attach: null, filter: null};

test('the Messages list bar filters on this phone and never sends', () => {
  const M = devMessages(), {api, log, state} = stubApi(seed);
  const spec = M.msgBar(state(), api);
  assert.deepEqual(plain({target: spec.target, kind: spec.closed.kind, placeholder: spec.closed.placeholder, left: spec.left, context: spec.context, contextKey: spec.contextKey, strip: spec.strip}),
    {target: {kind: 'list', app: 'Messages', name: null, first: null, initials: null}, kind: 'filter', placeholder: 'Search or ask',
      left: {icon: 'search', label: 'Back to search', initials: null, run: null}, context: 'Messages', contextKey: 'messages:list:', strip: {title: 'Messages', subtitle: '', initials: null, live: false, actions: []}});
  assert.equal(spec.closed.submit, null);
  assert.equal(spec.fit, null);
  spec.closed.onText('still');
  assert.deepEqual(plain(state().filter), {query: 'still', label: 'still', by: 'owner'});
  assert.equal(M.msgBar(state(), api).closed.value, 'still');
  M.msgBar(state(), api).closed.onText('  ');
  assert.equal(state().filter, null);
  assert.equal(log.notes.length, 0);
  assert.equal(M.msgBriefing(seed, api, null), 'Maya Chen sent an unread text.');
  assert.equal(M.msgBriefing({...seed, threads: {}}, api, null), null, 'nothing is known without threads');
});

test('a thread bar addresses the person; its Send sends once and clears the slot in the same write', () => {
  const M = devMessages(), {api, log, state} = stubApi({...seed, thread: 'maya'});
  const spec = M.msgBar(state(), api);
  assert.deepEqual(plain({target: spec.target, placeholder: spec.closed.placeholder, kind: spec.closed.kind, maxLength: spec.closed.maxLength, suggestion: spec.closed.suggestion, left: spec.left, context: spec.context, contextKey: spec.contextKey}),
    {target: {kind: 'thread', app: 'Messages', name: 'Maya Chen', first: 'Maya', initials: 'MC'}, placeholder: 'Text Maya', kind: 'person', maxLength: 1600, suggestion: null,
      left: {icon: 'avatar', label: 'Back to texting Maya', initials: 'MC', run: null}, context: 'Maya Chen · Messages', contextKey: 'messages:thread:maya'});
  assert.equal(spec.closed.canSubmit, false);
  assert.equal(spec.fit(), 42);
  assert.match(spec.briefing, /^Maya texted at 14:00 and hasn't had a reply\.$/);
  spec.closed.onText('On my way');
  assert.deepEqual(plain(state().drafts), {maya: {draft: 'owner', text: 'On my way', undo: null}});
  const typed = M.msgBar(state(), api);
  assert.equal(typed.closed.value, 'On my way');
  assert.equal(typed.closed.canSubmit, true);
  assert.equal(typed.strip.subtitle, 'Messages · draft waiting');
  const writes = log.sets.length;
  typed.closed.submit();
  const sent = log.sets.slice(writes);
  assert.equal(sent.length, 1, 'one write');
  assert.equal(sent[0].threads.maya.filter(m => m.text === 'On my way').length, 1);
  assert.deepEqual(sent[0].drafts, {}, 'the slot is cleared with the send');
  assert.equal(M.msgBar(state(), api).closed.submit(), undefined);
  assert.equal(state().threads.maya.filter(m => m.text === 'On my way').length, 1, 'an empty slot sends nothing');
});

test('Alpha replaces the slot with one Undo; Send on the bubble is the same Send and is noted quietly', () => {
  const M = devMessages(), {api, log, state} = stubApi({...seed, thread: 'maya', drafts: {maya: {draft: 'owner', text: 'Mine', undo: null}}});
  M.msgSetDraft(api, 'maya', D.askedDraftPlaced(M.msgDraft(state(), 'maya'), 'Running 10 late.', true));
  assert.deepEqual(plain(state().drafts.maya), {draft: 'asked', text: 'Running 10 late.', undo: {draft: 'owner', text: 'Mine'}});
  assert.equal(state().threads.maya.length, 1, 'placing a draft sends nothing');
  const spec = M.msgBar(state(), api);
  assert.deepEqual(plain(spec.strip.actions.map(a => [a.id, a.label])), [['send', 'Send draft']]);
  spec.strip.actions[0].run();
  assert.equal(state().threads.maya.filter(m => m.text === 'Running 10 late.').length, 1);
  assert.equal(state().drafts.maya, undefined);
  assert.deepEqual(log.notes, [['Sent to Maya Chen', undefined]]);
  assert.equal(state().sentDraft, state().threads.maya.at(-1).id, 'the sent message shows as the solid bubble');
});

test('on the Alpha image the thread bar, the draft slot and the bubble send only on the owner tap', async () => {
  const {mkdtempSync, rmSync, writeFileSync} = await import('node:fs'), {join, resolve} = await import('node:path'), {tmpdir} = await import('node:os'), {pathToFileURL} = await import('node:url');
  const {build} = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'sms-bar-')), priorDocument = globalThis.document, priorWindow = globalThis.window, priorButton = globalThis.HTMLButtonElement, sends = [];
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
  // The trusted Send gate needs a real owner tap on a Send control: a trusted click on a button.
  globalThis.window = Object.assign(new EventTarget(), {setTimeout, clearTimeout});
  globalThis.HTMLButtonElement = class { constructor(attributes) { this.attributes = attributes; } hasAttribute(name) { return name in this.attributes; } getAttribute(name) { return this.attributes[name] ?? null; } };
  const tap = attributes => ({isTrusted: true, currentTarget: new globalThis.HTMLButtonElement(attributes), stopPropagation() {}});
  const thread = {id: 'thread:1', addresses: ['+15550100101'], date: 1, snippet: 'Still on for 3?', unread: true};
  globalThis.__smsBarPort = {smsSendHistory: async () => [], status: async () => ({permissions: {sms: 'granted', sendSms: 'granted', phoneState: 'granted'}, sendMode: 'direct', subscriptions: [{id: 3, slot: 0, displayName: 'SIM'}]}),
    threadPage: async () => ({rows: [thread, {id: 'thread:2', addresses: ['+15550100102'], date: 0, snippet: 'Lunch?', unread: false}], next: null}),
    messagePage: async () => ({rows: [{id: 'sms:1', threadId: 'thread:1', kind: 'sms', addresses: thread.addresses, date: 1, body: 'Still on for 3?', direction: 'incoming', status: 'received', subscriptionId: 3}], next: null}),
    observeMessages: async () => async () => {}, sendSms: async (review, operationId) => { sends.push({review, operationId}); return {status: 'submitted'}; }, smsSendResult: async () => ({status: 'sent'})};
  try {
    const contract = resolve('.eliza/client-features/packages/contracts/src/native-telephony.ts');
    const fixture = {name: 'native-fixture', setup(builder) {
      builder.onResolve({filter: /platform-plugins|aosp-image|aosp-telephony|native-adapter$/}, args => ({path: args.path, namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({resolveDir: process.cwd(), contents: args.path.includes('aosp-telephony') ? `export const MMS_MAX_ATTACHMENTS=5;export {reviewMms,reviewSms} from ${JSON.stringify(contract)};export const createAospTelephony=()=>globalThis.__smsBarPort;export const registerTelephonyProfile=()=>()=>{};` : args.path.includes('platform-plugins') ? 'export const registerPlugin=()=>globalThis.__smsBarPort;' : args.path.includes('aosp-image') ? 'export const aospImage=true;' : 'export const watchReturnToApp=()=>()=>{};'}));
    }};
    const entry = `export {installSmsAdapter,placeAskedSmsDraft,undoSmsDraft,readSmsDraft} from ${JSON.stringify(resolve('apps/app/src/prototype/sms-adapter.ts'))};export {applyListFilter} from ${JSON.stringify(resolve('apps/app/src/runtime/comms-bar.ts'))};`;
    const result = await build({stdin: {contents: entry, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, format: 'esm', platform: 'node', write: false, plugins: [fixture]});
    const filename = join(dir, 'adapter.mjs'); writeFileSync(filename, result.outputFiles[0].text);
    const A = await import(pathToFileURL(filename));
    class Component { view = 'messages'; S() { return {view: this.view}; } setState() {} }
    const views = {messages: {}}; A.installSmsAdapter(Component, views); const owner = new Component(); owner.componentDidMount(); await tick(); await tick();
    const notes = [], viewApi = {name: 'Alpha', S: {chat: 'input'}, note: text => notes.push(text), toPerson: () => notes.push('toPerson')};
    const render = () => views.messages.render({}, viewApi), bar = () => views.messages.bar({}, viewApi), settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
    // The list: typing filters the rows on this phone; Alpha's filter shows a clearable chip.
    assert.equal(bar().target.kind, 'list');
    bar().closed.onText('lunch');
    assert.deepEqual(render().threads.map(row => row.snippet), ['Lunch?']);
    assert.equal(render().filterChip, null, 'the owner\'s own filter shows no chip');
    bar().closed.onText('');
    assert.equal(A.applyListFilter('messages', {query: 'still', label: 'Needs a reply', by: 'alpha'}), true);
    assert.deepEqual(render().threads.map(row => row.snippet), ['Still on for 3?']);
    assert.equal(render().filterChip.clearLabel, 'Clear filter Needs a reply');
    assert.equal(render().threads[0].stageLast, true);
    render().filterChip.clear();
    assert.equal(render().threads.length, 2);
    assert.match(bar().briefing, /sent an unread text\.$/);
    // The thread: the bar is the composer; Alpha's draft replaces the owner's text with one Undo.
    render().threads[0].open(); await settle();
    const spec = bar();
    assert.deepEqual([spec.target.kind, spec.closed.kind, spec.closed.maxLength, spec.contextKey], ['thread', 'person', 1600, 'messages:thread:thread:1']);
    assert.equal(render().bubbles.at(-1).stageLast, true, 'the newest inbound message stays above the sheet');
    spec.closed.onText('My own words');
    assert.equal(A.placeAskedSmsDraft('Ten minutes away'), 'drafted');
    assert.equal(bar().closed.value, 'Ten minutes away');
    assert.deepEqual(A.readSmsDraft(), {by: 'alpha', text: 'Ten minutes away', canUndo: true, threadId: 'thread:1'});
    assert.equal(render().draftBubble, null, 'no bubble while the chat is closed');
    viewApi.S.chat = 'sheet';
    assert.deepEqual({by: render().draftBubble.by, aria: render().draftBubble.aria, canUndo: render().draftBubble.canUndo}, {by: 'alpha', aria: "Alpha's draft, not sent", canUndo: true});
    assert.equal(bar().strip.subtitle, 'Messages · draft waiting');
    render().draftBubble.undo();
    assert.deepEqual(A.readSmsDraft(), {by: 'owner', text: 'My own words', canUndo: false, threadId: 'thread:1'});
    assert.equal(A.undoSmsDraft(), false, 'one Undo');
    assert.equal(render().draftBubble.aria, 'Your draft, not sent');
    // Edit makes Alpha's text the owner's and returns to the person target.
    A.placeAskedSmsDraft('Running late');
    render().draftBubble.edit();
    assert.equal(A.readSmsDraft().by, 'owner');
    assert.deepEqual(notes, ['toPerson']);
    assert.deepEqual(sends, [], 'nothing is sent without the owner tap on Send');
    // Send on the bubble goes through the same review and journal, once, and is noted quietly.
    A.placeAskedSmsDraft('On my way');
    render().draftBubble.send(tap({'data-alpha-draft-send': ''})); await settle();
    assert.equal(sends.length, 1);
    assert.equal(sends[0].review.body, 'On my way');
    assert.equal(bar().closed.value, '', 'an accepted send clears the slot');
    assert.match(notes.at(-1), /^Sent to /);
    owner.componentWillUnmount();
  } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; globalThis.HTMLButtonElement = priorButton; delete globalThis.__smsBarPort; rmSync(dir, {recursive: true, force: true}); }
});
