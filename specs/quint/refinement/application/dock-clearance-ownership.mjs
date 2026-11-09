import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, captureSources, checkpoint, read, tick, trace, call} from './support.mjs';

const model = 'DockClearanceOwnership';
const modelPath = 'specs/quint/application/DockClearanceOwnership.qnt';
const host = 'apps/app/src/runtime/dock-clearance.ts';
const shared = 'packages/ui/src/components/shell/dock-clearance.ts';
const effective = '.eliza/client-features/' + shared;
const projection = '.eliza/client-features/.source.json';
const screenFocus = '.eliza/client-features/packages/ui/src/accessibility/screen-focus.ts';
const strip = text => stripTypeScriptTypes(text, {mode: 'strip'})
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');

function fixture(name, code) {
  const dom = new JSDOM(`<div data-screen data-alpha-chat-half="true">
    <header data-alpha-app-header>App</header>
    <div data-alpha-layer="conversation"><header data-alpha-chat-header>Chat</header></div>
    <div data-alpha-layer="composer"><div data-alpha-input-bar>Input</div></div>
  </div>`);
  const {window} = dom, {document} = window;
  const screen = document.querySelector('[data-screen]');
  const conversation = screen.querySelector('[data-alpha-layer="conversation"]');
  const dock = screen.querySelector('[data-alpha-layer="composer"]');
  const bar = dock.firstElementChild;
  const app = screen.querySelector('[data-alpha-app-header]');
  const chat = screen.querySelector('[data-alpha-chat-header]');
  let frameId = 0, scale = 1, shape = 1, appBottom = 60, chatBottom = 140;
  const rect = bottom => ({top: 10, bottom: 10 + bottom * scale, width: 400 * scale});
  Object.defineProperties(screen, {
    offsetWidth: {get: () => 400}, clientHeight: {get: () => 600},
  });
  screen.getBoundingClientRect = () => rect(600);
  for (const [node, bottom] of [[app, () => appBottom], [chat, () => chatBottom]]) {
    node.getBoundingClientRect = () => rect(bottom());
    node.getClientRects = () => node.isConnected && bottom() ? [rect(bottom())] : [];
  }
  const depth = () => shape === 2 ? 110 : 80;
  const rest = () => shape === 2 ? 60 : 40;
  Object.defineProperties(dock, {offsetTop: {get: () => 600 - depth()}, offsetParent: {get: () => screen}});
  Object.defineProperties(bar, {offsetTop: {get: () => depth() - rest()}, offsetParent: {get: () => dock}});
  dock.getClientRects = () => dock.isConnected ? [rect(depth())] : [];

  const frames = new Map(), observers = new Set();
  class ResizePort {
    targets = new Set();
    constructor(callback) {
      this.callback = callback;
      observers.add(this);
    }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  }
  const deliver = nodes => {
    for (const observer of observers) if (nodes.some(node => observer.targets.has(node))) observer.callback();
  };
  const context = vm.createContext({document, window, Element: window.Element, HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver, ResizeObserver: ResizePort,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); }});
  code.runInContext(context);
  const handles = new Map();
  const value = name => {
    const text = document.documentElement.style.getPropertyValue('--alpha-' + name);
    assert.ok(text === '' || /^\d+px$/.test(text));
    return text ? Number.parseInt(text, 10) : -1;
  };
  const observe = () => ({
    'state.installed': [...handles].find(([, stop]) => stop === context.current())?.[0] ?? 0,
    'state.generation': handles.size,
    'state.screen': screen.isConnected,
    'state.scale': screen.getBoundingClientRect().width / screen.offsetWidth,
    'state.conversation': !conversation.hasAttribute('inert'),
    'state.half': screen.dataset.alphaChatHalf === 'true',
    'state.dock': dock.hasAttribute('inert') ? 0 : shape,
    'state.appBottom': appBottom,
    'state.chatBottom': chatBottom,
    'state.clearance': value('dock-clearance'),
    'state.rest': value('dock-rest'),
    'state.header': value('header-clearance'),
  });
  const result = trace(name, observe());
  async function save(label, ...action) {
    for (let pass = 0; pass < 5; pass++) {
      await tick();
      if (!frames.size) {
        checkpoint(result, label, call(...action), observe());
        return;
      }
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback();
    }
    assert.fail('header and dock publishers did not settle');
  }
  return {
    result,
    end: () => { context.current()?.(); window.close(); },
    async install() {
      const previous = context.current(), stop = context.install();
      if (previous) assert.equal(stop, previous);
      else handles.set(handles.size + 1, stop);
      await save('install the exact paired layout publishers', 'install');
    },
    async dispose(owner) {
      const stop = handles.get(owner);
      assert.ok(stop);
      stop();
      await save('retire the exact installed layout publishers', 'dispose', owner);
    },
    async screen(value) {
      if (value) document.body.append(screen);
      else screen.remove();
      await save('the screen is replaced or restored by the renderer', 'screen', value);
    },
    async conversation(value) {
      conversation.toggleAttribute('inert', !value);
      await save('the conversation becomes exposed or inert', 'conversation', value);
    },
    async split(value) {
      screen.dataset.alphaChatHalf = String(value);
      await save('split chat changes without resizing the header', 'splitChat', value);
    },
    async scale(value) {
      scale = value;
      document.documentElement.style.setProperty('--fixture-screen-scale', String(value));
      await save('root style and geometry change at the same layout scale', 'setScale', value);
    },
    async dock(value) {
      shape = value;
      dock.toggleAttribute('inert', value === 0);
      deliver([dock, bar]);
      await save('dock geometry or retirement is observed', 'changeDock', value);
    },
    async headers(appHeight, chatHeight) {
      appBottom = appHeight;
      chatBottom = chatHeight;
      deliver([app, chat]);
      await save('watched header dimensions change', 'headers', appHeight, chatHeight);
    },
  };
}

