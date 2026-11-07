import assert from 'node:assert/strict';
import vm from 'node:vm';
import {checkTraces as check} from '../check-traces.mjs';
import {read, sourceContext, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/surfaces.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/surfaces.mjs', 'specs/quint/refinement/application/support.mjs']}));

export async function shellNavigation() {
  const path = 'apps/app/src/prototype/model.js', source = read(path);
  const methods = source.slice(source.indexOf('  goHome(chat) {'), source.indexOf('  /* ---- Android', source.indexOf('  goHome(chat) {')));
  const traces = [];
  for (const view of ['notes', 'calendar', 'files', 'browser', 'settings']) {
    const context = vm.createContext({VIEWS: {[view]: {}}, isMvpView: value => value === view});
    vm.runInContext(`class Shell {
      constructor(){this.state={view:null,chat:'input',shade:false,drawer:false,voice:'off'};this.props={};}
      S(){return this.state;} setState(patch){Object.assign(this.state,patch);} clear(){} leave(){}
      mod(){return {};} vget(){return {};} vset(){} vreset(){} homeHint(){} toast(){}
      defaultChat(){return 'hidden';} rest(){return this.state.view?'hidden':'input';}
      ${methods}
    };globalThis.shell=new Shell();`, context);
    const shell = context.shell;
    const observe = () => ({'s.view': shell.S().view || 'home', 's.chat': shell.S().chat === 'hidden' ? 'input' : shell.S().chat,
      's.shade': shell.S().shade, 's.drawer': shell.S().drawer});
    const t = trace(`open-back-${view}`, observe());
    shell.openView(view); checkpoint(t, 'actual shell opens view', call('open', view), observe());
    shell.back(); checkpoint(t, 'actual shell returns home', call('back'), observe()); traces.push(t);
  }
  return checkTraces({model: 'ShellNavigation', sources: [path], traces, scope: 'bounded-component', assumptions: [
    'Actual goHome/openView/back method bodies execute with synchronous React state commits and empty view-specific handlers.',
    'Hidden and input are the model collapsed-chat class. Modal interception, focus, drawer gestures and asynchronous navigation claims remain untested here.']});
}

export async function developmentSurfaces() {
  const paths = ['apps/app/src/build-flags.ts', 'apps/app/src/browser/dev-profile.ts'];
  const traces = [];
  for (const enabled of [false, true]) {
    const environment = {DEV: true, VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: enabled ? '1' : '', VITE_ELIZA_RUNTIME_PROFILE: 'native'};
    const flags = read(paths[0]).replace(/export /g, '').replace(/: boolean/g, '').replaceAll('import.meta.env', 'environment');
    const profile = read(paths[1]).replace(/^import.*$/gm, '').replace(/export /g, '')
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
  const source = 'apps/app/src/prototype/files-tree-adapter.ts', traces = [];
  for (const leave of [false, true]) {
    let active = true;
    const result = deferred(), accepted = [], forgotten = [], state = {}, document = {hidden: false};
    const api = {ic: {folder: ''}, get: () => state, set: patch => Object.assign(state, patch), isActive: () => active, toast() {}};
    const view = {render: () => ({locs: [{name: 'Documents'}]}), onLeave() {}};
    const module = sourceContext([source], ['installFilesTreeAdapter'], {
      document, window: {dispatchEvent() {}}, Capacitor: {isNativePlatform: () => false}, registerPlugin: () => ({}),
      DailyApps: {perform: () => result.promise, async forgetSelected(input) {forgotten.push(input.selectionId);}},
      filesIndex: {list: () => [], revokeTree() {}}, createInlineModal: () => ({}), FOLDER_CONTEXT_EVENT: 'folder',
      createFolderRevisions: () => () => null, folderScope: () => null,
    });
    module.installFilesTreeAdapter({files: view}, async (_module, selected) => accepted.push(selected.selectionId), () => {});
    const observe = () => ({'s.preview': accepted.length ? 1 : 0});
    const t = trace(`picker-${leave ? 'retired' : 'current'}`, observe());
    view.render(state, api).locs.find(row => row.name === 'Documents').go();
    checkpoint(t, 'source opens system picker', call('pickFile'), observe());
    if (leave) {active = false; view.onLeave(api); checkpoint(t, 'source retires picker owner', call('leave'), observe());}
    result.resolve({status: 'selected', action: 'files', selectionId: 'owned-selected', name: 'Owned.txt', mimeType: 'text/plain'});
    await tick(); await tick();
    checkpoint(t, 'actual picker completion', call('pickerReply', 1), observe());
    assert.deepEqual(forgotten, leave ? ['owned-selected'] : []); traces.push(t);
  }
  return checkTraces({model: 'FilesTree', sources: [source], traces, scope: 'bounded-component', assumptions: [
    'Actual picker completion and view-leave handlers execute. The external picker is a deferred capability port.',
    'Tree enumeration, revisions, partial mutation batches, persistent Recent and native grant enforcement remain additional obligations.']});
}
