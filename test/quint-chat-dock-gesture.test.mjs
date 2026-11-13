import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// ChatDock traces from the simulator, replayed on the gesture adapter itself: installChatOverlayMotion
// patches a shell class whose chat controls (openSheet, toInput, grabTap, startVoice) and
// swallowed() are the lines of prototype/model.js, in a jsdom page. Every press, move, release,
// cancellation, late click, toolbar activation, close, navigation and clock tick of a trace runs
// through the adapter's own handlers. The shared pull recogniser is stood in for: the driver calls
// paintChatMotion, tapChatMotion and settleChatMotion where the recogniser would, with the offset,
// direction and release speed the trace picks. Layout is jsdom's (no boxes), so paints are not checked.
const bundled = await build({entryPoints: [resolve('apps/app/src/prototype/chat-overlay-motion-adapter.ts')], bundle: true,
  format: 'esm', platform: 'node', write: false, logLevel: 'silent'});
const {installChatOverlayMotion} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const model = readFileSync('apps/app/src/prototype/model.js', 'utf8');
const line = start => { const at = model.indexOf(`\n      ${start}`); assert.ok(at >= 0, start); return model.slice(at + 1, model.indexOf('\n', at + 1)); };
const controls = ['openSheet: function () {', 'toInput: function () {', 'grabTap: function () {', 'startVoice: function () {'].map(line).join('\n');
const swallowed = model.match(/\n  swallowed\(\) \{ (return [^\n]+;) \}\n/);
assert.ok(swallowed, 'the shell swallowed() source');
const baseControls = new Function('self', 'assistantOnly', `return {\n${controls}\n};`);

const TICK = 180, WINDOW = 2;
const PAGE = `<div data-alpha-layer="conversation"></div>
  <div data-alpha-input-bar><div data-alpha-input-drag-background id="handle">
    <textarea data-alpha-composer id="focus"></textarea>
    <button aria-label="Open conversation" id="open"></button><button aria-label="Type" id="type"></button>
    <button aria-label="Talk" id="talk"></button><button aria-label="Resize chat" id="resize"></button></div></div>
  <div data-alpha-layer="pill"><div></div></div><button data-alpha-chat-size id="toolbar"></button>`;

