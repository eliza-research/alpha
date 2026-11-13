import test from 'node:test';
import assert from 'node:assert/strict';
import {recordComparedObservation} from '../specs/quint/refinement/observed-replay.mjs';
import {editCoalescer} from '../apps/app/src/runtime/inbox-edit-coalescer.ts';
import {actionCounter, modelScenario, modelWalks} from '../specs/quint/refinement/services/inbox-workflows-model-traces.mjs';

/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
let observedTraces=0,observedCheckpoints=0;

const model = 'specs/quint/services/InboxEditCoalescer.qnt', main = 'InboxEditCoalescer';
const scenarios = ['burstWritesLatestOnceTest', 'continuousTypingIsBoundedTest', 'slowStoreHoldsNextWriteTest',
  'leavingWritesAtOnceTest', 'oversizedEditReportedTest', 'retireWritesWaitingEditTest'];

/** The real coalescer on a tick clock, with the writer of the retained-edit store: a copy too
 * large to encode is reported and leaves the stored copy as it was. */
function subject() {
  let now = 0, timer = null, stored = 0, invalid = false, writes = 0, alive = true, held = 0;
  const timers = {set(run, ms) { timer = {run, at: now + ms}; return timer; }, clear(handle) { if (timer === handle) timer = null; }, now: () => now};
  const queue = editCoalescer(value => { writes++; if (value.big) invalid = true; else { stored = value.n; invalid = false; } },
    {delay: 2, maximumWait: 4, timers});
  let latest = 0;
  const apply = (action, after) => {
    if (action === 'push') queue.push({n: ++latest, big: after.latestBig});
    else if (action === 'tick') now++;
    else if (action === 'due') { assert.ok(timer && timer.at <= now, 'the model fired a timer the coalescer has not armed or that is not due'); const {run} = timer; timer = null; run(); }
    else if (action === 'flush') assert.equal(queue.flush(), after.writesBefore !== after.writes, 'flush reports whether a copy was written');
    else if (action === 'hold') { queue.hold(); held++; }
    else if (action === 'release') { queue.release(); held--; }
    else if (action === 'discard') queue.discard();
    else if (action === 'retire') { queue.flush(); alive = false; }
    else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = () => ({waiting: queue.peek()?.n ?? 0, waitingBig: queue.peek()?.big ?? false, pending: queue.pending,
    timer: timer !== null, remaining: timer ? timer.at - now : 0, held, stored, invalid, writes, alive, latest});
  return {apply, observe};
}

const project = s => ({waiting: s.waiting, waitingBig: s.waitingBig, pending: s.waiting !== 0, timer: s.timer, remaining: s.remaining,
  held: s.held, stored: s.stored, invalid: s.invalid, writes: s.writes, alive: s.alive, latest: s.latest});

/** A step the model refuses has no counterpart the real coalescer would act on. */
function refused(code, action, label) {
  const before = code.observe();
  if (action === 'due' || action === 'tick') assert.equal(before.timer && (action === 'tick' ? before.remaining > 0 : before.remaining === 0), false, `${label}: ${action} is refused because no such timer is armed`);
  else if (action === 'push') assert.equal(before.alive, false, `${label}: an edit is refused only after retirement`);
  else assert.fail(`${label}: unmapped refused action ${action}`);
}

function replay(walk, label, seen) {
  const code = subject();
  const initialObservation=code.observe(),initialProjection=project(walk[0].state);
  assert.deepEqual(initialObservation,initialProjection,`${label} initial state`);
  recordComparedObservation({trace:label,step:0,actual:initialObservation,expected:initialProjection});observedTraces++;observedCheckpoints++;
  for (let i = 1; i < walk.length; i++) {
    const {action, state, rejected} = walk[i];
    if(rejected){refused(code,action,label);const actual=code.observe(),expected=project(state);assert.deepEqual(actual,expected);recordComparedObservation({trace:label,step:i,action:null,actual,expected});observedCheckpoints++;continue;}
    seen.note(action);
    code.apply(action, {...state, writesBefore: walk[i - 1].state.writes});
    const observation=code.observe(),projection=project(state);
    assert.deepEqual(observation,projection,`${label} step ${i} ${action || 'stutter'}`);
    recordComparedObservation({trace:label,step:i,action,args:walk[i].args,picks:walk[i].picks,actual:observation,expected:projection});observedCheckpoints++;
    // A timer the coalescer armed never outlives the burst limit, and a due write is never made while held.
    assert.equal(state.heldWrite, false, `${label} step ${i}`);
  }
}


async function runInboxEditCoalescerCase1(t, {canaries=true}={}) {
  const seen = actionCounter();
  for (const scenario of scenarios) replay(modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of ['push', 'tick', 'due', 'flush', 'hold', 'release', 'retire']) assert.ok(seen.count(action) > 0, action);
}

async function runInboxEditCoalescerCase2(t, {canaries=true}={}) {
  const seen = actionCounter(), walks = modelWalks(model, {main, traces: 60, steps: 30});
  assert.equal(walks.length, 60);
  walks.forEach((walk, index) => replay(walk, `walk ${index}`, seen));
  for (const action of ['push', 'tick', 'due', 'flush', 'hold', 'release', 'discard', 'retire']) assert.ok(seen.count(action) > 0, `${action} ${JSON.stringify(seen.all())}`);
}

async function runInboxEditCoalescerCase3(t, {canaries=true}={}) {
  // The model's WaitingHasDriver: a copy waits only with a timer or under a hold.
  const code = subject();
  code.apply('push', {latestBig: false}); code.apply('hold'); code.apply('tick'); code.apply('tick'); code.apply('due');
  assert.deepEqual({...code.observe()}, {waiting: 1, waitingBig: false, pending: true, timer: false, remaining: 0, held: 1, stored: 0, invalid: false, writes: 0, alive: true, latest: 1});
  code.apply('release');
  assert.equal(code.observe().stored, 1);
}

async function runInboxEditCoalescerReplay(){const beforeTraces=observedTraces,beforeCheckpoints=observedCheckpoints;await runInboxEditCoalescerCase1(undefined,{canaries:false});await runInboxEditCoalescerCase2(undefined,{canaries:false});return{traces:observedTraces-beforeTraces,checkpoints:observedCheckpoints-beforeCheckpoints};}

test('the real edit coalescer follows every step of the model scenarios', () => runInboxEditCoalescerCase1(undefined));
test('the real edit coalescer follows random model walks step by step', {timeout: 120000}, () => runInboxEditCoalescerCase2(undefined));
test('an armed timer is the only way a waiting copy is written without a caller', () => runInboxEditCoalescerCase3(undefined));
