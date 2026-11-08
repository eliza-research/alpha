import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import vm from 'node:vm';
import {checkTraces as check, qmap} from '../check-traces.mjs';
import {read, sourceModule, sourceContext, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/surfaces.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/surfaces.mjs', 'specs/quint/refinement/application/support.mjs']}));

export async function shellNavigation() {
  const path = 'apps/app/src/prototype/model.js', source = read(path);
  const methods = source.slice(source.indexOf('  goHome(chat) {'), source.indexOf('  /* ---- Android', source.indexOf('  goHome(chat) {')));
  const {navigateMobileShell} = await sourceModule('.eliza/client-features/packages/ui/src/mobile-shell/core.ts');
  const traces = [];
  for (const view of ['notes', 'calendar', 'files', 'browser', 'settings']) {
    const context = vm.createContext({navigateMobileShell, VIEWS: {[view]: {}}, isMvpView: value => value === view});
    vm.runInContext(`class Shell {
      constructor(){this.state={view:null,chat:'input',shade:false,drawer:false,voice:'off'};this.props={};}
      S(){return this.state;} setState(patch){Object.assign(this.state,patch);} clear(){} leave(){}
      mod(){return {};} vget(){return {};} vset(){} vreset(){} homeHint(){} toast(){}
      defaultChat(){return 'hidden';} rest(){return this.state.view?'hidden':'input';}
      ${methods}
    };globalThis.shell=new Shell();`, context);
    const shell = context.shell;
    const observe = () => ({'s.view': shell.S().view || 'home', 's.chat': shell.S().chat,
      's.shade': shell.S().shade, 's.drawer': shell.S().drawer});
    const t = trace(`open-back-${view}`, observe());
    shell.openView(view); checkpoint(t, 'actual shell opens view', call('open', view), observe());
    shell.back(); checkpoint(t, 'actual shell returns home', call('back'), observe()); traces.push(t);
  }
  return checkTraces({model: 'ShellNavigation', sources: [path], traces, scope: 'bounded-component', assumptions: [
    'Actual goHome/openView/back method bodies execute with synchronous React state commits and empty view-specific handlers.',
    'Collapsed input on Home and hidden chat inside app views remain distinct. Modal interception, focus, drawer gestures and asynchronous navigation claims remain untested here.']});
}

export async function developmentSurfaces() {
  const paths = ['apps/app/src/build-flags.ts', 'apps/app/src/browser/dev-profile.ts'];
  const traces = [];
  for (const enabled of [false, true]) {
    const environment = {DEV: true, VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: enabled ? '1' : '', VITE_ELIZA_RUNTIME_PROFILE: 'native'};
    const flags = stripTypeScriptTypes(read(paths[0]), {mode:'transform'}).replace(/export /g, '').replaceAll('import.meta.env', 'environment');
    const profile = stripTypeScriptTypes(read(paths[1]), {mode:'transform'}).replace(/^import.*$/gm, '').replace(/export /g, '')
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
  const source = '.eliza/client-features/plugins/plugin-files/src/browser/storage-volume.ts';
  const {BrowserStorageVolume} = await sourceModule(source);
  const traces = [];
  for (const change of ['none', 'changed', 'missing']) {
    const folder = (id, name) => ({id: String(id), parentId: 'root', name, directory: true, revision: '0', size: 0, mimeType: ''});
    const file = (id, parentId, mimeType) => ({id: String(id), parentId: String(parentId), name: 'fixture.dat', directory: false, revision: '0', size: 1, modifiedAt: 0, mimeType});
    const rows = new Map([
      ['10', folder(10, 'Download')], ['20', folder(20, 'Pictures')], ['30', folder(30, 'Documents')],
      ['1', file(1, 20, 'image/png')], ['2', file(2, 10, 'text/plain')],
    ]);
    // The controlled library supplies identity-CAS primitives. Path resolution, category filtering,
    // expected-identity checks and the transfer itself execute BrowserStorageVolume unchanged.
    const library = {
      async list({id = 'root'}) { return {folder: {id}, entries: [...rows.values()].filter(row => row.parentId === id).map(row => ({...row}))}; },
      async move(input) {
        const row = rows.get(input.id);
        assert.equal(row.revision, input.expectedRevision);
        rows.set(row.id, {...row, parentId: input.destinationId, revision: String(Number(row.revision) + 1)});
      },
      async rename(input) {
        const row = rows.get(input.id);
        assert.equal(row.revision, input.expectedRevision);
        rows.set(row.id, {...row, name: input.name, revision: String(Number(row.revision) + 1)});
      },
      async usage() { return {bytes: 2, files: 2}; },
    };
    const volume = new BrowserStorageVolume(library,{trashFolder:'.Trash-alpha',trashKey:'alpha.files.trash.v1'});
    const locations = () => qmap([1, 2, 3].map(id => [id, rows.has(String(id)) ? Number(rows.get(String(id)).parentId) : 0]));
    const t = trace(`volume-reviewed-move-${change}`, {'s.locations': locations()});
    const access = await volume.run('storageState', {});
    checkpoint(t, 'actual browser volume reports its access', call('grantAccess'), {'s.access': access.access === 'granted'});
    assert.deepEqual((await volume.category('downloads')).entries.map(row => row.path), ['Download/fixture.dat']);
    assert.deepEqual((await volume.category('images')).entries.map(row => row.path), ['Pictures/fixture.dat']);
    const reviewed = await volume.reviewedIdentities(['Pictures/fixture.dat']);
    assert.equal(reviewed.length,1);
    assert.match(reviewed[0],/^[A-Za-z0-9_-]{43}$/);
    const reviewedRevision=Number(rows.get('1').revision);
    checkpoint(t, 'actual volume captures the reviewed identity', call('proposeMove', 1, 30), {'s.review': {file: 1, from: 20, to: 30, revision: reviewedRevision}});
    if (change === 'changed') {
      rows.set('1', {...rows.get('1'), modifiedAt: 1, revision: '1'});
      checkpoint(t, 'external library write changes the identity', call('externalEdit', 1), {'s.revisions': qmap([[1, 1], [2, 0], [3, 0]])});
    }
    if (change === 'missing') {
      rows.delete('1');
      checkpoint(t, 'external library removal changes the location', call('externalRemove', 1), {'s.locations': locations()});
    }
    const result = await volume.transfer(['Pictures/fixture.dat'], 'Documents', false, reviewed);
    assert.equal(result.outcomes[0].status, change === 'none' ? 'moved' : change === 'changed' ? 'changed' : 'missing');
    checkpoint(t, 'actual transfer preserves stale or missing sources', call(change === 'none' ? 'applyMove' : 'refuseMove'), {'s.locations': locations()});
    traces.push(t);
  }
  return checkTraces({model: 'FilesTree', sources: [source], traces, scope: 'bounded-component', assumptions: [
    'BrowserStorageVolume resolves paths, filters categories and conditionally transfers the exact reviewed identity against a controlled library CAS port.',
    'Three one-file schedules cover accepted, changed and missing identities. Full view selection, collisions, Trash, partial batches, native volumes and access revocation remain separate obligations.']});
}
