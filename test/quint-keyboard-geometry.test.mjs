import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// KeyboardGeometry traces from the simulator, replayed on the estimator and canvas decision that
// main.tsx's size() calls. The window (orientation, keyboard, focus) is the environment; the
// test keeps it and measures exactly where the model measures.
const {canvasGeometry, keyboardFreeHeight, WIDE_CANVAS} = await import('../apps/app/src/runtime/canvas-geometry.ts');
const KEYBOARD = 300;

test('simulated KeyboardGeometry traces agree with the estimator and canvas after every measurement', {timeout: 120000}, async () => {
  const traces = modelTraces({module: 'KeyboardGeometry', traces: 80, steps: 30});
  const result = await replay(traces, {
    start({state}) {
      const short = state.compact ? 360 : 412, long = state.compact ? 640 : 915;
      const window = {portrait: true, keyboard: false, focused: false};
      let estimator = keyboardFreeHeight();
      // What size() last published; canvasWidth starts at the reference canvas.
      const published = {free: 0, landscape: false, wide: false, canvasWidth: 412};
      return {
        apply({action}) {
          if (action === 'focus') window.focused = true;
          else if (action === 'showKeyboard') window.keyboard = true;
          else if (action === 'hideKeyboard') window.keyboard = false;
          else if (action === 'blur') { window.focused = false; window.keyboard = false; }
          else if (action === 'rotate') window.portrait = !window.portrait;
          // A reloaded document has no focused field or keyboard, and its shell starts a new estimator.
          else if (action === 'remount') { window.focused = false; window.keyboard = false; estimator = keyboardFreeHeight(); }
          else if (action === 'measure') {
            const width = window.portrait ? short : long;
            const layoutHeight = (window.portrait ? long : short) - (window.keyboard ? KEYBOARD : 0);
            const input = {width, layoutHeight, available: layoutHeight, desktop: false, fluid: true, launcher: false,
              screenShort: short, editing: window.focused};
            const free = estimator(width, layoutHeight, input.editing), geometry = canvasGeometry(input, free);
            Object.assign(published, {free, landscape: geometry.landscape, wide: geometry.wide, canvasWidth: width / geometry.scale});
            assert.equal(geometry.wide, published.canvasWidth >= WIDE_CANVAS);
          } else assert.fail(`unmapped action ${action}`);
        },
        observe: () => ({...published}),
      };
    },
    project: s => ({free: s.free, landscape: s.landscape, wide: s.wide, canvasWidth: s.canvasWidth}),
  });
  assert.deepEqual([...result.exercised].sort(), ['blur', 'focus', 'hideKeyboard', 'measure', 'remount', 'rotate', 'showKeyboard']);
});
