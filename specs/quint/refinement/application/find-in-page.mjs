/** Replays FindInPage traces against the browser adapter's real find bar code (`openFind`,
 * `closeFind`, `findQuery`, its debounce and the `findResult` listener) over the shared tab session.
 *
 * Controlled ports: the debounce timer and the native tab host. The host is a stand-in that keeps
 * the contract the model states for it: a search exists per tab, a non-empty `find` starts one and
 * an empty one ends it, `clearFind`, a navigation and a tab no longer shown end it and queue one
 * cleared event, and a closed tab is dropped without an event. What is checked against the model is
 * therefore the renderer: the bar's state, when it searches or clears, and which events it obeys.
 * Abstraction: tab n is `t<n>`; `count` is whether matches are shown; `queryVersion`, the timer's
 * captured values and the two ghost flags are model-only. Closing a tab is performed as the tab
 * switcher does it (forget the native tab, drop the row, select the other). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {BrowserTabSession} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
import {modelTraces, replayTraces, repositoryRoot, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/FindInPage.qnt', module: 'FindInPage'};
const scenarios = ['tabSwitchDuringDebounceTest', 'switchClearsActiveSearchTest', 'navigationClearsSearchTest', 'emptyBarOutlivesSwitchTest', 'closeFindClearsNativeSearchTest'];
const witnesses = ['HiddenFindBarWitness', 'FindBarOnClosedTabWitness', 'EarlierTextSearchedWitness', 'ClearedEventPendingWitness'];
const name = id => `t${id}`, number = id => id ? Number(String(id).slice(1)) : 0;

export async function findInPageDriver() {
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const slice = (from, to) => { const start = adapter.indexOf(from), end = adapter.indexOf(to, start); assert.ok(start >= 0 && end > start, `the adapter no longer has ${from}`); return stripTypeScriptTypes(adapter.slice(start, end)); };
  const region = slice('  let findTimer = 0;', '  async function sharePage() {') + '\n' + slice("  void Browser.addListener('findResult',", "  // A page's video fullscreen");
  return async () => {
    const session = 'session', tabs = new BrowserTabSession({session});
    const state = {tabs: [{id: 't1'}, {id: 't2'}], cur: 't1', finding: false, findTab: null, findQuery: '', findCount: 0, findIndex: 0, findDone: true};
    for (const id of ['t1', 't2']) {
      await tabs.ensure(id, false, async () => undefined);
      tabs.applyState({session, id, sequence: 1, navigation: 1, url: `https://example.test/${id}`, title: id, committed: true, loading: false, error: ''});
    }
    const native = {presented: 1, searches: new Set(), events: []}, reports = [];
    let timer, timers = 0, listener;
    const clear = ids => { for (const id of ids) if (native.searches.delete(id)) native.events.push({id, cleared: true}); };
    const context = {session, tabs, disposed: false, tabInfo: id => tabs.info(id), state: () => state, report: error => reports.push(error.message),
      shell: {vset(_view, patch) { Object.assign(state, patch); }},
      window: {setTimeout(run) { timer = {run, id: ++timers}; return timer.id; }, clearTimeout(id) { if (timer?.id === id) timer = undefined; }},
      Browser: {
        async find({id, query}) { if (query) native.searches.add(number(id)); else native.searches.delete(number(id)); },
        async clearFind({id}) { clear([number(id)]); },
        async findNext() {},
        addListener(event, run) { assert.equal(event, 'findResult'); listener = run; return Promise.resolve({remove() {}}); },
      }};
    const run = vm.runInNewContext('(function(){' + region + ';return {openFind, closeFind, findQuery};})()', context);
    const alive = () => state.tabs.map(tab => number(tab.id));
    return {
      async openFind() { run.openFind(); await settle(); },
      async closeFind() { run.closeFind(); await settle(); },
      async typeQuery(nonEmpty) { run.findQuery(nonEmpty ? 'harbour' : ''); await settle(); },
      async timerFires() { const due = timer; timer = undefined; due.run(); await settle(); },
      nativeResult(id) { native.events.push({id, cleared: false}); },
      async deliver() {
        const event = native.events.shift();
        listener(event.cleared ? {session, id: name(event.id), cleared: true} : {session, id: name(event.id), count: 3, index: 1, done: true});
        await settle();
      },
      pick(id) { state.cur = name(id); },
      present(hidden) { native.presented = hidden ? 0 : number(state.cur); clear(alive().filter(id => id !== native.presented).sort((a, b) => a - b)); },
      navigate(id) { clear([id]); },
      closeTab(id) {
        tabs.forget([name(id)]);
        const rest = state.tabs.filter(tab => tab.id !== name(id));
        Object.assign(state, {tabs: rest, cur: state.cur === name(id) ? rest[0].id : state.cur});
        native.searches.delete(id); if (native.presented === id) native.presented = 0;
      },
      observe: () => ({alive: alive().sort((a, b) => a - b), cur: number(state.cur), presented: native.presented, finding: !!state.finding, findTab: number(state.findTab),
        hasQuery: !!state.findQuery, count: state.findCount > 0 ? 1 : 0, timerArmed: !!timer, nativeQuery: [...native.searches].sort((a, b) => a - b),
        events: native.events.map(event => ({...event})), reports: reports.length}),
    };
  };
}

export async function checkFindInPage({random = 40, steps = 30} = {}) {
  const create = await findInPageDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({alive: s.alive, cur: s.cur, presented: s.presented, finding: s.finding, findTab: s.findTab, hasQuery: s.hasQuery,
    count: s.count, timerArmed: s.timerArmed, nativeQuery: s.nativeQuery, events: s.events.map(event => ({id: event.id, cleared: event.cleared})), reports: 0})});
}
