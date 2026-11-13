// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replay, root, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {shellCore} from '../specs/quint/refinement/application/shell-core-fixture.mjs';

// BackDispatch traces from the simulator, replayed on the pieces native Back runs through: the
// script MainActivity evaluates, the availability flag and Back handler of the agent adapter, the
// launcher layers of installHomeShell and the shell's own back(). Dialogs, panels, popovers and
// the inert phone are page elements the test stands in for; each closes the way its owner does.
const adapter = readFileSync('apps/app/src/prototype/agent-adapter.ts', 'utf8');
const slice = (from, to) => { const a = adapter.indexOf(from), b = adapter.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return stripTypeScriptTypes(adapter.slice(a, b)); };
const pageCode = `${slice('  function modalPanels(){', '  // Native Back reaches')}
${slice('  function updateBackAvailability(', '\n  const notesLeave')}
globalThis.updateBackAvailability = updateBackAvailability;
globalThis.listen = function () { ${slice('this.backHandler = (event: Event) => {', 'this.selectionHandler =')} };`;

const activity = readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/MainActivity.java', 'utf8');
const script = activity.match(/String script = "(.*?)"\s*\+ \(home \? "(.*?)" : "(.*?)"\) \+ "(.*?)";/s);
assert.ok(script, 'the Back script MainActivity evaluates');
// What the activity does with the script's answer.
assert.match(activity, /if \(home \|\| "true"\.equals\(handled\) \|\| isFinishing\(\) \|\| isDestroyed\(\)\) return;\s*if \(!isAssistantSurface\(\)\) moveTaskToBack\(true\); else finish\(\);/);
const backScript = home => script[1] + (home ? script[2] : script[3]) + script[4];

