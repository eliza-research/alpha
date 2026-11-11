import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// The saved-browsing and tab-session models are the shared ones; the harnesses run the real code.
import {browsingSnapshot, restoreBrowsing, DEFAULT_BROWSING_LIMITS} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts';
import {BrowserTabSession} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';


const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(path, 'utf8'))).toString('base64'));
const {createSessionSaver, saveRetryDelay, surfacePollIdle} = await load('apps/app/src/browser/browser-poll.ts');
const adapter = readFileSync('apps/app/src/prototype/browser-adapter.ts', 'utf8');
const MAX_TABS = DEFAULT_BROWSING_LIMITS.tabs;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolveTick => setImmediate(resolveTick)); };

// The adapter's own snapshot, saver and restore, over a recording bridge.
const sessionRegion = stripTypeScriptTypes(adapter.slice(adapter.indexOf('  function savedSnapshot() {'), adapter.indexOf('  async function confirmBrowser(')));
function sessionHarness({saved, state, loaded = [], failWrites = false}) {
  const tabs = new BrowserTabSession({session: 'session'}), writes = [], reports = [];
  for (const id of loaded) { void tabs.ensure(id, false, async () => undefined); tabs.applyState({session: 'session', id, sequence: 1, navigation: 1, url: `https://example.test/${id}`, title: id, committed: true, loading: false, error: ''}); }
  const context = {JSON, Math, Error, Set, MAX_TABS, browsingSnapshot, restoreBrowsing, createSessionSaver, tabs, session: 'session', restored: new Map(),
    sessionRead: false, sessionHydrated: false, clearingData: false, disposed: false, Capacitor: {isNativePlatform: () => true},
    state: () => state, tabInfo: id => tabs.info(id), unimplemented: () => false, report: error => reports.push(error.message),
    shell: {vset(_view, patch) { Object.assign(state, patch); }},
    Browser: {browsingState: async () => saved, saveBrowsingState: async input => { writes.push(input); if (failWrites) throw new Error('store'); }}};
  const run = vm.runInNewContext('(function(){' + sessionRegion + ';return {restoreSession, saveSession};})()', context);
  return {...run, context, state, tabs, writes, reports};
}
const savedRecord = count => ({history: ['https://example.test/old'], tabs: Array.from({length: count}, (_, index) => ({id: 's' + index, url: 'https://example.test/s' + index, title: 'Saved ' + index})), cur: 's1'});

// Values made inside the adapter's context are copied before comparison.
const ids = tabs => Array.from(tabs, tab => tab.id);

test('a restore that finds the user already browsing keeps the open tabs and adds the saved ones', async () => {
  const state = {tabs: [{id: 'open', hist: ['newtab'], pos: 0}], visits: ['https://example.test/open'], cur: 'open', editing: false};
  const h = sessionHarness({saved: savedRecord(2), state, loaded: ['open']});
  const openRow = state.tabs[0];
  await h.restoreSession();
  assert.deepEqual(ids(state.tabs), ['open', 's0', 's1']);
  assert.equal(state.tabs[0], openRow, 'the open tab is untouched');
  assert.equal(state.cur, 'open', 'the open tab stays selected');
  assert.deepEqual(Array.from(state.visits), ['https://example.test/open', 'https://example.test/old']);
  assert.deepEqual([...h.context.restored.keys()], ['s0', 's1'], 'the saved tabs load when shown');
  assert.equal(h.context.sessionHydrated, true);
  // The first save after the restore still holds the saved tabs.
  state.visits = ['https://example.test/next', ...state.visits];
  h.saveSession(); await settle();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(ids(h.writes[0].tabs), ['open', 's0', 's1']);
  assert.equal(h.writes[0].tabs[1].url, 'https://example.test/s0');
});

test('a late restore never exceeds the tab limit or repeats an open tab, and an untouched new tab is still replaced', async () => {
  const open = [{id: 'a'}, {id: 'p', priv: true}, {id: 's0'}];
  const late = sessionHarness({saved: savedRecord(MAX_TABS), state: {tabs: open, visits: [], cur: 'p', editing: false}, loaded: ['a']});
  await late.restoreSession();
  assert.deepEqual(ids(late.state.tabs), ['a', 'p', 's0', 's1', 's2', 's3', 's4', 's5']);
  assert.equal(late.state.cur, 'p');
  assert.equal(late.context.restored.has('s0'), false, 'an open tab is not marked as unloaded');
  const fullTabs = Array.from({length: MAX_TABS}, (_, index) => ({id: 'o' + index}));
  const full = sessionHarness({saved: savedRecord(3), state: {tabs: fullTabs, visits: [], cur: 'o0', editing: false}, loaded: ['o0']});
  await full.restoreSession();
  assert.equal(full.state.tabs, fullTabs);
  assert.equal(full.context.restored.size, 0);
  assert.deepEqual(Array.from(full.state.visits), ['https://example.test/old']);
  // Typing in the first new tab is browsing too.
  const typing = sessionHarness({saved: savedRecord(2), state: {tabs: [{id: 'new'}], visits: [], cur: 'new', editing: true}});
  await typing.restoreSession();
  assert.deepEqual(ids(typing.state.tabs), ['new', 's0', 's1']);
  assert.equal(typing.state.cur, 'new');
  const pristine = sessionHarness({saved: savedRecord(3), state: {tabs: [{id: 'new'}], visits: [], cur: 'new', editing: false}});
  await pristine.restoreSession();
  assert.deepEqual(ids(pristine.state.tabs), ['s0', 's1', 's2']);
  assert.equal(pristine.state.cur, 's1');
  pristine.saveSession(); await settle();
  assert.equal(pristine.writes.length, 0, 'a restore alone writes nothing back');
});

