import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCombinedAgentLauncher} from '../specs/quint/refinement/services/combined-agent-launcher.mjs';

test('combined launcher matches closed preflight, child custody and signal schedules', {timeout: 120000}, async () => {
  const receipt = await checkCombinedAgentLauncher([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'CombinedAgentLauncher');
  assert.equal(receipt.traces, 21);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  for (const [name, signal] of [['metadata-write', 'SIGTERM'], ['metadata-stubborn', 'SIGKILL']]) {
    const trace = receipt.traceInputs.find(row => row.name === name);
    const writeFailure = trace.steps.find(step => step.action.name === 'metadataFailure').expect;
    assert.equal(writeFailure['s.supervised'], true);
    assert.equal(writeFailure['s.childClosed'], false);
    const failure = last(name);
    assert.equal(failure['s.cleanupSignal'], signal);
    assert.equal(failure['s.childClosed'], true);
    assert.equal(failure['s.metadata'], false);
    assert.equal(failure['s.supervised'], false);
    assert.equal(failure['s.logOpen'], false);
    assert.equal(failure.ChildCustodyAfterLaunch, true);
  }
  assert.equal(last('core-refused')['s.spawnRequested'], false);
  assert.equal(last('core-refused')['s.logOpen'], false);
  assert.equal(last('empty-input')['s.token'], true);
  assert.equal(last('empty-input')['s.logOpen'], false);
  assert.equal(last('spawn-error')['s.metadataPid'], 0);
  assert.equal(last('spawn-error')['s.logOpen'], false);
  assert.equal(last('signal-term')['s.exitCode'], 1);
  assert.equal(last('child-seven')['s.exitCode'], 7);
});
