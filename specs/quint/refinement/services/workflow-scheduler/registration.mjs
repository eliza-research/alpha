import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../../check-traces.mjs';
import {engineDriverSources, prepareEngineModule} from '../workflow-engine/ports.mjs';
import {serviceInputs} from '../source-inputs.mjs';
import {action, until} from '../support.mjs';
import {createSchedulerFixture} from './fixture.mjs';

const attempt = promise => promise.then(value => ({value}), error => ({error}));
const slot = id => Number(id.split('-').at(-1));
async function state(f) {
  const rows = await f.rows();
  const row = rows.workflows[0];
  const versionOf = value => {
    if (!value) return 0;
    if (!f.versions.has(value)) f.versions.set(value, f.versions.size + 1);
    return f.versions.get(value);
  };
  const version = versionOf(row.versionId);
  const tasks = [1, 2, 3].map(id => {
    const task = f.tasks.tasks.get(`task-${id}`);
    return [id, task ? task.metadata.trigger.dedupeKey === 'workflow-schedule:workflow-A'
      ? versionOf(task.metadata.reviewedVersionId ?? task.metadata.hostedVersionId ?? row.versionId) : -1 : 0];
  });
  const pending = [...f.tasks.openCreates.entries()];
  assert.ok(pending.length <= 1, 'one deliberately held task creation in this finite slice');
  const [id, input] = pending[0] ?? [];
  const receipt = await f.database.query('SELECT expected_version_id FROM workflow.lifecycle_mutations WHERE operation=$1', ['remove']);
  const observed = {
    's.version': version, 's.active': row.workflow.active, 's.typed': !!row.workflow.metadata.elizaPhoneWorkflowSpec,
    's.removed': !!row.workflow.metadata.elizaPhoneRemovedAt, 's.cleanup': row.workflow.metadata.elizaPhoneTriggerCleanup ?? 'none',
    's.tasks': qmap(tasks), 's.retired': qset([...new Set(f.tasks.events.filter(event => event.kind === 'deleted').map(event => slot(event.id)))]),
    's.pendingId': id ? slot(id) : 0,
    's.pendingVersion': input ? versionOf(input.metadata.reviewedVersionId ?? input.metadata.hostedVersionId ?? row.versionId) : 0,
    's.phase': id ? f.tasks.tasks.has(id) ? 'persisted' : 'requested' : 'none',
    's.receipt': receipt.rows.length > 0, 's.receiptVersion': receipt.rows.length ? versionOf(receipt.rows[0].expected_version_id) : 0,
  };
  if (!row.workflow.metadata.elizaPhoneWorkflowSpec) {
    // Generic task records contain no reviewed-version metadata. Only task existence is observed.
    delete observed['s.tasks'];
    delete observed['s.pendingVersion'];
    observed.taskCount = f.tasks.tasks.size;
  }
  return observed;
}
async function currentVersion(f) { return (await f.service.getWorkflow('workflow-A')).versionId; }
function taskInput(version, other = false) {
  return {name: 'TRIGGER_DISPATCH', tags: ['queue', 'repeat', 'trigger'], metadata: {reviewedVersionId: version,
    trigger: {kind: 'workflow', workflowId: 'workflow-A', dedupeKey: other ? 'other-event' : 'workflow-schedule:workflow-A'}}};
}
async function settled(promise, shouldFail = false) {
  const result = await promise;
  if (shouldFail) assert.ok(result.error, 'operation reports its persistence failure');
  else if (result.error) throw result.error;
  return result.value;
}

