import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const adapter = new URL('../../apps/app/src/prototype/notifications-adapter.ts', import.meta.url);
const selection = new URL('../../apps/app/src/prototype/context-selection.ts', import.meta.url);
const dialog = new URL('../../apps/app/src/browser/content-question.ts', import.meta.url);
export const shadeNoticeQuestionSources = [import.meta.url, adapter, selection, dialog,
  new URL('../support/strip-types.mjs', import.meta.url), new URL('../../package-lock.json', import.meta.url)].map(fileURLToPath);

const tick = () => new Promise(resolve => setImmediate(resolve));
function range(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'The actual source slice must remain available: ' + start);
  return source.slice(a, b);
}

/** Real adapter, row checks and dialog handlers. Shell and list/composer ports are closed. */
export function shadeNoticeQuestionFixture() {
  const a = readFileSync(adapter, 'utf8'), s = readFileSync(selection, 'utf8');
  const code = stripTypeScriptTypes([range(s, 'const OPAQUE = ', '\n'),
    range(s, 'export const ASKABLE_NOTICE_KINDS', 'export type CaptureSelection'),
    range(a, 'const opaque', 'type Notice ='), a.slice(a.indexOf('export function installNotificationsAdapter')),
    readFileSync(dialog, 'utf8').replace(/^import .*?;?\n/gm, ''), 'installNotificationsAdapter(Shell);',
  ].join('\n').replace(/^export /gm, ''));
  const dom = new JSDOM('<!doctype html><body></body>', {pretendToBeVisual: true});
  const {window} = dom, {document} = window;
  if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.setInterval = () => 1;
  let hidden = false;
  Object.defineProperty(document, 'hidden', {get: () => hidden});
  const rows = ['a', 'b'].map(id => ({id: 'reminder:' + id, revision: 'revision-' + id, source: 'own', kind: 'reminder',
    title: 'Saved ' + id, text: 'Synthetic text ' + id, appLabel: 'Alpha Phone', at: 0, canOpen: true}));
  const requests = [], drafts = [], toasts = [];
  class Shell {
    state = {shade: true, view: 'home', screen: 'home'};
    S() {return this.state;}
    renderVals() {return {ic: {bell: 'icon'}};}
    componentDidMount() {}
    componentDidUpdate() {}
    componentWillUnmount() {}
    setState(patch) {
      const previous = this.state;
      this.state = {...previous, ...patch};
      this.renderVals();
      this.componentDidUpdate(undefined, previous);
    }
    swallowed() {return false;}
    sw() {return {};}
    toast(message) {toasts.push(message);}
    api() {return {composeContentQuestion: text => {
      drafts.push(text);
      this.setState({shade: false, draft: text});
    }};}
  }
  const native = {list() {
    if (shell.alphaNoticesBusy) return Promise.resolve({items: structuredClone(rows)});
    return new Promise((resolve, reject) => requests.push({resolve, reject}));
  }};
  const box = vm.createContext({Shell, window, document, HTMLElement: window.HTMLElement, AbortController, queueMicrotask,
    native, Capacitor: {isNativePlatform: () => false}, sensitiveReadingText: () => false,
    formatTime: () => 'time', clearInterval() {}});
  vm.runInContext(code, box);
  const shell = new Shell();
  shell.componentDidMount();
  shell.alphaNotices = structuredClone(rows);
  const content = () => document.querySelector('dialog [aria-label="Content excerpt"]')?.value || '';
  return {rows, requests, drafts, toasts, content,
    ask(id) {
      const row = shell.renderVals().shadeN.find(row => row.id === 'reminder:' + id);
      assert.ok(row?.canAsk);
      row.ask();
      assert.equal(content(), 'Saved ' + id + '\nSynthetic text ' + id);
    },
    async approve() {
      const button = document.querySelector('[aria-label="Use in conversation"]');
      assert.ok(button && !button.disabled);
      button.click();
      await tick();
      assert.equal(content(), '');
    },
    async finish(index, items = rows) {requests[index].resolve({items: structuredClone(items)});await tick();},
    async refuse(index) {requests[index].reject(Error('Synthetic list unavailable'));await tick();},
    async set(patch) {shell.setState(patch);await tick();},
    async visibility(value) {
      hidden = value;
      document.dispatchEvent(new window.Event('visibilitychange'));
      await tick();
    },
    close() {shell.componentWillUnmount();window.close();},
  };
}