const built = await build({absWorkingDir: root, stdin: {resolveDir: root, sourcefile: 'back-dispatch-entry.ts', contents: `
  export {installHomeShell} from './apps/app/src/prototype/home-shell.ts';
  export {appsDrawerEntries} from './.eliza/client-features/packages/ui/src/mobile-shell/InstalledAppsGridDrawer';
  export {ALPHA_PRODUCT} from './apps/app/src/product/alpha-product';`},
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'], define: {'import.meta.env': '{}'}});
const BAR = 'barView', PILL = 'pillView';
const innerBack = (state, api) => { if (!state.inner) return false; api.set({inner: false}); return true; };

function fixture(host) {
  const layers = {popover: false, dialog: false, panel: false, inert: false};
  let outcome = 'none', closedAssistant = false;
  const close = name => ({dispatchEvent() { layers[name] = false; return true; }, close() { layers[name] = false; },
    hidePopover() { layers[name] = false; }, id: name, closest: () => null, getAttribute: () => null, getClientRects: () => [{}]});
  const page = {documentElement: {dataset: {}}, body: {},
    querySelector: selector => selector === 'dialog[open]' ? (layers.dialog ? close('dialog') : null) : selector === '.os' ? {inert: layers.inert} : null,
    querySelectorAll: selector => selector.startsWith('[popover]:popover-open') ? (layers.popover ? [close('popover')] : [])
      : selector === 'dialog[open]' ? (layers.dialog ? [close('dialog')] : [])
      : selector.startsWith('[role="dialog"][aria-modal="true"]') ? (layers.panel ? [close('panel')] : []) : []};
  const window = new EventTarget();
  const context = vm.createContext({document: page, window, Event, HTMLElement: {prototype: {hidePopover() {}}},
    getComputedStyle: () => ({visibility: 'visible'}), dismissMailFolderMenu: () => false,
    connectionController: {getSnapshot: () => ({open: false}), cancelViewNavigation() {}}});
  vm.runInContext(pageCode, context);

  const core = shellCore({views: {[BAR]: {chat: 'input', back: innerBack}, [PILL]: {back: innerBack}}});
  const module = {exports: {}};
  new Function('require', 'module', 'exports', 'document', 'window', 'CSS', built.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, Object.assign(new EventTarget(), {hidden: false}), new EventTarget(), {escape: String});
  const {installHomeShell, appsDrawerEntries, ALPHA_PRODUCT} = module.exports;
  let favorites = null;
  const home = installHomeShell(core.Shell, {}, {list: async () => ({apps: [{packageName: 'org.example.camera', label: 'Camera'}]}), launch: async () => {}},
    {appInventory: 'simulated', follow: false, favorites: {read: () => favorites, write(keys) { favorites = [...keys]; }}});
  core.Shell.prototype.componentDidUpdate = function () { context.updateBackAvailability(this); };
  const shell = new core.Shell({assistantSurface: host === 'assistant', onCloseAssistant() { closedAssistant = true; },
    systemShade: 'simulated', systemShell: host === 'home' || host === 'launcher'});
  shell.componentDidMount();
  shell.preset('home');
  context.listen.call(shell);
  return {
    async apply({action, picks}) {
      const S = shell.S();
      if (action === 'openView') shell.openView(picks.view, null, null, {push: picks.push});
      else if (action === 'openInner') shell.vset(S.view, {inner: true});
      else if (action === 'openPopover') layers.popover = true;
      else if (action === 'openDialog') layers.dialog = true;
      else if (action === 'openPanel') layers.panel = true;
      else if (action === 'holdInert') layers.inert = true;
      else if (action === 'releaseInert') layers.inert = false;
      else if (action === 'openShade') shell.openShade();
      else if (action === 'openDrawer') { shell.openAllApps(); await home.launcher.load(); }
      else if (action === 'openMenu') shell.setState({drawerMenu: appsDrawerEntries(home.launcher.snapshot(), ALPHA_PRODUCT.storage.launcherBuiltinPrefix, '')[0].key});
      else if (action === 'startEdit') shell.setState({homeEdit: true, homeAdd: false});
      else if (action === 'openAdd') shell.setState({homeAdd: true});
      else if (action === 'startVoice') shell.startVoice();
      else if (action === 'moveChat') shell.setState({chat: picks.chat});
      else if (action === 'homeGesture') { window.dispatchEvent(new Event('launcher-home')); outcome = 'home'; }
      else if (action === 'nativeBack') {
        // The page's observers bring the flag up to date before Android reads it.
        context.updateBackAvailability(shell);
        const flagged = page.documentElement.dataset.alphaCanGoBack === 'true', showsHome = host === 'home';
        const handled = vm.runInContext(backScript(showsHome), context);
        assert.equal(handled, flagged || showsHome);
        outcome = flagged ? 'renderer' : showsHome ? 'home' : host === 'launcher' ? 'background' : 'finish';
      } else assert.fail(`unmapped action ${action}`);
      await tick();
      // A menu popover belongs to its view's page and goes with it.
      if (!shell.S().view) layers.popover = false;
      context.updateBackAvailability(shell);
    },
    observe() {
      const S = shell.S();
      return {...layers, shade: !!S.shade, voice: S.voice !== 'off', chat: S.chat, view: S.view || '',
        inner: !!S.view && !!shell.vget(S.view).inner, stack: [...S.stack], drawer: !!S.drawer, menu: !!S.drawerMenu,
        homeEdit: !!S.homeEdit, homeAdd: !!S.homeAdd, outcome, closedAssistant,
        canGoBack: page.documentElement.dataset.alphaCanGoBack === 'true'};
    },
  };
}
const shown = s => s.host === 'assistant' && s.view === '' && (s.chat === 'input' || s.chat === 'hidden') ? 'full' : s.chat;

test("partial source contract: simulated BackDispatch traces agree with native Back, the flag and the renderer layers after every step", {timeout: 170000}, async () => {
  const traces = modelTraces({module: 'BackDispatch', traces: 200, steps: 30});
  const result = await replay(traces, {
    start: ({state}) => fixture(state.host),
    project: s => ({popover: s.popover, dialog: s.dialog, panel: s.panel, inert: s.inert, shade: s.shade, voice: s.voice, chat: shown(s),
      view: s.view, inner: s.view !== '' && s.inners.includes(s.view), stack: s.stack, drawer: s.drawer, menu: s.menu, homeEdit: s.homeEdit, homeAdd: s.homeAdd,
      outcome: s.outcome, closedAssistant: s.closed === 'assistant',
      canGoBack: s.dialog || s.view !== '' || s.drawer || s.homeEdit || s.homeAdd || s.shade || ['sheet', 'full'].includes(shown(s)) || s.voice || s.inert || s.panel}),
  });
  assert.deepEqual([...result.exercised].sort(), ['holdInert', 'homeGesture', 'moveChat', 'nativeBack', 'openAdd', 'openDialog',
    'openDrawer', 'openInner', 'openMenu', 'openPanel', 'openPopover', 'openShade', 'openView', 'releaseInert', 'startEdit', 'startVoice']);
});

test("partial source contract: native Back keeps Apps and its menu while retiring voice and each assistant detent above them", async () => {
  const f = fixture('home');
  const apply = (action, picks = {}) => f.apply({action, picks});
  await apply('openDrawer'); await apply('openMenu'); await apply('moveChat', {chat: 'full'}); await apply('startVoice');
  const layers = () => { const s = f.observe(); return [s.voice, s.chat, s.drawer, s.menu, s.outcome]; };
  await apply('nativeBack'); assert.deepEqual(layers(), [false, 'full', true, true, 'renderer']);
  await apply('nativeBack'); assert.deepEqual(layers(), [false, 'sheet', true, true, 'renderer']);
  await apply('nativeBack'); assert.deepEqual(layers(), [false, 'input', true, true, 'renderer']);
  await apply('nativeBack'); assert.deepEqual(layers(), [false, 'input', true, false, 'renderer']);
  await apply('nativeBack'); assert.deepEqual(layers(), [false, 'input', false, false, 'renderer']);
  await apply('nativeBack'); assert.equal(f.observe().outcome, 'home');
});
