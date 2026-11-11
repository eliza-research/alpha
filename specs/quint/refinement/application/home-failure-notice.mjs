import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const source = 'apps/app/src/prototype/home-shell.ts';
const installed = {packageName: 'org.example.clock', label: 'Fixture clock'};
const missing = {packageName: 'org.example.retired', label: 'Retired app'};
const messages = new Map([
  ['', ''],
  ['Fixture clock could not be opened. Paused.', 'launch-paused'],
  ['Fixture clock could not be opened. Disabled.', 'launch-disabled'],
  ['Retired app is no longer installed.', 'stale-app'],
  ['Favorites could not be saved. Nothing changed.', 'favorites'],
  ['Couldn’t load', 'inventory'],
]);
const errorKind = value => {
  const label = messages.get(value ?? '');
  assert.notEqual(label, undefined, value);
  return label;
};
const surface = state => state.view ? 'app' : state.drawer ? 'drawer' : state.homeEdit ? 'edit' : 'home';

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [source], bundle: true, platform: 'node',
    format: 'cjs', write: false, metafile: true, external: ['react', 'react-dom'],
    define: {'import.meta.env': '{}'}, plugins: [{name: 'home-failure-observer', setup(builder) {
      builder.onLoad({filter: /\/home-shell\.ts$/}, ({path}) => {
        const input = readFileSync(path, 'utf8'), marker = '  const shell = createMobileShellLauncher({';
        assert.equal(input.split(marker).length, 2, 'One Home failure observer seam');
        return {loader: 'ts', contents: input.replace(marker,
          '  __port.inspect = () => ({seenError,seenStatus,seenApps,launchReported,snapshot:shell.launcher.snapshot()});\n' + marker)};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), source, driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

async function fixture(compiled, pinNative) {
  const document = Object.assign(new EventTarget(), {hidden: false, querySelector: () => null});
  const module = {exports: {}}, port = {};
  new Function('require', 'module', 'exports', '__port', 'document', 'window', compiled.code)(
    createRequire(import.meta.url), module, module.exports, port, document, new EventTarget());
  const {installHomeShell} = module.exports;
  const ids = new WeakMap(), notices = [], events = [];
  let listId = 0, recording = false, listFails = false, launchFailure, holdLaunch, saveFails = false;
  let favorites = pinNative ? [installed.packageName] : ['alpha:notes'];
  const listIdentity = apps => {
    if (!ids.has(apps)) ids.set(apps, ++listId);
    return ids.get(apps);
  };
  function observe() {
    const observed = port.inspect();
    return {'s.surface': surface(home.S()), 's.seenError': errorKind(observed.seenError),
      's.seenStatus': observed.seenStatus, 's.seenApps': listIdentity(observed.seenApps),
      's.launchReported': observed.launchReported, 's.notices': [...notices]};
  }
  class Host {
    constructor() {this.state = {drawer: false, drawerQ: '', view: null, homeEdit: false};}
    S() {return this.state;}
    setState(patch) {
      Object.assign(this.state, patch);
      if (!recording || !Object.hasOwn(patch, 'launcherRevision')) return;
      const {snapshot} = port.inspect();
      events.push({label: 'actual shared launcher snapshot notification', action: call('report',
        snapshot.status, errorKind(snapshot.launchError), listIdentity(snapshot.apps),
        snapshot.favorites.length > shell.launcher.favoriteApps().length), expect: observe()});
    }
    toast(message) {notices.push({surface: surface(this.S()), kind: errorKind(message)});}
    renderVals() {return {isOn: true, isView: false, homeHidden: false};}
  }
  const shell = installHomeShell(Host, {}, {
    async list() {if (listFails) throw Error('Fixture list failure'); return {apps: [installed]};},
    async launch(target) {
      assert.equal(target.packageName, installed.packageName);
      if (holdLaunch) await holdLaunch.promise;
      if (launchFailure) throw Error(launchFailure);
    },
  }, {
    appInventory: 'simulated', follow: false,
    favorites: {read: () => favorites, write(keys) {if (saveFails) throw Error('Fixture write failure'); favorites = keys;}},
  });
  const home = new Host();
  home.renderVals();
  home.componentDidMount();
  await shell.launcher.load();
  const init = observe();
  assert.equal(init['s.seenStatus'], 'ready');
  assert.deepEqual(notices, []);
  recording = true;
  return {
    init, observe, events,
    show(mode) {home.setState({drawer: mode === 'drawer', view: mode === 'app' ? 'notes' : null, homeEdit: mode === 'edit'});},
    refresh(fails) {listFails = fails; return shell.launcher.refresh();},
    launch(message, followupFails = false) {
      listFails = followupFails;
      launchFailure = message;
      return shell.launcher.launch(shell.launcher.snapshot().apps.find(app => app.packageName === installed.packageName));
    },
    stale() {return shell.launcher.launch(missing);},
    clearError() {shell.launcher.clearError();},
    saveFailure() {
      saveFails = true;
      shell.launcher.toggleFavorite(shell.launcher.snapshot().apps.find(app => app.packageName === installed.packageName));
    },
    async beginHeldLaunch() {
      launchFailure = 'Paused.';
      holdLaunch = deferred();
      void shell.launcher.launch(shell.launcher.snapshot().apps.find(app => app.packageName === installed.packageName));
      await tick();
    },
    async finishHeldLaunch() {
      holdLaunch.resolve();
      await tick();
      holdLaunch = undefined;
    },
    close() {recording = false; home.componentWillUnmount();},
  };
}

const cases = [
  ['repeated-inventory-failure-then-recovery', true, [['refresh', true], ['refresh', true], ['refresh', false], ['refresh', true]]],
  ['inventory-with-no-dropped-favorite', false, [['refresh', true], ['refresh', false]]],
  ['followup-read-fails-after-launch-error', true, [['launch', 'Paused.', true], ['refresh', true], ['refresh', false]]],
  ['drawer-keeps-launch-inline-then-home-notices', true, [['show', 'drawer'], ['launch', 'Paused.'], ['show', 'home'], ['launch', 'Paused.']]],
  ['app-view-suppresses-inventory-failure', true, [['show', 'app'], ['refresh', true], ['show', 'home'], ['refresh', true], ['refresh', false], ['refresh', true]]],
  ['edit-surface-owns-save-failure', true, [['show', 'edit'], ['saveFailure'], ['show', 'home']]],
  ['stale-entry-repeats-same-error', true, [['stale'], ['stale'], ['clearError'], ['stale']]],
  ['held-launch-rejects-after-navigation', true, [['beginHeldLaunch'], ['show', 'app'], ['finishHeldLaunch']]],
  ['successful-launch-clears-old-error', true, [['launch', 'Disabled.'], ['launch'], ['launch', 'Paused.']]],
];

export async function checkHomeFailureNotice(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, pinNative, operations] of cases) {
    const f = await fixture(compiled, pinNative), t = trace(name, f.init);
    try {
      for (const [operation, ...args] of operations) {
        await f[operation](...args);
        const updates = f.events.splice(0);
        if (operation === 'show') checkpoint(t, 'host displays ' + args[0], call('show', args[0]), f.observe());
        else if (updates.length) t.steps.push(...updates);
        else checkpoint(t, 'actual operation without notification ' + operation, null, f.observe());
      }
      traces.push(t);
    } finally {f.close();}
  }
  return checkTraces(boundInputs({model: 'HomeFailureNotice', sources: compiled.sources, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual installHomeShell, shared launcher and mobile-shell adapter execute against a synthetic installed app, storage and native launch port. Each changed callback is compared with the notice model.',
    'The campaign begins after a settled ready inventory. Array identities and exact error strings are mapped to finite classes. Shell surface changes are explicit host inputs.',
    'Native activity execution, multiple profile identities, startup inventory, generic launcher request races and durable favorites storage remain separate obligations.',
  ]}));
}
