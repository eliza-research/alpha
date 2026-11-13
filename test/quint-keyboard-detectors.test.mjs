// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
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
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// KeyboardDetectors traces from the simulator, replayed on both detectors at once: the chat
// dock's keyboard watch as the shell mounts it (taken from the adapter source, with its covered
// flag read back) and the canvas estimator and arrangement that main.tsx's size() calls. The
// window, its keyboard and the focused composer are the environment.
const {canvasGeometry, keyboardFreeHeight} = await import('../apps/app/src/runtime/canvas-geometry.ts');
const adapter = readFileSync('apps/app/src/prototype/chat-overlay-motion-adapter.ts', 'utf8');
const from = adapter.indexOf('const free = keyboardFreeHeight();'), to = adapter.indexOf('window.visualViewport?.addEventListener("resize", this.dockKeyboardWatch);', from);
assert.ok(from >= 0 && to > from);
const dock = new vm.Script(`globalThis.mountDock = function () { ${stripTypeScriptTypes(adapter.slice(from, to))}
  this.dockCovered = () => keyboardOpen; };`);
const SHORT = 412, LONG = 915;

function fixture(overlay) {
  const env = {portrait: true, keyboard: 0, focused: false};
  let releases = 0, dropKeyboard = false;
  const width = () => env.portrait ? SHORT : LONG, full = () => env.portrait ? LONG : SHORT;
  const visual = () => full() - env.keyboard, layout = () => overlay ? full() : visual();
  class HTMLElement {}
  const composer = Object.assign(new HTMLElement(), {editable: true, matches: selector => selector === '[data-alpha-composer]',
    // A blurred field loses its keyboard once this resize has been handled.
    blur() { env.focused = false; releases++; dropKeyboard = true; }});
  const context = vm.createContext({keyboardFreeHeight, isEditing: element => !!element?.editable, HTMLElement,
    document: {get activeElement() { return env.focused ? composer : null; },
      documentElement: {dataset: {}, get clientWidth() { return width(); }, get clientHeight() { return layout(); }}},
    window: {addEventListener() {}, get innerWidth() { return width(); }, get innerHeight() { return layout(); },
      visualViewport: {get height() { return visual(); }, addEventListener() {}}}});
  dock.runInContext(context);
  const shell = {};
  context.mountDock.call(shell);
  const estimator = keyboardFreeHeight(), published = {free: estimator(width(), layout(), false), landscape: false};
  return {
    apply({action, picks}) {
      if (action === 'focus') env.focused = true;
      else if (action === 'blur') { env.focused = false; env.keyboard = 0; }
      else if (action === 'raise') env.keyboard = picks.height;
      else if (action === 'lower') env.keyboard = 0;
      else if (action === 'rotate') env.portrait = !env.portrait;
      else if (action === 'resize') {
        // The shell's listener was added first, so the dock looks before the canvas is sized.
        shell.dockKeyboardWatch();
        const input = {width: width(), layoutHeight: layout(), available: visual(), desktop: false, fluid: true, launcher: false,
          screenShort: SHORT, editing: env.focused};
        published.free = estimator(input.width, input.layoutHeight, input.editing);
        published.landscape = canvasGeometry(input, published.free).landscape;
        if (dropKeyboard) env.keyboard = 0;
        dropKeyboard = false;
      } else assert.fail(`unmapped action ${action}`);
    },
    observe: () => ({focused: env.focused, keyboard: env.keyboard, ...published, open: shell.dockCovered(), releases: Math.min(releases, 3)}),
  };
}

test("partial source contract: simulated KeyboardDetectors traces agree with the dock watch and the canvas estimator after every step", {timeout: scaledTimeout(120000)}, async () => {
  const traces = modelTraces({module: 'KeyboardDetectors', traces: 150, steps: 40});
  assert.ok(traces.some(trace => trace.some(step => step.state.releasedUnderBar)), 'the campaign swaps the full keyboard for the short bar');
  const result = await replay(traces, {
    start: ({state}) => fixture(state.overlay),
    project: s => ({focused: s.focused, keyboard: s.keyboard, free: s.free, landscape: s.landscape, open: s.open, releases: s.releases}),
  });
  assert.deepEqual([...result.exercised].sort(), ['blur', 'focus', 'lower', 'raise', 'resize', 'rotate']);
});
