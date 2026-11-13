import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {lifeOpsScheduledTaskRouteFixture} from '../../../../test/fixtures/lifeops-scheduled-task-route.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {call, checkpoint, trace} from '../application/support.mjs';

const model = 'LifeOpsScheduledTaskRoute';
const logNames = ['completed', 'edited', 'failed', 'fire_attempt', 'fired', 'reopened', 'skipped', 'snoozed'];
const indexed = entries => qmap(entries.map((entry, i) => [i + 1, entry]));
function fields({slots, fireReplies, logs, ...state}) {
  assert.ok(logs.every(log => logNames.includes(log)), logs.join(', '));
  return {...Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value])),
    's.slots': indexed(slots), 's.fireReplies': indexed(fireReplies),
    's.logs': qmap(logNames.map(name => [name, logs.filter(log => log === name).length]))};
}

export async function checkLifeOpsScheduledTaskRoute(extraSources = []) {
  const driverHashes = captureInputs([fileURLToPath(import.meta.url), ...extraSources,
    fileURLToPath(new URL('../application/support.mjs', import.meta.url))]);
  const traces = [];
  async function scenario(name, steps) {
    const f = await lifeOpsScheduledTaskRouteFixture();
    Object.assign(driverHashes, f.hashes);
    const t = trace(name, fields(await f.observe()));
    for (const [action, ...args] of steps) {
      await f[action](...args);
      checkpoint(t, [action, ...args].join(' '), call(action, ...args), fields(await f.observe()));
    }
    traces.push(t);
  }
  await scenario('owner-visible filtering, unfiltered listing and malformed request input', [
    ['control', 'owner-list'], ['control', 'all-list'], ['control', 'duplicate-filter'], ['control', 'malformed-id'],
  ]);
  await scenario('bodyless, empty and read-only edits leave the row and log unchanged', [
    ['control', 'bodyless-edit'], ['control', 'empty-edit'], ['control', 'readonly-edit'], ['control', 'history'],
  ]);
  await scenario('valid cron edit returns the new exact task and writes one edit history event', [
    ['control', 'edit'], ['control', 'owner-list'], ['control', 'history'],
  ]);
  await scenario('snooze validates input, completion and reopen preserve the last history fields', [
    ['control', 'invalid-snooze'], ['control', 'snooze'], ['control', 'complete'],
    ['control', 'reopen'], ['control', 'history'],
  ]);
  for (const [first, second] of [[1, 2], [2, 1]]) {
    await scenario(`caller ${first} wins a shared scheduled snapshot; caller ${second} gets raced`, [
      ['fire', 1], ['fire', 2], ['claim', first], ['claim', second],
      ['enterEgress', first], ['finish', first, 'ok'], ['control', 'history'],
    ]);
  }
  await scenario('a completion before atomic claim prevents a synthetic dispatch entry', [
    ['fire', 1], ['control', 'complete'], ['claim', 1], ['control', 'history'],
  ]);
  await scenario('a completion after claim blocks pre-egress admission and the failed stale write', [
    ['fire', 1], ['claim', 1], ['control', 'complete'], ['enterEgress', 1], ['control', 'history'],
  ]);
  await scenario('a completion after synthetic egress wins persistence and is returned with the fire receipt', [
    ['fire', 1], ['claim', 1], ['enterEgress', 1], ['control', 'complete'], ['finish', 1, 'ok'], ['control', 'history'],
  ]);
  await scenario('synthetic dispatcher failure becomes a typed fire outcome and a terminal state-log entry', [
    ['fire', 1], ['claim', 1], ['enterEgress', 1], ['finish', 1, 'throw'], ['control', 'history'],
  ]);
  await scenario('global pause settles a respecting manual task without claiming or dispatching', [
    ['pause'], ['fire', 1], ['control', 'history'],
  ]);
  await scenario('a terminal manual task is skipped before any new fire attempt log', [
    ['control', 'complete'], ['fire', 1], ['control', 'history'],
  ]);
  await scenario('known gap: a later fired occurrence admits and can be overwritten by an older held dispatch', [
    ['fire', 1], ['claim', 1], ['control', 'complete'], ['control', 'reopen'], ['advance'],
    ['fire', 2], ['claim', 2], ['enterEgress', 1], ['finish', 1, 'ok'], ['control', 'history'],
    ['enterEgress', 2], ['finish', 2, 'ok'],
  ]);
  const receipt = await checkTraces({model, sources: Object.keys(driverHashes), driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Actual pinned SDK route, schema, generic runner, in-memory task and log stores execute against a direct body/response context and controlled clock, claim and dispatcher primitives.',
      'One mutable manual task, one list-only hidden task, two generic runners, and one exact cron edit. The route context does not cover host authorization or Node HTTP framing.',
      'The generic in-memory store demonstrates status CAS and an occurrence ABA counterexample. Configured host admission, PostgreSQL CAS, crash recovery, real dispatch and worker effects remain separate.',
    ]});
  return {receipt, obligations: [{
    model, obligation: 'Fence pre-egress and all post-claim writes by the exact occurrence',
    reason: 'After complete, reopen and refire, the generic runner admits an older held dispatch against a newer fired row. Its status-only conditional write can restore the old occurrence snapshot. The replay records this pinned behavior.',
  }]};
}