test('the adapter saves a changed tab page once and backs off a rejected write', async () => {
  const state = {tabs: [{id: 'open'}], visits: [], cur: 'open', editing: false};
  const h = sessionHarness({saved: {history: [], tabs: []}, state, loaded: ['open'], failWrites: true});
  for (let tick = 0; tick < 5; tick++) h.saveSession();
  await settle();
  assert.equal(h.writes.length, 0, 'nothing is saved before the saved record was read');
  await h.restoreSession();
  for (let tick = 0; tick < 5; tick++) { h.saveSession(); await settle(); }
  assert.equal(h.writes.length, 0, 'an unchanged session is not written');
  h.tabs.applyState({session: 'session', id: 'open', sequence: 2, navigation: 2, url: 'https://example.test/moved', title: 'Moved', committed: true, loading: false, error: ''});
  for (let tick = 0; tick < 20; tick++) { h.saveSession(); await settle(); }
  assert.equal(h.writes.length, 1, 'a rejected write is not repeated on the next polls');
  assert.equal(h.writes[0].tabs[0].url, 'https://example.test/moved');
  assert.deepEqual(h.reports, []);
});

function saverHarness() {
  const h = {inputs: [1], enabled: true, time: 0, built: 0, writes: [], fail: false, value: {tabs: ['a']}};
  h.saver = createSessionSaver({
    inputs: () => h.inputs, enabled: () => h.enabled, now: () => h.time,
    snapshot: () => { h.built++; return h.value; },
    write: async snapshot => { h.writes.push(snapshot); if (h.fail) throw new Error('store'); },
  });
  return h;
}

test('an idle poll builds no snapshot', async () => {
  const h = saverHarness();
  h.saver.prime();
  const built = h.built;
  for (let tick = 0; tick < 50; tick++) h.saver.save();
  await settle();
  assert.equal(h.built, built);
  assert.equal(h.writes.length, 0);
  h.inputs = [2]; h.value = {tabs: ['a', 'b']};
  for (let tick = 0; tick < 50; tick++) h.saver.save();
  await settle();
  assert.equal(h.built, built + 1, 'one snapshot for one change');
  assert.deepEqual(h.writes, [{tabs: ['a', 'b']}]);
  h.inputs = [3];
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 1, 'an unchanged snapshot is not written again');
});

test('nothing is built or written while saving is disabled, and the change is kept', async () => {
  const h = saverHarness();
  h.enabled = false;
  for (let tick = 0; tick < 20; tick++) h.saver.save();
  assert.equal(h.built, 0);
  h.enabled = true; h.saver.save(); await settle();
  assert.equal(h.writes.length, 1);
});

test('a rejected save backs off instead of repeating on every poll', async () => {
  const h = saverHarness();
  h.fail = true;
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 1);
  for (let tick = 0; tick < 19; tick++) { h.time += 100; h.saver.save(); await settle(); }
  assert.equal(h.writes.length, 1, 'no retry inside the first 2 s');
  const built = h.built;
  h.saver.save();
  assert.equal(h.built, built, 'a waiting retry builds nothing');
  h.time = 2000; h.saver.save(); await settle();
  assert.equal(h.writes.length, 2);
  h.time = 5999; h.saver.save(); await settle();
  assert.equal(h.writes.length, 2, 'the second wait is 4 s');
  h.time = 6000; h.saver.save(); await settle();
  assert.equal(h.writes.length, 3);
  // A changed snapshot is written at once; success ends the backoff.
  h.inputs = [2]; h.value = {tabs: ['c']}; h.fail = false; h.time = 6100;
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 4);
  h.time = 1e9; h.saver.save(); await settle();
  assert.equal(h.writes.length, 4, 'a stored snapshot is not retried');
});

test('retry delay doubles from 2 s to at most 60 s', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 500].map(saveRetryDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  for (const odd of [0, -3, NaN, undefined]) assert.equal(saveRetryDelay(odd), 2000);
});

