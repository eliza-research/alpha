import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {tsImport} from 'tsx/esm/api';
import {root} from './shell-model-traces.mjs';

/*
 * The shell's own state methods from prototype/model.js, compiled as a class without React or a
 * DOM: state reads (S), timer groups, toasts, per-view state, navigation, Back, the shade entry
 * points, the pull context, scripted voice and the lock-screen camera entry. Timers are held, not run, so a driver
 * fires exactly the one a model step stands for. The shared navigation reducer is the pinned one.
 */
const model = readFileSync(join(root, 'apps/app/src/prototype/model.js'), 'utf8');
function between(from, to) {
  const start = model.indexOf(from), end = model.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `shell source between ${from} and ${to}`);
  return model.slice(start, end);
}
const methods = between('\n  S() {', '\n  /* ---- gestures ---- */');
const voice = between('\n  startVoice() {', '\n  showHeads() {');
const pullContext = between('\n  pullContext() {', '\n  sw(fn, opts) {');
const lockCamera = between('      lockCamera: function () {', '\n      msgs: msgs,').replace(/^\s*lockCamera: function \(\) \{/, '').replace(/\},\s*$/, '');
const base = between('\nvar BASE = {', '\n};') + '\n};';
const {navigateMobileShell} = await tsImport(join(root, '.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts'), import.meta.url);

/**
 * `views` are the registered view definitions (their `chat`, `back`, `onLeave`); `globals` adds
 * or replaces names the shell source reads (the document, the shade wording, a window).
 */
export function shellCore({views, globals = {}}) {
  const timers = new Map();
  let nextTimer = 0;
  const arm = kind => (run, delay) => { timers.set(++nextTimer, {run, delay, kind}); return nextTimer; };
  const disarm = id => { timers.delete(id); };
  const context = vm.createContext({
    VIEWS: views, DEFERRED_MVP_VIEWS: new Set(), isMvpView: key => key in views, navigateMobileShell,
    accessibilityTimeoutScale: () => 1, shadeFallback: outcome => `shade:${outcome}`, externalVoiceInvocationEnabled: true,
    VOICE: {locked: 'ab', fallback: 'cd', lockedAnswer: 'locked answer'}, QUICK_SETTINGS: {mic: true},
    ALPHA_PRODUCT: {identity: {characterName: 'Alpha'}}, IC: {}, PEOPLE: [], person: () => null,
    setTimeout: arm('timeout'), clearTimeout: disarm, setInterval: arm('interval'), clearInterval: disarm,
    document: {activeElement: null, querySelector: () => null}, structuredClone, console, ...globals,
  });
  vm.runInContext(`${base}
class Shell {
  constructor(props) { this.props = props || {}; this.state = structuredClone(BASE); this.G = {}; this.I = {}; this.toasts = []; }
  setState(patch, done) {
    if (typeof patch === 'function') patch = patch(this.state);
    Object.assign(this.state, patch);
    if (this.componentDidUpdate) this.componentDidUpdate();
    if (done) done();
  }
  reply() { return { text: 'ok' }; }
  showHeads() {}
  lockCamera() { var P = this.props, self = this; ${lockCamera} }
${methods}
${voice}
${pullContext}
}
globalThis.Shell = Shell;`, context);
  const {Shell} = context, toast = Shell.prototype.toast;
  Shell.prototype.toast = function (message, options) { this.toasts.push(message); return toast.call(this, message, options); };
  return {
    Shell, context, timers,
    /** Evaluates more shell source beside the class (a view's handlers and the helpers they call). */
    run: code => vm.runInContext(code, context),
    /** Runs the pending timer with this delay; an interval stays armed. */
    fire(delay, kind = 'timeout') {
      const found = [...timers].find(([, timer]) => timer.delay === delay && timer.kind === kind);
      assert.ok(found, `a pending ${kind} of ${delay} ms`);
      if (kind === 'timeout') timers.delete(found[0]);
      found[1].run();
    },
    pending: (delay, kind = 'timeout') => [...timers.values()].some(timer => timer.delay === delay && timer.kind === kind),
    /** Timer groups of this shell that still hold a pending timer. */
    armed: shell => [...new Set([...Object.entries(shell.G), ...Object.entries(shell.I)]
      .filter(([, ids]) => ids.some(id => timers.has(id))).map(([group]) => group))].sort(),
  };
}
