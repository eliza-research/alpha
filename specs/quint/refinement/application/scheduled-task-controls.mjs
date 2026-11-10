import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {scheduledTaskControlsFixture} from '../../../../test/fixtures/scheduled-task-controls.mjs';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'ScheduledTaskControls';
const taskPrefix = '/api/lifeops/scheduled-tasks/weekly/';
const controls = {'Run now': 'fire', 'Edit schedule': 'edit', 'Save schedule': 'edit',
  'Snooze 10 minutes': 'snooze', Acknowledge: 'acknowledge', Complete: 'complete', Dismiss: 'dismiss', Reopen: 'reopen'};
const buttons = Object.fromEntries(Object.entries(controls).filter(([label]) => label !== 'Save schedule')
  .map(([label, verb]) => [verb, label]));
const messages = {
  '': '', 'Run started.': 'started', 'Saved on this agent.': 'saved',
  'Another run was already in progress.': 'raced', 'Choose a valid time.': 'invalid-time', 'Choose a time and at least one day.': 'invalid-time',
  'This item did not run. Read its current status before trying again.': 'not-run',
  'Outcome unknown. Check the current record and history before repeating this action.': 'unknown',
  'Scheduled items could not refresh. Retry to check the current records.': 'source-unavailable',
};
function payload(path, body) {
  assert.ok(path.startsWith(taskPrefix), path);
  const verb = path.slice(taskPrefix.length);
  assert.deepEqual(Object.keys(body).sort(), verb === 'edit'
    ? body.trigger ? ['promptInstructions', 'trigger'] : ['promptInstructions'] : verb === 'snooze' ? ['untilIso'] : []);
  if(verb==='snooze')assert.ok(typeof body.untilIso==='string'&&Number.isFinite(Date.parse(body.untilIso)),'Exact snooze instant is required');
  if (body.trigger) {
    assert.deepEqual(Object.keys(body.trigger).sort(), ['expression', 'kind', 'tz']);
    assert.equal(body.trigger.kind, 'cron');
  }
  return {verb, text: body.promptInstructions ?? '',
    cron: body.trigger?.expression ?? '', zone: body.trigger?.tz ?? '', minutes: verb==='snooze'?10:0};
}
function fields(state) {
  assert.ok(Object.hasOwn(messages, state.message), state.message);
  assert.ok(!state.review || Object.hasOwn(controls, state.review)||state.review.startsWith('Snooze until '), state.review);
  assert.ok(state.actions.every(action => Object.hasOwn(controls, action.label)));
  const result = {
    owner: state.owner, visible: state.visible, kind: state.kind, storedStatus: state.storedStatus,
    storedText: state.storedText, storedCron: state.storedTime, catalog: state.catalog,
    source: state.source, detail: state.detail, shownStatus: state.status.toLowerCase(),
    days: state.days, editing: state.editing, draft: state.draft, time: state.time, message: messages[state.message],
    pending: state.pending ? {owner: state.pending.owner, request: payload(state.pending.path, state.pending.body)}
      : {owner: '', request: {verb: '', text: '', cron: '', zone: '', minutes: 0}},
    sends: state.sends.map(send => ({owner: send.owner, request: payload(send.path, send.body), retained: send.retained})),
    intents: qset(state.intents.map(entry => ({owner: entry.owner, request: payload(entry.intent.path, entry.intent.body)}))),
  };
  return {...Object.fromEntries(Object.entries(result).map(([key, value]) => [`s.${key}`, value])),
    's.review.verb': state.review.startsWith('Snooze until ')?'snooze':controls[state.review] ?? '', busy: state.busy, locked: state.locked,
    clockEditable: state.clockEditable, menu: state.actions.map(action => controls[action.label]),
    menuDisabled: state.actions.length > 0 && state.actions.every(action => action.disabled)};
}

