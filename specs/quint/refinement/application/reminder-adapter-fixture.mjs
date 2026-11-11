import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const implementation = 'apps/app/src/prototype/reminder-adapter.ts';
// Ports the adapter reaches through other modules. Everything else in the bundle is the real
// source: the adapter, reminder-creations, reminder-deletions, reminder-journal-store and the
// shared reminder journal with its contract.
const ports = [
  [/own-notice-question$/, 'question'], [/(^|\/)deletions$/, 'deletions'], [/alpha-client$/, 'client'],
  [/connection-ui$/, 'connection'], [/^@capacitor\/core$/, 'capacitor'], [/(^|\/)daily$/, 'daily'],
  [/note-origin-adapter$/, 'origin'], [/native-connection$/, 'secure'],
  [/reminder-creation-document$/, 'document'], [/reminder-action-document$/, 'document'],
];

/** `mutate` rewrites the bundled adapter, for checks that a replay notices a changed implementation. */
export async function buildReminderAdapter(mutate = code => code) {
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true, platform: 'node',
    format: 'cjs', write: false, metafile: true, plugins: [{name: 'reminder-adapter-ports', setup(builder) {
      for (const [filter, name] of ports) builder.onResolve({filter}, () => ({path: name, namespace: 'reminder-port'}));
      builder.onLoad({filter: /.*/, namespace: 'reminder-port'}, ({path}) =>
        ({loader: 'js', contents: `module.exports = __ports[${JSON.stringify(path)}];`}));
    }}]});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.includes(':') && !path.startsWith('node_modules/'));
  for (const needed of [implementation, 'apps/app/src/runtime/reminder-creations.ts', 'apps/app/src/runtime/reminder-deletions.ts',
    'apps/app/src/runtime/reminder-journal-store.ts']) assert.ok(sources.includes(needed), needed);
  // The tap check's single-flight flags live in the adapter's closure; expose them read-only.
  const flags = 'let tapBusy = false, tapRequested = false, tapInteraction = 0;';
  assert.ok(built.outputFiles[0].text.includes(flags), 'The reminder tap flags must remain available');
  const code = built.outputFiles[0].text.replace(flags, flags +
    ' __ports.probe.tap = () => ({busy: tapBusy, requested: tapRequested, interaction: tapInteraction});'), mutated = mutate(code);
  if (mutate(code) !== code) assert.notEqual(mutated, code);
  return {code: mutated, sources};
}

const turn = () => new Promise(resolve => setImmediate(resolve));

/**
 * The real reminder adapter installed on a shell whose native bridge, secure store, clock and
 * page are local. Native calls answer from `handlers` at once unless a hold was armed for them.
 */
