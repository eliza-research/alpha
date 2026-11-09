import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkDevelopmentDigestPending} from '../specs/quint/refinement/services/development-digest-pending.mjs';

test('development digest phase changes retain exact reviewed payload and raw CAS', {timeout: 30000}, async () => {
  const receipt = await checkDevelopmentDigestPending([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.checkpoints, 52);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
  const trace = name => receipt.traceInputs.find(row => row.name === name);
  const legacy = trace('legacy retry retains original expected bytes').steps[1].expect;
  assert.equal(legacy['s.expected'].pretty, true);
  assert.equal(legacy['s.result'], 'saved');
  const lost = trace('lost acknowledgement preserves host commit and stale renderer view').steps;
  assert.equal(lost[2].expect['s.stored'].phase, 'dispatched');
  assert.equal(lost[2].expect['s.result'], 'lost');
  assert.equal(lost[3].expect['s.result'], 'conflict');
});
