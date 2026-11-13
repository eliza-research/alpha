import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// InlineModalGestures traces from the simulator, replayed on createInlineModal in a document.
// The document stands in for the page (the assistant's composer and a native dialog above). What
// a browser does is supplied here: layout boxes, inert, computed style read from the inline
// style, pointer capture, moving focus by one on an unhandled Tab, and handing focus back when
// the dialog above closes. This shows the modal's own key and pointer rules, not a browser's.
const bundled = await build({entryPoints: [resolve('apps/app/src/runtime/inline-modal.ts')], bundle: true, format: 'esm', platform: 'node', write: false});
const {createInlineModal} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const PAGE = `<div class="os"><div id="page"><button id="page-control">Page</button></div>
  <div data-alpha-layer="composer"><textarea id="assistant"></textarea></div><div id="slot"></div></div>
  <dialog id="native"><button id="above">Above</button></dialog>`;
const ON_DIALOG = -1, ON_ASSISTANT = -2, NOWHERE = -3, ABOVE = -4, POINTER = 7;
// Pointer positions: the grip area is the dialog's top 80 px; a pull of 72 px or more dismisses.
const MOVES = {up: [0, -30], short: [0, 40], far: [0, 100], side: [200, 0]};

function fixture() {
  const dom = new JSDOM(PAGE, {pretendToBeVisual: true}), {window} = dom, {document} = window;
  const proto = window.HTMLElement.prototype;
  proto.getClientRects = function () { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; };
  proto.setPointerCapture = function () {};
  Object.defineProperty(proto, 'inert', {configurable: true, get() { return this.hasAttribute('inert'); }, set(value) { this.toggleAttribute('inert', !!value); }});
  for (const name of ['document', 'window', 'HTMLElement', 'Element', 'MutationObserver'])
    globalThis[name] = name === 'window' ? window : name === 'document' ? document : window[name];
  const SHEET = {bottom: '0px', borderTopLeftRadius: '16px'}, CARD = {bottom: 'auto', borderTopLeftRadius: '0px'};
  globalThis.getComputedStyle = node => node.dataset.sheet ? SHEET : CARD;
  const element = id => document.getElementById(id);
  let closes = 0, lastClose = '', gesture = '', container = null, dialog = null;
  const modal = createInlineModal(() => { closes++; lastClose = gesture; });
  const buttons = () => [...dialog.querySelectorAll('button')];
  const place = at => at >= 0 ? buttons()[at] : at === ON_DIALOG ? dialog : at === ON_ASSISTANT ? element('assistant') : null;
  const pointer = (type, target, x, y) => {
    const event = new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
    Object.defineProperty(event, 'pointerId', {value: POINTER});
    target.dispatchEvent(event);
  };
  return {
    async apply({action, picks}, before) {
      gesture = '';
      if (action === 'mount') {
        container = document.createElement('div');
        container.innerHTML = `<div role="dialog"${picks.flag ? ' data-sheet="1"' : ''}><div class="grip"></div>${'<button>Control</button>'.repeat(picks.count)}</div>`;
        dialog = container.firstElementChild;
        element('slot').append(container);
        modal.ref(container);
      } else if (action === 'unmount') { modal.ref(null); container.remove(); container = dialog = null; }
      else if (action === 'tab') {
        gesture = 'tab';
        const active = document.activeElement, items = buttons();
        const event = new window.KeyboardEvent('keydown', {key: 'Tab', shiftKey: picks.flag, bubbles: true, cancelable: true});
        active.dispatchEvent(event);
        // An unhandled Tab is the browser's: one control forward or back.
        if (!event.defaultPrevented) {
          const next = items[items.indexOf(active) + (picks.flag ? -1 : 1)];
          assert.ok(next, 'an unhandled Tab has a neighbouring control inside the dialog');
          next.focus();
        }
      } else if (action === 'escape') {
        gesture = 'escape';
        document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      } else if (action === 'focusAssistant') element('assistant').focus();
      else if (action === 'controlLeaves') buttons().at(-1).remove();
      else if (action === 'controlArrives') dialog.append(Object.assign(document.createElement('button'), {textContent: 'Control'}));
      else if (action === 'dialogOpensAbove') { element('native').setAttribute('open', ''); element('above').focus(); }
      else if (action === 'dialogAboveCloses') {
        document.activeElement.blur(); element('native').removeAttribute('open');
        place(before.resume)?.focus();
      } else if (action === 'press') {
        const control = buttons()[0];
        if (picks.place === 'grip') pointer('pointerdown', dialog.firstElementChild, 100, 10);
        else if (picks.place === 'control' && control) pointer('pointerdown', control, 100, 10);
        else pointer('pointerdown', dialog, 100, 200);
      } else if (action === 'move') pointer('pointermove', dialog, 100 + MOVES[picks.kind][0], 10 + MOVES[picks.kind][1]);
      else if (action === 'lift') { gesture = 'drag'; pointer('pointerup', dialog, 100, 10); }
      else if (action === 'pointerCancel') pointer('pointercancel', dialog, 100, 10);
      else assert.fail(`unmapped action ${action}`);
      await tick();
    },
    observe() {
      const active = document.activeElement, at = dialog ? buttons().indexOf(active) : -1;
      const focus = at >= 0 ? at : dialog && active === dialog ? ON_DIALOG : active?.id === 'assistant' ? ON_ASSISTANT
        : active?.id === 'above' ? ABOVE : active === document.body ? NOWHERE : 'elsewhere';
      const drawn = dialog?.style.translate || '', pulled = drawn ? parseFloat(drawn.split(' ')[1]) : 0;
      return {focus, controls: dialog ? buttons().length : 0, closes, lastClose, displaced: drawn !== '',
        pull: pulled >= 72 ? 2 : pulled > 0 ? 1 : 0, gripLocked: !!dialog && dialog.firstElementChild.style.touchAction === 'none'};
    },
    close() { if (container) { modal.ref(null); container.remove(); } window.close(); },
  };
}

