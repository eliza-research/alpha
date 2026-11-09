import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkClientObservationSupport} from '../specs/quint/refinement/application/client-observation-support.mjs';

test('optional observation support requires a live session and a fresh matching peer', {timeout: 120000}, async () => {
  const receipt = await checkClientObservationSupport([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 21);
  assert.deepEqual(receipt.observedFields, [
    's.background', 's.compared', 's.connectionCurrent', 's.learn', 's.offered',
    's.reads', 's.retired', 's.supported', 's.turn',
  ]);
});
