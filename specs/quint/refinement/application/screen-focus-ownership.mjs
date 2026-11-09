import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, captureSources, checkpoint, read, tick, trace, call} from './support.mjs';

const model = 'ScreenFocusOwnership';
const modelPath = 'specs/quint/application/ScreenFocusOwnership.qnt';
const host = 'apps/app/src/runtime/view-focus.ts';
const shared = 'packages/ui/src/accessibility/screen-focus.ts';
const effective = '.eliza/client-features/' + shared;
const projection = '.eliza/client-features/.source.json';
const manifest = 'patches/eliza/screen-focus-priority-client-manifest.json';
const strip = text => stripTypeScriptTypes(text, {mode: 'strip'})
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function fixture(name, code) {
  const dom = new JSDOM(`<main>
    <textarea id="composer"></textarea><div id="home" data-alpha-layer="home" aria-label="Home"></div>
    <h1 id="title" data-alpha-app-title>Settings</h1>
    <div id="region" data-alpha-layer="app" role="region" aria-label="Settings"></div>
  </main>`);
  const {window} = dom, {document} = window;
  const elements = ['body', 'composer', 'home', 'title', 'region', 'drawer'];
  const element = id => document.getElementById(elements[id]);
  const identifier = value => Math.max(0, elements.indexOf(value?.id));
  // DOM mutations, focusin/blur and installed observers are real. JSDOM has no layout engine.
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden],[inert],[aria-hidden="true"]') ? [] : [{}];
  };
  window.HTMLElement.prototype.checkVisibility = function () {
    return this.getClientRects().length > 0;
  };
  const frames = new Map();
  let serial = 0;
  window.requestAnimationFrame = callback => {
    frames.set(++serial, callback);
    return serial;
  };
  window.cancelAnimationFrame = id => frames.delete(id);
  const context = vm.createContext({document, MutationObserver: window.MutationObserver});
  code.runInContext(context);
  const handles = new Map();
  const observe = () => {
    const installed = [...handles].find(([, handle]) => handle === context.current())?.[0] ?? 0;
    const coordinator = installed ? context.inspectFocus() : null;
    const frame = coordinator?.frame ?? 0;
    assert.equal(frames.size, frame ? 1 : 0);
    if (frame) assert.ok(frames.has(frame));
    const view = document.documentElement.dataset.activeView;
    return {
      'state.installed': installed,
      'state.generation': handles.size,
      'state.screen': view === undefined ? -1 : view === 'home' ? 0 : 1,
      'state.active': identifier(document.activeElement),
      'state.held': identifier(coordinator?.held),
      'state.composer': !element(1).hidden,
      'state.title': !element(3).hidden,
      'state.region': !element(4).hidden,
      'state.drawer': Boolean(element(5)),
      'state.selfFocus': Boolean(document.querySelector('dialog[open]')),
      'state.phase': frame ? (frames.get(frame).name === 'step' ? 2 : 1) : 0,
      'state.cause': coordinator?.cause ?? 'idle',
      'state.remaining': frame ? coordinator.remaining : 0,
    };
  };
  const result = trace(name, observe());
  const save = async (label, ...action) => {
    await tick();
    checkpoint(result, label, call(...action), observe());
  };
  const event = name => window.dispatchEvent(new window.Event(name));
  return {
    result,
    end: () => { context.current()?.(); window.close(); },
    async install() {
      const previous = context.current(), stop = context.install();
      if (previous) assert.equal(stop, previous);
      else handles.set(handles.size + 1, stop);
      await save('install or reuse the exact focus observer', 'install');
    },
    async dispose(owner) {
      const stop = handles.get(owner);
      assert.ok(stop);
      stop();
      await save('retire only the exact focus observer', 'dispose', owner);
    },
    async screen(value) {
      document.documentElement.dataset.activeView = value === 0 ? 'home' : 'settings';
      await save('the host reports a screen change or first presentation', 'screen', value);
    },
    async home() {
      event('launcher-home');
      await save('launcher HOME queues dropped-focus recovery', 'home');
    },
    async resize() {
      event('resize');
      await save('the shared observer handles resize after a real focus event', 'resize');
    },
    async focus() {
      element(1).focus();
      await save('the person focuses the composer', 'focus', 1);
    },
    async blur() {
      document.activeElement.blur();
      await save('the person or retired element drops focus to body', 'blur');
    },
    async composer(value) {
      if (!value && document.activeElement === element(1)) element(1).blur();
      element(1).hidden = !value;
      await save('rotation retires the previously focused control', 'composerVisible', value);
    },
    async names(title, region) {
      if ((!title && document.activeElement === element(3)) ||
          (!region && document.activeElement === element(4))) document.activeElement.blur();
      element(3).hidden = !title;
      element(4).hidden = !region;
      await save('title and fallback region change while rendering', 'appName', title, region);
    },
    async drawer(open) {
      if (open) {
        const drawer = document.createElement('div');
        drawer.id = 'drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-label', 'Apps');
        document.body.append(drawer);
      } else element(5).remove();
      await save('the shell mounts or removes a labelled inline drawer', 'drawer', open);
    },
    async selfFocused(open) {
      if (open) {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.append(dialog);
      } else document.querySelector('dialog[open]').remove();
      await save('a native dialog manages its own focus', 'selfFocused', open);
    },
    async frame() {
      assert.equal(frames.size, 1);
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback();
      await save('advance one actual scheduled animation frame', 'frame');
    },
  };
}

