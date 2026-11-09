import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCloudQaLauncher} from '../specs/quint/refinement/services/cloud-qa-launcher.mjs';

test('Cloud QA launcher source stages private profile and retains exact child and receipt custody', {timeout: 120000}, async () => {
  const receipt = await checkCloudQaLauncher([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 19);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(last('receipt-write')['s.receipt'], 'prior');
  assert.equal(last('receipt-write')['s.child'], 'closed');
  assert.equal(last('pending-signal')['s.result'], 'cancelled');
  assert.equal(last('pending-signal')['s.receipt'], 'current');
  for (const name of ['linked-log','hardlinked-log','fifo-log']) {
    assert.equal(last(name)['s.result'], 'log');
    assert.equal(last(name)['s.child'], 'none');
    assert.equal(last(name)['s.foreignLogModeChanged'], false);
  }
});
