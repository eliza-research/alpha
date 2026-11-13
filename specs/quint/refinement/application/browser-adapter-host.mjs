/** The whole Browser adapter (`installPrototypeBrowserAdapter`) installed over a jsdom document, for
 * replaying models of the code that only exists inside its installed closure: the view's render
 * closure, its Back handler, the page actions and the functions it gives the shell.
 *
 * Real code: browser-adapter.ts with the shared tab session, address parser, browsing session and
 * page-reading rules, browser/review.ts, browser-external-handoff.ts, browser-poll.ts and
 * browser-errors.ts. Ports, each a small stand-in the driver controls: the native Browser plugin
 * (every call is recorded and settles when the driver says, or at once for calls listed in
 * `instant`), Capacitor's platform answers, the connection controller, the reading voice, the
 * question review, the web page-text reader and the documents behind the dynamic imports.
 * The shell is a stand-in component holding the Browser view state and the shell state; `sync()`
 * runs the component's render pass as a state change does in the product. */
import {installDocument, loadBundled, settle} from './browser-model-traces.mjs';

const pageSource = '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-source.ts';
const stubs = {
  '../build-flags': 'export const cloudRuntimeEnabled=false,testMocksEnabled=false,devSurfacesEnabled=false;',
  '../platform-plugins': 'export const registerPlugin=()=>globalThis.__alphaBrowserHost.Browser;',
  '@capacitor/core': `const host=()=>globalThis.__alphaBrowserHost;
    export const ExceptionCode={Unimplemented:'UNIMPLEMENTED'};
    export class CapacitorException extends Error{constructor(message,code){super(message);this.code=code;}}
    export const Capacitor={isNativePlatform:()=>host().native,getPlatform:()=>host().native?'android':'web',isPluginAvailable:()=>true};`,
  '../daily': 'export const DailyApps={addListener:()=>Promise.resolve({remove(){}})};',
  '../runtime/native-reading-voice': 'export const createNativeReadingVoice=()=>globalThis.__alphaBrowserHost.voice();',
  '../browser/content-question': 'export const reviewContentQuestion=input=>globalThis.__alphaBrowserHost.question(input);',
  [pageSource]: 'export const readPublicPageSource=(url,signal)=>globalThis.__alphaBrowserHost.pageSource(url,signal);',
  './agent-calendar-adapter': 'export const browserCalendarScope=()=>false;',
  '../runtime/connection-ui': `const host=()=>globalThis.__alphaBrowserHost;
    export const connectionController={subscribe(run){host().connectionListeners.add(run);return()=>host().connectionListeners.delete(run);},getSnapshot:()=>host().connection};
    export const agentPendingText=()=>'Your agent is still starting.';`,
  '../browser/preference-documents': 'export const bookmarkDocument={read:async fallback=>fallback()};',
  '../browser/preference-recovery': 'export const openBookmarkRecovery=()=>{};',
  '../browser/reading-review': 'export const reviewBrowserReading=(...args)=>globalThis.__alphaBrowserHost.readingReview(...args);',
};

let load;
/** `instant`: native calls that succeed at once; every other call waits in `pending`. */
export async function browserAdapterHost({native = true, instant = ['bookmarks', 'browsingState', 'saveBrowsingState', 'present', 'close', 'cancelReading', 'addListener', 'readingSupport', 'clearFind', 'find', 'findNext'], results = {}} = {}) {
  load ||= await loadBundled('apps/app/src/prototype/browser-adapter.ts', stubs);
  const page = await installDocument('<!doctype html><body><div data-alpha-layer="app"></div></body>');
  const extra = {MutationObserver: page.window.MutationObserver, Element: page.window.Element, KeyboardEvent: page.window.KeyboardEvent, AbortController: globalThis.AbortController};
  const previous = Object.keys(extra).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const listeners = {}, calls = [], pending = [], messages = [], opened = [];
  const defaults = {bookmarks: () => ({urls: []}), browsingState: () => ({history: [], tabs: [], cur: ''}), readingSupport: () => ({available: true}), ...results};
  const Browser = new Proxy({}, {get(_target, name) {
    if (name === 'then') return undefined;
    if (name === 'addListener') return (event, run) => { listeners[event] = run; return Promise.resolve({remove() { delete listeners[event]; }}); };
    return input => {
      calls.push({name, input});
      if (instant.includes(name)) return Promise.resolve(defaults[name]?.(input));
      const item = {name, input};
      item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
      pending.push(item);
      return item.promise;
    };
  }});
  const host = globalThis.__alphaBrowserHost = {Browser, native, connection: {open: false, session: true}, connectionListeners: new Set(),
    voice: () => undefined, question: () => { throw new Error('No question review port'); }, pageSource: async () => ({text: ''}), readingReview: async () => {}};
  const views = {browser: {state: {editing: false, addr: '', tabsOpen: false, menu: false, lib: null, share: false, ag: null, confirm: null}, render: () => ({})}};
  const shellState = {screen: 'home', view: 'browser', shade: false, chat: 'closed'};
  const viewOpens = [];
  class Component {
    S() { return shellState; }
    vget(view) { return views[view]?.state; }
    vset(view, patch) { Object.assign(views[view].state, patch); }
    toast(message) { messages.push(message); }
    api(view) { return api(view); }
    openView(...args) { viewOpens.push(args); }
    renderVals() { return {}; }
  }
  const api = view => ({set: patch => Object.assign(views[view].state, patch), get: name => views[name].state, toast: message => messages.push(message), ic: {star: '', clock: ''},
    open: (...args) => { opened.push(args); }, composeContentQuestion: (...args) => { opened.push(['question', ...args]); }});
  const {installPrototypeBrowserAdapter} = await load();
  const dispose = installPrototypeBrowserAdapter(Component, views);
  const component = new Component();
  const state = () => views.browser.state;
  const sync = async () => { component.renderVals(); await settle(); };
  await sync();
  return {state, shellState, component, view: views.browser, listeners, calls, pending, messages, opened, viewOpens, host, page, settle, sync,
    session: () => calls.find(call => call.input?.session)?.input.session,
    /** The Browser view's rendered values (its closures act on the state they were rendered with). */
    rendered: () => views.browser.render(state(), api('browser')),
    back: () => views.browser.back(state(), api('browser')),
    /** Settles the oldest waiting native call of `name`. */
    async settleCall(name, {error, value} = {}) {
      const index = pending.findIndex(item => item.name === name);
      if (index < 0) throw new Error(`no ${name} call is waiting`);
      const [item] = pending.splice(index, 1);
      if (error) item.reject(error instanceof Error ? error : new Error(error)); else item.resolve(value);
      await settle();
      return item;
    },
    waiting: name => pending.filter(item => item.name === name).length,
    emit(event, payload) { listeners[event]?.({session: host.session ?? this.session(), ...payload}); },
    async teardown() {
      dispose(); await settle();
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
      page.restore();
    }};
}
