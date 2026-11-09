import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCoreConnectorCustody} from '../specs/quint/refinement/services/core-runtime/connector-custody.mjs';

test('authenticated plugin connector custody retires old publication while preserving current owners', {timeout: 120000}, async () => {
  const receipt = await checkCoreConnectorCustody([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 10);
  assert.deepEqual(receipt.traceInputs.map(trace => trace.steps.length+1), [6, 5, 4, 5, 4, 4, 3, 2, 4, 4]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
});
