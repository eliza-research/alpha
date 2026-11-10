import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const source = 'apps/app/src/prototype/chat-overlay-motion-adapter.ts';
function between(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'The actual keyboard callback boundaries exist');
  return text.slice(first, last);
}
function fixture() {
  const text = readFileSync(source, 'utf8');
  const code = between(text, 'function clearScrimPress(', 'function watchDockScrimPress(') +
    between(text, '\t\tconst free = keyboardFreeHeight();', '\n\t};\n\tp.componentDidUpdate');
  const dom = new JSDOM('<textarea data-alpha-composer>keep</textarea><input id="other">');
  const {window} = dom, {document} = window;
  const composer = document.querySelector('textarea'), other = document.querySelector('input');
  let height = 800, hidden = false;
  Object.defineProperty(window, 'innerHeight', {get: () => height});
  Object.defineProperty(window, 'innerWidth', {value: 400});
  Object.defineProperty(window, 'visualViewport', {value: {get height() {return height;}, addEventListener() {}}});
  Object.defineProperty(document, 'hidden', {get: () => hidden});
  Object.defineProperty(document.documentElement, 'clientHeight', {value: 800});
  Object.defineProperty(document.documentElement, 'clientWidth', {value: 400});
  const shell = {chatInputFocused: false, chatScrimPress: undefined};
  vm.runInNewContext('(function(){' + stripTypeScriptTypes(code, {mode: 'strip'}) +
    ';this.observeKeyboard=()=>({native:nativeKeyboardVisible===undefined?-1:nativeKeyboardVisible?1:0,covered:keyboardOpen});}).call(shell)',
    {shell, window, document, HTMLElement: window.HTMLElement, keyboardFreeHeight: () => () => 800, isEditing: element => element === composer});
  composer.setSelectionRange(2, 2);
  return {
    observe() {
      const state = {...shell.observeKeyboard(),
        focus: document.activeElement === composer ? 'composer' : document.activeElement === other ? 'other' : 'none',
        draft: composer.value, selection: composer.selectionStart};
      return Object.fromEntries(Object.entries(state).map(([key, value]) => ['s.' + key, value]));
    },
    run(name, args) {
      if (name === 'tapComposer') composer.focus();
      else if (name === 'tapOther') other.focus();
      else if (name === 'nativeVisibility') window.dispatchEvent(new window.CustomEvent('alpha-keyboard-visibility', {detail: {visible: args[0], handoff: args[1]}}));
      else if (name === 'viewport') {height = args[0] ? 500 : 800; shell.dockKeyboardWatch();}
      else if (name === 'background') {hidden = true; shell.dockHiddenWatch(); hidden = false;}
      else throw Error('Unknown keyboard action');
    },
    close: () => dom.window.close(),
  };
}

export async function checkKeyboardFocus(extraSources = []) {
  const sources = [source, 'android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java',
    'test/support/strip-types.mjs', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const scenarios = [
    ['floating Back and one-tap reopen', [['tapComposer'], ['nativeVisibility', true, false], ['nativeVisibility', false, false], ['tapComposer'], ['nativeVisibility', false, false]]],
    ['initial hidden event keeps composer', [['tapComposer'], ['nativeVisibility', false, false]]],
    ['Back does not blur another field', [['nativeVisibility', true, false], ['tapOther'], ['nativeVisibility', false, false]]],
    ['browser viewport fallback', [['tapComposer'], ['viewport', true], ['viewport', false]]],
    ['native visibility owns resize ordering', [['tapComposer'], ['nativeVisibility', true, false], ['viewport', true], ['viewport', false], ['nativeVisibility', false, false]]],
    ['voice keyboard handoff keeps editor', [['tapComposer'], ['nativeVisibility', true, false], ['nativeVisibility', false, true], ['nativeVisibility', true, false], ['nativeVisibility', false, false]]],
    ['background preserves draft and selection', [['tapComposer'], ['background'], ['tapOther'], ['background']]],
  ];
  const traces = scenarios.map(([name, actions]) => {
    const actual = fixture();
    try {
      const trace = {name, expect: actual.observe(), steps: []};
      for (const [action, ...args] of actions) {
        actual.run(action, args);
        trace.steps.push({label: action, action: {name: action, args}, expect: actual.observe()});
      }
      return trace;
    } finally {actual.close();}
  });
  return checkTraces({model: 'KeyboardFocus', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual renderer IME/viewport and background callbacks execute in a DOM. Focus, draft and selection come from real DOM fields; the test-only getter reads the actual closure state.',
    'Viewport geometry and native inset notifications are controlled input. MainActivity is source-bound but Android event delivery is not executed by this component campaign.',
    'Two fields, one retained draft and cursor, native visibility/handoff, browser resize and background are covered. Installed IME switching, STT, accessibility delivery and Pixel behavior remain separate proof.',
  ]});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkKeyboardFocus(), null, 2));
