import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const source = 'apps/app/src/prototype/home-shell.ts';
const navigation = '.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts';
const notes = 'alpha:notes', inbox = 'alpha:inbox', files = 'alpha:files';

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, stdin: {resolveDir: root, sourcefile: 'home-gesture-entry.ts',
    contents: `export {installHomeShell} from './${source}';
      export {navigateMobileShell} from './${navigation}';`},
    bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, external: ['react', 'react-dom'],
    define: {'import.meta.env': '{}'}, plugins: [{name: 'home-gesture-observer', setup(builder) {
      builder.onLoad({filter: /\/home-shell\.ts$/}, ({path}) => {
        const input = readFileSync(path, 'utf8'), marker = "  let swallow = '';";
        const focus = 'const focusTile = (key: string) => requestAnimationFrame(';
        assert.equal(input.split(marker).length, 2, 'One Home gesture observation seam');
        assert.equal(input.split(focus).length, 2, 'One Home keyboard frame scheduling seam');
        return {loader: 'ts', contents: input.replace(marker, marker + '\n  __port.inspect = () => ({owner,press,drag,swallow});')
          .replace(focus, 'const focusTile = (key: string) => __port.scheduleFocus(key, ')};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<') && path !== 'home-gesture-entry.ts'),
    source, navigation, driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function fixture(compiled) {
  let home, covered = false, over = '', lastCapture = 0, clickStopped = false, focused = '', frame;
  let favorites = [notes, inbox];
  const module = {exports: {}};
  const timers = new Map(), retired = [];
  const port = {scheduleFocus(key, run) {assert.equal(frame, undefined); frame = {key, run};}};
  const layer = {hasAttribute: name => name === 'inert' && covered};
  const tile = key => {
    const element = {get isConnected() {return favorites.includes(key);},
      querySelector: () => ({getAttribute: () => key}), getBoundingClientRect: () => ({width: 64}),
      offsetWidth: 64, style: {}, focus() {focused = key;}, setAttribute() {}, removeAttribute() {}};
    element.closest = selector => selector === '[data-mobile-shell-tile]' ? element
      : selector === '[data-mobile-shell-home]' ? layer : null;
    return element;
  };
  const elements = new Map([notes, inbox, files].map(key => [key, tile(key)]));
  const stateOwnsHome = () => !covered && !home.S().view && !home.S().drawer && port.inspect().owner === home;
  const document = Object.assign(new EventTarget(), {hidden: false, elementsFromPoint: () => over ? [elements.get(over)] : [],
    querySelector(selector) {
      if (!stateOwnsHome()) return null;
      const key = [...elements.keys()].find(candidate => selector === `[data-alpha-home-key="${candidate}"]`);
      return favorites.includes(key) ? elements.get(key) : null;
    }});
  const setTimeout = (run, delay) => {
    assert.equal(delay, 450);
    assert.equal(timers.size, 0, 'One pending Home hold');
    const token = {};
    timers.set(token, run);
    return token;
  };
  const clearTimeout = token => {
    assert.ok(timers.has(token), 'Clearing the held timer');
    retired.push(timers.get(token));
    timers.delete(token);
  };
  new Function('require', 'module', 'exports', '__port', 'document', 'window', 'setTimeout', 'clearTimeout', 'CSS', 'requestAnimationFrame',
    compiled.code)(createRequire(import.meta.url), module, module.exports, port, document, new EventTarget(), setTimeout, clearTimeout, {escape: String},
      callback => {queueMicrotask(callback);return 0;});
  const {installHomeShell, navigateMobileShell} = module.exports;
  class Host {
    state = {drawer: false, drawerQ: '', view: null, stack: []};
    S() {return this.state;}
    setState(patch) {Object.assign(this.state, patch);}
    toast() {}
    vget() {return {};}
    shellNavigate(action) {
      const next = navigateMobileShell({view: this.state.view, stack: this.state.stack,
        drawer: this.state.drawer, drawerQuery: this.state.drawerQ}, action);
      return {view: next.view, stack: [...next.stack], drawer: next.drawer, drawerQ: next.drawerQuery};
    }
    openView(view) {this.setState(this.shellNavigate({type: 'open', view}));}
    goHome() {this.setState(this.shellNavigate({type: 'home'}));}
    back() {this.setState(this.shellNavigate({type: 'back'}));}
    renderVals() {return {isOn: true, isView: !!this.state.view, homeHidden: covered || !!this.state.view || this.state.drawer};}
  }
  const shell = installHomeShell(Host, {}, {list: async () => ({apps: []}), launch: async () => {}}, {
    appInventory: 'simulated', follow: false,
    favorites: {read: () => favorites, write(value) {favorites = [...value];}},
  });
  const grid = () => home.renderVals().homeShell.props.gridProps;
  function event(key, pointerId, {far = false, remove = false, keyboard = false} = {}) {
    const tile = elements.get(key);
    const target = remove ? {closest: selector => selector === '[data-alpha-home-remove]' ? {} : tile.closest(selector)} : tile;
    return {target, pointerId, button: 0, clientX: far ? 11 : 10, clientY: 0, detail: keyboard ? 0 : 1,
      currentTarget: {setPointerCapture(pointer) {lastCapture = pointer;}},
      prevented: false, stopped: false, preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}};
  }
  function mount() {
    covered = false;
    home = new Host();
    home.renderVals();
    home.componentDidMount();
  }
  mount();
  return {
    observe() {
      const {owner, press, drag, swallow} = port.inspect(), state = home.S();
      assert.equal(!!press, !!timers.size, 'Source press tracks the held timeout');
      assert.deepEqual(shell.launcher.snapshot().favorites, favorites, 'Successful storage port and Home agree');
      return {'s.mounted': owner === home, 's.surface': state.view ? 'view' : state.drawer ? 'drawer' : 'home',
        's.covered': covered, 's.editing': !!state.homeEdit, 's.adding': !!state.homeAdd,
        's.press': {pointer: press?.pointer ?? 0, key: press?.key ?? ''},
        's.drag': {pointer: drag?.pointer ?? 0, key: drag?.key ?? '', moved: drag?.moved ?? false},
        's.swallow': swallow, 's.order': favorites, 's.lastCapture': lastCapture, 's.clickStopped': clickStopped,
        's.focusJob': frame?.key ?? '', 's.focused': focused};
    },
    mount,
    unmount() {home.componentWillUnmount();},
    down(pointer, key, remove) {grid().onPointerDown({...event(key, pointer, {remove}), clientX: 0});},
    movePointer(pointer, far) {grid().onPointerMove(event(notes, pointer, {far}));},
    up(pointer, target) {over = target; grid().onPointerUp(event(notes, pointer));},
    cancel(pointer) {grid().onPointerCancel(event(notes, pointer));},
    hold() {
      assert.equal(timers.size, 1);
      const [token, callback] = timers.entries().next().value;
      timers.delete(token);
      callback();
    },
    fireOldHold() {assert.ok(retired.length); retired.at(-1)();},
    cover(value) {covered = value;},
    context(key) {grid().onContextMenu(event(key, 1));},
    click(key, remove, keyboard) {
      const input = event(key, 1, {remove, keyboard});
      grid().onClickCapture(input);
      assert.equal(input.prevented, input.stopped);
      clickStopped = input.stopped;
    },
    erase(key) {grid().onKeyDown({...event(key, 1), key: 'Delete'});},
    arrow(key, direction) {grid().onKeyDown({...event(key, 1), key: direction < 0 ? 'ArrowLeft' : 'ArrowRight'});},
    flushFocus() {
      assert.ok(frame);
      const {run} = frame;
      frame = undefined;
      run();
    },
    addSheet() {home.renderVals().homeEdit.add();},
    addChoice(key) {home.renderVals().homeEdit.hidden.find(entry => entry.key === key).add();},
    done() {home.renderVals().homeEdit.done();},
    openDrawer() {home.openAllApps();},
    openView() {home.openView('notes');},
    goHome() {home.goHome();},
    back() {home.back();},
    close() {if (port.inspect().owner === home) home.componentWillUnmount();},
  };
}

const down = ['down', 1, notes, false], hold = ['hold'], context = ['context', notes];
const cases = [
  ['unrelated-pointer-cannot-clear-held-press', [down, ['down', 2, inbox, false], ['movePointer', 2, true],
    ['up', 2, inbox], ['cancel', 2], hold]],
  ['own-movement-over-slop-cancels-hold', [down, ['movePointer', 1, false], ['movePointer', 1, true], ['fireOldHold']]],
  ['release-before-hold-leaves-home-idle', [down, ['up', 1, ''], ['fireOldHold']]],
  ['cancel-before-hold-leaves-home-idle', [down, ['cancel', 1], ['fireOldHold']]],
  ['opening-drawer-retires-an-armed-hold', [down, ['openDrawer'], ['fireOldHold'], ['back']]],
  ['replaced-timeout-cannot-claim-new-same-pointer', [down, ['down', 1, inbox, false], ['fireOldHold'], hold]],
  ['inert-home-rejects-an-elapsed-hold', [down, ['cover', true], hold, ['cover', false]]],
  ['opening-view-retires-press-before-handoff', [down, ['openView'], ['fireOldHold'], ['goHome']]],
  ['unmount-retires-press-and-late-events', [down, ['unmount'], ['fireOldHold'], ['movePointer', 1, true], ['mount']]],
  ['remount-releases-earlier-click-suppression', [context, ['unmount'], ['mount'], ['click', notes, false, true]]],
  ['held-release-is-swallowed-once', [down, hold, ['click', notes, false, true], ['click', notes, false, true]]],
  ['remove-control-does-not-start-drag', [context, ['down', 1, inbox, true], ['click', inbox, true, false]]],
  ['only-drag-owner-can-capture-and-drop', [context, down, ['movePointer', 2, true], ['up', 2, inbox],
    ['cancel', 2], ['movePointer', 1, false], ['movePointer', 1, true], ['up', 1, inbox], ['click', notes, false, true]]],
  ['own-cancel-cleans-moved-drag', [context, down, ['movePointer', 1, true], ['cancel', 1], ['up', 1, inbox]]],
  ['covered-drag-cannot-commit', [context, down, ['movePointer', 1, true], ['cover', true], ['up', 1, inbox], ['cover', false]]],
  ['covered-motion-clears-drag-without-reorder', [context, down, ['movePointer', 1, true],
    ['cover', true], ['movePointer', 1, true], ['cover', false], ['up', 1, inbox]]],
  ['keyboard-move-refocuses-the-same-key', [context, ['arrow', notes, 1], ['flushFocus'], ['erase', inbox]]],
  ['retired-view-cannot-receive-keyboard-focus', [context, ['arrow', notes, 1], ['openView'], ['flushFocus']]],
  ['edit-sheet-adds-and-back-unwinds-two-layers', [context, ['addSheet'], ['addChoice', files], ['back'], ['back'], ['openDrawer']]],
  ['done-cleans-active-drag-and-edit', [context, down, ['movePointer', 1, true], ['done'], ['up', 1, inbox]]],
];

export async function checkHomeGesture(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, steps] of cases) {
    const f = fixture(compiled), t = trace(name, f.observe());
    try {
      for (const [operation, ...args] of steps) {
        f[operation](...args);
        await tick();
        checkpoint(t, operation, call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.close();}
  }
  return checkTraces(boundInputs({model: 'HomeGesture', sources: compiled.sources, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual installHomeShell grid, edit callbacks and mounted lifecycle execute with the shared launcher/navigation code and controlled pointer, timer, focus and storage ports.',
    'Two pointer IDs, three favorite keys, a fixed tile geometry, one keyboard frame, and distinct hidden/drawer/view/retired states are modeled. The source campaign drives the real callbacks, reads the original closure fields, and records pointer-capture and click suppression calls.',
    'One successful favorite store and no overlapping host mounts are used. Drop is a macrostep across ordered writes. Browser pointer delivery, multi-write refusal, full modal focus trap and native touch acceptance require separate evidence.',
  ]}));
}
