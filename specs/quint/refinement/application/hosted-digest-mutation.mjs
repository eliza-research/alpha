import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';
import {withHostedDigestRefresh} from './hosted-digest-refresh.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'HostedDigestMutation';
const owners = [1, 2];
const phases = ['review', 'dispatched'];
const notices = new Map([
  ['Save not confirmed. Retry.', 'unconfirmed'],
  ['Source not saved. Retry to clear it.', 'clearRefused'],
  ['Source access changed before saving. Refresh accounts and review the source again.', 'sourceRejected'],
  ['Discarded', 'discarded'],
  ['Couldn’t discard', 'discardRefused'],
]);

function observe(state) {
  const selected = state.session ? owners.find(id => state.session === 'session-'+id) : 0;
  assert.equal(state.binding, state.session);
  assert.ok(selected !== undefined);
  const visible = state.pendingSummary ? state.pending || 'legacy' : '';
  if (visible) assert.equal(state.pendingSummary, 'Fixture saved request '+selected);
  const phase = owner => {
    const saved = state.stored.find(([id]) => id === owner)?.[1];
    if (!saved) return '';
    assert.equal(saved.body.id, 'fixture-mutation-'+owner);
    assert.ok(!saved.phase || phases.includes(saved.phase));
    return saved.phase ?? 'legacy';
  };
  const holds = kind => qset(state.requests.filter(row => row.kind === kind && !row.done).map(row => row.id));
  const count = (owner, phase) => state.writes.filter(([id, written]) => id === owner && written === phase).length;
  return {'s.owner': selected, 's.visited': qset(state.visited), 's.loaded': state.available, 's.pending': visible,
    's.busy': state.busy, 's.notice': notices.get(state.message) ?? '', 's.journal': qmap(owners.map(id => [id, phase(id)])),
    's.mutations': holds('mutation'), 's.removes': holds('remove'), 's.refreshes': holds('sync'),
    's.calls': qmap(owners.map(id => [id, state.mutations.filter(owner => owner === id).length])),
    's.reviewWrites': qmap(owners.map(id => [id, count(id, 'review')])),
    's.dispatchWrites': qmap(owners.map(id => [id, count(id, 'dispatched')]))};
}

async function schedule(run, name, seeds, steps) {
  for (const id of owners) {
    const phase = seeds[id-1];
    if (phase) await run('seed', id, phase === 'legacy' ? null : phase);
  }
  const t = trace(name, observe(await run('observe')), call('initFor', ...seeds));
  for (const [transition, owner, reply] of steps) {
    if (transition === 'attach') await run('select', owner);
    else if (transition === 'restore') {
      await run('history', owner);
      await run('sync', owner, owner);
      if (!(await run('observe')).open) {
        await run('open');
        await run('sync', owner, owner);
      }
    } else if (transition === 'mutationReply') {
      await run('mutate', owner, reply === 'saved' ? 'ok' : reply === 'unconfirmed' ? 'refused' : 'rejected');
    } else if (transition === 'removeReply') await run('remove', owner, !reply);
    else if (transition === 'refreshReply') await run('sync', owner, owner);
    else await run(transition);
    const args = reply === undefined ? [owner] : [owner, reply];
    checkpoint(t, [transition, ...args].join(' '), call(transition, ...args), observe(await run('observe')));
  }
  return t;
}

export async function checkHostedDigestMutation(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const attach = owner => ['attach', owner];
  const restore = owner => ['restore', owner];
  const retry = owner => ['retry', owner];
  const discard = owner => ['discard', owner];
  const mutation = (owner, reply = 'saved') => ['mutationReply', owner, reply];
  const remove = (owner, ok = true) => ['removeReply', owner, ok];
  const refreshed = owner => ['refreshReply', owner];
  const begin = [attach(1), restore(1), retry(1)];
  const replacement = [attach(2), restore(2)];
  const cases = [
    ['old-clear-does-not-start-replacement-refresh', ['dispatched', 'legacy'],
      [...begin, mutation(1), attach(2), remove(1), restore(2)]],
    ['old-clear-cannot-end-replacement-busy', ['review', 'legacy'],
      [...begin, mutation(1), ...replacement, retry(2), remove(1), mutation(2), remove(2), refreshed(2)]],
    ['old-source-refusal-cannot-publish-into-replacement', ['dispatched', 'dispatched'],
      [...begin, mutation(1, 'rejected'), remove(1), attach(2), refreshed(1), restore(2)]],
    ['current-source-refusal-clears-and-reports', ['dispatched', ''],
      [...begin, mutation(1, 'rejected'), remove(1), refreshed(1)]],
    ['lost-reply-retains-the-dispatched-journal', ['review', ''],
      [...begin, mutation(1, 'unconfirmed'), retry(1), mutation(1), remove(1, false)]],
    ['only-an-unsent-review-can-discard', ['review', 'legacy'],
      [attach(1), restore(1), discard(1), remove(1, false), discard(1), remove(1), ...replacement]],
    ['retired-remote-success-keeps-its-dispatched-journal', ['legacy', 'dispatched'],
      [...begin, ...replacement, mutation(1)]],
    ['retired-discard-removes-only-the-exact-old-review', ['review', 'review'],
      [attach(1), restore(1), discard(1), ...replacement, remove(1)]],
  ];
  const {observations: traces, sources} = await withHostedDigestRefresh(async scenario => {
    const results = [];
    for (const [name, seeds, steps] of cases) results.push(await scenario(run => schedule(run, name, seeds, steps)));
    return results;
  }, [driver, ...extraSources]);
  return checkTraces(boundInputs({model, traces, sources, scope: 'bounded-orchestration', assumptions: [
    'The actual mounted digest panel drives exact reviewed, dispatched or legacy pending rows. The journal, provider reply and inbox are controlled ports. Writes and removal are attributed to exact fixture slots.',
    'Two distinct binding lifetimes with one operation per owner at a time. Restore groups held history, completed supported reads and actual panel open before mutation controls are used.',
    'The stage map is a hidden representation, observed through actual mutation, journal removal, refresh, busy and message boundaries. Native consent, external provider effects and renewal rebind remain separate.',
  ]}));
}