test('simulated InlineModalGestures traces agree with createInlineModal after every step', {timeout: 170000}, async () => {
  const traces = modelTraces({module: 'InlineModalGestures', traces: 300, steps: 40});
  const result = await replay(traces, {
    start: fixture,
    project: s => ({focus: s.focus, controls: s.controls, closes: s.closes, lastClose: s.lastClose, displaced: s.displaced, pull: s.pull,
      gripLocked: s.mounted && s.sheet}),
  });
  assert.deepEqual([...result.exercised].sort(), ['controlArrives', 'controlLeaves', 'dialogAboveCloses', 'dialogOpensAbove', 'escape',
    'focusAssistant', 'lift', 'mount', 'move', 'pointerCancel', 'press', 'tab', 'unmount']);
  const reached = traces.flat().map(step => step.state);
  assert.ok(reached.some(s => s.lastClose === 'escape') && reached.some(s => s.wraps > 0) && reached.some(s => s.reentries > 0),
    'an Escape close, a wrapped Tab and a focus re-entry were replayed');
});

// Random traces seldom hold a drag long enough to release it, so the model's own drag scenarios
// are replayed step by step with the values those scenarios expect.
test('the sheet drag scenarios of InlineModalGestures hold on createInlineModal', async () => {
  const run = async (steps, expected) => {
    const modal = fixture();
    let resume = NOWHERE;
    for (const [action, picks = {}] of steps) {
      if (action === 'dialogOpensAbove') resume = modal.observe().focus;
      await modal.apply({action, picks}, {resume});
    }
    const seen = modal.observe();
    modal.close();
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, seen[key]])), expected, steps.map(([action]) => action).join(' '));
  };
  const sheet = ['mount', {flag: true, count: 1}], grip = ['press', {place: 'grip'}], far = ['move', {kind: 'far'}];
  // farPullDismissesSheetTest
  await run([sheet, grip, far], {displaced: true, pull: 2, closes: 0});
  await run([sheet, grip, far, ['lift']], {closes: 1, lastClose: 'drag', displaced: false});
  // shortPullSpringsBackTest
  await run([sheet, grip, ['move', {kind: 'short'}], ['lift']], {closes: 0, displaced: false});
  // sidewaysMoveAbandonsDragTest
  await run([sheet, grip, far, ['move', {kind: 'side'}], ['lift']], {closes: 0, displaced: false});
  // onlyTheGripDragsTest
  await run([sheet, ['press', {place: 'control'}], far, ['lift']], {closes: 0, displaced: false});
  await run([sheet, ['press', {place: 'low'}], far, ['lift']], {closes: 0, displaced: false});
  await run([['mount', {flag: false, count: 1}], grip, far, ['lift']], {closes: 0, displaced: false});
  // dialogAboveOwnsEscapeAndDragTest
  await run([['mount', {flag: true, count: 2}], grip, far, ['dialogOpensAbove'], ['escape'], ['lift']], {closes: 0, displaced: false, focus: ABOVE});
  await run([['mount', {flag: true, count: 2}], grip, far, ['dialogOpensAbove'], ['escape'], ['lift'], ['dialogAboveCloses'], ['escape']],
    {closes: 1, lastClose: 'escape', focus: 0});
  // A cancelled pointer and an unmount both put the sheet back without closing.
  await run([sheet, grip, far, ['pointerCancel'], ['lift']], {closes: 0, displaced: false});
  await run([sheet, grip, far, ['unmount']], {closes: 0, displaced: false, gripLocked: false});
});
