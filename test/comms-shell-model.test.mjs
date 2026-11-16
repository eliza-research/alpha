import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// AP-16 shell decisions in the shipped model (prototype/model.js): which chat a comms view rests on,
// proposals, stage switches and the Back order (docs/agentic-comms.md AC-05, AC-06, AC-19, AC-26).
// Browser behaviour is in test/browser/comms-shell.spec.ts.
const model = readFileSync('apps/app/src/prototype/model.js', 'utf8');
const {proposalCanAct} = await import('../apps/app/src/runtime/comms-bar.ts');
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
/** Source of one shell class method: from its name to the brace that closes its body. */
function method(name) {
  const start = model.indexOf(`\n  ${name}(`);
  assert.ok(start >= 0, `${name} is a shell method`);
  let depth = 0, quote = null;
  for (let i = model.indexOf('{', model.indexOf(')', start)); i < model.length; i++) {
    const c = model[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && model[i + 1] === '/') { i = model.indexOf('\n', i); continue; }
    if (c === '/' && model[i + 1] === '*') { i = model.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return model.slice(start + 1, i + 1);
  }
  assert.fail(`${name} has a closed body`);
}
const METHODS = ['isCommsView', 'commsSpec', 'defaultChat', 'shellDetent', 'nextMessageId', 'stage', 'stageBack', 'stageSwitched', 'propose', 'cardAct', 'back'];

/** A shell over plain state with recorded navigation; setState applies at once, like a committed update. */
function shell(state, views) {
  const log = {opened: [], navigated: [], toasts: [], acted: []};
  const ctx = vm.createContext({Object, JSON, Number, Date, isMvpView: () => true, proposalCanAct, DEFERRED_MVP_VIEWS: new Set(), VIEWS: views});
  vm.runInContext(`globalThis.shell={${METHODS.map(method).join(',\n')}};`, ctx);
  const s = ctx.shell;
  state = {screen: 'home', chat: 'input', msgs: [], stack: [], stageFrom: [], vs: {}, voice: 'off', ...state};
  Object.assign(s, {
    S: () => state, props: {},
    setState(patch) { Object.assign(state, typeof patch === 'function' ? patch(state) : patch); },
    vget: key => (state.vs || {})[key] || {}, api: key => ({key}), mod: key => views[key] || {},
    openView(view, patch, chat, options) { log.opened.push([view, patch, chat, options]); state.view = view; if (chat) state.chat = chat; },
    shellNavigate(action) { log.navigated.push(action); const chat = action.detent === 'rest' ? 'input' : action.detent; return {chat, ...(chat === 'sheet' || chat === 'full' ? {} : {stageFrom: []})}; },
    toast: text => log.toasts.push(text), stopVoice() {}, goHome() {},
  });
  return {s, state: () => state, log};
}
const bar = (extra = {}) => () => ({target: {kind: 'thread', app: 'Messages', name: 'Maya Chen', first: 'Maya', initials: 'MC'}, emergency: false, ...extra});
const proposal = id => ({id, kind: 'call', title: 'Call Maya', detail: '(555) 010-0100', button: 'Call', acts: true, act: {mod: 'phone', fn: 'callApproved'}, args: {pid: 'maya'}});

test('a comms view rests on its bar: never the pill, by any default', () => {
  const views = {messages: {bar: bar()}, notes: {}, inbox: {chat: 'input'}};
  const {s} = shell({}, views);
  same(['messages', 'notes', 'inbox'].map(key => s.defaultChat(key)), ['input', 'hidden', 'input']);
  same([s.shellDetent('hidden', 'messages'), s.shellDetent('hidden', 'notes'), s.shellDetent('sheet', 'messages'), s.shellDetent(undefined, 'messages')], ['input', 'pill', 'sheet', undefined]);
  // A bar that throws makes the view non-comms for that render, never the whole shell.
  const broken = shell({view: 'messages'}, {messages: {bar: () => { throw Error('bad'); }}});
  assert.equal(broken.s.commsSpec('messages'), null);
  assert.match(method('cardAct'), /c\.go\.chat \|\| self\.defaultChat\(c\.go\.view\)/);
  assert.doesNotMatch(method('cardAct'), /\|\| "hidden"/);
});

test('a newer proposal replaces the open one, which never acts; a finished one never acts again', () => {
  const acted = [];
  const views = {messages: {bar: bar()}, phone: {actions: {callApproved: card => acted.push(card.id)}}};
  const {s, state} = shell({view: 'messages', chat: 'input'}, views);
  same(s.propose(proposal('a'), 'Call Maya?'), {shown: true, replaced: []});
  assert.equal(state().chat, 'sheet');
  const second = s.propose(proposal('b'));
  same(second.replaced.map(item => item.id), ['a']);
  assert.equal(second.replaced[0].type, undefined, 'replaced entries are plain proposals');
  same(state().msgs.map(m => [m.text, m.card.state]), [['Call Maya?', 'replaced'], ['Call Maya', 'open']]);
  s.cardAct(state().msgs[0]);
  same(acted, [], 'a replaced proposal is a no-op through cardAct');
  s.cardAct(state().msgs[1]);
  same(acted, ['b']);
  same([state().msgs[1].card.state, state().msgs[1].card.done], ['done', true]);
  s.cardAct(state().msgs[1]);
  same(acted, ['b'], 'a done proposal never acts again');
  assert.equal(proposalCanAct({type: 'generic'}), true, 'other cards are unaffected');
});

test('over an emergency call no acting proposal is shown; a note-only one still is', () => {
  const {s, state} = shell({view: 'phone', chat: 'input'}, {phone: {bar: bar({emergency: true})}});
  same(s.propose(proposal('a')), {shown: false, replaced: []});
  same(state().msgs, []);
  assert.equal(state().chat, 'input');
  assert.equal(s.propose({...proposal('n'), acts: false}).shown, true);
});

test('a stage switch keeps the chat and the Back stack; Back returns the stage, then closes the chat', () => {
  const views = {messages: {bar: bar()}, phone: {bar: bar({target: {kind: 'call', app: 'Phone'}})}};
  const {s, state, log} = shell({view: 'messages', chat: 'sheet', stack: ['contacts']}, views);
  s.stage('phone', {call: 'maya'}, {thread: 'maya'});
  same(state().stageFrom, [{view: 'messages', title: 'Messages', patch: {thread: 'maya'}}]);
  same(log.opened.at(-1), ['phone', {call: 'maya'}, 'sheet', {keepState: true}]);
  same(state().stack, ['contacts']);
  // Full lowers to the sheet first.
  state().chat = 'full';
  s.back();
  same(log.navigated.at(-1), {type: 'assistant', detent: 'sheet'});
  assert.equal(state().chat, 'sheet');
  s.back();
  same(log.opened.at(-1), ['messages', {thread: 'maya'}, 'sheet', {keepState: true}]);
  same([state().view, state().chat, state().stageFrom, state().stack], ['messages', 'sheet', [], ['contacts']]);
  s.back();
  same(log.navigated.at(-1), {type: 'assistant', detent: 'rest'});
  same([state().view, state().chat, state().stageFrom], ['messages', 'input', []]);
  assert.equal(s.stageBack(), false, 'nothing to return to');
});
