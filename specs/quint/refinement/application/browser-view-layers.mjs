/** Replays BrowserViewLayers traces against the installed Browser adapter: the rendered controls
 * (the menu button, the switcher, the library, New tab, a tab card's pick and close, the address
 * field's start, Enter and Escape, Find), the view's Back handler, and the native pop-up and
 * fullscreen listeners.
 *
 * Native creation and navigation succeed at once, and the page's committed state is reported as
 * the tab host reports it. Abstraction: model tab n is the n-th tab identity the adapter produced;
 * `loaded` and `backable` are observed for the selected tab through what its controls offer. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces} from './browser-model-traces.mjs';
import {browserAdapterHost} from './browser-adapter-host.mjs';

const model = {path: 'specs/quint/application/BrowserViewLayers.qnt', module: 'BrowserViewLayers'};
const scenarios = ['backClosesLayersInOrderTest', 'newTabAtLimitTest', 'closingSelectedCardSelectsFirstTest', 'popupClosesLayersTest', 'menuEndsEditingTest', 'bareBackIsUnhandledTest'];
const witnesses = ['HistoryBackWitness', 'UnhandledBackWitness', 'LimitNoticeWitness', 'MenuOverLibraryWitness', 'FindBarOffTabWitness'];
const limitMessage = 'Tab limit';

export async function browserViewLayersDriver() {
  return async () => {
    const host = await browserAdapterHost({instant: ['bookmarks', 'browsingState', 'saveBrowsingState', 'present', 'close', 'cancelReading', 'readingSupport', 'clearFind', 'find', 'findNext', 'create', 'navigate', 'command']});
    const state = host.state, ids = new Map([[1, 'b0']]);
    let used = 1, sequence = 0, lastBack = 'none';
    const number = real => real ? [...ids].find(([, id]) => id === real)?.[0] ?? 0 : 0;
    const visible = () => state().tabs;
    const adopt = () => { for (const tab of visible()) if (!number(tab.id)) ids.set(++used, tab.id); };
    const card = id => host.rendered().tabCards.find(item => item.id === ids.get(id));
    const act = async run => { lastBack = 'none'; await run(); adopt(); await host.sync(); };
    return {
      toggleMenu: () => act(() => host.rendered().toggleMenu()),
      openTabs: () => act(() => host.rendered().openTabs()),
      closeTabs: () => act(() => host.rendered().closeTabs()),
      openLibrary: () => act(() => host.rendered().openLib()),
      showLibrary: list => act(() => list === 'history' ? host.rendered().libHist() : host.rendered().libMarks()),
      closeLibrary: () => act(() => host.rendered().closeLib()),
      startEdit: () => act(() => host.rendered().startEdit()),
      escapeEdit: () => act(() => host.rendered().onAddrKey({key: 'Escape', preventDefault() {}, target: {value: ''}})),
      submitAddress: canBack => act(async () => {
        const id = state().cur, url = `https://example.test/page-${++sequence}`;
        host.rendered().onAddrKey({key: 'Enter', preventDefault() {}, target: {value: url}});
        await host.settle();
        host.emit('stateChanged', {id, sequence, navigation: `n${sequence}`, url, title: 'Page', committed: true, loading: false, error: '', canBack});
      }),
      newTab: () => act(() => host.rendered().newTab()),
      pick: id => act(() => card(id).pick()),
      closeCard: id => act(() => card(id).close()),
      openFind: () => act(() => host.rendered().openFind()),
      closeFind: () => act(() => host.rendered().find.close()),
      popupOpened: () => act(() => { const id = `popup${used + 1}`; if (visible().length >= 8) used++; host.emit('tabOpened', {id, opener: state().cur}); }),
      fullscreen: () => act(() => host.emit('fullscreen', {id: state().cur, active: true})),
      async back() {
        const before = {...state()}, commands = host.calls.filter(call => call.name === 'command').length;
        const handled = host.back(); await host.sync();
        const after = state(), sent = host.calls.filter(call => call.name === 'command').slice(commands);
        const closed = ['finding', 'editing', 'tabsOpen', 'menu', 'lib'].filter(key => !!before[key] && !after[key]);
        assert.ok(closed.length <= 1, 'one Back press closes at most one layer');
        assert.equal(handled, closed.length === 1 || sent.length === 1, 'Back is taken exactly when it did something');
        if (sent.length) assert.deepEqual([sent.length, sent[0].input.command, sent[0].input.id], [1, 'back', after.cur]);
        lastBack = closed.length ? {finding: 'find', editing: 'editing', tabsOpen: 'tabs', menu: 'menu', lib: 'library'}[closed[0]] : sent.length ? 'history' : 'unhandled';
      },
      observe() {
        const s = state(), out = host.rendered();
        assert.equal(!!s.finding, !!s.findTab, 'the find bar and its tab are set together');
        assert.equal(!!s.share, false, 'the share layer is never opened by the installed view');
        return {tabs: visible().map(tab => number(tab.id)), cur: number(s.cur), used, selectedLoaded: !!out.canFind, selectedBackable: out.backOp === 1,
          editing: !!s.editing, tabsOpen: !!s.tabsOpen, menu: !!s.menu, lib: s.lib || 'none', findTab: number(s.findTab),
          limitNotice: host.messages.includes(limitMessage), lastBack, onlyLimitMessages: host.messages.every(message => message === limitMessage)};
      },
      teardown: () => host.teardown(),
    };
  };
}

export async function checkBrowserViewLayers({random = 40, steps = 30} = {}) {
  const create = await browserViewLayersDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({tabs: s.tabs, cur: s.cur, used: s.used, selectedLoaded: s.loaded.includes(s.cur), selectedBackable: s.backable.includes(s.cur),
    editing: s.editing, tabsOpen: s.tabsOpen, menu: s.menu, lib: s.lib, findTab: s.findTab, limitNotice: s.limitNotice, lastBack: s.lastBack, onlyLimitMessages: true})});
}
