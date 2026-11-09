import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const settings = new URL('../../apps/app/src/prototype/settings-adapter.ts', import.meta.url);
const main = new URL('../../apps/app/src/main.tsx', import.meta.url);
const shellSource = new URL('../../apps/app/src/prototype/model.js', import.meta.url);
export const appearancePreferenceSources = [import.meta.url, settings, main, shellSource,
  new URL('../support/strip-types.mjs', import.meta.url)].map(fileURLToPath);

function range(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Actual appearance source anchor ' + start);
  return source.slice(a, b);
}

function events() {
  const listeners = new Map();
  return {listeners,
    addEventListener(event, callback) {
      const existing = listeners.get(event) ?? new Set();
      existing.add(callback);
      listeners.set(event, existing);
    },
    removeEventListener(event, callback) {listeners.get(event)?.delete(callback);},
    emit(event, detail = {}) {for (const callback of listeners.get(event) ?? []) callback(detail);},
  };
}

/** Execute actual boot, Settings appearance listeners, Display options, and commit writeback. */
export function appearancePreferenceFixture({testMocksEnabled = false, native = false, queryTheme = 'none',
  initialStorage = 'light', initialScheme = 'light'} = {}) {
  const a = readFileSync(settings, 'utf8'), b = readFileSync(main, 'utf8'), c = readFileSync(shellSource, 'utf8');
  const setupAnchor = '    this.passwordLifecycle = passwordManagerLifecycle(changed);';
  const setup = range(a, setupAnchor, '    let lastBinding =').slice(setupAnchor.length);
  const cleanup = range(a, "    window.removeEventListener('storage',this.appearanceStorageListener);", '    this.settingsConnectionUnsubscribe?.();');
  const pick = range(a, "          if(row.label==='Theme'&&row.kSeg){", "          if(row.label==='Brightness')");
  const commitUpdate = range(a, '  p.componentDidUpdate = function (previousProps: Bag, previousState: Bag) {', '  p.componentWillUnmount = function () {');
  const displayTheme = range(c, '    var theme = S.theme || (this.props || {}).theme || "light";', '\n');
  const appearanceToggle = range(c, '      themes: [["light",', '\n');
  const code = stripTypeScriptTypes([
    range(a, 'export type AppearanceChoice = ', 'const UPDATE_KEY ='),
    range(b, 'const initialTheme = (() => {', 'document.documentElement.dataset.connectionMode'),
    'const p = {};const update = undefined;', commitUpdate,
    'function mountAppearance(){' + setup + '}',
    'function unmountAppearance(){' + cleanup + '}',
    'function appearanceOptions(owner, api){const row={label:"Theme",kSeg:true};' + pick + '}',
    'function shellTheme(){const S=this.S();' + displayTheme + '\nreturn theme;}',
    'function shellAppearanceToggle(){const self=this,theme=shellTheme.call(this);return ({' + appearanceToggle + '}).themes;}',
    'globalThis.actual={initialTheme,mountAppearance,unmountAppearance,appearanceOptions,shellTheme,shellAppearanceToggle,update:p.componentDidUpdate};',
  ].join('\n').replace(/^export /gm, ''));
  const window = events(), scheme = {...events(), matches: initialScheme === 'dark'};
  const search = queryTheme === 'none' ? '' : '?theme=' + encodeURIComponent(queryTheme);
  const query = new URLSearchParams(search), attempts = [], messages = [], pending = [], markers = new WeakMap();
  let stored = initialStorage, blocked = false, serial = 0, phase = 'new';
  const localStorage = {
    getItem(key) {assert.equal(key, 'alpha.appearance.v1');return stored || null;},
    setItem(key, choice) {
      assert.equal(key, 'alpha.appearance.v1');
      attempts.push(choice);
      if (blocked) throw Error('Synthetic storage write refusal');
      stored = choice;
    },
  };
  const context = vm.createContext({testMocksEnabled, fixture: false, query, location: {search}, URLSearchParams,
    window, matchMedia(value) {
      assert.equal(value, '(prefers-color-scheme: dark)');
      return scheme;
    }, localStorage, Capacitor: {isNativePlatform: () => native}, leavePasswordManager() {}});
  vm.runInContext(code, context);
  const {actual} = context;
  const shell = {props: {theme: actual.initialTheme}, state: {theme: null}, S() {return {...this.state, view: 'settings'};},
    setState(patch) {
      if (patch.appearanceStorageRead) markers.set(patch.appearanceStorageRead, ++serial);
      pending.push(patch);
    },
    toast(message) {messages.push(message);},
  };
  const visualTheme = () => actual.shellTheme.call(shell);
  const options = () => actual.appearanceOptions(shell, {theme: visualTheme(), toast: message => shell.toast(message)}).opts;
  const count = (source, event) => source.listeners.get(event)?.size ?? 0;
  const marker = value => value ? markers.get(value) : 0;
  return {
    mount() {
      actual.mountAppearance.call(shell);
      phase = 'mounted';
    },
    unmount() {
      actual.unmountAppearance.call(shell);
      phase = 'retired';
    },
    commit() {
      assert.ok(pending.length);
      const previous = shell.state;
      shell.state = Object.assign({}, previous, ...pending.splice(0));
      actual.update.call(shell, shell.props, previous);
    },
    choose(choice) {options().find(option => option.label.toLowerCase() === choice).pick();},
    explicit(theme) {
      actual.shellAppearanceToggle.call(shell).find(option => option.label.toLowerCase() === theme).go();
    },
    storage(choice, event = 'key') {
      stored = choice;
      if (event !== 'silent') window.emit('storage', {key: event === 'clear' ? null : event === 'other' ? 'another-setting' : 'alpha.appearance.v1'});
    },
    pageshow() {window.emit('pageshow');},
    scheme(theme) {
      scheme.matches = theme === 'dark';
      scheme.emit('change');
    },
    failWrites() {blocked = true;},
    observe() {
      const readMarker = shell.state.appearanceStorageRead;
      assert.ok(messages.every(message => message === 'Theme changed for this session, but could not be saved.'));
      return {testMocks: testMocksEnabled, native, query: queryTheme, phase, boot: actual.initialTheme,
        system: scheme.matches ? 'dark' : 'light', stored, blocked,
        theme: shell.state.theme || '', marker: marker(readMarker), markerTheme: readMarker?.theme || '', serial,
        pending: pending.map(patch => ({theme: patch.theme, marker: marker(patch.appearanceStorageRead)})),
        storageListener: count(window, 'storage') === 1, resumeListener: count(window, 'pageshow') === 1,
        schemeListener: count(scheme, 'change') === 1, attempts: [...attempts], failures: messages.length,
        displayed: visualTheme(), selection: options().find(option => option.on).label.toLowerCase()};
    },
  };
}
