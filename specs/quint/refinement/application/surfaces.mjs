import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces as check} from '../check-traces.mjs';
import {read, bundledSource, sourceContext, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/surfaces.mjs', 'test/support/strip-types.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/surfaces.mjs', 'specs/quint/refinement/application/support.mjs', 'test/support/strip-types.mjs']}));

export async function shellNavigation() {
  const path = 'apps/app/src/prototype/model.js', source = read(path);
  const methods = source.slice(source.indexOf('  goHome(chat) {'), source.indexOf('  /* ---- Android', source.indexOf('  goHome(chat) {')));
  const navigation = await bundledSource('.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts');
  const policy = ['defaultChat', 'rest'].map(name => {
    const line = source.split('\n').find(line => line.startsWith(`  ${name}(`));
    assert.ok(line?.endsWith('}'), `Current ${name} policy remains a single source method`);
    return line;
  }).join('\n');
  const traces = [];
  for (const view of ['notes', 'calendar', 'files', 'browser', 'settings']) {
    const context = vm.createContext({VIEWS: {[view]: {}}, isMvpView: value => value === view, navigateMobileShell: navigation.exports.navigateMobileShell});
    vm.runInContext(`class Shell {
      constructor(){this.state={view:null,chat:'input',shade:false,drawer:false,voice:'off'};this.props={};}
      S(){return this.state;} setState(patch){Object.assign(this.state,patch);} clear(){} leave(){}
      mod(){return {};} vget(){return {};} vset(){} vreset(){} homeHint(){} toast(){}
      ${policy}
      ${methods}
    };globalThis.shell=new Shell();`, context);
    const shell = context.shell;
    const observe = () => ({'s.view': shell.S().view || 'home', 's.chat': shell.S().chat,
      's.shade': shell.S().shade, 's.drawer': shell.S().drawer});
    const t = trace(`open-back-${view}`, observe());
    shell.openView(view); checkpoint(t, 'actual shell opens view', call('open', view), observe());
    shell.back(); checkpoint(t, 'actual shell returns home', call('back'), observe()); traces.push(t);
  }
  return checkTraces({model: 'ShellNavigation', sources: [path, ...navigation.sources], traces, scope: 'bounded-component', assumptions: [
    'Actual goHome/openView/back method bodies execute with synchronous React state commits and empty view-specific handlers.',
    'Home input and hidden app chat retain the actual current rest policy. Modal interception, focus, drawer gestures and asynchronous navigation claims remain untested here.']});
}

export async function developmentSurfaces() {
  const paths = ['apps/app/src/build-flags.ts', 'apps/app/src/browser/dev-profile.ts'];
  const traces = [];
  for (const enabled of [false, true]) {
    const environment = {DEV: true, VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: enabled ? '1' : '', VITE_ELIZA_RUNTIME_PROFILE: 'native'};
    const flags = stripTypeScriptTypes(read(paths[0]), {mode: 'strip'}).replace(/export /g, '').replaceAll('import.meta.env', 'environment');
    const profile = stripTypeScriptTypes(read(paths[1]), {mode: 'strip'}).replace(/^import.*$/gm, '').replace(/export /g, '')
      .replaceAll('devSurfacesEnabled', 'profileEnabled').replace(/:boolean/g, '').replaceAll('import.meta.env', 'environment');
    const context = vm.createContext({environment, Capacitor: {isNativePlatform: () => false}, location: {search: '?mode=dev'}, URLSearchParams});
    vm.runInContext(`${flags}\n${profile}\nglobalThis.values={testMocksEnabled,devSurfacesEnabled,browserDevProfile};`, context);
    const values = context.values;
    const t = trace(`compiled-mocks-${enabled}`, {'s.mocks': values.testMocksEnabled}, call(enabled ? 'developmentInit' : 'productionInit'));
    checkpoint(t, 'query admission through real build/profile predicates', call(enabled ? 'fixture' : 'craftedQuery'), {'s.fixture': values.browserDevProfile});
    if (enabled) checkpoint(t, 'developer controls require development build', call('showTools'), {'s.tools': values.devSurfacesEnabled});
    traces.push(t);
  }
  return checkTraces({model: 'DevelopmentSurfaces', sources: paths, traces, scope: 'bounded-component', assumptions: [
    'Executes unchanged build/profile expressions with two explicit compile-time environments and the development query.',
    'Remote transport admission, Android two-collector pause and compiled production bundle elimination remain separate obligations.']});
}

export async function developmentDevice() {
  const path = 'apps/app/src/prototype/model.js', source = read(path);
  const phone = source.slice(source.indexOf('var PN ='), source.indexOf('registerView("phone",'));
  const traces = [];
  for (const late of [false, true]) {
    const state = {callWho: null, liveAt: null, mute: false, spk: false, recents: [], tab: 'recents'};
    let timer;
    const context = vm.createContext({Date, PN_SCRIPT: {_:{lines: [], sum: ''}}, PEOPLE: [], person: () => null});
    vm.runInContext(phone + ';globalThis.operations={pnStart,pnEnd};', context);
    const api = {get: () => state, set: patch => Object.assign(state, patch), stop() {}, stopBg() {}, laterBg(fn) {timer = fn;}, everyBg() {}, toast() {}, isActive: () => false};
    const observe = () => ({'s.call': state.callWho ? state.liveAt ? 'active' : 'dialing' : 'idle',
      's.microphoneMuted': state.mute, 's.speaker': state.spk});
    const t = trace(`call-timer-${late ? 'late' : 'current'}`, observe());
    context.operations.pnStart(api, 'one', null); checkpoint(t, 'actual dial helper', call('dial'), observe());
    if (late) {context.operations.pnEnd(api); checkpoint(t, 'hang up before timer', call('hangup'), observe());}
    timer(); checkpoint(t, 'actual scheduled callback executes', call('connected', 1), observe());
    if (!late) {context.operations.pnEnd(api); checkpoint(t, 'hang up active call', call('hangup'), observe());}
    traces.push(t);
  }
  return checkTraces({model: 'DevelopmentDevice', sources: [path], traces, scope: 'bounded-component', assumptions: [
    'Actual prototype dial/hangup/timer bodies execute against controlled timer ports. No telecom or network effects run.',
    'Incoming screening, simulated messages, location, payments and build admission are additional obligations.']});
}

export async function filesTree() {
  const source = 'apps/app/src/prototype/files-browser-adapter.ts', traces = [];
  const rules = await bundledSource('apps/app/src/runtime/files-storage.ts');
  const contract = await bundledSource('apps/app/src/runtime/files-agent-contract.ts');
  for (const outcome of ['current', 'retired', 'returned']) {
    let active = true, pending = false;
    const result = deferred(), accepted = [], forgotten = [], state = {};
    const document = Object.assign(new EventTarget(), {hidden: false, querySelector: () => null});
    const entry = {path: 'Owned.txt', name: 'Owned.txt', mimeType: 'text/plain', size: 4, modified: 1, directory: false};
    const storage = {
      async storageState() {return {status: 'ready', access: 'granted', volumes: [{id: 'primary', primary: true, name: 'Internal', free: 1, total: 2}]};},
      async storageCategory() {return {status: 'ready', entries: [], count: 0};},
      async storageTrashList() {return {status: 'ready', items: []};},
      async storageList() {return {status: 'ready', entries: [entry]};},
      async storageWatch() {return {status: 'ready'};},
      async storageUnwatch() {return {status: 'ready'};},
      async addListener() {return {async remove() {}};},
      storageSelect() {pending = true; return result.promise.finally(() => {pending = false;});},
    };
    const api = {ic: {}, get: () => state, set: patch => Object.assign(state, patch), isActive: () => active, toast() {}};
    const view = {render: () => ({}), onLeave() {}};
    const module = sourceContext([source], ['installFilesBrowserAdapter'], {
      ...rules.exports, ...contract.exports, document, window: new EventTarget(),
      registerPlugin: () => storage, queueMicrotask,
      DailyApps: {async forgetSelected(input) {forgotten.push(input.selectionId);}},
      createInlineModal: () => ({ref() {}}),
    });
    module.installFilesBrowserAdapter({files: view}, async (_module, selected) => accepted.push(selected.selectionId), () => {});
    view.render(state, api); await tick(); await tick();
    view.render(state, api).browse.vols[0].go(); await tick(); await tick();
    const observe = () => ({'s.preview': accepted.length ? 1 : 0, 's.active': active, 's.pending': pending, 's.released': forgotten.length > 0});
    const t = trace(`storage-preview-${outcome}`, observe());
    view.render(state, api).fd.items[0].tap();
    checkpoint(t, 'actual storageSelect awaits owned capability', call('beginPreview'), observe());
    if (outcome !== 'current') {
      active = false; view.onLeave(api); checkpoint(t, 'source retires preview owner', call('leave'), observe());
      if (outcome === 'returned') {
        active = true; view.render(state, api); await tick(); await tick();
        checkpoint(t, 'returning to Files retains the new preview epoch', call('enter'), observe());
      }
    }
    result.resolve({status: 'selected', action: 'files', selectionId: 'owned-selected', name: entry.name, mimeType: entry.mimeType});
    await tick(); await tick();
    checkpoint(t, 'actual storage capability completion', call('previewReply'), observe());
    assert.deepEqual(forgotten, outcome === 'current' ? [] : ['owned-selected']); traces.push(t);
  }
  return checkTraces({model: 'FilesPreview', sources: [source, ...rules.sources, ...contract.sources], traces, scope: 'bounded-component', assumptions: [
    'Current installFilesBrowserAdapter listing, storageSelect completion and view-leave handlers execute. Storage and modal UI are controlled ports.',
    'The current preview request keeps the page visible. Old tree-token semantics are historical. The full current per-volume load/filter/watch/mutation state needs FilesBrowserController. Storage access and modal behavior are controlled ports.']});
}
