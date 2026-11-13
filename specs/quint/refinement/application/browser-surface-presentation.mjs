/** Replays BrowserSurfacePresentation traces against the browser adapter's real presentation code:
 * the poll's `update`, the render-time `hide`, and `presentBrowser` with its answer handling.
 *
 * Controlled ports: the native `present` call (answered when the model says so), the measured page
 * rectangle, the shell's view and the document's visibility. Abstraction: a request is 0 when it
 * withdraws the page and otherwise the geometry number of its width; `lastRequest` is the adapter's
 * last sent request (-1 when forgotten); `acknowledged` is the request it keeps for blocking page
 * input; `native` is what the port last accepted; `reports` are the errors shown and `recoveries`
 * the times a shown failure was followed by an accepted request. The overlay is the Browser menu. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/BrowserSurfacePresentation.qnt', module: 'BrowserSurfacePresentation'};
const scenarios = ['staleAnswerIgnoredTest', 'overlayWithdrawsTest', 'failureReportedOnceTest', 'hiddenAppKeepsPageTest', 'idleOffBrowserTest', 'sameGeometryNotResentTest'];
const witnesses = ['StaleAnswerPendingWitness', 'RetryAfterFailureWitness', 'KeptWhileAppHiddenWitness'];
const widths = {1: 320, 2: 400};

export async function browserSurfacePresentationDriver() {
  const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(join(repositoryRoot, path), 'utf8'))).toString('base64'));
  const {surfacePollIdle} = await load('apps/app/src/browser/browser-poll.ts');
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const slice = (from, to) => { const start = adapter.indexOf(from), end = adapter.indexOf(to, start); assert.ok(start >= 0 && end > start, `the adapter no longer has ${from}`); return stripTypeScriptTypes(adapter.slice(start, end)); };
  const region = slice('  function hide() {', '  function ensure(') + '\n' + slice('  const nativeUnderlay =', '  const openBrowserView =');
  return () => {
    const view = {view: 'notes', screen: 'home', chat: 'pill'}, state = {cur: 'selected'}, attributes = new Map(), errors = [], calls = [];
    let width = widths[1], ready = false, native = 0, recoveries = 0;
    const rect = () => ({x: 0, y: 0, width, height: 500, bottom: 500, top: 0});
    const element = {offsetWidth: 320, isConnected: true, getClientRects: () => [rect()], getBoundingClientRect: rect};
    const dock = {offsetWidth: 100, closest: () => null, getBoundingClientRect: () => ({x: 0, y: 400, width: 100, height: 60})};
    const document = {hidden: false, documentElement: {hasAttribute: () => false, setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name),
      removeAttribute: name => attributes.delete(name), style: {setProperty() {}, removeProperty() {}}}, querySelector: () => element, querySelectorAll: () => [dock]};
    const number = payload => payload.id ? Number(Object.entries(widths).find(([, value]) => value === payload.width)[0]) : 0;
    const context = {document, surfacePollIdle, hiddenGeometry: JSON.stringify({session: 'session', id: null}), disposed: false, questionReview: false, confirming: false, clearingData: false, reading: false,
      session: 'session', lastGeometry: '', lastPresented: undefined, presentationFailed: false, presentationFrame: undefined, report: error => errors.push(error.message),
      getComputedStyle: () => ({display: 'block', visibility: 'visible', pointerEvents: 'auto', opacity: '1', borderTopLeftRadius: '30px'}), hostModalOpen: () => false,
      Capacitor: {isNativePlatform: () => true, getPlatform: () => 'android'}, shell: {S: () => view}, state: () => state, restored: new Map(), tabs: {has: () => ready},
      saveSession() {}, stopReading() {},
      Browser: {present(payload) { const call = {payload, number: number(payload)}; call.promise = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; }); calls.push(call); return call.promise; }}};
    const run = vm.runInNewContext('(function(){' + region + ';return {update, hide};})()', context);
    return {
      async poll(geometry) { width = widths[geometry]; void run.update(); await settle(); },
      // A render off the Browser or under the menu withdraws the page at once.
      async withdraw() { run.hide(); await settle(); },
      async answer(ok) {
        const call = calls.shift(), failedBefore = context.presentationFailed;
        if (ok) { native = call.number; call.resolve(); } else call.reject(new Error('Presentation refused'));
        await settle();
        if (failedBefore && !context.presentationFailed) recoveries++;
      },
      forget() { context.lastGeometry = ''; },
      enterBrowser() { view.view = 'browser'; },
      leaveBrowser() { view.view = 'notes'; },
      setOverlay(shown) { state.menu = shown; },
      setAppHidden(hidden) { document.hidden = hidden; },
      tabCreated() { ready = true; },
      dispose() { context.disposed = true; },
      observe: () => ({inBrowser: view.view === 'browser', overlay: !!state.menu, appHidden: document.hidden, tabReady: ready, disposed: context.disposed,
        lastRequest: context.lastGeometry === '' ? -1 : number(JSON.parse(context.lastGeometry)), unanswered: calls.map(call => call.number),
        acknowledged: context.lastPresented ? number(context.lastPresented) : 0, native, failed: context.presentationFailed, reports: errors.length, recoveries,
        backdrop: attributes.has('data-alpha-browser-underlay')}),
    };
  };
}

export async function checkBrowserSurfacePresentation({random = 40, steps = 30} = {}) {
  const create = await browserSurfacePresentationDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  // The page backdrop is cleared exactly while the adapter holds an acknowledged page.
  return replayTraces(traces, create, {project: s => ({inBrowser: s.inBrowser, overlay: s.overlay, appHidden: s.appHidden, tabReady: s.tabReady, disposed: s.disposed,
    lastRequest: s.lastRequest, unanswered: s.unanswered, acknowledged: s.acknowledged, native: s.native, failed: s.failed, reports: s.reports, recoveries: s.recoveries,
    backdrop: s.acknowledged !== 0})});
}
