import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const adapter = new URL('../../apps/app/src/prototype/reminder-adapter.ts', import.meta.url);
const presentation = new URL('../../apps/app/src/runtime/reminder-creations.ts', import.meta.url);
const automations = new URL('../../apps/app/src/prototype/automations-adapter.ts', import.meta.url);
const journal = new URL('../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts', import.meta.url);
const contract = new URL('reminder-contract.ts', journal);
export const reminderOpenIntentSources = [import.meta.url, adapter, presentation, automations, journal, contract,
  new URL('../support/strip-types.mjs', import.meta.url)].map(fileURLToPath);
export const reminderClockOrigin = 1_000_000;

/** Real legacy renderer adapter with an explicitly held list and shell navigation port. */
export async function reminderOpenIntentFixture(initial = 'home') {
  const strip = source => stripTypeScriptTypes(source.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''));
  const source = readFileSync(presentation, 'utf8');
  const start = source.indexOf('export function reminderEvents('), end = source.indexOf('/** Specific, stable reason');
  assert.ok(start >= 0 && end > start);
  const workflow = readFileSync(automations, 'utf8').match(/if\(row\.kind==='device-reminder'\)\{[^\n]+?return;\}/)?.[0];
  assert.ok(workflow, 'The actual Workflows device-reminder row branch must remain available');
  const code = strip(source.slice(start, end)) + '\n' + strip(readFileSync(adapter, 'utf8'));
  const {reminderDueAt: dueOf, isUndatedReminder, overdueReminders, undatedTodos} = await import(journal.href);
  const calendar = {}, opened = [], toasts = [], reads = [], calls = [];
  const clock = {now: reminderClockOrigin}, document = {hidden: false};
  const reminder = {id: 'tapped', title: 'Tapped reminder', body: '', at: clock.now + 3_600_000,
    dueAt: clock.now + 3_600_000, alertMinutes: 0, status: 'scheduled', occurrenceId: 'one', target: {reminderId: 'tapped'}};
  let deferNavigation = false, queuedView = null;
  let settlingVisit = -1, delivery = {kind: 'none', intentVisit: -1, viewVisit: -1};
  class FixedDate extends Date {
    constructor(...args) {super(...(args.length ? args : [clock.now]));}
    static now() {return clock.now;}
  }
  class Shell {
    live = true;
    view = initial;
    reminderTodoVersion = 1;
    componentDidMount() {}
    componentWillUnmount() {}
    S() {return {view: this.view};}
    vget() {return calendar;}
    vset(_view, patch) {Object.assign(calendar, patch);}
    openView(view, patch) {
      calls.push({action: 'openView', view, current: this.view});
      opened.push({view, ...patch});
      if (patch?.events) {
        if (patch.open) assert.equal(patch.open, 'reminder:tapped');
        delivery = {kind: patch.open ? 'detail' : 'calendar', intentVisit: settlingVisit,
          viewVisit: (this.reminderOpenVisit ?? 0) - 1};
      }
      if (deferNavigation) {deferNavigation = false;queuedView = view;}
      else this.view = view;
    }
    goHome() {calls.push({action: 'goHome', current: this.view});this.view = 'home';}
    back() {}
    setState(_patch, done) {done?.();}
    toast(text) {toasts.push(text);}
  }
  const context = vm.createContext({Shell, views: {calendar: {state: {}, render: () => ({})}}, Date: FixedDate, document,
    Capacitor: {getPlatform: () => 'android', isNativePlatform: () => false, isPluginAvailable: () => true},
    reminderCreations: async () => ({}), reconcileReminderCreations: async () => 0, reconcileReminderDeletions: async () => 0,
    dueOf, isUndatedReminder, overdueReminders, undatedTodos,
    DailyApps: {listReminders: () => new Promise((resolve, reject) => {
      const read = {state: 'held', ok(occurrenceId = 'one') {
        settlingVisit = shell.pendingReminderOpen?.visit ?? -1;
        read.state = 'ok';resolve({reminders: [{...reminder, occurrenceId}]});
      }, fail() {read.state = 'failed';reject(Error('Secure store locked'));}};
      reads.push(read);
    })},
  });
  vm.runInContext(code + '\ninstallReminderAdapter(Shell, views);\n' +
    'globalThis.openDeviceReminder = (owner, row) => {' + workflow + '};', context);
  const shell = new Shell();
  const refresh = shell.refreshReminders;
  let lastRefresh;
  shell.refreshReminders = function (...args) {
    calls.push({action: 'refreshReminders', args, current: this.view});
    return lastRefresh = refresh.apply(this, args);
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const read = async index => {await settle();assert.ok(reads[index], 'The held list call ' + index + ' started');return reads[index];};
  return {shell, opened, toasts, clock, document, read, settle, calls,
    selectDeviceReminder() {
      deferNavigation = true;
      context.openDeviceReminder(shell, {kind: 'device-reminder', id: reminder.id, record: reminder});
      return lastRefresh;
    },
    commitNavigation() {assert.ok(queuedView);shell.view = queuedView;queuedView = null;},
    observe() {
      const intent = shell.pendingReminderOpen;
      const message = toasts.at(-1);
      if (message) assert.ok(["Couldn't open that reminder. Open Calendar to find it.",
        'Reminders could not refresh. Previously loaded reminders may be out of date.'].includes(message));
      return {view: shell.view, deferred: queuedView || '', visit: shell.reminderOpenVisit ?? 0,
        refresh: shell.reminderRefreshGeneration ?? 0, reads: reads.map((read, i) => [i + 1, read.state]),
        now: clock.now - reminderClockOrigin, foreground: !document.hidden,
        intent: intent ? {id: intent.id, occurrence: intent.occurrenceId ?? '', at: intent.at - reminderClockOrigin,
          view: intent.view, visit: intent.visit, followedCalendar: intent.followedCalendar} :
          {id: '', occurrence: '', at: 0, view: '', visit: 0, followedCalendar: false},
        cache: shell.reminderRows?.[0]?.occurrenceId ?? '', stale: !!calendar.reminderStale,
        notice: !message ? '' : message.startsWith("Couldn't open") ? 'open-failed' : 'refresh-failed',
        delivery: {...delivery}};
    },
  };
}
