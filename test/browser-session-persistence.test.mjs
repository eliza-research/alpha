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


const source=readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8');
const declarations=source.slice(source.indexOf('  // Saving waits'),source.indexOf('  const tabOf ='));
const saving=source.slice(source.indexOf('  function savedSnapshot()'),source.indexOf('  async function restoreSession()'));
const clearing=source.slice(source.indexOf('  async function clearBrowsingData()'),source.indexOf('  async function clearSiteData()'));
function fixture(){
 let now=0,snapshots=0,fail=false,hold,release,record=null,clears=0;
 const state={tabs:[{id:'tab'}],cur:'tab',visits:['https://example.test/a']},metadata=new Map([['tab',{savedUrl:'https://example.test/a',title:'A'}]]),writes=[],errors=[];
 const context={JSON,Map,Promise,Date:{now:()=>now},disposed:false,clearingData:false,session:'session',state:()=>state,restored:new Map(),tabInfo:id=>metadata.get(id),Capacitor:{isNativePlatform:()=>true},
  browsingSnapshot(...args){snapshots++;return browsingSnapshot(...args);},confirmBrowser:async()=>true,report:error=>errors.push(error.message),
  forgetTabs(ids,clearHistory,afterCommit){queueMicrotask(()=>{state.tabs=state.tabs.filter(tab=>!ids.includes(tab.id));state.cur=state.tabs[0]?.id||'';if(clearHistory)state.visits=[];afterCommit?.();});},shell:{vset(_key,patch){Object.assign(state,patch);},toast(){}},
  Browser:{async saveBrowsingState(input){writes.push(input);if(hold){const pending=hold;hold=undefined;await pending;}if(fail)throw Error('Storage unavailable');record=input;},async clearBrowsingData(){clears++;record={history:[],tabs:[],cur:''};return {closed:[]};}}};
 const api=vm.runInNewContext(stripTypeScriptTypes(declarations+saving+clearing+';({saveSession,clearBrowsingData,hydrate(){sessionHydrated=true;},flush:()=>saveQueue,changed(){if(typeof snapshotRevision!=="undefined")snapshotRevision++;}})',{mode:'strip'}),context);api.hydrate();
 return {...api,state,metadata,writes,errors,context,advance(ms){now+=ms;},fail(value=true){fail=value;},hold(){hold=new Promise(resolve=>release=resolve);return ()=>release();},get snapshots(){return snapshots},get record(){return record},get clears(){return clears}};
}
const settlePersistence=async h=>{await h.flush();await Promise.resolve();};

test('idle presentation ticks reuse the bounded snapshot, including outside Browser',async()=>{
 const h=fixture();h.saveSession();await settlePersistence(h);for(let i=0;i<100;i++)h.saveSession();await settlePersistence(h);
 assert.equal(h.snapshots,1,'idle ticks must not normalize every saved URL again');assert.equal(h.writes.length,1);
 h.metadata.get('tab').title='New title';h.changed();h.saveSession();await settlePersistence(h);assert.equal(h.writes.at(-1).tabs[0].title,'New title');assert.equal(h.snapshots,2);
 h.state.visits=[...h.state.visits,'https://example.test/b'];h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,3);
});
test('failed saves use bounded exponential retry rather than the 100ms geometry cadence',async()=>{
 const h=fixture();h.fail();h.saveSession();await settlePersistence(h);for(let i=0;i<19;i++){h.advance(100);h.saveSession();await settlePersistence(h);}assert.equal(h.writes.length,1);
 h.advance(100);h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,2);
 h.advance(3999);h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,2);h.advance(1);h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,3);
 assert.equal(h.errors.length,1,'one ongoing storage failure should produce one notice');
 h.fail(false);h.advance(8000);h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,4);for(let i=0;i<20;i++){h.advance(100);h.saveSession();}await settlePersistence(h);assert.equal(h.writes.length,4);
 assert.equal(h.snapshots,1,'retry the already normalized snapshot');
});
test('new browsing state can save immediately during a failed snapshot backoff',async()=>{
 const h=fixture();h.fail();h.saveSession();await settlePersistence(h);h.fail(false);h.state.visits=['https://example.test/new'];h.saveSession();await settlePersistence(h);
 assert.equal(h.writes.length,2);assert.deepEqual(Array.from(h.record.history),h.state.visits);
});
test('Clear waits for an in-flight save and retires queued pre-clear snapshots',async()=>{
 const h=fixture(),release=h.hold();h.saveSession();await Promise.resolve();h.state.visits=['https://example.test/queued'];h.saveSession();
 const clearing=h.clearBrowsingData();await Promise.resolve();await Promise.resolve();assert.equal(h.clears,0,'an earlier save must finish before native Clear');release();await clearing;await settlePersistence(h);
 assert.equal(h.writes.length,1,'queued pre-clear state must never be written');assert.equal(h.clears,1);assert.deepEqual(h.record,{history:[],tabs:[],cur:''});
 h.saveSession();await settlePersistence(h);assert.equal(h.writes.length,1,'the cleared state is already durable');
});
test('a failed pre-clear save cannot schedule a retry after Clear',async()=>{
 const h=fixture(),release=h.hold();h.fail();h.saveSession();await Promise.resolve();const clearing=h.clearBrowsingData();await Promise.resolve();release();await clearing;h.advance(60000);h.saveSession();await settlePersistence(h);
 assert.equal(h.writes.length,1);assert.equal(h.clears,1);assert.deepEqual(h.record,{history:[],tabs:[],cur:''});assert.equal(h.errors.length,0);
});

