/** Replays BrowserTabLifecycle traces against the browser adapter's real tab code over the shared
 * tab session: `navigate` with `ensure` (creation, the tab limit, the restored-tab retry),
 * `restoreSession`, `forgetTabs` and the native `tabOpened`/`tabClosed` listeners.
 *
 * Controlled ports: the native Browser plugin (creation, navigation and the saved-record read
 * settle when the model says so), fresh tab identities, and the shell's view state and messages.
 * The tab limit is the model's 3 in both the adapter region and the tab session.
 * Three renderer actions live in the Browser view's render closure, which only exists inside a
 * rendered component; the driver performs them as that closure does: New tab, a tab card's close,
 * and the address bar's editing flag. The poll's "load a restored tab when shown" is the same
 * `navigate` call the poll makes. When the selected tab closes, the adapter selects the first
 * remaining tab (or the opener); the model allows any remaining tab, so the driver then selects the
 * model's choice, which is an ordinary tab pick.
 *
 * Abstraction: tab n is `t<n>`; `created` is the tab session's creations; `native` the tabs the
 * port holds; `nav.stage` the port call in flight; `limitNotice` and `errorShown` the messages
 * shown. `used`, `everRestored`, `gaveUp` and the rest of `nav` are model-only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {parseBrowserAddressInput} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts';
import {browsingSnapshot, restoreBrowsing} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts';
import {BrowserTabSession} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
import {modelTraces, replayTraces, repositoryRoot, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/BrowserTabLifecycle.qnt', module: 'BrowserTabLifecycle'};
const scenarios = ['restoredTabsCountTowardLimitTest', 'limitRecheckedAfterCreateTest', 'restoreRetryThenReportTest', 'typingKeepsOpenTabTest', 'closeDuringCreateTest', 'loadedRestoreClearsAttemptsTest'];
const witnesses = ['RetryPendingWitness', 'RendererFullNativeEmptyWitness', 'GaveUpWitness', 'TypedTabKeptWitness', 'LimitRefusedPopupWitness'];
const Cap = 3, Ids = Array.from({length: 10}, (_, index) => index + 1), limitMessage = 'Close a tab before opening another.';
const name = id => `t${id}`, number = id => Number(String(id).slice(1)), sorted = ids => [...ids].map(number).sort((a, b) => a - b);

export async function browserTabLifecycleDriver() {
  const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(join(repositoryRoot, path), 'utf8'))).toString('base64'));
  const {createSessionSaver} = await load('apps/app/src/browser/browser-poll.ts');
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const slice = (from, to) => { const start = adapter.indexOf(from), end = adapter.indexOf(to, start); assert.ok(start >= 0 && end > start, `the adapter no longer has ${from}`); return stripTypeScriptTypes(adapter.slice(start, end)); };
  const region = [slice('  function ensure(', '  async function command('), slice('  function forgetTabs(ids', '  async function confirmBrowser('),
    slice("  void Browser.addListener('tabOpened',", "  void Browser.addListener('notice',")].join('\n');
  return () => {
    const session = 'session', tabs = new BrowserTabSession({session, maxTabs: Cap});
    const state = {tabs: [{id: name(1), hist: ['newtab'], pos: 0}], cur: name(1), visits: [], editing: false};
    const native = new Set(), messages = [], calls = [], listeners = {};
    let fresh, read;
    const call = (kind, id) => { const item = {kind, id}; item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; }); calls.push(item); return item.promise; };
    const context = {URL, MAX_TABS: Cap, parseBrowserAddressInput, browsingSnapshot, restoreBrowsing, createSessionSaver, tabs, session, restored: new Map(), restoreAttempts: new Map(),
      disposed: false, sessionRead: false, sessionHydrated: false, clearingData: false, profileUnsupportedTab: undefined, PROFILE_UNSUPPORTED_NATIVE_MESSAGE: 'unsupported',
      Capacitor: {isNativePlatform: () => true}, state: () => state, tabInfo: id => tabs.info(id), isPrivate: () => false, unimplemented: () => false, refresh() {},
      newTabId: () => { assert.ok(fresh, 'a fresh tab identity is asked for only when the model supplies one'); const id = fresh; fresh = undefined; return id; },
      report: error => messages.push(error.message),
      shell: {vset(_view, patch) { Object.assign(state, patch); }, toast: message => messages.push(message)},
      Browser: {
        create: ({id}) => call('create', id), navigate: ({id}) => call('navigate', id),
        async close({id}) { native.delete(id); },
        browsingState: () => new Promise(resolve => { read = resolve; }), async saveBrowsingState() {},
        addListener(event, run) { listeners[event] = run; return Promise.resolve({remove() {}}); },
      }};
    const run = vm.runInNewContext('(function(){' + region + ';return {navigate, restoreSession, forgetTabs};})()', context);
    const start = (...args) => { void run.navigate(...args).catch(error => messages.push(`unhandled: ${error.message}`)); };
    // The model's choice of the tab selected after the selected tab closed.
    const select = (id, step) => {
      const rest = step.before.tabs.filter(tab => tab !== id);
      if (step.before.cur !== id || !rest.length) return;
      assert.ok(rest.includes(number(state.cur)), 'the adapter selects a remaining tab');
      state.cur = name(step.after.cur);
    };
    return {
      async hydrate(saved, selected) {
        const reading = run.restoreSession(); await settle();
        read({history: [], tabs: saved.map(id => ({id: name(id), url: `https://example.test/saved-${id}`, title: `Saved ${id}`})), cur: saved.includes(selected) ? name(selected) : ''});
        await reading; await settle();
      },
      openTab(id) {
        if (state.tabs.length >= Cap) { messages.push(limitMessage); return; }
        Object.assign(state, {tabs: [...state.tabs, {id: name(id), hist: ['newtab'], pos: 0}], cur: name(id), tabsOpen: false, menu: false, editing: true, addr: ''});
      },
      setEditing(on) { state.editing = on; },
      pick(id) { Object.assign(state, {cur: name(id), tabsOpen: false}); },
      async navigateStart(...args) {
        const step = args.at(-1), [newTab, , id] = args.length === 4 ? args : [step.picks.id !== step.before.cur, false, step.picks.id];
        if (newTab) fresh = name(id);
        start('https://example.test/typed', newTab);
        await settle(); fresh = undefined;
      },
      async restoredShown() { start(context.restored.get(state.cur).url, false, undefined, false, true); await settle(); },
      async createSettles(ok) {
        const item = calls.shift(); assert.equal(item.kind, 'create');
        if (ok) { native.add(item.id); item.resolve(); } else item.reject(new Error('The tab could not be created.'));
        await settle();
      },
      async navigateSettles(ok) {
        const item = calls.shift(); assert.equal(item.kind, 'navigate');
        if (ok) item.resolve(); else item.reject(new Error('The page could not be opened.'));
        await settle();
      },
      async closeTab(id, fallback, _successor, step) {
        const rest = state.tabs.filter(tab => tab.id !== name(id));
        if (tabs.has(name(id))) void context.Browser.close({session, id: name(id)});
        tabs.forget([name(id)]); context.restored.delete(name(id));
        Object.assign(state, {tabs: rest.length ? rest : [{id: name(fallback), hist: ['newtab'], pos: 0}], cur: state.cur === name(id) ? (rest[0]?.id || name(fallback)) : state.cur});
        select(id, step); await settle();
      },
      async nativeTabOpened(id) { native.add(name(id)); listeners.tabOpened({session, id: name(id), opener: state.cur}); await settle(); },
      async nativeTabClosed(id, fallback, _successor, step) {
        native.delete(name(id)); fresh = name(fallback);
        listeners.tabClosed({session, id: name(id)}); fresh = undefined;
        select(id, step); await settle();
      },
      observe() {
        assert.ok(calls.length <= 1, 'the model keeps one creation or navigation in flight');
        return {tabs: sorted(state.tabs.map(tab => tab.id)), cur: number(state.cur), editing: !!state.editing, created: sorted(tabs.ids()), native: sorted(native),
          restored: sorted(context.restored.keys()), attempts: Object.fromEntries(Ids.map(id => [id, context.restoreAttempts.get(name(id)) || 0])),
          stage: calls[0] ? (calls[0].kind === 'create' ? 'creating' : 'navigating') : 'none', hydrated: context.sessionHydrated,
          limitNotice: messages.includes(limitMessage), errorShown: messages.some(message => message !== limitMessage)};
      },
    };
  };
}

export async function checkBrowserTabLifecycle({random = 60, steps = 40} = {}) {
  const create = await browserTabLifecycleDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps, evaluate: text => {
    const set = /^Set\(([\d, ]*)\)$/.exec(text);
    if (set) return set[1].split(',').map(item => item.trim()).filter(Boolean).map(Number);
    if (text === 'Home') return 1;
    throw Error(`Scenario argument ${text}`);
  }});
  return replayTraces(traces, create, {project: s => ({tabs: s.tabs, cur: s.cur, editing: s.editing, created: s.created, native: s.native, restored: s.restored, attempts: s.attempts,
    stage: s.nav.stage, hydrated: s.hydrated, limitNotice: s.limitNotice, errorShown: s.errorShown})});
}
