import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Issues #416 and #417: Android's shade is the one notification and quick-settings surface.
// The dependency-free decision region of the renderer module, evaluated without a browser. What
// Android does with the request is device evidence (SystemShadeInstrumentedTest), not shown here.
const read = file => readFileSync(file, 'utf8');
const source = read('apps/app/src/prototype/system-shade.ts');
const region = source.slice(source.indexOf('// system-shade:begin'), source.indexOf('// system-shade:end'));
assert.ok(region.length > 200, 'system-shade region is present');
const m = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(region, { mode: 'strip' })).toString('base64'));

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

test('product builds draw no Alpha shade; the template gates the development stand-in', () => {
  const template = read('apps/app/src/prototype/template.html');
  const layer = template.indexOf('data-alpha-layer="shade"');
  assert.ok(layer > 0);
  // The last gate opened before the layer is the simulated-shade gate.
  assert.match(template.slice(0, layer), /<sc-if value="\{\{simulatedShade\}\}">\s*<sc-if value="\{\{isOn\}\}">\s*<div $/);
  // Home has no notifications control: a pull on empty Home and Android's own swipe are the ways in.
  assert.doesNotMatch(template, /showShadeButton|data-alpha-shade-handle|aria-controls="alpha-notifications"/);
  const model = read('apps/app/src/prototype/model.js');
  assert.match(model, /shadeY: isOn && S\.shade && this\.simulatedShade\(\) \? "0" : "-100%"/);
  assert.match(model, /simulatedShade\(\) \{ return this\.props\.systemShade === "simulated"; \}/);
  const main = read('apps/app/src/main.tsx');
  assert.match(main, /const systemShade=shadeSurface\(\{native:isAndroid,simulated:devSurfacesEnabled\}\);/);
  assert.match(main, /systemShell=\{launcherPresentation\} systemShade=\{systemShade\}/);
});

test('the launcher flavor alone requests EXPAND_STATUS_BAR and the plugin reports every outcome', () => {
  const launcher = read('android/app/src/launcher/AndroidManifest.xml');
  const main = read('android/app/src/main/AndroidManifest.xml');
  assert.match(launcher, /<uses-permission android:name="android\.permission\.EXPAND_STATUS_BAR" \/>/);
  assert.doesNotMatch(main, /EXPAND_STATUS_BAR/, 'the standalone app does not drive the system shade');
  const shade = read('android/app/src/main/java/ai/elizaresearch/alphaphone/SystemShade.java');
  assert.match(shade, /if \(!launcher\) return STANDALONE;\s*if \(!platform\.granted\(PERMISSION\)\) return PERMISSION_MISSING;/);
  assert.match(shade, /getMethod\("expandNotificationsPanel"\)\.invoke\(service\);\s*return OPENED;/);
  assert.match(shade, /catch \(ReflectiveOperationException \| RuntimeException refused\) \{[\s\S]*?return UNSUPPORTED;/);
  const plugin = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java');
  assert.match(plugin, /@PluginMethod public void openNotificationShade\(PluginCall call\)\{/);
  assert.match(plugin, /!activity\.hasWindowFocus\(\)\)out\.put\("status","not-in-front"\);\s*else out\.put\("status",SystemShade\.expand\(getContext\(\),BuildConfig\.IS_LAUNCHER\)\);/);
});

test('an overflowing Home takes only a clearly downward drag at its top from the WebView', () => {
  assert.equal(m.overflowPullDecision(false, 0, 40), 'release', 'not eligible: scrolled, editable, standalone or covered');
  assert.equal(m.overflowPullDecision(true, 2, 3), 'wait', 'inside the slop');
  assert.equal(m.overflowPullDecision(true, 0, m.PULL_SLOP), 'claim');
  assert.equal(m.overflowPullDecision(true, 3, 20), 'claim', 'a slightly diagonal pull');
  assert.equal(m.overflowPullDecision(true, 0, -20), 'release', 'upward scrolls Home as usual');
  assert.equal(m.overflowPullDecision(true, 30, 10), 'release', 'horizontal: a card row or Back');
});