export async function collectWorkflowTaskTraces() {
  const traces = [];
  async function scenario(name, callback, {typed = true, valid = true, active = false} = {}) {
    const f = await createSchedulerFixture();
    f.versions = new Map([['version-1', 1]]);
    try {
      const spec = {version: 1, name: 'Task fixture', description: '', trigger: {kind: 'time', localTime: '07:00', timeZone: 'UTC', days: [0]},
        steps: [{id: 'text', kind: 'Read', operation: 'supplied_text', text: 'fixture'}]};
      const compiled = f.phone.phoneDraftDefinition(spec);
      const workflow = await f.seed({active, ...(typed ? {metadata: compiled.metadata, source: compiled.source} : {})});
      workflow.schedule = valid ? f.phone.phoneTriggerSchedule(spec.trigger) : {cron: 'not-a-cron', timezone: 'UTC', enabled: true};
      await f.database.query('UPDATE workflow.embedded_workflows SET workflow=$1 WHERE id=$2', [JSON.stringify(workflow), 'workflow-A']);
      const trace = {name, init: action('initFor', typed, valid, active, false), expect: await state(f), steps: []};
      const point = async (label, transition) => trace.steps.push({label, action: transition, expect: await state(f)});
      await callback(f, point); traces.push(trace);
    } finally { await f.close(); }
  }
  await scenario('typed activation persists before task creation and pause removes its task', async (f, point) => {
    f.tasks.hold('beforeCreate'); const activated = attempt(f.service.activateWorkflow('workflow-A', 'version-1'));
    await until(() => f.tasks.openCreates.size === 1, 'task create admission');
    await point('active row commits before external task write', [action('activation', true, 1), action('requestCreate', 1)]);
    f.tasks.release('beforeCreate'); await settled(activated);
    await point('created task carries exact committed version', [action('persistCreate'), action('creationReturned')]);
    await f.service.deactivateWorkflow('workflow-A', await currentVersion(f));
    await point('pause commits new version then removes schedule', [action('activation', false, 2), action('removeTask', 1, false)]);
  });
  for (const stage of ['beforeCreate', 'afterCreate']) {
    await scenario(`restart repairs task creation failure ${stage}`, async (f, point) => {
      f.tasks.hold(stage); const activated = attempt(f.service.activateWorkflow('workflow-A', 'version-1'));
      await until(() => f.tasks.openCreates.size === 1 && (stage === 'beforeCreate' || f.tasks.tasks.size === 1), 'held task persistence');
      await point('definition commits independently of task storage', stage === 'beforeCreate'
        ? [action('activation', true, 1), action('requestCreate', 1)]
        : [action('activation', true, 1), action('requestCreate', 1), action('persistCreate')]);
      f.tasks.fail(stage); await settled(activated, true); await point('task error leaves durable definition', action('creationFailed'));
      await f.restart();
      await point('startup retries only a missing current-version task', stage === 'beforeCreate'
        ? [action('requestCreate', 2), action('persistCreate'), action('creationReturned')] : null);
    });
  }
  await scenario('held old activation cannot survive a concurrent pause', async (f, point) => {
    f.tasks.hold('beforeCreate'); const activated = attempt(f.service.activateWorkflow('workflow-A', 'version-1'));
    await until(() => f.tasks.openCreates.size === 1, 'old activation task');
    await point('first host commits and waits on task store', [action('activation', true, 1), action('requestCreate', 1)]);
    const other = new f.EmbeddedWorkflowService(f.runtime);
    await other.deactivateWorkflow('workflow-A', await currentVersion(f));
    await point('another host pauses while create is pending', action('activation', false, 2));
    f.tasks.release('beforeCreate'); await settled(activated);
    await point('post-write current-row check retires only stale task', [action('persistCreate'), action('retireCreated')]);
  });
  await scenario('stale host creation preserves newer activation task', async (f, point) => {
    const gate = f.tasks.hold('beforeCreate'); const activated = attempt(f.service.activateWorkflow('workflow-A', 'version-1'));
    await until(() => f.tasks.openCreates.size === 1, 'old activation'); f.tasks.detach('beforeCreate');
    await point('old host retains its task identity', [action('activation', true, 1), action('requestCreate', 1)]);
    const other = new f.EmbeddedWorkflowService(f.runtime);
    await other.deactivateWorkflow('workflow-A', await currentVersion(f));
    await point('intermediate pause', action('activation', false, 2));
    await other.activateWorkflow('workflow-A', await currentVersion(f));
    await point('second host finishes new version task', [action('activation', true, 3), action('otherCreate', 2)]);
    gate.resolve(); await settled(activated);
    await point('old host deletes its stale task without deleting successor', [action('persistCreate'), action('retireCreated')]);
  });
  await scenario('completed cleanup marker can precede a late task whose retirement fails', async (f, point) => {
    f.tasks.hold('beforeCreate');
    const activated = attempt(f.service.activateWorkflow('workflow-A', 'version-1'));
    await until(() => f.tasks.openCreates.size === 1, 'old host create');
    await point('old host is waiting after its active commit', [action('activation', true, 1), action('requestCreate', 1)]);
    const other = new f.EmbeddedWorkflowService(f.runtime);
    await other.changeLifecycle('workflow-A', 'remove-A', await currentVersion(f), 'remove', 'owner-A', () => {});
    await point('visible tasks are cleaned before old creation returns', [action('removeWorkflow', 2), action('cleanupComplete')]);
    f.tasks.hold('beforeDelete');
    f.tasks.release('beforeCreate');
    await until(() => f.tasks.events.some(event => event.kind === 'delete-called'), 'late task retirement');
    f.tasks.fail('beforeDelete');
    await settled(activated, true);
    assert.equal((await f.service.lifecycleState('workflow-A')).cleanup, 'complete');
    assert.equal(f.tasks.tasks.size, 1);
    await point('late task is retained after reported retirement failure', [action('persistCreate'), action('creationFailed')]);
    await f.restart();
    await point('next startup removes the late stale task', [action('removeTask', 1, true), action('cleanupComplete')]);
  });
  await scenario('pause preserves non-schedule workflow triggers', async (f, point) => {
    f.tasks.seed(taskInput('version-1')); await point('existing schedule task', action('seedTask', 1, 1));
    f.tasks.seed(taskInput('version-1', true)); await point('independent workflow event trigger', action('seedTask', 2, -1));
    await f.service.deactivateWorkflow('workflow-A', 'version-1');
    await point('pause removes only its schedule dedupe key', [action('activation', false, 1), action('removeTask', 1, false)]);
  }, {active: true});
  await scenario('removal cleans every trigger and records an idempotent receipt', async (f, point) => {
    f.tasks.seed(taskInput('version-1')); await point('schedule task', action('seedTask', 1, 1));
    f.tasks.seed(taskInput('version-1', true)); await point('event trigger', action('seedTask', 2, -1));
    const receipt = await f.service.changeLifecycle('workflow-A', 'remove-A', 'version-1', 'remove', 'owner-A', () => {});
    await point('removal receipt and all trigger cleanup commit', [action('removeWorkflow', 1), action('removeTask', 1, true), action('removeTask', 2, true), action('cleanupComplete')]);
    const replay = await f.service.changeLifecycle('workflow-A', 'remove-A', 'version-1', 'remove', 'owner-A', () => {});
    assert.deepEqual(replay, receipt); await point('same removal receipt survives current version change', action('replayRemoval', 1));
  });
  for (const stage of ['beforeDelete', 'afterDelete']) {
    await scenario(`removal remains pending when trigger cleanup fails ${stage}`, async (f, point) => {
      f.tasks.seed(taskInput('version-1')); await point('existing schedule', action('seedTask', 1, 1));
      f.tasks.hold(stage); const removed = attempt(f.service.changeLifecycle('workflow-A', 'remove-A', 'version-1', 'remove', 'owner-A', () => {}));
      await until(() => f.tasks.events.some(event => event.kind === (stage === 'beforeDelete' ? 'delete-called' : 'deleted')), 'cleanup storage boundary');
      await point('durable removal precedes cleanup completion', stage === 'beforeDelete' ? action('removeWorkflow', 1) : [action('removeWorkflow', 1), action('removeTask', 1, true)]);
      f.tasks.fail(stage); await settled(removed); await point('cleanup failure retains pending marker', null);
      await assert.rejects(f.service.changeLifecycle('workflow-A', 'restore-A', await currentVersion(f), 'restore', 'owner-A', () => {}), error => error.statusCode === 409);
      await point('restore rejects unconfirmed cleanup', {...action('restore', 2), reject: true});
      await f.restart(); await point('startup repairs cleanup idempotently', stage === 'beforeDelete' ? [action('removeTask', 1, true), action('cleanupComplete')] : action('cleanupComplete'));
      await f.service.changeLifecycle('workflow-A', 'restore-A', await currentVersion(f), 'restore', 'owner-A', () => {});
      await point('restore is inactive after confirmed cleanup', action('restore', 2));
    });
  }
  await scenario('typed startup reconstructs missing task from durable active version', async (f, point) => {
    await f.restart(); await point('current schedule task recovered', [action('requestCreate', 1), action('persistCreate'), action('creationReturned')]);
    await f.restart(); await point('second startup retains exact existing task', null);
  }, {active: true});
  await scenario('generic startup does not invent reviewed schedule recovery', async (f, point) => {
    await f.restart(); await point('generic active definition alone is not recovery registration', null);
    await f.service.activateWorkflow('workflow-A', 'version-1');
    await point('explicit activation registers generic schedule', [action('activation', true, 1), action('requestCreate', 1), action('persistCreate'), action('creationReturned')]);
  }, {typed: false, active: true});
  await scenario('invalid typed schedule and stale review are rejected before active commit', async (f, point) => {
    await assert.rejects(f.service.activateWorkflow('workflow-A', 'version-1'), error => error.statusCode === 409);
    await point('stored schedule must match reviewed typed trigger', {...action('activation', true, 1), reject: true});
    await assert.rejects(f.service.activateWorkflow('workflow-A', 'version-other'), error => error.statusCode === 409);
    await point('stale review version cannot mutate definition', {...action('activation', true, 2), reject: true});
  }, {valid: false});
  await scenario('paused cleanup failure is repaired by typed startup', async (f, point) => {
    f.tasks.seed(taskInput('version-1')); await point('current task', action('seedTask', 1, 1));
    f.tasks.hold('beforeDelete'); const paused = attempt(f.service.deactivateWorkflow('workflow-A', 'version-1'));
    await until(() => f.tasks.events.some(event => event.kind === 'delete-called'), 'pause task deletion');
    await point('pause is already durable', action('activation', false, 1));
    f.tasks.fail('beforeDelete'); await settled(paused, true); await point('caller observes task-store failure', null);
    await f.restart(); await point('typed startup removes stale paused schedule', action('removeTask', 1, false));
  }, {active: true});
  return traces;
}

