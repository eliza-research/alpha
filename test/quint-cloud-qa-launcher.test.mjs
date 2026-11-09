import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCloudQaLauncher} from '../specs/quint/refinement/services/cloud-qa-launcher.mjs';

test('Cloud QA launcher source stages private profile and retains exact child and receipt custody', {timeout: 120000}, async () => {
  const receipt = await checkCloudQaLauncher([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 22);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(last('receipt-write')['s.receipt'], 'prior');
  assert.equal(last('receipt-write')['s.child'], 'closed');
  assert.equal(last('pending-signal')['s.result'], 'cancelled');
  assert.equal(last('pending-signal')['s.receipt'], 'current');
  const matching = last('preload-matches-receipt');
  assert.deepEqual([matching['s.requestedPin'], matching['s.admittedPin'], matching['s.receiptHead']],
    ['reviewed', 'reviewed', 'reviewed']);
  const drift = last('preload-admits-before-late-head');
  assert.deepEqual([drift['s.requestedPin'], drift['s.admittedPin'], drift['s.receiptHead']],
    ['reviewed', 'reviewed', 'other']);
  const refused = receipt.traceInputs.find(trace => trace.name === 'preload-rejects-after-receipt');
  assert.ok(refused.steps.some(step => step.expect['s.receiptHead'] === 'reviewed'
    && step.expect['s.preloadOutcome'] === 'unobserved'));
  assert.deepEqual([refused.steps.at(-1).expect['s.preloadOutcome'], refused.steps.at(-1).expect['s.exitCode']],
    ['rejected', 1]);
  for (const name of ['linked-log','hardlinked-log','fifo-log']) {
    assert.equal(last(name)['s.result'], 'log');
    assert.equal(last(name)['s.child'], 'none');
    assert.equal(last(name)['s.foreignLogModeChanged'], false);
  }
});