// The extracted saver remains independently checked; production retains the stronger
// epoch/drain/React-commit writer while sharing its bounded retry and idle-poll semantics.
const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(path, 'utf8'))).toString('base64'));
const {createSessionSaver, saveRetryDelay, surfacePollIdle} = await load('apps/app/src/browser/browser-poll.ts');
const adapter = source;
const MAX_TABS = DEFAULT_BROWSING_LIMITS.tabs;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolveTick => setImmediate(resolveTick)); };

// The adapter's own snapshot, saver and restore, over a recording bridge.
const sessionRegion = stripTypeScriptTypes(adapter.slice(adapter.indexOf('  function forgetTabs(ids'), adapter.indexOf('  async function clearSiteData(')));
function sessionHarness({saved, state, loaded = [], failWrites = false, clearWait}) {
  const tabs = new BrowserTabSession({session: 'session'}), writes = [], reports = [], clears = [], reads = [];
  for (const id of loaded) { void tabs.ensure(id, false, async () => undefined); tabs.applyState({session: 'session', id, sequence: 1, navigation: 1, url: `https://example.test/${id}`, title: id, committed: true, loading: false, error: ''}); }
  const context = {JSON, Math, Error, Set, MAX_TABS, browsingSnapshot, restoreBrowsing, createSessionSaver, tabs, session: 'session', restored: new Map(),
    sessionRead: false, sessionHydrated: false, clearingData: false, disposed: false, confirming: false, lastGeometry: '', update: async()=>{}, reviews:{confirm:async()=>true},newTabId:()=> 'fresh', Capacitor: {isNativePlatform: () => true},
    state: () => state, tabInfo: id => tabs.info(id), unimplemented: () => false, report: error => reports.push(error.message),
    shell: {vset(_view, patch, options) { Object.assign(state, patch); options?.afterCommit?.(); },toast(){}},
    Browser: {clearBrowsingData:async()=>{clears.push(true);if(clearWait)await clearWait;return {closed:[]};},browsingState: async () => {reads.push(true);return saved;}, saveBrowsingState: async input => { writes.push(input); if (failWrites) throw new Error('store'); }}};
  const run = vm.runInNewContext('(function(){' + stripTypeScriptTypes(declarations) + sessionRegion + ';return {restoreSession, saveSession, clearBrowsingData, changed(){snapshotRevision++;}, get hydrated(){return sessionHydrated;}};})()', context);
  return {restoreSession:run.restoreSession,saveSession:run.saveSession,clearBrowsingData:run.clearBrowsingData,clears,reads,changed:run.changed,get hydrated(){return run.hydrated;},context,state,tabs,writes,reports};
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
  assert.equal(h.hydrated, true);
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
  h.tabs.applyState({session: 'session', id: 'open', sequence: 2, navigation: 2, url: 'https://example.test/moved', title: 'Moved', committed: true, loading: false, error: ''}); h.changed();
  for (let tick = 0; tick < 20; tick++) { h.saveSession(); await settle(); }
  assert.equal(h.writes.length, 1, 'a rejected write is not repeated on the next polls');
  assert.equal(h.writes[0].tabs[0].url, 'https://example.test/moved');
  assert.deepEqual(h.reports, ['Tabs and history could not be saved. Alpha will try again shortly.']);
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
  // The production writer retains its epoch, queued-write drain and post-commit Clear fence;
  // their behavior is exercised above rather than constraining its private variable names.
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

// A launch read may still be waiting when the owner completes Clear. Its older reply
// must not reintroduce the exact tabs and history the owner just removed.
test('Clear retires a saved-session read that resolves after the clear committed',async()=>{
 let resolveRead;const saved=new Promise(resolve=>{resolveRead=resolve;});
 const state={tabs:[{id:'new',hist:['newtab'],pos:0}],visits:[],cur:'new',editing:false};
 const h=sessionHarness({saved,state});const reading=h.restoreSession();await settle();
 await h.clearBrowsingData();assert.equal(h.clears.length,1);
 resolveRead(savedRecord(2));await reading;
 assert.deepEqual(Array.from(state.visits),[],'the old read must not resurrect cleared history');
 assert.deepEqual(ids(state.tabs),['fresh'],'the cleared new-tab state stays selected');
 h.saveSession();await settle();assert.equal(h.writes.length,0);
});

test('a saved-session read cannot begin while Clear owns the native boundary',async()=>{
 let release;const clearWait=new Promise(resolve=>{release=resolve;});
 const h=sessionHarness({saved:savedRecord(2),clearWait,state:{tabs:[{id:'new'}],visits:[],cur:'new',editing:false}});
 const clearing=h.clearBrowsingData();await settle();assert.equal(h.clears.length,1);
 await h.restoreSession();assert.equal(h.reads.length,0,'no older record is requested during Clear');
 release();await clearing;assert.deepEqual(Array.from(h.state.visits),[]);
});
