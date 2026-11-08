import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {checkTraces as check, qset} from '../check-traces.mjs';
import {sourceModule, bundledSource, memoryStore, read, trace, checkpoint, call, tick, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/portable.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/portable.mjs', 'specs/quint/refinement/application/support.mjs']}));

export async function startupPermissions() {
  const source = 'apps/app/src/startup-permission-flow.ts';
  const module = await bundledSource(source);
  const {createStartupPermissionFlow, readStartupPermissionMemory} = module.exports;
  const traces = [];
  for (const durable of [true, false]) for (const granted of [true, false]) {
    const store = memoryStore({failWrites: !durable});
    let requests = 0, settings = 0, grant = false;
    const bridge = {async status() { return {granted: grant, enabled: grant}; },
      async request() { requests++; grant = granted; }, async openSettings() { settings++; }};
    let flow = createStartupPermissionFlow(bridge, {key: 'camera', store});
    const t = trace(`prompt-${durable ? 'saved' : 'volatile'}-${granted}`, {'s.requests': requests});
    let status = await flow.enable();
    checkpoint(t, 'first explicit request and authoritative readback', [call('enable'), call(durable ? 'prompt' : 'promptWithoutPersistence'), call('result', granted)],
      {'s.requests': requests, 's.status': status, 's.durableAttempt': !!readStartupPermissionMemory(store).attempted.camera});
    flow = createStartupPermissionFlow(bridge, {key: 'camera', store});
    checkpoint(t, 'fresh instance reads retained marker', call('restart'),
      {'s.requests': requests, 's.attempted': !!readStartupPermissionMemory(store).attempted.camera});
    status = await flow.refresh();
    checkpoint(t, 'restart readback', call('check'), {'s.status': status});
    if (!granted) {
      status = await flow.enable();
      const operations = [call('enable'), ...(!durable ? [call('promptWithoutPersistence')] : []), call('result', false)];
      checkpoint(t, 'repeat explicit request after restart', operations,
        {'s.status': status, 's.requests': requests, 's.durableAttempt': !!readStartupPermissionMemory(store).attempted.camera});
      assert.equal(settings, durable ? 1 : 0);
    }
    traces.push(t);
  }
  return checkTraces({model: 'StartupPermissions', sources: module.sources, traces, scope: 'bounded-component',
    assumptions: ['One camera permission and two flow instances. Platform status/request are controlled ports.',
      'Checks persistent versus volatile attempt storage. Other permission kinds and walkthrough rendering have separate adapters.']});
}

export async function callbackLanding() {
  const source = 'apps/app/public/delegation-return.html', html = read(source);
  const state = 'A'.repeat(43), traces = [];
  const values = ['', 'ok', 'x'.repeat(4096), 'x'.repeat(4097)];
  for (const code of values) for (const error of ['', 'denied']) for (const description of [null, '', 'details', 'x'.repeat(2001)]) {
    const q = new URLSearchParams({state, code});
    if (error) q.set('error', error);
    if (description !== null) q.set('error_description', description);
    traces.push([`return-${traces.length}`, q]);
  }
  for (const [key, value] of [['state', state], ['code', 'again'], ['error', 'again'], ['error_description', 'again'], ['unknown', '1']]) {
    const q = new URLSearchParams({state, code: 'ok'}); q.append(key, value); traces.push([`duplicate-${key}`, q]);
  }
  for (const value of ['short', '!'.repeat(43), 'é'.repeat(43)]) traces.push([`state-${value.slice(0, 5)}`, new URLSearchParams({state: value, code: 'ok'})]);
  const checked = traces.map(([name, q]) => {
    const page = new JSDOM(html, {url: `https://example.test/delegation-return.html?${q}`, runScripts: 'outside-only'});
    try {
      const link = page.window.document.getElementById('return');
      const t = trace(name, {'s.urlHasQuery': !!page.window.location.search, 's.link': link.hidden ? 'none' : 'code'});
      const input = {stateCount: q.getAll('state').length, validState: /^[-\w]{43}$/.test(q.get('state') || ''),
        codeCount: q.getAll('code').length, codePresent: !!q.get('code'), codeFits: (q.get('code') || '').length <= 4096,
        errorCount: q.getAll('error').length, errorPresent: !!q.get('error'),
        descriptionCount: q.getAll('error_description').length, descriptionPresent: q.has('error_description'),
        descriptionFits: (q.get('error_description') || '').length <= 2000,
        knownKeys: [...q.keys()].every(key => ['state', 'code', 'error', 'error_description'].includes(key))};
      page.window.eval(page.window.document.querySelector('script').textContent);
      const target = link.hidden ? null : new URL(link.href);
      checkpoint(t, 'actual page script parses, scrubs and exposes link', [call('receive', input), call('scrub'), call('validate')],
        {'s.urlHasQuery': !!page.window.location.search, 's.link': target ? (target.searchParams.has('code') ? 'code' : target.searchParams.get('error')) : 'none'});
      if (target) assert.deepEqual([...target.searchParams.keys()], ['state', target.searchParams.has('code') ? 'code' : 'error']);
      return t;
    } finally { page.window.close(); }
  });
  return checkTraces({model: 'CallbackLanding', sources: [source], traces: checked, scope: 'bounded-component',
    assumptions: ['40 concrete query cases. Input regex/length abstraction classifies raw inputs; output comes exclusively from executing the actual page script.',
      'App-link delivery to Android is outside the page adapter.']});
}

export async function preferences() {
  const source = 'apps/app/src/runtime/canvas-geometry.ts';
  const {surfaceLayout, keyboardFreeHeight, canvasGeometry} = await sourceModule(source);
  const traces = [];
  for (const sequence of [[], ['keyboard'], ['keyboard', 'rotate'], ['wide'], ['wide', 'largeText'], ['largeText', 'wide'], ['wide', 'largeText', 'normalText']]) {
    let width = 412, height = 915, editing = false, scale = 100;
    const freeHeight = keyboardFreeHeight();
    const observe = () => {
      const free = freeHeight(width, height, editing), layout = surfaceLayout(width, scale / 100);
      const geometry = canvasGeometry({width, layoutHeight: height, available: height, desktop: false, fluid: true, launcher: false, screenShort: 412, editing}, free);
      return {'s.freeHeight': free, 's.width': width, 's.visibleHeight': height,
        landscape: geometry.landscape, split: layout.split, agenda: layout.agenda, calendarDays: layout.calendarDays};
    };
    const t = trace(sequence.join('-') || 'initial', observe());
    for (const operation of sequence) {
      if (operation === 'keyboard') {editing = true; height = 300;}
      if (operation === 'rotate') {width = 915; height = 300;}
      if (operation === 'wide') {width = 1200; height = 915;}
      if (operation === 'largeText') scale = 150;
      if (operation === 'normalText') scale = 100;
      checkpoint(t, operation, call(operation), observe());
    }
    traces.push(t);
  }
  return checkTraces({model: 'PreferencesAndPresentation', sources: [source], traces, scope: 'bounded-component',
    assumptions: ['Seven geometry sequences use actual layout and keyboard-height policies. Device dimensions and text preferences are controlled inputs.',
      'Theme persistence, DOM selection and native shade rendering are not checked by this geometry adapter.']});
}

export async function browserSession() {
  const source = '.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts';
  const {browsingSnapshot, restoreBrowsing} = await sourceModule(source);
  const traces = [];
  for (const privateTab of [false, true]) {
    const state = {tabs: [{id: '1'}], visits: [], cur: '1'};
    const t = trace(`snapshot-${privateTab ? 'private' : 'normal'}`, {'s.normal': qset(state.tabs.map(tab => Number(tab.id))), 's.order': state.tabs.map(tab => Number(tab.id)), 's.active': Number(state.cur)});
    state.tabs.push({id: privateTab ? '3' : '2', ...(privateTab ? {priv: true} : {})}); state.cur = privateTab ? '3' : '2';
    checkpoint(t, 'open tab', call(privateTab ? 'privateTab' : 'normalTab'),
      {'s.normal': qset(state.tabs.filter(tab => !tab.priv).map(tab => Number(tab.id))), 's.privateTabs': qset(state.tabs.filter(tab => tab.priv).map(tab => Number(tab.id))), 's.order': state.tabs.map(tab => Number(tab.id)), 's.active': Number(state.cur)});
    const saved = browsingSnapshot(state, id => ({url: `https://example.test/${id}`, title: id}));
    checkpoint(t, 'persist only normal tabs', call('snapshot'), {'s.saved': qset(saved.tabs.map(tab => Number(tab.id))), 's.savedOrder': saved.tabs.map(tab => Number(tab.id)), 's.savedActive': saved.cur ? Number(saved.cur) : 0});
    const restored = restoreBrowsing(saved, {tabs: [{id: 'fresh'}], visits: []}, true);
    checkpoint(t, 'reconstruct from snapshot', call('restart'), {'s.normal': qset(restored.restored.map(tab => Number(tab.id))), 's.privateTabs': qset(restored.restored.filter(tab => tab.priv).map(tab => Number(tab.id))), 's.order': restored.restored.map(tab => Number(tab.id)), 's.active': Number(restored.cur)});
    traces.push(t);
  }
  const current = {tabs: [{id:'1'}], visits: [], cur:'1'};
  const late = trace('late-restore-keeps-current-tabs', {'s.normal':qset(current.tabs.map(tab => Number(tab.id))), 's.active':Number(current.cur)});
  current.tabs.push({id:'2'}); current.cur='2';
  checkpoint(late, 'current second tab', call('normalTab'), {'s.normal':qset(current.tabs.map(tab => Number(tab.id))), 's.active':Number(current.cur)});
  const previous = browsingSnapshot({tabs:[{id:'1'}],visits:[],cur:'1'}, () => ({url:'https://example.test/1',title:'1'}));
  const result = restoreBrowsing(previous, current, false);
  assert.equal(result.restored.length, 0);
  checkpoint(late, 'late saved state provides no replacement tabs', call('lateRestore'),
    {'s.normal':qset(current.tabs.map(tab => Number(tab.id))), 's.active':Number(current.cur)});
  traces.push(late);
  return checkTraces({model: 'BrowserSession', sources: [source], traces, scope: 'bounded-component',
    assumptions: ['Persistence projection executes real snapshot and restore helpers for normal/private tabs.',
      'The current shared helper returns recreation descriptors in restored. A non-pristine caller receives no replacement tabs. The host owns WebViews and computes pristine admission. Supplied page metadata has valid persistence-eligible URLs. Blank-tab filtering, WebView navigation callbacks, host pristine admission and native encrypted persistence remain outside this helper adapter.']});
}

export async function permanentVoiceDeletion() {
  const source = 'apps/app/src/runtime/permanent-voice-deletion.ts';
  const {planInterruptedPermanentDeletion, leasedDeletionRow, sameDeletionRow, deletionLeaseDue} = await sourceModule(source);
  const rows = [];
  for (const note of ['original', 'deleted', 'changed']) for (const known of [false, true]) for (const owned of [false, true])
    for (const inTrash of [false, true]) for (const receipt of ['unknown', 'removed', 'restored', 'purged', 'unreadable']) for (const referenced of [false, true]) {
      const plan = planInterruptedPermanentDeletion({note, recording: known ? {ownedByNote: owned, inAudioTrash: inTrash} : null,
        receipt: receipt === 'unreadable' ? null : receipt, referencedElsewhere: referenced});
      rows.push({note, known, owned, inTrash, receipt, referenced, plan});
    }
  const original = {id: 'row'}, leased = leasedDeletionRow(original, 100);
  assert.equal(sameDeletionRow(original, leased), true);
  assert.equal(deletionLeaseDue(leased, 100), false);
  assert.equal(deletionLeaseDue(leased, leased.lease.until), true);
  return checkTraces({model: 'PermanentVoiceDeletionContract', modelPath: 'specs/quint/application/PermanentVoiceDeletion.qnt', id: 'PermanentVoiceDeletion',
    sources: [source], traces: [trace('complete finite planner table', {rows: qset(rows)})], scope: 'complete-finite-helper',
    assumptions: ['All240 combinations of the planner input classes. Lease helpers also execute at the boundary.',
      'Stateful deletion effects, cross-view Web Locks and native worker coordination are not covered by the pure planner comparison.']});
}

export async function draftDispatch() {
  const source = 'apps/app/src/prototype/assistant-draft-controller.ts';
  const {AssistantDraftController} = await sourceModule(source);
  const traces = [];
  for (const finish of ['commit', 'release']) for (const newer of [false, true]) for (const failWrite of [false, true]) {
    let text = '', record = {version: 1, binding: 'one', revision: '1', text: 'A'}, fail = false;
    const store = {async read() { return record; }, async save(expected, value) {
      if (fail) throw Error('Injected write failure');
      assert.deepEqual(expected, record);
      return record = {...record, revision: String(Number(record.revision) + 1), text: value};
    }};
    const controller = new AssistantDraftController(async () => store, () => text, value => {text = value;}, () => {});
    await controller.open('one');
    const abstractText = value => value.replace('\n', '+');
    const observe = () => ({'s.draft': abstractText(text), 's.savedOne': abstractText(record.text), 's.holding': controller.holding, 's.error': controller.state.error});
    const t = trace(`${finish}-${newer}-${failWrite}`, observe());
    await controller.hold('A'); checkpoint(t, 'hold actual controller draft', call('hold'), observe());
    text = ''; controller.edit(text); checkpoint(t, 'clear composer only', call('clearComposer'), observe());
    if (newer) {text = 'B'; controller.edit(text); checkpoint(t, 'newer typing while held', call('typeNew'), observe());}
    fail = failWrite;
    if (finish === 'commit') await controller.commit(); else {controller.release(); await tick(); await tick();}
    const completion = failWrite && (finish === 'commit' || newer)
      ? (finish === 'release' ? 'saveConflict' : 'saveFailed') : 'flush';
    checkpoint(t, 'settle dispatch and its queued storage write', [call(finish), call(completion)], observe());
    traces.push(t);
  }
  return checkTraces({model: 'DraftDispatch', sources: [source], traces, scope: 'bounded-component',
    assumptions: ['Eight real controller sequences cover commit/release, newer typing and failed writes.',
      'One conversation, serial storage completion. Cross-conversation and retained-instance reconstruction are additional obligations.']});
}