export function reminderAdapterFixture(compiled, {native = true, platform = 'android'} = {}) {
  const calendar = {events: []}, toasts = [], calls = [], held = [], holds = new Map(), listeners = new Map();
  const commits = [], subscribers = new Set(), slots = new Map(), opened = [];
  const document = new EventTarget(), window = new EventTarget();
  const state = {view: 'calendar', active: true, confirm: true, now: Date.UTC(2027, 0, 15, 12), uuid: 0, digests: 0,
    holdCommits: false, sensitive: false, chooser: false, secureFails: false, question: undefined};
  document.hidden = false;
  window.confirm = () => state.confirm;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const crypto = {
    randomUUID: () => `00000000-0000-4000-8000-${String(++state.uuid).padStart(12, '0')}`,
    subtle: {async digest(...args) { state.digests++; try { return await webcrypto.subtle.digest(...args); } finally { state.digests--; } }},
  };
  const handlers = {
    secureRead: ({slot}) => (slots.has(slot) ? JSON.parse(slots.get(slot)) : null),
    addListener(name, listener) { listeners.set(name, listener); return {remove() { listeners.delete(name); }}; },
  };
  function invoke(name, args) {
    calls.push({name, args});
    const armed = holds.get(name);
    if (armed?.skip) armed.skip--;
    else if (armed?.count) {
      armed.count--;
      return new Promise((resolve, reject) => held.push({name, args, resolve, reject}));
    }
    try { return Promise.resolve(handlers[name] ? handlers[name](args) : assert.fail(`Unexpected native call ${name}`)); }
    catch (error) { return Promise.reject(error); }
  }
  const DailyApps = new Proxy({}, {get: (_target, name) => name === 'addListener'
    ? (event, listener) => Promise.resolve(handlers.addListener(event, listener)) : args => invoke(name, args)});
  const secure = {
    // Reads pass through the same hold points as native calls, so a journal write can be paused.
    read: slot => invoke('secureRead', {slot}),
    async compareExchange(slot, expected, next) {
      if (state.secureFails) throw Error('Secure store unavailable');
      if ((slots.get(slot) ?? 'null') !== JSON.stringify(expected ?? null)) return {status: 'changed'};
      if (next === null) slots.delete(slot); else slots.set(slot, JSON.stringify(next));
      return {status: 'saved'};
    },
  };
  const exposed = {
    question: {reviewOwnNoticeQuestion(options) { state.question = options; return () => { if (state.question === options) { state.question = undefined; options.closed(); } }; }},
    deletions: {deletions: {reviewReminder: args => invoke('reviewReminder', args)}, refreshDeletionViews() {},
      reminderDeletionRefusal: status => ({stale: 'This reminder changed. Review it again before deleting.',
        unavailable: 'This reminder is unavailable.'})[status]},
    client: {alphaClient: {getState: () => ({context: {sensitive: state.sensitive}})}},
    connection: {connectionController: {getSnapshot: () => ({open: state.chooser, session: 'session'}),
      getWorkflowDeviceTarget: () => ({device: 'fixture'}),
      subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }}},
    capacitor: {Capacitor: {getPlatform: () => platform, isNativePlatform: () => native, isPluginAvailable: () => true}},
    daily: {DailyApps},
    origin: {rememberNoteOrigin: async () => true, forgetNoteOrigin: async () => true},
    secure: {secureConnectionStore: secure},
    document: {},
    probe: {},
  };
  class Shell {
    live = true;
    componentDidMount() {}
    componentWillUnmount() {}
    S() { return {view: state.view}; }
    vget() { return calendar; }
    vset(_view, patch) { Object.assign(calendar, patch); }
    openView(next, patch) { opened.push({view: next, ...patch}); state.view = next; if (next === 'calendar' && patch) Object.assign(calendar, patch); }
    goHome() { state.view = 'home'; }
    back() {}
    toast(text) { toasts.push(text); }
    setState(_patch, commit) { if (state.holdCommits) commits.push(commit); else commit?.(); }
    api() { return {composeContentQuestion() {}}; }
  }
  const views = {calendar: {state: {}, render: view => ({f: view.form ? {cals: []} : undefined, ev: view.open ? {notes: ''} : undefined})}};
  const module = {exports: {}};
  new Function('module', 'exports', '__ports', 'document', 'window', 'crypto', 'Date', compiled.code)(
    module, module.exports, exposed, document, window, crypto, FixedDate);
  module.exports.installReminderAdapter(Shell, views);
  const api = {get: () => calendar, set: patch => Object.assign(calendar, patch), toast: text => toasts.push(text),
    isActive: () => state.active};
  return {
    Shell, views, calendar, toasts, opened, calls, held, listeners, commits, subscribers, slots, document, window, state, handlers, api,
    /** After `skip` further calls of a method, its next `count` calls wait for `settle`. */
    hold(name, count = 1, skip = 0) { holds.set(name, {count, skip}); },
    release(name) { holds.delete(name); },
    waiting: name => held.filter(call => call.name === name).length,
    count: name => calls.filter(call => call.name === name).length,
    /** Answers the oldest held call of `name` with `answer(args)`; a thrown error rejects it. */
    async settle(name, answer = handlers[name]) {
      const index = held.findIndex(call => call.name === name);
      assert.ok(index >= 0, `No held ${name} call`);
      const [call] = held.splice(index, 1);
      try { call.resolve(await answer(call.args)); } catch (error) { call.reject(error); }
      await this.idle();
    },
    /** Lets every continuation that needs no further native answer run. */
    async idle() {
      for (let round = 0; round < 2; round++) {
        for (let index = 0; index < 10; index++) await turn();
        while (state.digests) await turn();
      }
    },
    /** What React would hand the view: the handlers of the current calendar state. */
    render: () => views.calendar.render(calendar, api),
    tap: () => exposed.probe.tap(),
    journal: slot => (slots.has(slot) ? JSON.parse(slots.get(slot)) : {}),
  };
}
