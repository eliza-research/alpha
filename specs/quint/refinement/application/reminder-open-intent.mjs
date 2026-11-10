import {fileURLToPath} from 'node:url';
import {reminderOpenIntentFixture, reminderOpenIntentSources} from '../../../../test/fixtures/reminder-open-intent.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'ReminderOpenIntent';
const driver = fileURLToPath(import.meta.url);
const observations = ({reads, ...state}) => ({'s.reads': qmap(reads),
  ...Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value]))});

export async function checkReminderOpenIntent(extraSources = []) {
  const sources = [...new Set([driver, ...reminderOpenIntentSources, ...extraSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url)), 'upstream.lock.json', 'scripts/prepare-client-features.ts'])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run, origin = 'home') {
    const f = await reminderOpenIntentFixture(origin);
    const t = trace(name, observations(f.observe()), call('initView', origin));
    const mark = (label, action) => checkpoint(t, label, action, observations(f.observe()));
    const pending = [];
    const start = async (id = '', occurrence = '') => {
      pending.push(f.shell.refreshReminders(id || undefined, occurrence || undefined));
      await f.read(pending.length - 1);
      mark(id ? 'A reminder intent starts the latest refresh' : 'A background refresh supersedes the held read', call('refresh', id, occurrence));
    };
    const finish = async (id, result, label) => {
      const read = await f.read(id - 1);
      if (result === 'failed') read.fail();else read.ok(result);
      await pending[id - 1];
      mark(label, call('finishRead', id, result));
    };
    const navigate = (view, label) => {
      if (view === 'home') f.shell.goHome();else f.shell.openView(view);
      mark(label, call('navigate', view, false));
    };
    const advance = ms => {
      f.clock.now += ms;
      mark('The controlled clock advances by ' + ms + ' ms', call('advance', ms));
    };
    const selectWorkflowRow = async () => {
      pending.push(f.selectDeviceReminder());
      await f.read(pending.length - 1);
      mark('The actual Workflows row starts the refresh before its Calendar commit',
        [call('navigate', 'calendar', true), call('refresh', 'tapped', 'one')]);
      f.commitNavigation();
      mark('Calendar commits the visit already captured by the read', call('commitNavigation'));
    };
    await run({f, mark, start, finish, navigate, advance, selectWorkflowRow});
    traces.push(t);
  }

  await scenario('a resume can publish the tap while a stale read cannot replace its cache', async c => {
    await c.start('tapped', 'one');await c.start();c.advance(5000);
    await c.finish(2, 'one', 'The latest successful refresh publishes the exact reminder');
    await c.finish(1, 'other', 'The stale refresh cannot replace the latest row or navigate again');
  });
  for (const [origin, destination] of [['home', 'home'], ['home', 'calendar'], ['calendar', 'calendar']]) {
    await scenario(`${origin} to Notes to ${destination} retires the old open`, async c => {
      await c.start('tapped', 'one');
      c.navigate('notes', 'Opening Notes retires the captured visit');
      c.navigate(destination, 'Another app entry cannot inherit the retired visit');
      await c.finish(1, 'one', 'The current read refreshes rows without reopening the retired reminder');
    }, origin);
  }
  await scenario('a direct Calendar entry can inherit the exact reminder intent', async c => {
    await c.start('tapped', 'one');c.navigate('calendar', 'Direct Calendar entry carries the still-current intent');
    c.f.shell.back();c.mark('A Back that does not leave Calendar keeps the visit', null);
    await c.finish(1, 'one', 'The selected visit opens the exact occurrence');
  });
  await scenario('leaving the directly admitted Calendar visit still retires the intent', async c => {
    await c.start('tapped', 'one');c.navigate('calendar', 'The current origin follows a single direct Calendar entry');
    c.navigate('notes', 'Leaving that Calendar visit retires the intent');
    c.navigate('calendar', 'Returning to Calendar cannot follow the intent again');
    await c.finish(1, 'one', 'The retired intent refreshes the cache only');
  });
  await scenario('Workflows row handoff captures the requested visit before Calendar commits', async c => {
    await c.selectWorkflowRow();await c.finish(1, 'one', 'The Workflows handoff opens the exact reminder');
  }, 'workflows');
  await scenario('exactly thirty seconds expires only the navigation', async c => {
    await c.start('tapped', 'one');c.advance(30000);
    await c.finish(1, 'one', 'The expired intent updates the reminder cache without opening');
  });
  await scenario('a foreground read just inside the window can still open', async c => {
    await c.start('tapped', 'one');c.advance(29999);
    await c.finish(1, 'one', 'The exact reminder opens before the expiry boundary');
  });
  await scenario('a hidden document keeps the read but suppresses navigation', async c => {
    await c.start('tapped', 'one');c.f.document.hidden = true;
    c.mark('The document leaves the foreground during the list read', call('setForeground', false));
    await c.finish(1, 'one', 'The list is cached without opening a background view');
  });
  await scenario('a different occurrence opens Calendar without selecting the wrong detail', async c => {
    await c.start('tapped', 'one');await c.finish(1, 'other', 'The Calendar fallback contains no wrong occurrence detail');
  });
  await scenario('a failed current read retires the intent before an ordinary refresh', async c => {
    await c.start('tapped', 'one');await c.finish(1, 'failed', 'The current list failure retires the tap and displays its diagnostic');
    await c.start();await c.finish(2, 'one', 'A later successful refresh clears staleness without navigation');
  });
  return checkTraces({model, scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['The actual legacy reminder adapter, reminder row projector and Workflows device-row branch execute in a closed Node VM. The shell and native list are controlled ports.',
      'The newest refresh can still update its cache after navigation retires the open intent. Each modeled refresh starts a held list after immediate successful reconciliation. Reconciliation and process lifetime have separate obligations.',
      'One reminder, two occurrences, three refresh generations and four explicit navigation requests before delivery. Typed token custody, Android intents, mounted UI, and provider behavior are separate.']});
}