test('the poll is idle only off the Browser view with the page already hidden', () => {
  assert.equal(surfacePollIdle('home', 'hidden', 'hidden'), true);
  assert.equal(surfacePollIdle(undefined, 'hidden', 'hidden'), true);
  assert.equal(surfacePollIdle('browser', 'hidden', 'hidden'), false);
  assert.equal(surfacePollIdle('home', '', 'hidden'), false, 'geometry must be resent first');
  assert.equal(surfacePollIdle('home', '{"id":"b1"}', 'hidden'), false);
});

test('the adapter poll returns before measuring when idle', () => {
  const update = adapter.slice(adapter.indexOf('  const update = () => {'), adapter.indexOf('  const openBrowserView'));
  const idle = update.indexOf('if(surfacePollIdle(S?.view,lastGeometry,hiddenGeometry)){if(reading)stopReading();return;}');
  assert.ok(idle > 0);
  assert.ok(update.indexOf('saveSession();') < idle, 'a pending change is still saved');
  assert.ok(idle < update.indexOf('document.querySelector'), 'before any DOM query');
  assert.match(adapter, /const hiddenGeometry = JSON\.stringify\(\{session,id:null\}\);/);
  assert.doesNotMatch(adapter, /lastSaved/);
});

test('a question review that fails to open leaves the browser page shown', async () => {
  const region = stripTypeScriptTypes(adapter.slice(adapter.indexOf('  async function askPage()'), adapter.indexOf('  function hide()')));
  const reports = [];
  const context = {AbortController, reading: undefined, questionReview: false, lastGeometry: 'shown', disposed: false,
    stopReading() {}, readingUnsupported: async () => false, update: async () => {}, report: error => reports.push(error.message),
    state: () => ({cur: 't'}), tabInfo: () => ({url: 'https://example.test/', title: 'Example', committed: true}), tabs: {revision: () => 1},
    webSourceOf: source => source, sensitiveReadingText: () => false, browserReadingSource: async () => ({text: 'page text'}),
    Capacitor: {isNativePlatform: () => false}, connectionController: {getSnapshot: () => ({open: false})},
    document: {hidden: false, documentElement: {hasAttribute: () => false}},
    shell: {S: () => ({screen: 'home', view: 'browser'}), vset() {}, api: () => ({})},
    reviewContentQuestion() { throw new Error('dialog failed'); }};
  await vm.runInNewContext(region + ';askPage', context)();
  assert.deepEqual(reports, ['dialog failed']);
  assert.equal(context.questionReview, false, 'the surface is not left hidden');
  assert.equal(context.lastGeometry, '', 'geometry is resent');
  assert.equal(context.reading, undefined);
});

test('a question dialog that cannot open removes itself and its listeners', async () => {
  const {JSDOM} = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div class="os"><button id="opener"></button></div>');
  const names = ['window', 'document', 'HTMLElement', 'getComputedStyle'], previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const directory = mkdtempSync(join(tmpdir(), 'content-question-'));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: name === 'window' ? dom.window : dom.window[name]});
    globalThis.getComputedStyle = element => dom.window.getComputedStyle(element);
    const bundle = await build({entryPoints: [resolve('apps/app/src/browser/content-question.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
      plugins: [{name: 'ports', setup(b) { b.onResolve({filter: /local-ocr$/}, args => ({path: args.path, namespace: 'fixture'})); b.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export const recognizeLocalText=async()=>({text:""});'})); }}]});
    const file = join(directory, 'content-question.mjs');
    writeFileSync(file, bundle.outputFiles[0].text);
    const {reviewContentQuestion} = await import(pathToFileURL(file));
    dom.window.HTMLDialogElement.prototype.showModal = function () { throw new dom.window.DOMException('cannot open', 'InvalidStateError'); };
    const closed = [];
    const open = () => reviewContentQuestion({name: 'Example', text: 'page text', current: () => true, compose() {}, closed: dismissed => closed.push(dismissed)});
    assert.throws(open, /cannot open/);
    assert.deepEqual(closed, [false], 'the caller is told once that the review is gone');
    assert.equal(dom.window.document.querySelector('dialog'), null);
    const back = new dom.window.Event('alpha-back', {cancelable: true});
    dom.window.dispatchEvent(back);
    assert.equal(back.defaultPrevented, false, 'no Back handler is left behind');
    // A dialog that opens still stays open and owns Back until dismissed.
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    const close = open();
    assert.ok(dom.window.document.querySelector('.os dialog'));
    const owned = new dom.window.Event('alpha-back', {cancelable: true});
    dom.window.dispatchEvent(owned);
    assert.equal(owned.defaultPrevented, true);
    close();
    assert.deepEqual(closed, [false, true]);
  } finally {
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]); else delete globalThis[name]; });
    rmSync(directory, {recursive: true, force: true});
  }
});
