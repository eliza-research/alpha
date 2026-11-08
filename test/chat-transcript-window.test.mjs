// The chat renders only the newest rows of a long conversation. The real dc-lite renderer and
// template run in jsdom with the shell's own window methods; rows are counted in the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const slice = (source, start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); };

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'navigator', 'SVGElement', 'DocumentFragment', 'MutationObserver', 'Event'])
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const React = require('react'), { createRoot } = require('react-dom/client'), { flushSync } = require('react-dom');

// dc-lite without its bundler imports; jsdom cannot parse the template's CSS, so inline styles are dropped.
const lite = read('apps/app/src/prototype/dc-lite.js')
  .replace(/^import \{iconStyle\}.*\n/m, 'const iconStyle=()=>({});\n').replace(/^import React.*\n/m, '').replace(/^import templateHtml.*\n/m, '')
  .replace('export class DCLogic', 'class DCLogic');
const DCLogic = new Function('React', 'templateHtml', lite + '\n;return DCLogic;')(React, read('apps/app/src/prototype/template.html').replace(/ style="[^"]*"/g, ''));
const model = read('apps/app/src/prototype/model.js');
const constants = slice(model, 'var CHAT_CLOSED_ROWS', '\n');
const methods = slice(model, '  transcriptWindow(msgs, open) {', '  getSnapshotBeforeUpdate(');

const Shell = new Function('DCLogic', `${constants}
  return class Shell extends DCLogic {
    constructor(props) { super(props); this.state = { chat: 'input', msgs: props.msgs }; }
    S() { return this.state; }
    componentDidMount() { var self = this; this.chatWindowScroll = function (event) { self.growChatWindow(event.target); }; document.addEventListener('scroll', this.chatWindowScroll, true); }
    componentWillUnmount() { document.removeEventListener('scroll', this.chatWindowScroll, true); }
${methods}
    renderVals() {
      var S = this.S(), open = S.chat === 'sheet' || S.chat === 'full' || !!this.chatMotion;
      return { isOn: true, ic: {}, draft: '', msgs: this.transcriptWindow(S.msgs, open).map(function (m) { return { id: m.id, text: m.text, displayText: m.text, hasCalendarText: true, isUser: m.from === 'user', isAgent: m.from === 'agent', c: {}, rows: [], bullets: [], calendarReviews: [] }; }) };
    }
  };`)(DCLogic);

const conversation = (count, prefix = 'm') => Array.from({ length: count }, (_, i) => ({ id: prefix + i, from: i % 2 ? 'agent' : 'user', text: 'Message ' + i }));
function mount(msgs) {
  const element = document.createElement('div'); document.body.appendChild(element);
  const root = createRoot(element); let shell;
  flushSync(() => root.render(React.createElement(Shell, { msgs, ref: value => { shell = value; } })));
  const ids = () => Array.from(element.querySelectorAll('[data-alpha-message-id]'), row => row.getAttribute('data-alpha-message-id'));
  const set = patch => flushSync(() => shell.setState(patch));
  const scrollToTop = () => { const list = element.querySelector('[data-alpha-transcript]'); list.scrollTop = 0; flushSync(() => list.dispatchEvent(new Event('scroll'))); };
  return { shell, ids, set, scrollToTop, unmount: () => { root.unmount(); element.remove(); } };
}

test('a closed chat renders only the newest 20 rows, an open one the newest 100', () => {
  const t = mount(conversation(300));
  assert.equal(t.ids().length, 20);
  assert.equal(t.ids().at(-1), 'm299', 'the newest row, including a streaming one, stays in the bar window');
  t.set({ chat: 'sheet' });
  assert.equal(t.ids().length, 100); assert.equal(t.ids()[0], 'm200');
  t.set({ chat: 'full' });
  assert.equal(t.ids().length, 100);
  t.unmount();
});

test('a drag from the bar renders the open window before chat settles open', () => {
  const t = mount(conversation(300));
  t.shell.chatMotion = { moved: true };
  t.set({});
  assert.equal(t.ids().length, 100);
  t.unmount();
});

test('scrolling to the top of a restored 300-message conversation reaches its first message', () => {
  const t = mount(conversation(300));
  t.set({ chat: 'sheet' });
  t.scrollToTop(); assert.equal(t.ids().length, 200); assert.equal(t.ids()[0], 'm100');
  t.scrollToTop(); assert.equal(t.ids().length, 300); assert.equal(t.ids()[0], 'm0');
  t.scrollToTop(); assert.equal(t.ids().length, 300, 'nothing older to show');
  t.unmount();
});

test('scrolling a closed chat does not grow the window, and a new conversation starts over', () => {
  const t = mount(conversation(300));
  t.scrollToTop(); assert.equal(t.ids().length, 20);
  t.set({ chat: 'sheet' }); t.scrollToTop(); assert.equal(t.ids().length, 200);
  t.set({ chat: 'input' }); assert.equal(t.ids().length, 20);
  t.set({ chat: 'sheet' }); assert.equal(t.ids().length, 200, 'reopening keeps the older rows the owner loaded');
  t.set({ msgs: conversation(300, 'n') });
  assert.equal(t.ids().length, 100); assert.equal(t.ids()[0], 'n200');
  t.unmount();
});

test('a short conversation renders whole', () => {
  const t = mount(conversation(12));
  assert.equal(t.ids().length, 12);
  t.set({ chat: 'sheet' }); t.scrollToTop(); assert.equal(t.ids().length, 12);
  t.unmount();
});