export async function runWorkflowTaskRefinement(extraSources = []) {
  const discovered = await engineDriverSources();
  const sources = serviceInputs([...discovered, fileURLToPath(import.meta.url), 'specs/quint/refinement/services/workflow-scheduler/fixture.mjs',
    'specs/quint/refinement/services/workflow-scheduler/clock.mjs', 'specs/quint/refinement/services/workflow-scheduler/tasks.mjs',
    'specs/quint/refinement/services/workflow-engine/ports.mjs', 'specs/quint/refinement/services/support.mjs', 'package.json', ...extraSources]);
  const driverHashes = captureInputs(sources); await prepareEngineModule(discovered, driverHashes);
  const traces = await collectWorkflowTaskTraces();
  const receipt = await checkTraces({model: 'WorkflowScheduleTasks', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual workflow activation/removal/restore/startup and deterministic trigger UUID creation execute against real SQL. Task read/create/delete is a controlled persistence port.',
    'One workflow, four committed version classes, three unique task identities and one deliberately held task creation. A second actual service instance drives selected cross-host schedules.',
    'Task registration does not authorize execution by itself. Run admission independently checks durable workflow state; installed trigger-dispatch and task-store implementations remain separate.',
    'The schedule-validity class is supplied by fixture inputs and checked by actual source rejection. No independent calendar/cron algorithm is implemented by this driver.',
  ]});
  return {receipts: [receipt], obligations: [
    {model: 'WorkflowScheduleTasks', obligation: 'Installed task storage and trigger execution, concurrent multiple creations, task queue consumption', reason: 'Task persistence is controlled and only one creation is deliberately held; dispatch belongs to its own runtime state owner. Generic tasks carry no reviewed version, so their model task-version field is unobserved.'},
    {model: 'WorkflowScheduleTasks', obligation: 'Cross-store atomicity and all generic/hosted schedule recovery', reason: 'Definition SQL and external task storage remain separate commits. Selected typed and generic recovery cases are executed, without universal liveness claims.'},
  ]};
}