export async function checkScreenFocusOwnership() {
  const sources = [fileURLToPath(import.meta.url), host, 'vendor/eliza/' + shared, effective, projection, manifest,
    'apps/app/src/main.tsx'];
  captureSources([...sources, modelPath]);
  const stamp = JSON.parse(read(projection));
  const reviewed = JSON.parse(read(manifest));
  const prepared = read(effective);
  const sha = text => createHash('sha256').update(text).digest('hex');
  assert.equal(sha(prepared), reviewed.afterSha256);
  assert.equal(sha(read('vendor/eliza/' + shared)), reviewed.beforeSha256);
  assert.equal(stamp.screenFocusPriorityPatch.manifestSha256, sha(read(manifest)));
  assert.equal(stamp.files[shared], reviewed.afterSha256);
  const marker = '  return {\n    screenChanged: () => schedule(),';
  assert.equal(prepared.split(marker).length, 2);
  const inspect = `  globalThis.inspectFocus = () => ({frame, remaining, held,
    cause: !frame ? "idle" : allowed === screenChangeAllowed ? "screen" : "resize"});\n`;
  const code = new vm.Script(strip(prepared.replace(marker, inspect + marker)) +
    `\n${strip(read(host))}\nglobalThis.install = installViewFocus; globalThis.current = () => installed;`);
  const traces = [];
  async function run(name, sequence) {
    const owner = fixture(name, code);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { owner.end(); }
  }
  await run('first_screen_then_exact_navigation', async f => {
    await f.install(); await f.screen(0); await f.focus(); await f.blur();
    await f.screen(1); await f.resize(); await f.frame(); await f.frame();
  });
  await run('voluntary_blur_and_resize_budget', async f => {
    await f.install(); await f.screen(0); await f.focus(); await f.blur(); await f.resize();
    for (let i = 0; i < 13; i++) await f.frame();
  });
  await run('rotation_retires_held_control', async f => {
    await f.install(); await f.screen(0); await f.focus(); await f.composer(false);
    await f.resize(); await f.frame(); await f.frame();
  });
  await run('late_name_and_inline_drawer', async f => {
    await f.install(); await f.screen(0); await f.names(false, false); await f.screen(1);
    await f.frame(); await f.frame(); await f.names(false, true); await f.frame();
    await f.blur(); await f.drawer(true); await f.frame(); await f.frame();
    await f.drawer(false); await f.home(); await f.frame(); await f.frame();
  });
  await run('real_focus_and_modal_win', async f => {
    await f.install(); await f.screen(0); await f.focus(); await f.screen(1);
    await f.frame(); await f.frame(); await f.blur(); await f.selfFocused(true); await f.home();
    await f.frame(); await f.frame(); await f.selfFocused(false); await f.frame();
  });
  await run('stale_dispose_preserves_replacement', async f => {
    await f.install(); await f.screen(0); await f.home(); await f.dispose(1);
    await f.install(); await f.dispose(1); await f.home(); await f.frame(); await f.frame();
  });

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-component',
    assumptions: ['Actual prepared coordinator and Alpha focus owner execute. A read-only test hook captures private scheduling state.',
      'The DOM fixture controls geometry, animation frames and overlay existence. Captured resize callback identity is covered through observed behavior.',
      'Installed TalkBack, physical rotation timing and mounted modal shapes beyond the focused browser tests remain separate.']}));
}