function fixture() {
  const dom = new JSDOM(PAGE, {pretendToBeVisual: true}), {window} = dom, {document} = window;
  for (const name of ['document', 'window', 'HTMLElement', 'HTMLTextAreaElement', 'Element', 'MutationObserver', 'getComputedStyle'])
    globalThis[name] = name === 'window' ? window : name === 'document' ? document : window[name];
  // Frames only repaint rows; pointer capture is the browser's.
  globalThis.requestAnimationFrame = () => 0;
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  const element = id => document.getElementById(id);
  let release = () => {};
  class Shell {
    constructor() {
      this.live = true;
      this.state = {view: null, screen: 'home', chat: 'input', voice: 'off', shade: false};
      this.props = {configureChatPull() {}, chatPullBinding: {onPointerDown() {}, onPointerMove() {}, onPointerUp: () => release(),
        onPointerCancel() {}, onLostPointerCapture() {}}};
    }
    S() { return this.state; }
    setState(patch, done) {
      const previous = {...this.state};
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
      this.out = this.renderVals();
      this.componentDidUpdate({}, previous);
      if (done) done();
    }
    rest() { return this.state.view === 'pillView' ? 'hidden' : 'input'; }
    startVoice() { this.setState({voice: 'listening'}); }
    renderVals() { return {...baseControls(this, false), draft: '', showComposer: this.state.chat === 'input', showSugg: false}; }
  }
  Shell.prototype.swallowed = new Function(swallowed[1]);
  installChatOverlayMotion(Shell);
  const shell = new Shell();
  shell.out = shell.renderVals();
  shell.componentDidMount();
  let stamp = 1000;
  const Y = 600, pointer = (target, clientY, timeStamp) => ({isPrimary: true, button: 0, pointerId: 7, pointerType: 'touch', target,
    currentTarget: element('handle'), clientY, timeStamp, stopPropagation() {}, preventDefault() {}});
  const drag = offset => { stamp += 50; shell.out.grabSw.move(pointer(element('handle'), Y - offset, stamp)); shell.paintChatMotion(offset); };
  const age = since => Math.min(WINDOW, Math.floor((Date.now() - (since || 0)) / TICK));
  return {
    apply({action, picks}, before) {
      stamp += 1000;
      if (action === 'down') shell.out.grabSw.down(pointer(element(picks.label === 'none' ? 'handle' : picks.label), Y, stamp));
      else if (action === 'move') drag(24);
      else if (action === 'tap') { release = () => shell.tapChatMotion(); shell.out.grabSw.up(pointer(element('handle'), Y, stamp)); }
      else if (action === 'settle') {
        const d = shell.chatMotion, zone = Math.min(120, (d.full - d.floor) / 3), collapsed = d.mode === 'input' || d.mode === 'hidden';
        // A released height inside the picked zone and a real distance from where the drag began.
        const heights = picks.zone === 'floor' ? [d.floor + 30, d.floor + 60] : picks.zone === 'top' ? [d.full - 30, d.full - 60]
          : [(d.floor + d.full) / 2, (d.floor + d.full) / 2 + 60];
        const height = heights.find(value => Math.abs(value - d.start) >= 24);
        assert.ok(height > d.floor + (picks.zone === 'floor' ? 0 : zone) && height < d.full - (picks.zone === 'top' ? 0 : zone) + 1, 'the zone holds the height');
        const offset = collapsed && picks.direction === 'down' ? -40 : height - d.start;
        // A flick is fast over the last samples in its direction; otherwise the finger rests before it lifts.
        if (picks.flick) drag(offset + (picks.direction === 'up' ? -150 : 150));
        drag(offset);
        release = () => shell.settleChatMotion(picks.direction);
        shell.out.grabSw.up(pointer(element(picks.over === 'none' ? 'handle' : picks.over), Y - offset, stamp + (picks.flick ? 20 : 400)));
        if (picks.flick) assert.equal(d.flick, picks.direction, 'the release speed is a flick');
        else assert.equal(d.flick, undefined, 'a rested finger is no flick');
      }
      else if (action === 'cancel') window.dispatchEvent(new window.Event('blur'));
      else if (action === 'lateClick') {
        const label = before.ghostLabel;
        if (label === 'open') shell.out.openSheet();
        else if (label === 'type') shell.out.toInput();
        else if (label === 'talk') shell.out.startVoice();
        else if (label === 'resize' || label === 'toolbar') shell.out.grabTap({detail: 1, currentTarget: element(label)});
      }
      // After the drag window a pointer tap on the size button counts; inside it only a keyboard activation does.
      else if (action === 'sizeButton') shell.out.grabTap({detail: before.dragAge >= WINDOW ? 1 : 0, currentTarget: element('toolbar')});
      else if (action === 'closeChat') shell.out.closeChat();
      else if (action === 'navigate') shell.setState({view: picks.view || null, chat: picks.view === 'pillView' ? 'hidden' : 'input'});
      else if (action === 'voiceEnds') shell.setState({voice: 'off'});
      else if (action === 'tick') this.timers.tick(TICK);
      else assert.fail(`unmapped action ${action}`);
    },
    observe() {
      const d = shell.chatMotion, s = shell.S();
      return {view: s.view || '', chat: s.chat, voice: s.voice !== 'off',
        drag: d ? {active: true, mode: d.mode, view: d.view || '', moved: d.moved} : {active: false, mode: '', view: '', moved: false},
        remembered: shell.chatSheetShare !== undefined, swallowAge: age(shell.swallow), dragAge: age(shell.chatDraggedAt)};
    },
    close() { shell.componentWillUnmount(); window.close(); },
  };
}

test('simulated ChatDock traces agree with the chat gesture adapter after every step', {timeout: 170000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1_000_000});
  const traces = modelTraces({module: 'ChatDock', traces: 300, steps: 40});
  const result = await replay(traces, {
    start: () => Object.assign(fixture(), {timers: t.mock.timers}),
    project: s => ({view: s.view, chat: s.chat, voice: s.voice,
      drag: {active: s.drag.active, mode: s.drag.mode, view: s.drag.view, moved: s.drag.moved},
      remembered: s.remembered, swallowAge: s.swallowAge, dragAge: s.dragAge}),
  });
  assert.deepEqual([...result.exercised].sort(), ['cancel', 'closeChat', 'down', 'lateClick', 'move', 'navigate', 'settle',
    'sizeButton', 'tap', 'tick', 'voiceEnds']);
});