export async function checkScheduledTaskControls() {
  const driver = fileURLToPath(import.meta.url);
  const driverHashes = captureInputs([driver, fileURLToPath(new URL('./support.mjs', import.meta.url))]);
  const traces = [];
  const confirm = ['confirm'];
  const openRun = [['open'], ['pick', 'fire'], confirm];
  async function scenario(name, steps, options) {
    const f = await scheduledTaskControlsFixture(options);
    Object.assign(driverHashes, f.hashes);
    const initial = f.observe();
    const t = trace(name, fields(initial), call('initFor', initial.kind, initial.storedStatus));
    const methods = {...f, pick: verb => f.click(buttons[verb]),
      enter: (text, time) => f.enter(text, initial.kind === 'preset' ? time : undefined),
      chooseCatalog: f.catalog, async confirm() {f.confirm();await f.wait();}};
    for (const [action, ...args] of steps) {
      await methods[action](...args);
      checkpoint(t, [action, ...args].join(' '), call(action, ...args), fields(f.observe()));
    }
    traces.push(t);
  }
  await scenario('preset edit reviews trimmed instructions and the original weekday and zone', [
    ['open'], ['pick', 'edit'], ['enter', '  New instructions.  ', '09:30'], ['save'], confirm, ['answer', 'exact'],
  ]);
  await scenario('chosen weekends are bound to the confirmed edit', [
    ['open'], ['pick', 'edit'], ['chooseDays', '0,6'], ['enter', 'New instructions.', '09:30'], ['save'], confirm, ['answer','exact'], ['pick','edit'], ['cancelEdit'],
  ]);
  await scenario('discarding a day selection sends no edit', [
    ['open'], ['pick','edit'], ['chooseDays','1,3,5'], ['cancelEdit'],
  ]);
  await scenario('custom cron edits instructions without replacing the stored trigger', [
    ['open'], ['pick', 'edit'], ['enter', 'New instructions.', ''], ['save'], ['cancelReview'],
    ['pick', 'edit'], ['enter', 'New instructions.', ''], ['save'], confirm, ['answer', 'exact'],
  ], {kind: 'custom'});
  await scenario('an invalid preset time keeps edit open without creating a request', [
    ['open'], ['pick', 'edit'], ['enter', 'New instructions.', '25:00'], ['save'], ['cancelEdit'],
  ]);
  await scenario('a mismatched edit receipt keeps its exact retained payload', [
    ['open'], ['pick', 'edit'], ['enter', 'New instructions.', '08:00'], ['save'], confirm, ['answer', 'bad-edit'],
  ]);
  await scenario('a wrong task receipt locks until the user explicitly releases it without replay', [
    ...openRun, ['answer', 'wrong-id'], ['release', false], ['release', true],
    ['pick', 'fire'], confirm, ['answer', 'exact'],
  ]);
  for (const result of ['missing-id', 'wrong-skipped-id', 'transport-lost', 'raced', 'skipped', 'dispatch_deferred', 'dispatch_failed']) {
    await scenario(`fire classifies ${result} without replaying the request`, [...openRun, ['answer', result]]);
  }
  await scenario('a completed manual task offers Reopen before returning to manual controls', [
    ['open'], ['pick', 'reopen'], confirm, ['answer', 'exact'],
  ], {kind: 'manual', status: 'completed'});
  await scenario('a successful missing schedule read retires the detail despite another source error', [
    ...openRun, ['chooseCatalog', 'missing-partial'], ['answer', 'exact'],
  ]);
  await scenario('a failed schedule source blocks even a review that was already open', [
    ['open'], ['pick', 'fire'], ['chooseCatalog', 'failed'], ['refresh'], confirm,
    ['chooseCatalog', 'available'], ['refresh'], ['pick', 'fire'], ['cancelReview'],
  ]);
  await scenario('a previous owner response cannot acknowledge its retained request', [
    ...openRun, ['switchOwner'], ['answer', 'exact'], ['open'],
  ]);
  await scenario('leaving Workflows clears edit without writing a schedule', [
    ['open'], ['pick', 'edit'], ['enter', 'New instructions.', '09:30'], ['leave'],
  ]);
  await scenario('Snooze review and dispatch retain the exact ten-minute intent', [
    ['open'], ['pick', 'snooze'], confirm, ['answer', 'exact'],
  ]);

  return checkTraces({model, sources: Object.keys(driverHashes), driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual Alpha renderer adapter, protocol, owner route table and shared installed-slot intent adapter run with closed ports.',
    'One listed synthetic task, two owner bindings, one held response at a time and fixed UTC preset examples. The synthetic remote row does not execute the LifeOps scheduler.',
    'The source replay invokes renderer callbacks against a controlled shell. Mounted DOM ordering, browser document persistence, server-side task CAS and external effects are separate.',
    'The review verb is visible, while the reviewed request body is observed at intent admission and dispatch.',
    'The explicit untilIso is validated by the fixture and represented as the ten-minute intent here; timezone/recurrence math is checked separately by the exact-time protocol tests.',
  ]});
}
