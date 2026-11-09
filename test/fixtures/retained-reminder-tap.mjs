import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const adapter = new URL('../../apps/app/src/prototype/reminder-adapter.ts', import.meta.url);
const presentation = new URL('../../apps/app/src/runtime/reminder-creations.ts', import.meta.url);
const journal = new URL('../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts', import.meta.url);
const contract = new URL('reminder-contract.ts', journal);
export const retainedReminderTapSources = [import.meta.url, adapter, presentation, journal, contract,
  new URL('../support/strip-types.mjs', import.meta.url)].map(fileURLToPath);

const original = 'original-token', newer = 'newer-token', exact = 'reminder:retained-reminder';
const target = {sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: 'retained-reminder',
  occurrenceId: 'first', revision: 'b'.repeat(64), timingVersion: 2};
const reminder = {id: target.reminderId, title: 'Saved synthetic reminder', body: 'Only fixture text',
  at: 1_003_600_000, dueAt: 1_003_600_000, alertMinutes: 0, status: 'posted', occurrenceId: target.occurrenceId, target};
const turn = () => new Promise(resolve => setImmediate(resolve));

/** The actual adapter holds after its Calendar open; all custody and rendering ports are local. */
export async function retainedReminderTapFixture() {
  const strip = source => stripTypeScriptTypes(source.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''));
  const source = readFileSync(presentation, 'utf8');
  const start = source.indexOf('export function reminderEvents('), end = source.indexOf('/** Specific, stable reason');
  assert.ok(start >= 0 && end > start, 'The actual reminder row projector must remain available');
  const code = strip(source.slice(start, end)) + '\n' + strip(readFileSync(adapter, 'utf8'));
  const {reminderDueAt: dueOf, isUndatedReminder, overdueReminders, undatedTodos} = await import(journal.href);
  const calendar = {}, document = new EventTarget(), window = new EventTarget(), views = {calendar: {state: {}, render: () => ({})}};
  const connection = {open: false}, agentContext = {sensitive: false};
  const bridge = new Map(), subscribers = new Set(), callbacks = [], attempts = [], consumed = [];
  let pending = {}, view = 'home', visit = 0, captured = '', capturedVisit = 0, blockedConsume = false;
  document.hidden = false;
  class Shell {
    live = true;
    reminderTodoVersion = 1;
    componentDidMount() {}
    componentWillUnmount() {}
    S() {return {view};}
    vget() {return calendar;}
    vset(_view, patch) {Object.assign(calendar, patch);}
    openView(next, patch) {view = next;visit++;if (next === 'calendar') Object.assign(calendar, patch);}
    goHome() {view = 'home';visit++;}
    back() {}
    toast() {}
    setState(_patch, commit) {
      assert.equal(typeof commit, 'function');
      assert.equal(callbacks.length, 0);
      assert.equal(view, 'calendar');
      assert.equal(calendar.open, exact);
      captured = pending.token;
      capturedVisit = visit;
      callbacks.push(commit);
    }
  }
  const DailyApps = {
    async surfaceInfo() {return {reminderTapVersion: 1};},
    async pendingReminderTap() {return structuredClone(pending);},
    async listReminders() {return {reminders: [structuredClone(reminder)]};},
    async consumeReminderTap({token}) {
      attempts.push(token);
      blockedConsume ||= document.hidden || connection.open || agentContext.sensitive || !!calendar.form ||
        view !== 'calendar' || visit !== capturedVisit || calendar.open !== exact;
      if (pending.token !== token || !pending.retained) throw Error('Synthetic native tap changed');
      consumed.push(token);
      pending = {};
    },
    async addListener(name, listener) {
      bridge.set(name, listener);
      return {remove() {bridge.delete(name);}};
    },
  };
  const context = vm.createContext({Shell, views, document, window, DailyApps, queueMicrotask,
    Capacitor: {isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true},
    connectionController: {getSnapshot: () => connection, subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }},
    alphaClient: {getState: () => ({context: agentContext})},
    reminderCreations: async () => ({}), reconcileReminderCreations: async () => 0,
    reconcileReminderDeletions: async () => 0, dueOf, isUndatedReminder, overdueReminders, undatedTodos,
  });
  vm.runInContext(code + '\ninstallReminderAdapter(Shell, views);', context);
  const shell = new Shell();
  shell.componentDidMount();
  await turn();
  assert.equal(callbacks.length, 0);
  return {
    async deliver() {
      pending = {token: original, target, retained: true};
      bridge.get('pendingReminderTap')();
      await turn();
      assert.equal(callbacks.length, 1, 'Actual reminder adapter awaits render');
    },
    replaceToken() {pending = {...pending, token: newer};},
    async set(field, value) {
      if (field === 'chooser') {
        connection.open = value;
        subscribers.forEach(listener => listener());
      } else if (field === 'sensitive') agentContext.sensitive = value;
      else if (field === 'form') shell.vset('calendar', {form: value ? {title: 'New draft'} : null});
      else if (field === 'foreground') document.hidden = !value;
      else assert.fail('Unexpected fixture field ' + field);
      await turn();
    },
    navigate(next) {shell.openView(next, next === 'calendar' ? {open: exact} : {});},
    changeDetail() {shell.vset('calendar', {open: 'different-detail'});},
    async commit() {
      assert.equal(callbacks.length, 1);
      callbacks.shift()();
      await turn();
    },
    observe: () => ({view, visit, detail: view === 'calendar' && calendar.open === exact,
      captured, capturedVisit, waiting: callbacks.length === 1, pending: pending.token || '',
      chooser: connection.open, sensitive: agentContext.sensitive, form: !!calendar.form, foreground: !document.hidden,
      attempts: [...attempts], consumed: [...consumed], blockedConsume}),
  };
}
