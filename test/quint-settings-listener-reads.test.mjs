// SettingsListenerReads traces replayed against the Settings listener read gate. The gate is the
// shipped `listenerReadGate`; the driver applies a status or an action result to the row exactly
// where the Settings adapter does (a read only when `readApplies`, an action result always).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/application/SettingsListenerReads.qnt', module: 'SettingsListenerReads'};
const SCENARIOS = ['olderReadDroppedTest', 'readSkippedDuringActionTest', 'freshReadAfterActionTest', 'supersededReadTest'];
const WITNESSES = ['OlderReadPendingAfterActionWitness', 'ReadSkippedWitness', 'FreshReadShownWitness'];
const source = readFileSync(`${repositoryRoot}apps/app/src/prototype/settings-adapter.ts`, 'utf8');
const region = source.slice(source.indexOf('// settings-reads:begin'), source.indexOf('// settings-reads:end'));
assert.ok(region.includes('export function listenerReadGate'));
const {listenerReadGate} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(region)).toString('base64'));
// The adapter's two uses of the gate, which the driver repeats.
assert.match(source, /const read = listenerReads\.beginRead\(\);\s*if \(read === null\) return;\s*const status = await listenerStatus\(\);\s*if \(owner === instance && capabilityAbort === abort && listenerReads\.readApplies\(read\)\) listener = status;/);
assert.match(source, /if \(!listenerReads\.beginAction\(\)\) return;[\s\S]{0,260}listener = next;[\s\S]{0,420}finally \{ listenerReads\.endAction\(\);/);

const project = s => ({busy: s.busy, reads: s.reads, skippedReads: s.skippedReads, shown: s.shown, shownFrom: s.shownFrom,
  readShown: s.shownFrom === 'read' ? s.shownSequence : 0});

function create() {
  const gate = listenerReadGate(), reads = new Map();
  let listening = true, skipped = 0, shown = 'unknown', shownFrom = 'none', readShown = 0;
  return {
    beginRead() { const token = gate.beginRead(); if (token === null) skipped = Math.min(3, skipped + 1); else reads.set(token, listening); },
    readCompletes(token) {
      const status = reads.get(token);
      reads.delete(token);
      if (gate.readApplies(token)) { shown = status ? 'listening' : 'stopped'; shownFrom = 'read'; readShown = token; }
    },
    beginAction() { assert.equal(gate.beginAction(), true); },
    actionCompletes(stopped) {
      listening = listening && !stopped;
      shown = listening ? 'listening' : 'stopped'; shownFrom = 'action'; readShown = 0;
      gate.endAction();
    },
    listenerResumes() { listening = true; },
    observe: () => ({busy: gate.busy(), reads: [...reads.keys()].sort((a, b) => a - b), skippedReads: skipped, shown, shownFrom, readShown}),
  };
}

test('the Settings listener gate follows SettingsListenerReads scenarios, witnesses and random walks', {timeout: 180000}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model in which the older read replaced the action's result is refused.
  const replaced = state => ({...project(state), shownFrom: state.shownFrom === 'action' && !state.reads.length ? 'read' : state.shownFrom});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'olderReadDroppedTest'), create, {project: replaced}), /olderReadDroppedTest step/);
  for (const action of ['beginRead', 'readCompletes', 'beginAction', 'actionCompletes', 'listenerResumes']) assert.ok(receipt.actions[action] > 0, action);
  // A second action while one runs is refused by the gate, as the model's guard says.
  const gate = listenerReadGate();
  assert.equal(gate.beginAction(), true);
  assert.equal(gate.beginAction(), false);
});
