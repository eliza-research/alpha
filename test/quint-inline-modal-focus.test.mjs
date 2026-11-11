import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// InlineModalFocus traces from the simulator, replayed on createInlineModal in a document. The
// document stands in for the page (an opening control, another control, the assistant's composer
// and a native dialog); what a browser does with inert content and layout is supplied here, so
// this shows the modal's own focus rules, not a browser's.
const bundled = await build({entryPoints: [resolve('apps/app/src/runtime/inline-modal.ts')], bundle: true, format: 'esm', platform: 'node', write: false});
const {createInlineModal} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const PAGE = `<div class="os"><div id="page"><button id="opener">Open</button><button id="other">Other</button></div>
  <div data-alpha-layer="composer"><textarea id="assistant"></textarea></div><div id="slot"></div></div>
  <dialog id="native"><button id="above">Above</button></dialog>`;

function fixture(covers) {
  const dom = new JSDOM(PAGE, {pretendToBeVisual: true}), {window} = dom, {document} = window;
  const proto = window.HTMLElement.prototype;
  // Layout and inert are the browser's: every connected, shown element has a box, and inert reflects its attribute.
  proto.getClientRects = function () { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; };
  Object.defineProperty(proto, 'inert', {configurable: true, get() { return this.hasAttribute('inert'); }, set(value) { this.toggleAttribute('inert', !!value); }});
  for (const name of ['document', 'window', 'HTMLElement', 'Element', 'MutationObserver', 'getComputedStyle'])
    globalThis[name] = name === 'window' ? window : name === 'document' ? document : window[name];
  const element = id => document.getElementById(id), opener = element('opener');
  let closes = 0, restores = 0, driving = false, container = null;
  opener.addEventListener('focus', () => { if (!driving) restores++; });
  const modal = createInlineModal(() => { closes++; }, () => opener, {coverAssistant: covers});
  const drive = act => { driving = true; try { act(); } finally { driving = false; } };
  // The owner opens the modal from its opening control.
  drive(() => opener.focus());
  return {
    async apply({action, picks}) {
      if (action === 'mount') {
        container = document.createElement('div');
        container.innerHTML = '<div role="dialog"><button id="inside">Close</button></div>';
        element('slot').append(container);
        modal.ref(container);
      } else if (action === 'unmount') { modal.ref(null); container.remove(); container = null; }
      else if (action === 'focusMoves') drive(() => picks.place === 'body' ? document.activeElement.blur() : element(picks.place).focus());
      else if (action === 'nativeOpens') { element('native').setAttribute('open', ''); element('above').focus(); }
      // A closing native dialog hands focus back to what held it before, or to nothing.
      else if (action === 'nativeCloses') { document.activeElement.blur(); element('native').removeAttribute('open'); if (container) element('inside').focus(); }
      else if (action === 'dismiss') window.dispatchEvent(new window.Event('alpha-back', {cancelable: true}));
      else if (action === 'openerLeaves') { if (document.activeElement === opener) opener.blur(); opener.hidden = true; }
      else if (action === 'openerReturns') opener.hidden = false;
      else if (action === 'waitEnds') this.timers.tick(1000);
      else assert.fail(`unmapped action ${action}`);
      await tick();
    },
    observe() {
      const active = document.activeElement;
      const focus = active === opener ? 'opener' : active?.id === 'inside' || active?.getAttribute?.('role') === 'dialog' ? 'modal'
        : active?.id === 'assistant' ? 'assistant' : active === document.body ? 'body' : 'other';
      return {focus, closes: Math.min(closes, 3), restores: Math.min(restores, 3)};
    },
    close() { if (container) { modal.ref(null); container.remove(); } window.close(); },
  };
}

test('simulated InlineModalFocus traces agree with createInlineModal after every step', {timeout: 170000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const traces = modelTraces({module: 'InlineModalFocus', traces: 120, steps: 30});
  const result = await replay(traces, {
    start: ({state}) => Object.assign(fixture(state.covers), {timers: t.mock.timers}),
    project: s => ({focus: s.focus, closes: s.closes, restores: s.restores}),
  });
  assert.deepEqual([...result.exercised].sort(), ['dismiss', 'focusMoves', 'mount', 'nativeCloses', 'nativeOpens', 'openerLeaves',
    'openerReturns', 'unmount', 'waitEnds']);
});
