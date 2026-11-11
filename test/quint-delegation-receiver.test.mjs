// DelegationReceiver traces replayed against the shipped Cancel decision (`delegationCancelStep`)
// with Cloud's state as the port. Every Cancel step of every trace is decided by the real
// function and its effect compared with the model. The panel's callback, start and status steps
// are React state and are covered by test/cloud-delegation-callback.test.mjs, not by this replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, repositoryRoot} from '../specs/quint/refinement/services/identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/application/DelegationReceiver.qnt', module: 'DelegationReceiver'};
const model = readFileSync(`${repositoryRoot}${MODEL.path}`, 'utf8');
const SCENARIOS = [...model.matchAll(/^\s*run (\w+Test)\s*=/gm)].map(match => match[1]);
const WITNESSES = [...model.matchAll(/^\s*val (\w+Witness)\s*=/gm)].map(match => match[1]);
const source = readFileSync(`${repositoryRoot}apps/app/src/runtime/cloud-delegation-ui.tsx`, 'utf8');
const from = source.indexOf('export function delegationCancelStep('), to = source.indexOf('export function CloudDelegationPanel(');
assert.ok(from > 0 && to > from);
const {delegationCancelStep} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source.slice(from, to))).toString('base64'));
// The panel's Cancel uses the decision twice: before and after reading Cloud's state.
assert.match(source, /if \(delegationCancelStep\(record\.phase, null\) === "read-status"\) \{\s*status = await recover\(record, false\);/);
assert.match(source, /if \(delegationCancelStep\(record\.phase, status\) !== "cancel"\) return;/);

/** What reading Cloud's state reports for an authorization, as the panel's recover() names it. */
const reported = cloud => cloud === 'complete' || cloud === 'failed' ? 'settled' : cloud;
/** The stored record, Cloud's state and the grant after a Cancel that reached Cloud. */
function cancelled(before) {
  let status = null, state = {record: before.record, cloud: before.cloud, grant: before.grant};
  if (delegationCancelStep(before.record, null) === 'read-status') {
    status = reported(before.cloud);
    // A settled authorization is applied by the read itself: a grant is adopted, an ended one cleared.
    if (status === 'settled') state = {record: 'none', cloud: before.cloud, grant: before.grant || before.cloud === 'complete'};
  }
  return delegationCancelStep(before.record, status) === 'cancel' ? {record: 'none', cloud: 'failed', grant: before.grant} : state;
}

test('the Cancel decision follows DelegationReceiver on every Cancel step of its traces', {timeout: 240000}, () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 300, steps: 40});
  let cancels = 0;
  const seen = new Set();
  for (const trace of traces) {
    let before = trace.init;
    for (const step of trace.steps) {
      if (step.action === 'cancelEnds' && step.args[0] === false) {
        assert.deepEqual(cancelled(before), {record: step.state.record, cloud: step.state.cloud, grant: step.state.grant}, `${trace.name}: cancel of ${before.record} with Cloud ${before.cloud}`);
        assert.equal(step.state.completes, before.completes, 'Cancel never sends completion');
        seen.add(`${before.record}/${before.cloud}`);
        cancels++;
      }
      before = step.state;
    }
  }
  assert.ok(cancels >= 20, `cancel steps replayed: ${cancels}`);
  // Every reachable combination of the stored phase and Cloud's state was decided.
  for (const pair of ['waiting/waiting', 'finishing/waiting', 'finishing/finishing', 'finishing/complete', 'finishing/failed']) assert.ok(seen.has(pair), pair);
  // The whole decision table, including the combinations the panel never asks about.
  assert.deepEqual(['waiting', 'finishing'].flatMap(phase => [null, 'settled', 'finishing', 'waiting'].map(status => delegationCancelStep(phase, status))),
    ['cancel', 'cancel', 'cancel', 'cancel', 'read-status', 'done', 'done', 'cancel']);
});
