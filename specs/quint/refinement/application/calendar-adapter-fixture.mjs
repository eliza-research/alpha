import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const entry = `
export {installCalendarAdapter} from './apps/app/src/prototype/calendar-adapter.ts';
export {installCalendarFormDraftAdapter, calendarFormRetained} from './apps/app/src/prototype/calendar-form-draft-adapter.ts';
export {installCalendarEditDraftAdapter} from './apps/app/src/prototype/calendar-edit-draft-adapter.ts';
export {reminderEvents, reminderWallTime} from './apps/app/src/runtime/reminder-creations.ts';
`;
// Ports the adapters reach through other modules. The adapters, calendar-days, the form and
// edit draft codecs and the reminder row projection in the bundle are the real sources.
const ports = [
  [/calendar-interval-presentation$/, 'presentation'], [/(^|\/)deletions$/, 'deletions'], [/reminder-recovery$/, 'recovery'],
  [/calendar-recovery$/, 'recovery'], [/platform-plugins$/, 'plugins'], [/^@capacitor\/core$/, 'capacitor'],
  [/(^|\/)daily$/, 'daily'], [/maps-event-return$/, 'maps'], [/note-origin-adapter$/, 'origin'],
  [/native-connection$/, 'secure'], [/reminder-creation-document$/, 'document'], [/canvas-geometry$/, 'geometry'],
  [/assistant-draft-controller$/, 'drafts'], [/assistant-draft-store$/, 'drafts'], [/domain-recovery$/, 'recovery'],
  [/dev-profile$/, 'profile'],
  [/browser\/review$/, 'reviews'], [/connection-ui$/, 'connection'], [/alpha-client$/, 'client'],
];
const closures = [
  ['let creationPending = null, creationRecoveryFailed = false, creationDraftEpoch = 0, creationReadEpoch = 0;',
    '__ports.probe.creations = () => ({pending: creationPending, failed: creationRecoveryFailed, draftEpoch: creationDraftEpoch});'],
  ['let agentSelection, agentSelectionKey = "", agentSelectionEpoch = 0;',
    '__ports.probe.selection = () => ({selection: agentSelection, key: agentSelectionKey, epoch: agentSelectionEpoch});'],
];

/** `mutate` rewrites the bundled adapters, for checks that a replay notices a changed implementation. */
export async function buildCalendarAdapter(mutate = code => code) {
  const built = await build({absWorkingDir: root, stdin: {contents: entry, resolveDir: root, loader: 'ts'}, bundle: true,
    platform: 'node', format: 'cjs', write: false, metafile: true, plugins: [{name: 'calendar-adapter-ports', setup(builder) {
      for (const [filter, name] of ports) builder.onResolve({filter}, () => ({path: name, namespace: 'calendar-port'}));
      builder.onLoad({filter: /.*/, namespace: 'calendar-port'}, ({path}) =>
        ({loader: 'js', contents: `module.exports = __ports[${JSON.stringify(path)}];`}));
    }}]});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.includes(':') && !path.startsWith('node_modules/'));
  for (const needed of ['apps/app/src/prototype/calendar-adapter.ts', 'apps/app/src/prototype/calendar-form-draft-adapter.ts',
    'apps/app/src/prototype/calendar-edit-draft-adapter.ts', 'apps/app/src/prototype/calendar-days.ts',
    'apps/app/src/runtime/reminder-creations.ts']) assert.ok(sources.includes(needed), needed);
  // The adapter's epochs and receipts live in its closure; expose them read-only.
  let code = built.outputFiles[0].text;
  for (const [declaration, probe] of closures) {
    assert.ok(code.includes(declaration), declaration);
    code = code.replace(declaration, declaration + ' ' + probe);
  }
  return {code: mutate(code), sources};
}

const turn = () => new Promise(resolve => setImmediate(resolve));

/**
 * The real calendar adapters installed on a shell whose device calendar, clock, timers and page
 * are local. Native calls answer from `handlers` at once unless a hold was armed for them.
 */
