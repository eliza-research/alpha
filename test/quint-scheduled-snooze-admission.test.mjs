import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const model = 'ScheduledSnoozeAdmission';
const modelPath = 'specs/quint/application/ScheduledSnoozeAdmission.qnt';
const source = 'apps/app/src/runtime/automations-protocol.ts';
const clockSource = 'apps/app/src/runtime/workflow-local-time.ts';
const minute = 60000;
const iso = value => new Date(value).toISOString();
const action = (name, ...args) => ({name, args});

async function checkScheduledSnoozeAdmission(extraSources = []) {
  const buildOptions = {absWorkingDir: root, stdin: {contents:
    `export {AutomationsProtocol,scheduledSnoozeAt} from './${source}'; export {workflowNextClockOccurrence,workflowDeviceTimeZone} from './${clockSource}';`,
    resolveDir: root, loader: 'ts'}, bundle: true, write: false, format: 'cjs', platform: 'node', metafile: true};
  const graph = Object.keys(buildSync(buildOptions).metafile.inputs);
  const sources = [...new Set([modelPath, source, clockSource, 'upstream.lock.json',
    '.eliza/client-features/.source.json', 'bun.lock', fileURLToPath(import.meta.url),
    ...graph.filter(path => !path.startsWith('<')), ...extraSources])];
  const driverHashes = captureInputs(sources);
  const built = buildSync(buildOptions);
  assert.deepEqual(Object.keys(built.metafile.inputs), graph, 'Executable inputs keep the captured dependency graph');
  const prepared = JSON.parse(readFileSync(resolve(root, '.eliza/client-features/.source.json')));
  assert.equal(prepared.baseCommit, JSON.parse(readFileSync(resolve(root, 'upstream.lock.json'))).commit);
  for (const input of sources.filter(path => path.startsWith('.eliza/client-features/') && path.endsWith('.ts'))) {
    const relative = input.slice('.eliza/client-features/'.length);
    assert.equal(driverHashes[resolve(root, input)], prepared.files[relative], input);
  }
  const traces = [];
  const rows = [
    {name: 'scheduled recurrence defers its upcoming occurrence', next: 420, until: 430},
    {name: 'owner-local sentinel follows the device clock', now: new Date(2026, 10, 10, 1).toISOString(), zone: 'owner_local', next: 420, until: 430},
    {name: 'an absent saved zone follows the device clock', now: new Date(2026, 10, 10, 1).toISOString(), zone: '', next: 420, until: 430},
    {name: 'an early from-now deferral is repaired to the scheduled clock', saved: 54, snoozed: true, next: 420, until: 430},
    {name: 'a valid same-day deferral continues after the recurrence passed', now: '2026-11-10T08:05:00Z', saved: 5, snoozed: true, next: 1435, until: 15},
    {name: 'a valid owner-local deferral continues after the recurrence passed', now: new Date(2026, 10, 10, 8, 5).toISOString(), zone: 'owner_local', saved: 5, snoozed: true, next: 1435, until: 15},
    {name: 'a valid deferral without a saved zone continues on the device clock', now: new Date(2026, 10, 10, 8, 5).toISOString(), zone: '', saved: 5, snoozed: true, next: 1435, until: 15},
    {name: 'a future later deferral remains the base', saved: 500, snoozed: true, next: 420, until: 510},
    {name: 'an expired deferral returns to the next recurrence', saved: -10, snoozed: true, next: 420, until: 430},
    {name: 'a fired task snoozes from now without rewriting its recurrence', scheduled: false, next: 420, until: 10},
    {name: 'manual task uses the current instant', cron: null, next: -1, until: 10},
    {name: 'manual snoozed task preserves its saved deferral', cron: null, saved: 20, snoozed: true, next: -1, until: 30},
    {name: 'unsupported cron does not invent a clock occurrence', cron: '*/15 * * * *', next: -1, until: 10},
    {name: 'invalid saved time zone has no invented occurrence', zone: 'Not/AZone', next: -1, until: 10},
    {name: 'spring DST gap skips the nonexistent local recurrence', now: '2027-03-14T06:00:00Z', cron: '30 2 * * *', zone: 'America/New_York', next: 1470, until: 1480},
    {name: 'autumn repeated hour selects the remaining second occurrence', now: '2026-11-01T05:45:00Z', cron: '30 1 * * *', zone: 'America/New_York', next: 45, until: 55},
    {name: 'autumn before the first repeated occurrence uses the first instant', now: '2026-11-01T05:00:00Z', cron: '30 1 * * *', zone: 'America/New_York', next: 30, until: 40},
    {name: 'a future first-fold deferral clamps to the second-fold recurrence', now: '2026-11-01T05:35:00Z', cron: '30 1 * * *', zone: 'America/New_York', saved: 5, snoozed: true, next: 55, until: 65},
    {name: 'foreign clock remains in its saved zone', zone: 'Asia/Tokyo', next: 1320, until: 1330},
    {name: 'an occurrence exactly now is a valid ten-minute base', now: '2026-11-10T08:00:00Z', next: 0, until: 10},
  ];
  async function scenario(configuration, settlement = 'exact', delay = 0, validId = true) {
    const now = Date.parse(configuration.now ?? '2026-11-10T01:00:00Z');
    let clock = now;
    class Clock extends Date {static now() {return clock;}}
    const module = {exports: {}};
    const context = vm.createContext({module, exports: module.exports, Date: Clock, Intl, console, URL, AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, crypto, structuredClone});
    vm.runInContext(built.outputFiles[0].text, context);
    const {AutomationsProtocol, scheduledSnoozeAt, workflowNextClockOccurrence, workflowDeviceTimeZone} = module.exports;
    const cron = configuration.cron === undefined ? '0 8 * * *' : configuration.cron;
    const zone = configuration.zone ?? 'UTC';
    const scheduled = configuration.scheduled !== false;
    const saved = configuration.saved ?? -1;
    const snoozed = configuration.snoozed === true;
    const row = {status: snoozed ? 'snoozed' : scheduled ? 'scheduled' : 'fired', record: {
      taskId: 'closed-task', trigger: cron ? {kind: 'cron', expression: cron, tz: zone} : {kind: 'manual'},
      state: {status: scheduled ? 'scheduled' : 'fired', ...(saved !== -1 ? {firedAt: iso(now + saved * minute)} : {})},
    }};
    const triggerBefore = JSON.stringify(row.record.trigger);
    const nextStamp = cron ? workflowNextClockOccurrence(cron, zone, now) : null;
    const next = nextStamp === null ? -1 : (nextStamp - now) / minute;
    assert.equal(next, configuration.next, configuration.name + ' expected calendar instant');
    const resolvedZone = !zone || zone === 'owner_local' ? workflowDeviceTimeZone() : zone;
    const differentDay = saved !== -1 && next !== -1 && nextStamp !== null
      ? new Date(now + saved * minute).toLocaleDateString('sv-SE', {timeZone: resolvedZone}) !== new Date(nextStamp).toLocaleDateString('sv-SE', {timeZone: resolvedZone}) : false;
    const observed = {clock: 0, next: -1, saved: -1, differentDay: false, scheduled: false,
      snoozed: false, until: -1, phase: 'idle', requests: 0, sentUntil: -1, sentClock: -1, cancelled: false};
    const fields = () => Object.fromEntries(Object.entries(observed).map(([key, value]) => ['s.' + key, value]));
    const replay = {name: configuration.name + ' / ' + settlement, init: action('init'), expect: fields(), steps: []};
    const mark = (name, ...args) => replay.steps.push({label: name, action: action(name, ...args), expect: fields()});
    Object.assign(observed, {next, saved, differentDay, scheduled, snoozed, phase: 'ready'});
    mark('prepare', next, saved, differentDay, scheduled, snoozed);
    const untilIso = scheduledSnoozeAt(row, now);
    Object.assign(observed, {until: (Date.parse(untilIso) - now) / minute, phase: 'calculated'});
    assert.equal(observed.until, configuration.until, configuration.name + ' expected snooze instant');
    assert.equal(JSON.stringify(row.record.trigger), triggerBefore, 'Snooze calculation leaves recurrence intact');
    mark('calculate');
    if (delay) {clock += delay * minute; observed.clock = delay; mark('advance', delay);}
    let release, reject;
    const controller = new AbortController();
    const client = new AutomationsProtocol((path, method, body, signal) => {
      assert.equal(path, '/api/lifeops/scheduled-tasks/closed-task/snooze');
      assert.equal(method, 'POST');
      assert.deepEqual(JSON.parse(JSON.stringify(body)), {untilIso});
      observed.requests++;
      observed.sentClock = (clock - now) / minute;
      observed.sentUntil = (Date.parse(body.untilIso) - now) / minute;
      return new Promise((resolve, fail) => {
        release = resolve; reject = fail;
        signal.addEventListener('abort', () => fail(signal.reason), {once: true});
      });
    });
    let result = 'pending';
    const pending = client.snoozeSchedule(validId ? 'closed-task' : '../other', untilIso, controller.signal)
      .then(() => {result = 'confirmed';}, () => {result = observed.requests ? 'unconfirmed' : 'refused';});
    await pendingTurn();
    observed.phase = result;
    mark('send', validId);
    if (observed.requests) {
      if (settlement === 'cancel') {controller.abort(); observed.cancelled = true; mark('cancel');}
      else if (settlement === 'transport') reject(Error('Closed transport failure'));
      else {
        const task = {taskId: settlement === 'wrong-id' ? 'other' : 'closed-task', state: {
          status: settlement === 'wrong-status' ? 'fired' : 'scheduled',
          firedAt: settlement === 'wrong-time' ? iso(Date.parse(untilIso) + minute) : untilIso,
        }};
        release(settlement === 'missing' ? {} : {task});
      }
      await pending;
      observed.phase = result;
      mark('settle', settlement === 'cancel' ? 'transport' : settlement);
    } else await pending;
    traces.push(replay);
  }
  for (const row of rows) await scenario(row);
  const ordinary = {name: 'exact explicit snooze protocol', cron: null, next: -1, until: 10};
  for (const result of ['wrong-id', 'wrong-status', 'wrong-time', 'missing', 'transport', 'cancel']) await scenario(ordinary, result);
  await scenario({...ordinary, name: 'a held review becomes past before dispatch'}, 'exact', 10);
  await scenario({...ordinary, name: 'malformed identity refuses before request'}, 'exact', 0, false);
  return checkTraces({model, modelPath, sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual Alpha snooze calculator, recurrence helper and AutomationsProtocol execute with an injected clock and one closed request port. Projected shared parser bytes are authenticated against the current source stamp.',
    'Twenty representative calendar configurations cover UTC, a saved foreign zone, unsupported cron, and the New York spring gap and repeated hour. Calendar answers are independently asserted as explicit instants. The model treats the resulting next occurrence as an environmental value.',
    'The repeated-hour deferral records the current recurrence clamp: a saved first-fold 01:40 is snoozed after the remaining second-fold 01:30 occurrence. Whether to retain the earlier future deferral is a separate product policy decision.',
    'One protocol invocation per trace, exact receipt fields, one cancellation and one expiry before dispatch. Recurrence execution, durable server task state, arbitrary calendars and actual provider delivery remain separate.',
  ]});
}

const pendingTurn = () => new Promise(resolve => setImmediate(resolve));

test('explicit schedule snooze refines recurrence selection and exact receipt admission', async () => {
  const receipt = await checkScheduledSnoozeAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 28);
  assert.equal(receipt.observedFields.length, 12);
});
