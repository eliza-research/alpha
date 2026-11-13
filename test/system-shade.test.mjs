import test from 'node:test';
import assert from 'node:assert/strict';

const shared = await import('../.eliza/client-features/plugins/plugin-native-system/src/client/shade.ts');
const copy = shared.defaultShadeFallbackCopy('Alpha');
const m = { ...shared, shadeFallback: outcome => shared.shadeFallback(outcome, copy) };

const home = { launcher: true, assistant: false, screen: 'home', view: null, chat: 'input', voice: 'off', drawer: false, secure: false, shade: false };
const empty = { home: true, editable: false, keyboard: false, scrolled: false };
const pull = (context = {}, start = {}, startY = 300, dx = 0, dy = 120) => m.emptyHomeShadePull({ ...home, ...context }, start === null ? null : { ...empty, ...start }, startY, dx, dy);

test('Android answers on the phone; only the browser development build simulates it', () => {
  assert.equal(m.shadeSurface({ native: true, simulated: false }), 'android');
  // A test-mocks APK is still Android: no simulated shade on a phone.
  assert.equal(m.shadeSurface({ native: true, simulated: true }), 'android');
  assert.equal(m.shadeSurface({ native: false, simulated: true }), 'simulated');
  assert.equal(m.shadeSurface({ native: false, simulated: false }), 'none');
});

test('a clear downward pull on empty launcher Home asks for the shade', () => {
  assert.equal(pull(), true);
  assert.equal(pull({}, {}, 300, 40, 120), true, 'a slightly diagonal pull still counts');
});

test('the standalone app and the assistant surface follow ordinary app behaviour', () => {
  assert.equal(pull({ launcher: false }), false);
  assert.equal(pull({ assistant: true }), false);
});

test('Home with something over it is not empty Home', () => {
  for (const context of [{ view: 'settings' }, { chat: 'sheet' }, { chat: 'full' }, { voice: 'listening' }, { drawer: true }, { secure: true }, { shade: true }, { screen: 'lock' }, { screen: 'boot' }])
    assert.equal(pull(context), false, JSON.stringify(context));
  // The resting composer and the hidden pill leave Home empty.
  assert.equal(pull({ chat: 'hidden' }), true);
});

test('content, keyboard and Android\'s status bar band keep their gestures', () => {
  assert.equal(pull({}, { scrolled: true }), false, 'scrolled content scrolls back first');
  assert.equal(pull({}, { editable: true }), false, 'a text field keeps its drag');
  assert.equal(pull({}, { keyboard: true }), false, 'the keyboard may be up');
  assert.equal(pull({}, { home: false }), false, 'outside Home (composer, sheet, an app)');
  assert.equal(pull({}, null), false, 'unknown start');
  assert.equal(pull({}, {}, m.STATUS_BAND - 1), false, 'the status bar band is Android\'s own');
  assert.equal(pull({}, {}, m.STATUS_BAND), true);
});

test('only a clearly downward pull counts', () => {
  assert.equal(pull({}, {}, 300, 0, 46), false, 'below the threshold');
  assert.equal(pull({}, {}, 300, 0, -120), false, 'upward is the conversation sheet');
  assert.equal(pull({}, {}, 300, 100, 120), false, 'diagonal: a card row or Back');
  assert.equal(pull({}, {}, 300, 0, Number.NaN), false);
});

test('the fallback never claims Android opened its shade', () => {
  assert.equal(m.shadeFallback('opened'), '');
  for (const outcome of ['standalone', 'permission-missing', 'unsupported', 'not-in-front', undefined, null, 'surprise']) {
    const text = m.shadeFallback(outcome);
    assert.match(text, /Swipe down from the top edge of the screen/, String(outcome));
    assert.doesNotMatch(text, /\bopened\b/i, String(outcome));
  }
});

test('an overflowing Home takes only a clearly downward drag at its top from the WebView', () => {
  assert.equal(m.overflowPullDecision(false, 0, 40), 'release', 'not eligible: scrolled, editable, standalone or covered');
  assert.equal(m.overflowPullDecision(true, 2, 3), 'wait', 'inside the slop');
  assert.equal(m.overflowPullDecision(true, 0, m.PULL_SLOP), 'claim');
  assert.equal(m.overflowPullDecision(true, 3, 20), 'claim', 'a slightly diagonal pull');
  assert.equal(m.overflowPullDecision(true, 0, -20), 'release', 'upward scrolls Home as usual');
  assert.equal(m.overflowPullDecision(true, 30, 10), 'release', 'horizontal: a card row or Back');
});

test('the overflow pull listens to touches only while Home is showing, and still claims a pull there', async () => {
  const { tsImport } = await import('./support/ts-import.mjs');
  const { installSystemShade } = await tsImport('../apps/app/src/prototype/system-shade.ts', import.meta.url);
  class FakeElement {
    constructor(attrs = {}, parent = null) { Object.assign(this, { attrs, parentElement: parent, scrollTop: 0, scrollHeight: 100, clientHeight: 100, ownerDocument: doc }); }
    matches(selector) { return selector.split(',').some(part => { const attr = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(part.trim()); return !!attr && attr[1] in this.attrs && (attr[2] === undefined || this.attrs[attr[1]] === attr[2]); }); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    getBoundingClientRect() { return { top: 0, width: 412 }; }
  }
  const listeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
    querySelector: () => null,
  };
  doc.body = new FakeElement();
  doc.activeElement = doc.body;
  const screen = new FakeElement({ 'data-screen': '' }, doc.body);
  const layer = new FakeElement({ 'data-alpha-layer': 'home', overflow: 'auto' }, screen);
  const tile = new FakeElement({}, layer);
  layer.scrollHeight = 400;
  const saved = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, getComputedStyle: globalThis.getComputedStyle, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  Object.assign(globalThis, {
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    Element: FakeElement,
    getComputedStyle: node => ({ overflowY: node.attrs.overflow ?? 'visible' }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  });
  try {
    class Shell {
      constructor() { this.state = { ...home }; }
      pullContext() { return { ...this.state }; }
    }
    installSystemShade(Shell, { native: false });
    const shell = new Shell();
    const touchTypes = () => ['touchstart', 'touchmove', 'touchend', 'touchcancel'].filter(type => listeners.has(type));
    shell.componentDidMount();
    assert.equal(touchTypes().length, 4, 'listening on Home');
    const touch = y => { let prevented = false; return { event: { target: tile, cancelable: true, touches: [{ clientX: 100, clientY: y }], preventDefault: () => { prevented = true; } }, prevented: () => prevented }; };
    listeners.get('touchstart')(touch(300).event);
    const down = touch(320);
    listeners.get('touchmove')(down.event);
    assert.equal(down.prevented(), true, 'a downward pull at the top of an overflowing Home is claimed');
    listeners.get('touchend')();
    shell.state.view = 'notes';
    shell.componentDidUpdate();
    assert.deepEqual(touchTypes(), [], 'no touch listeners while an app is open');
    shell.state.view = null;
    shell.componentDidUpdate();
    assert.equal(touchTypes().length, 4, 'listening again back on Home');
    shell.state.screen = 'lock';
    shell.componentDidUpdate();
    assert.deepEqual(touchTypes(), [], 'none on the lock screen');
    shell.state.screen = 'home';
    shell.componentDidUpdate();
    shell.componentWillUnmount();
    assert.deepEqual(touchTypes(), [], 'removed on unmount');
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