export function calendarAdapterFixture(compiled, {native = true, drafts = false} = {}) {
  const calendar = {events: [], day: 0, month: null, open: null, form: null}, toasts = [], calls = [], held = [], holds = new Map();
  const listeners = new Map(), timers = [], document = new EventTarget(), window = new EventTarget();
  const subscribers = new Set();
  const state = {view: 'calendar', active: true, confirm: true, now: new Date(2027, 0, 15, 12).getTime(), uuid: 0};
  document.hidden = false;
  window.confirm = () => state.confirm;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const crypto = {randomUUID: () => `00000000-0000-4000-8000-${String(++state.uuid).padStart(12, '0')}`};
  // Timers are recorded with their delay and run only when the driver fires them.
  const setTimer = (run, delay) => { const timer = {run, delay, at: state.now + delay, cancelled: false}; timers.push(timer); return timer; };
  const clearTimer = timer => { if (timer) timer.cancelled = true; };
  const handlers = {};
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
  const bridge = () => new Proxy({}, {get: (_target, name) => name === 'addListener'
    ? (event, listener) => { listeners.set(event, listener); return Promise.resolve({remove() { listeners.delete(event); }}); }
    : args => invoke(name, args)});
  class Draft {
    state = {message: '', conflict: false, error: false, savedText: ''};
    open() { return Promise.resolve(); }
    edit() {}
    consume() { return Promise.resolve(); }
    retire() {}
    recovery() {}
  }
  const exposed = {
    presentation: {presentCalendarIntervals() {}},
    deletions: {refreshDeletionViews() {}},
    recovery: {openReminderRecovery() {}, openReminderCreationRecovery() {}, openReminderActionRecovery() {}, openCalendarRecovery() {},
      openDomainRecovery() {}},
    plugins: {registerPlugin: () => bridge()},
    capacitor: {Capacitor: {getPlatform: () => (native ? 'android' : 'web'), isNativePlatform: () => native, isPluginAvailable: () => true}},
    daily: {DailyApps: bridge()},
    maps: {mapsEventOriginFor: () => undefined},
    origin: {rememberNoteOrigin: async () => true, forgetNoteOrigin: async () => true, noteOriginSupported: () => false,
      eventNoteOriginId: () => undefined},
    secure: {secureConnectionStore: {read: async () => null, compareExchange: async () => ({status: 'saved'})}},
    document: {},
    geometry: {currentSurfaceLayout: () => ({split: false, calendarDays: 1, agenda: false})},
    drafts: {AssistantDraftController: Draft, assistantDraftStore: async () => ({})},
    profile: {browserDevProfile: false},
    connection: {connectionController: {getSnapshot: () => ({session: 'session'}),
      subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }}},
    client: {alphaClient: {getState: () => ({context: {view: state.view}}),
      subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }}},
    reviews: {BrowserReviews: class {
      async confirm(_id, _title, _details, _label, guard) {
        return state.confirm && !guard?.signal?.aborted && (!guard?.current || guard.current());
      }
    }},
    probe: {},
  };
  class Shell {
    live = true;
    componentDidMount() {}
    componentDidUpdate() {}
    componentWillUnmount() {}
    S() { return {view: state.view}; }
    vget() { return calendar; }
    vset(_view, patch) { Object.assign(calendar, patch); }
    toast(text) { toasts.push(text); }
    // The reminder adapter's publication: device rows merged into the shown events.
    async refreshReminders() { calendar.events = [...(this.nativeCalendarRows || [])]; }
  }
  const views = {calendar: {state: {}, render(view) {
    state.rendered = view;
    return {f: view.form ? {cals: []} : undefined, ev: view.open ? {notes: '', day: ''} : undefined};
  }}};
  const module = {exports: {}};
  new Function('module', 'exports', '__ports', 'document', 'window', 'crypto', 'Date', 'setTimeout', 'clearTimeout', compiled.code)(
    module, module.exports, exposed, document, window, crypto, FixedDate, setTimer, clearTimer);
  module.exports.installCalendarAdapter(Shell, views);
  if (drafts) {
    module.exports.installCalendarFormDraftAdapter(Shell, views);
    module.exports.installCalendarEditDraftAdapter(Shell, views);
  }
  const api = {get: () => calendar, set: patch => Object.assign(calendar, patch), toast: text => toasts.push(text),
    isActive: () => state.active, open() {}};
  return {
    Shell, views, calendar, toasts, calls, held, listeners, timers, document, window, state, handlers, api, exports: module.exports,
    probe: exposed.probe,
    /** After `skip` further calls of a method, its next `count` calls wait for `settle`. */
    hold(name, count = 1, skip = 0) { holds.set(name, {count, skip}); },
    release(name) { holds.delete(name); },
    waiting: name => held.filter(call => call.name === name).length,
    count: name => calls.filter(call => call.name === name).length,
    /** Answers a held call of `name` (the oldest, or the one `pick` chooses) with `answer(args)`. */
    async settle(name, answer = handlers[name], pick = list => list[0]) {
      const call = pick(held.filter(item => item.name === name));
      assert.ok(call, `No held ${name} call`);
      held.splice(held.indexOf(call), 1);
      try { call.resolve(await answer(call.args)); } catch (error) { call.reject(error); }
      await this.idle();
    },
    /** Lets every continuation that needs no further native answer run. */
    async idle() { for (let index = 0; index < 20; index++) await turn(); },
    /** What React would hand the view: the handlers of the current calendar state. */
    render: () => views.calendar.render(calendar, api),
  };
}
