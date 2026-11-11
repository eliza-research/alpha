import assert from 'node:assert/strict';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from './reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderRefresh.qnt', module: 'ReminderRefresh',
  witnesses: ['StaleRemindersWitness', 'SupersededRefreshWitness', 'DroppedOpenWitness', 'OpenedWitness']};
const dropped = "Couldn't open that reminder. Open Calendar to find it.";
const failed = 'Couldn’t refresh';

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  let deviceRows = 0, reminderStore = 0, openRequests = 0, publishedBy = 0, publishedWhen = 0, started = 0;
  const reminders = () => ({reminders: reminderStore ? [{id: 'r1', title: 'v' + reminderStore, body: '', at: f.state.now + 3600000,
    dueAt: f.state.now + 3600000, alertMinutes: 0, status: 'scheduled', occurrenceId: 'o1', target: {reminderId: 'r1'}}] : []});
  Object.assign(f.handlers, {
    listReminders: reminders,
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    pendingReminderTap: () => ({}),
    reminderOperationReceipt: () => ({status: 'unknown'}),
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  const base = shell.reminderRefreshGeneration;
  assert.equal(base, 1, 'mounting reads the reminders once');
  assert.deepEqual(f.toasts, []);
  f.hold('listReminders', 100);
  // Each started refresh waits in its reminder read; the read carries the refresh's number.
  const begun = async start => {
    start();
    await f.idle();
    const call = f.held.filter(item => item.name === 'listReminders').find(item => item.token === undefined);
    assert.ok(call, 'a started refresh reads the reminders');
    call.token = ++started;
    assert.equal(shell.reminderRefreshGeneration - base, started);
  };
  const shownVersion = key => Number(String(f.calendar.events.find(row => row[key])?.title ?? 'v0').slice(1));
  const observe = () => ({live: shell.live, generation: shell.reminderRefreshGeneration - base,
    inFlight: f.held.filter(item => item.name === 'listReminders').map(item => item.token).sort((a, b) => a - b),
    deviceRows, reminderStore, shownDevice: shownVersion('alphaCalendarId'), shownReminders: shownVersion('alphaReminderId'),
    stale: !!f.calendar.reminderStale, failedBefore: !!shell.reminderRefreshFailed,
    toasts: f.toasts.length, pendingOpen: !!shell.pendingReminderOpen, openRequests,
    opened: f.opened.length, dropped: f.toasts.filter(text => text === dropped).length, publishedBy, publishedWhen});
  sameState(observe(), trace.steps[0].state, trace, 0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index];
    if (action === 'refresh') await begun(() => void shell.refreshReminders());
    else if (action === 'deviceRead') {
      // The calendar adapter's publication: new device rows, then the reminders merged into them.
      deviceRows++;
      await begun(() => {
        shell.nativeCalendarRows = [{id: 'calendar:1', alphaCalendarId: '1', title: 'v' + deviceRows, off: 0}];
        void shell.refreshReminders();
      });
    } else if (action === 'reminderChanged') {
      reminderStore++;
      await begun(() => f.window.dispatchEvent(new Event('alpha:reminders-committed')));
    } else if (action === 'reminderOpened') {
      openRequests++;
      await begun(() => f.listeners.get('reminderOpened')({id: 'r1', occurrenceId: 'o1'}));
    } else if (action === 'complete') {
      const position = f.held.findIndex(item => item.name === 'listReminders' && item.token === picks.token);
      assert.ok(position >= 0, 'the model completes a refresh that is running');
      const [call] = f.held.splice(position, 1), rows = f.calendar.events, said = f.toasts.length;
      if (picks.ok) call.resolve(reminders()); else call.reject(Error('Secure store locked'));
      await f.idle();
      if (f.calendar.events !== rows) { publishedBy = picks.token; publishedWhen = shell.reminderRefreshGeneration - base; }
      else assert.equal(f.toasts.length, said, 'a refresh that publishes nothing says nothing');
      for (const text of f.toasts) assert.ok(text === dropped || text === failed, text);
    } else if (action === 'unmount') {
      shell.live = false;
      shell.componentWillUnmount();
      await f.idle();
    } else assert.equal(action, '', `Unmapped model action ${action}`);
    sameState(observe(), trace.steps[index].state, trace, index);
  }
  return trace.steps.length - 1;
}

export async function checkReminderRefresh(mutate) {
  const compiled = await buildReminderAdapter(mutate), traces = await modelTraces({...model, traces: 30});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}