export async function checkDockClearanceOwnership() {
  const sources = [fileURLToPath(import.meta.url), host, 'vendor/eliza/' + shared, effective, projection, screenFocus,
    'apps/app/src/main.tsx', 'apps/app/src/prototype/template.html'];
  captureSources([...sources, modelPath]);
  const stamp = JSON.parse(read(projection));
  const codeText = read(effective);
  const digest = createHash('sha256').update(codeText).digest('hex');
  assert.equal(stamp.files[shared], digest);
  assert.equal(stamp.sourceFiles[shared], digest);
  assert.equal(read('vendor/eliza/' + shared), codeText);
  const focusText = read(screenFocus);
  assert.equal(createHash('sha256').update(focusText).digest('hex'), stamp.files['packages/ui/src/accessibility/screen-focus.ts']);
  const code = new vm.Script(`const {isExposed, NATIVE_DIALOG_SELECTOR} = (() => {
${strip(focusText)}
return {isExposed, NATIVE_DIALOG_SELECTOR};
})();
const {installDockClearance: installSharedDockClearance, visibleDocks: sharedVisibleDocks} = (() => {
${strip(codeText)}
return {installDockClearance, visibleDocks};
})();
${strip(read(host))}
globalThis.install = installDockClearance; globalThis.current = () => installed;`);
  const traces = [];
  async function run(name, sequence) {
    const owner = fixture(name, code);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { owner.end(); }
  }
  await run('front_header_changes_without_geometry_mutation', async f => {
    await f.install(); await f.split(false); await f.conversation(false);
    await f.conversation(true); await f.split(true);
  });
  await run('dock_retirement_retains_last_clearance', async f => {
    await f.install(); await f.dock(0); await f.scale(2); await f.dock(2); await f.dock(1);
  });
  await run('screen_restore_reads_current_geometry', async f => {
    await f.install(); await f.screen(false); await f.split(false); await f.headers(100, 60);
    await f.headers(100, 140); await f.screen(true); await f.headers(100, 100);
  });
  await run('old_cleanup_cannot_erase_replacement', async f => {
    await f.install(); await f.install(); await f.dispose(1); await f.dock(2);
    await f.install(); await f.dispose(1); await f.dispose(2);
  });
  await run('scaled_header_and_absent_dock_at_install', async f => {
    await f.dock(0); await f.scale(2); await f.install(); await f.headers(0, 140);
    await f.split(false); await f.dock(1);
  });

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-component',
    assumptions: ['Actual product and prepared shared layout observers execute on synthetic geometry and settled frames.',
      'One screen and one layout dock. Physical Android insets, installed font scaling, and focus scrolling have separate evidence.']}));
}
