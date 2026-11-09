import {fileURLToPath} from 'node:url';
import {lifeOpsScheduledTaskRouteFixture} from '../../../../test/fixtures/lifeops-scheduled-task-route.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {call, checkpoint, trace} from '../application/support.mjs';

const model = 'PersonalAssistantScheduledTaskCustody';
const indexed = entries => qmap(entries.map((entry, index) => [index + 1, entry]));
function fields({clock, state, at, completed, dossier, lastActivity, lastDispatch, slots,
  metadataRevised, definitionRevised, claims, writes, guards, egress, fireReplies, selectedTaskId}) {
  return {...Object.fromEntries(Object.entries({managed: dossier.generation > 0, clock, state,
    at, completed, dossier, lastActivity, lastDispatch, metadataRevised, definitionRevised, claims, writes, guards, egress})
    .map(([key, value]) => [`s.${key}`, value])),
  's.slots': indexed(slots),
  's.fireReplies': indexed(fireReplies.map(({task, ...reply}) => ({...reply, selected: task === selectedTaskId})))};
}

export async function checkPersonalAssistantScheduledTaskCustody(extraSources = []) {
  const driverHashes = captureInputs([fileURLToPath(import.meta.url), ...extraSources,
    fileURLToPath(new URL('../application/support.mjs', import.meta.url))]);
  const traces = [];
  async function scenario(name, managed, steps) {
    const fixture = await lifeOpsScheduledTaskRouteFixture({configured: true, managed});
    Object.assign(driverHashes, fixture.hashes);
    try {
      const initial = call(managed ? 'initManaged' : 'initManual');
      const t = trace(name, fields(await fixture.observe()), initial);
      for (const [action, ...args] of steps) {
        if (action === 'complete' || action === 'reopen') await fixture.control(action);
        else if (action === 'finish') await fixture.finish(args[0], 'ok');
        else await fixture[action](...args);
        checkpoint(t, [action, ...args].join(' '), call(action, ...args), fields(await fixture.observe()));
      }
      traces.push(t);
    } finally {await fixture.close();}
  }
  await scenario('a trusted owner signal is consumed only by the automatic SQL claim', true, [
    ['activity', false], ['activity', true], ['activity', true], ['fire', 1], ['claim', 1],
    ['enterEgress', 1], ['finish', 1], ['activity', true],
  ]);
  for (const [first, second] of [[1, 2], [2, 1]]) {
    await scenario(`SQL claim ${first} consumes the one admitted day and claim ${second} loses`, true, [
      ['activity', true], ['fire', 1], ['fire', 2], ['claim', first], ['claim', second],
      ['enterEgress', first], ['finish', first],
    ]);
  }
  await scenario('terminal settlement before pre-egress refuses the dispatch guard', false, [
    ['fire', 1], ['claim', 1], ['complete'], ['enterEgress', 1],
  ]);
  await scenario('completion after egress is returned as authoritative after the rejected write', false, [
    ['fire', 1], ['claim', 1], ['enterEgress', 1], ['complete'], ['finish', 1],
  ]);
  await scenario('old pre-egress admission passes and full SQL custody preserves the newer occurrence', false, [
    ['fire', 1], ['claim', 1], ['complete'], ['reopen'], ['advance'], ['fire', 2], ['claim', 2],
    ['enterEgress', 1], ['finish', 1], ['enterEgress', 2], ['finish', 2],
  ]);
  for (const change of ['metadata', 'definition']) {
    await scenario(`SQL completion refuses a stale ${change} snapshot while lifecycle state stays exact`, false, [
      ['fire', 1], ['claim', 1], ['enterEgress', 1], ['supersede', change], ['finish', 1],
    ]);
  }
  const receipt = await checkTraces({model, sources: Object.keys(driverHashes), driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Selected pinned Personal Assistant callbacks and dossier anchor registration run as extracted source. The pinned scheduling migration, SQL stores, generic runner and manual route run unchanged in one private PGlite database.',
      'Synthetic trusted activity, fixed UTC day, two runner handles, and held dispatcher admission and results. Automatic attempts enter the runner directly. Manual attempts enter the SDK route body and response context.',
      'The production Personal Assistant runtime factory, family execution and store wrappers, HTTP framing, durable PostgreSQL deployments, authentication and external dispatch remain separate.',
    ]});
  return {receipt, obligations: [{
    model, obligation: 'Fence configured pre-egress admission by a unique occurrence',
    reason: 'The older held dispatcher passed the status-only guard against a newer fired row. The full expected state, metadata and definition write refused the stale snapshot in PGlite. Same-clock occurrence identity and production wrapper behavior remain open.',
  }]};
}
