import {fileURLToPath} from 'node:url';
import {retainedReminderTapFixture, retainedReminderTapSources} from '../../../../test/fixtures/retained-reminder-tap.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'RetainedReminderTapAdmission';
const sourceFields = state => Object.fromEntries(Object.entries(state).map(([field, value]) => [`s.${field}`, value]));

export async function checkRetainedReminderTapAdmission(extraSources = []) {
  const sources = [...new Set([driver, ...retainedReminderTapSources, ...extraSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url)), 'upstream.lock.json', 'scripts/prepare-client-features.ts'])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, run) {
    const fixture = await retainedReminderTapFixture();
    const t = trace(name, sourceFields(fixture.observe()));
    const mark = (label, action) => checkpoint(t, label, action, sourceFields(fixture.observe()));
    const commit = async label => {await fixture.commit();mark(label, call('commit'));};
    await fixture.deliver();
    mark('The exact token is confirmed and its Calendar detail waits for render', [call('enqueueOriginal'), call('publish')]);
    await run({fixture, mark, commit});
    traces.push(t);
  }
  await scenario('uninterrupted exact detail acknowledges its saved token', async ({commit}) => {
    await commit('The current unprotected detail consumes the exact saved token');
  });
  await scenario('chooser acquired before render preserves the token for a fresh attempt', async ({fixture, mark, commit}) => {
    await fixture.set('chooser', true);
    mark('The chooser covers the same Calendar detail', call('setGate', 'chooser', true));
    await commit('The old render callback leaves the token in native custody');
    await fixture.set('chooser', false);
    mark('The actual chooser-close listener begins a fresh exact read and render', [call('setGate', 'chooser', false), call('publish')]);
    await commit('The later visible detail consumes the retained token');
  });
  for (const [gate, value, label] of [['sensitive', true, 'The current context becomes sensitive'],
    ['form', true, 'A Calendar form takes precedence over the same detail'],
    ['foreground', false, 'The document leaves the foreground']]) {
    await scenario(gate + ' changes while the exact detail waits for render', async ({fixture, mark, commit}) => {
      await fixture.set(gate, value);
      mark(label, call('setGate', gate, value));
      await commit('The protected render leaves the native token pending');
    });
  }
  await scenario('leaving and returning to the same detail retires its old render', async ({fixture, mark, commit}) => {
    fixture.navigate('notes');
    mark('Navigate to Notes while the Calendar render waits', call('navigate', 'notes'));
    fixture.navigate('calendar');
    mark('Restore the same reminder under a fresh navigation', call('navigate', 'calendar'));
    await commit('The stale render does not acknowledge the reminder');
  });
  await scenario('replacing the current detail retires the old acknowledgement', async ({fixture, mark, commit}) => {
    fixture.changeDetail();
    mark('The same Calendar visit now displays a different detail', call('changeDetail'));
    await commit('The changed detail leaves the native token pending');
  });
  await scenario('a native replacement between render and consume keeps its exact token', async ({fixture, mark, commit}) => {
    fixture.replaceToken();
    mark('Synthetic native custody replaces the pending token before the held render', call('replaceToken'));
    await commit('The native port refuses the old captured token and retains the newer token');
  });
  return checkTraces({model, scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['The actual typed reminder adapter and reminder row projection execute in a closed Node VM. The shell records navigation and holds the actual setState callback. The test does not measure DOM or installed device visibility.',
      'Native delivery, reads and exact-token consume are synthetic ports. Only one local reminder occurrence and two opaque tokens are modeled, with at most four navigation calls.',
      'The post-render gate is scoped to non-question typed links. Question review, native encrypted persistence and alert removal, wake coalescing, and legacy reminderOpened refresh are separate.']});
}
