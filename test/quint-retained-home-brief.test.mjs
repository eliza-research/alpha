import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/hosted-digests.ts';
const model = 'RetainedHomeBrief';
const ids = [1, 2, 3];
const times = [null, '2027-01-01T09:00:00.000Z', '2027-01-01T10:00:00.000Z', '2027-01-01T11:00:00.000Z'];
const agentNames = {default: '', custom: 'Fixture agent', long: 'a'.repeat(220)};
const agentClasses = new Map([['Your agent', 'default'], [agentNames.custom, 'custom'], ['a'.repeat(199)+'…', 'long']]);
const text = {first: 'First retained fixture.', second: 'Second retained fixture.', tie: 'Equal-time fixture.',
  failure: 'Fixture run failed.', long: 'x'.repeat(2100)};
const textClasses = new Map(Object.entries({...text, long: 'x'.repeat(1999)+'…'}).map(([key, value]) => [value, key]));
const empty = {summary: '', time: 0, agent: '', status: ''};

function row(cursor, time, summary, status = 'finished') {
  const runId = 'fixture-run-' + cursor;
  return {runId, cursor, completedAt: times[time], status,
    output: [{nodeId: 'typed-steps', runId, text: text[summary] ?? 'An excluded occurrence.', steps: [{text: 'Private fixture input'}]}],
    error: status === 'failed' ? text.failure : null};
}
const profiles = {
  none: null,
  nonrun: [row(3, 3, '', 'missed'), row(4, 3, '', 'overlap'), row(5, 3, '', 'unavailable')],
  first: [row(1, 1, 'first')],
  time: [row(2, 2, 'second'), row(9, 1, 'first'), row(10, 3, '', 'missed')],
  tie: [row(8, 2, 'tie'), row(3, 2, 'second')],
  failure: [row(1, 1, 'first'), row(4, 2, 'second', 'failed')],
  long: [row(1, 3, 'long')],
};

async function scenario(actual, name, drive) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'window', {value: window, configurable: true, writable: true});
  let scope = '', accepted = '', events = 0;
  const listeners = new Map(), calls = new Map(ids.map(id => [id, 0]));
  actual.bindRetainedDigestScope(null);
  actual.rememberRetainedDigests(null);
  window.addEventListener('alpha:retained-digest', () => {events++;});
  function remove(id) {
    listeners.get(id)?.release();
    listeners.delete(id);
  }
  function observe() {
    const value = actual.latestRetainedDigest();
    let brief = empty;
    if (value) {
      const summary = textClasses.get(value.summary), time = times.indexOf(value.ranAt), agent = agentClasses.get(value.agent);
      assert.ok(summary && time > 0 && agent);
      assert.ok(!value.summary.includes('Private fixture input'));
      brief = {summary, time, agent, status: value.status};
    }
    return {'s.scope': scope, 's.brief': brief, 's.accepted': accepted, 's.events': events,
      's.listeners': qmap(ids.map(id => [id, listeners.get(id)?.mode ?? ''])), 's.calls': qmap(calls)};
  }
  const schedule = trace(name, observe());
  const record = (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), observe());
  try {
    await drive({
      bind(owner) {
        scope = owner;
        actual.bindRetainedDigestScope(owner || null);
        record('Actual Alpha scope binding clears only a prior scope publication', 'bind', owner);
      },
      remember(owner, profile, agent = 'default') {
        accepted = actual.rememberRetainedDigests(profiles[profile], agentNames[agent], owner || undefined) ? 'yes' : 'no';
        record('Exact source admission chooses the latest executed brief and publishes only a change', 'remember', owner, profile, agent);
      },
      subscribe(id, mode) {
        assert.ok(!listeners.has(id));
        const release = actual.subscribeRetainedDigest(() => {
          calls.set(id, calls.get(id) + 1);
          if (mode === 'throw') throw Error('Synthetic observer refused');
          if (mode === 'removeTwo') remove(2);
        });
        listeners.set(id, {mode, release});
        record('A real retained-brief observer subscribes', 'subscribe', id, mode);
      },
      unsubscribe(id) {
        remove(id);
        record('The exact observer cleanup retires its subscription', 'unsubscribe', id);
      },
    });
    return schedule;
  } finally {
    for (const id of ids) remove(id);
    actual.bindRetainedDigestScope(null);
    actual.rememberRetainedDigests(null);
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
}

async function checkRetainedHomeBrief(extraSources = []) {
  captureSources([driver, implementation, ...extraSources]);
  const {exports, sources} = await bundledSource(implementation);
  const run = (name, drive) => scenario(exports, name, drive);
  const traces = [
    await run('same-scope-and-equivalent-result-do-not-republish', f => {
      f.bind('A'); f.subscribe(1, 'listen'); f.remember('A', 'first'); f.bind('A');
      f.remember('A', 'first'); f.remember('B', 'tie'); f.remember('A', 'first', 'custom');
    }),
    await run('completion-time-precedes-cursor-and-ties-use-cursor', f => {
      f.remember('', 'time'); f.remember('', 'tie'); f.remember('', 'failure');
      f.remember('', 'nonrun'); f.remember('', 'none');
    }),
    await run('late-owner-result-after-replacement-or-disconnect', f => {
      f.bind('A'); f.remember('A', 'first'); f.bind('B'); f.remember('A', 'time');
      f.remember('B', 'tie', 'custom'); f.bind(''); f.remember('B', 'failure'); f.remember('', 'first');
    }),
    await run('returning-to-same-scope-leaves-generation-with-the-caller', f => {
      f.bind('A'); f.remember('A', 'time'); f.bind('B'); f.bind('A'); f.remember('A', 'first');
    }),
    await run('exact-summary-and-agent-label-clipping', f => {
      f.bind('A'); f.remember('A', 'long', 'long'); f.remember('A', 'long');
      f.remember('A', 'long', 'custom');
    }),
    await run('throwing-observer-and-removed-observer-keep-exact-copied-delivery', f => {
      f.subscribe(3, 'throw'); f.subscribe(1, 'removeTwo'); f.subscribe(2, 'listen');
      f.remember('', 'first'); f.remember('', 'tie'); f.unsubscribe(1); f.remember('', 'time');
      f.subscribe(2, 'listen'); f.bind('B'); f.remember('B', 'long');
    }),
  ];
  return await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-component', assumptions: [
      'Actual Alpha retained-brief wrapper and pinned shared store execute with synthetic results and an EventTarget observer.',
      'Two scoped owners, one unbound profile and three observers. The store keys only by scope. A caller must fence an old same-scope publication after an ABA owner transition.',
      'Mounted Home rendering and active inbox/provider completion have separate evidence.',
    ]}));
}

test('the retained Home brief refines scope, selection and exact publication', {timeout: 120000}, async () => {
  const receipt = await checkRetainedHomeBrief([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 6);
  assert.equal(receipt.observedFields.length, 6);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
