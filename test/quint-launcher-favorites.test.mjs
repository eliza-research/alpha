import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const launcherSource = '.eliza/client-features/plugins/plugin-native-system/src/client/launcher.ts';
const shellSource = '.eliza/client-features/packages/ui/src/mobile-shell/mobile-launcher.ts';
const productSource = 'apps/app/src/product/alpha-product.ts';
const notes = 'alpha:notes', automations = 'alpha:automations', legacy = 'alpha:workflows';
const clock = 'org.fixture.clock', work = 'org.fixture.clock/org.fixture.clock.Main#10';
const camera = 'org.fixture.camera', gone = 'org.fixture.gone';
const nativeApps = [
  {packageName: clock, label: 'Clock'},
  {packageName: clock, activityName: 'org.fixture.clock.Main', user: '10', profile: 'work', label: 'Work clock'},
  {packageName: camera, label: 'Camera'},
  {packageName: gone, label: 'Removed app'},
];
const record = (schema, entries = [], policy = false, previous) =>
  ({schema, entries, policy, hasPrevious: previous !== undefined, previous: previous ?? []});
const missing = record('missing'), malformed = record('malformed');
const modern = (entries, previous) => record('v2', entries, true, previous);
const errors = new Map([
  [null, ''],
  ['Favorites could not be saved.', 'automatic-save'],
  ['Favorites could not be saved. Nothing changed.', 'explicit-save'],
]);

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, stdin: {resolveDir: root, sourcefile: 'launcher-favorites-entry.ts',
    contents: `export {createMobileShellLauncher} from './${shellSource}';
      export {alphaNavigation, ALPHA_PRODUCT} from './${productSource}';
      export {appKey} from './${launcherSource}';`},
    bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
    define: {'import.meta.env': '{}'}, plugins: [{name: 'launcher-favorites-observer', setup(builder) {
      builder.onLoad({filter: /\/plugin-native-system\/src\/client\/launcher\.ts$/}, ({path}) => {
        const source = readFileSync(path, 'utf8'), marker = '  let generation = 0;';
        assert.equal(source.split(marker).length, 2, 'One shared launcher favorites observer seam');
        return {loader: 'ts', contents: source.replace(marker,
          '  __port.inspect = () => ({rawSaved,builtins,defaultsPending,migrationPending,legacyHomeDefaultsPending});\n' + marker)};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<') && path !== 'launcher-favorites-entry.ts'),
    launcherSource, shellSource, productSource, driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function fixture(compiled, initial, readOk, writeOk) {
  const module = {exports: {}}, port = {};
  new Function('module', 'exports', '__port', compiled.code)(module, module.exports, port);
  const {createMobileShellLauncher, alphaNavigation, ALPHA_PRODUCT, appKey} = module.exports;
  const storageKey = ALPHA_PRODUCT.storage.launcherFavorites, policy = ALPHA_PRODUCT.storage.launcherDefaultPolicy;
  const prefix = ALPHA_PRODUCT.storage.launcherBuiltinPrefix;
  const apps = new Map(nativeApps.map(app => [appKey(app), app]));
  const encode = value => value.schema === 'missing' ? null : value.schema === 'malformed' ? '{' : JSON.stringify({
    version: value.schema === 'v1' ? 1 : 2, keys: value.entries,
    ...(value.policy ? {defaultPolicy: policy} : {}),
    ...(value.hasPrevious ? {previousDefaults: value.previous} : {}),
  });
  const decode = raw => {
    if (raw === null) return missing;
    let value;
    try {value = JSON.parse(raw);} catch {return malformed;}
    assert.ok([1, 2].includes(value.version));
    assert.ok(Array.isArray(value.keys));
    assert.ok(!Object.hasOwn(value, 'defaultPolicy') || value.defaultPolicy === policy);
    return record(value.version === 1 ? 'v1' : 'v2', value.keys,
      Object.hasOwn(value, 'defaultPolicy'), value.previousDefaults);
  };
  let disk = encode(initial), readable = readOk, writable = writeOk, writes = 0;
  let shell, registry, views = new Set(), pending;
  const storagePort = {
    getItem(key) {
      assert.equal(key, storageKey);
      if (!readable) throw Error('Injected favorites read failure');
      return disk;
    },
    setItem(key, raw) {
      assert.equal(key, storageKey);
      if (!writable) throw Error('Injected favorites write failure');
      disk = raw;
      writes++;
    },
  };
  function mount() {
    assert.equal(pending, undefined);
    views = new Set();
    registry = alphaNavigation(hostKey => views.has(hostKey)).views;
    shell = createMobileShellLauncher({registry, storage: () => storagePort, changed() {}, open() {},
      bridge: {
        list() {assert.equal(pending, undefined); pending = deferred(); return pending.promise;},
        launch() {throw Error('Favorites actions should not hand off');},
      }});
  }
  const entry = key => {
    if (apps.has(key)) return apps.get(key);
    const view = registry.fromLauncherKey(key);
    assert.ok(view, key);
    return {packageName: registry.launcherKey(view), label: view.label};
  };
  mount();
  return {
    observe() {
      const state = shell.launcher.snapshot(), flags = port.inspect();
      const error = errors.get(state.launchError);
      assert.notEqual(error, undefined, state.launchError);
      return {'s.disk': decode(disk), 's.captured': flags.rawSaved ?? [], 's.capturedMissing': flags.rawSaved === null,
        's.favorites': state.favorites, 's.views': flags.builtins.map(appKey),
        's.apps': state.apps.map(appKey).filter(key => !key.startsWith(prefix)),
        's.migration': shell.migration.status, 's.renamed': shell.migration.renamed ?? 0,
        's.defaultsPending': flags.defaultsPending, 's.v1Pending': flags.migrationPending,
        's.barePending': flags.legacyHomeDefaultsPending, 's.status': state.status, 's.reading': !!pending,
        's.error': error, 's.readable': readable, 's.writable': writable, 's.writes': writes,
        visible: shell.homeEntries().map(entry => entry.key)};
    },
    restart: mount,
    storage(read, write) {readable = read; writable = write;},
    externalWrite(value) {disk = encode(value);},
    syncViews(keys) {
      views = new Set(keys.map(key => {
        const view = registry.fromLauncherKey(key);
        assert.ok(view, key);
        return registry.hostKey(view);
      }));
      shell.syncViews();
    },
    request() {void shell.launcher.load();},
    prepareHome() {shell.prepareHome();},
    async settle(ok, keys) {
      assert.ok(pending);
      const waiting = pending;
      pending = undefined;
      if (ok) waiting.resolve({apps: keys.map(entry)});
      else waiting.reject(Error('Injected installed inventory failure'));
      await tick();
    },
    toggle(key) {shell.launcher.toggleFavorite(entry(key));},
    move(key, direction, limited, filter) {
      shell.launcher.moveFavorite(entry(key), direction, limited ? new Set(filter) : undefined);
    },
    clearError() {shell.launcher.clearError();},
  };
}

const views = ['syncViews', [notes, automations]], request = ['request'], restart = ['restart'];
const prepare = ['prepareHome'], settle = ['settle', true, [clock]];
const cases = [
  ['absent-defaults-do-not-start-inventory', missing, true, true, [views, prepare, request, settle, restart, views]],
  ['explicit-empty-remains-empty', modern([]), true, true, [views, prepare, request, settle, restart, views]],
  ['malformed-record-remains-empty', malformed, true, true, [views, prepare, request, settle]],
  ['legacy-view-id-migrates-deduplicates-and-reopens', modern([legacy, automations, notes], [legacy, camera]), true, true, [views, restart, views]],
  ['refused-migration-retains-canonical-home-choice', modern([legacy, notes]), true, false, [views, ['toggle', notes], ['storage', true, true], restart, views]],
  ['legacy-v1-appends-current-product-views', record('v1', [legacy, clock]), true, true, [views, prepare, settle, restart, views]],
  ['old-all-apps-default-retains-rollback-copy', record('v2', [notes, automations, clock]), true, true, [views, prepare, settle, restart, views]],
  ['old-custom-order-is-preserved', record('v2', [clock, notes, automations]), true, true, [views, prepare, settle]],
  ['same-keys-explicit-policy-wins-held-migration', record('v2', [notes, automations, clock]), true, true, [
    views, prepare, ['externalWrite', modern([notes, automations, clock])], settle]],
  ['external-empty-choice-wins-held-defaults', missing, true, true, [views, request, ['externalWrite', modern([])], settle]],
  ['external-custom-choice-wins-held-v1', record('v1', [clock]), true, true, [
    views, prepare, ['externalWrite', modern([clock, notes])], settle]],
  ['explicit-edit-wins-before-held-default-list', missing, true, true, [views, request, ['toggle', notes], settle]],
  ['automatic-save-fails-then-next-load-retries', missing, true, false, [views, request, settle,
    ['storage', true, true], request, settle, restart, views]],
  ['denied-read-uses-defaults-and-denied-write-keeps-disk', modern([clock]), false, false, [views, request, settle,
    ['storage', true, true], request, settle, restart, views]],
  ['failed-inventory-keeps-stored-native-favorite', modern([clock, notes]), true, true, [views, prepare,
    ['settle', false, []], request, settle]],
  ['visible-move-preserves-hidden-slot-and-profile', modern([notes, gone, work, clock]), true, true, [views, prepare,
    ['settle', true, [clock, work]], ['move', notes, 1, false, []], ['move', clock, -1, true, [notes, clock]], restart, views]],
  ['disallowed-view-is-hidden-until-readmitted', modern([notes, automations]), true, true, [
    ['syncViews', [notes]], views, ['syncViews', [automations]], ['syncViews', []], views]],
  ['rejected-explicit-edit-and-later-good-edit', modern([notes, automations]), true, false, [views, ['toggle', notes], ['clearError'],
    ['storage', true, true], ['toggle', notes], ['toggle', notes], restart, views]],
  ['stale-unlisted-toggle-and-out-of-range-move', modern([notes, automations]), true, true, [
    views, ['toggle', gone], ['move', notes, -1, false, []], ['move', automations, 1, false, []]]],
  ['existing-empty-rollback-copy-is-kept', modern([notes], []), true, true, [
    views, ['toggle', automations], restart, views]],
  ['no-available-views-fall-back-to-installed-defaults', missing, true, true, [
    request, ['settle', true, [clock, work, camera]], views]],
];

async function checkLauncherFavorites(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, initial, readable, writable, operations] of cases) {
    const f = fixture(compiled, initial, readable, writable);
    const t = trace(name, f.observe(), call('initWith', initial, readable, writable));
    for (const [operation, ...args] of operations) {
      await f[operation](...args);
      checkpoint(t, operation, call(operation, ...args), f.observe());
    }
    traces.push(t);
  }
  return checkTraces(boundInputs({model: 'LauncherFavorites', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual shared MobileShellLauncher, local favorites store, registry, and product registration execute against a synthetic Storage port and deferred installed-app reads.',
    'Two Alpha views, their legacy alias, and three installed package/activity/profile keys form the bounded identity set. A source inspection seam reads the original captured favorites and migration flags. Home visibility comes from actual homeEntries().',
    'One held inventory read and a later load or controller recreation are covered. Independent writes use an external port. Browser storage errors are represented as thrown reads or writes; OS package effects and actual browser persistence remain external.',
  ]}));
}

test('shared launcher favorites preserve canonical identities and storage choices', {timeout: 120000}, async () => {
  const receipt = await checkLauncherFavorites([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 21);
  assert.equal(receipt.checkpoints, 126);
});
