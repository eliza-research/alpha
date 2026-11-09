import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNativeGoogleHostArtifact} from '../specs/quint/refinement/services/native-google-host-artifact.mjs';

test('native Google host artifact custody matches the current producer and readback baseline', {timeout: 120000}, async () => {
  const receipt = await checkNativeGoogleHostArtifact([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 11);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const drift = receipt.traceInputs.find(trace => trace.name.startsWith('coherent drift'));
  assert.ok(drift.steps.some(step => step.expect['s.outcome'].result === 'accepted'
    && step.expect.ReceiptBindsCompiledSource === false));
  const splitPairs = receipt.traceInputs.filter(trace => trace.name.includes('without a new receipt'));
  assert.equal(splitPairs.length, 7);
  assert.ok(splitPairs.every(trace => trace.steps.some(step => step.expect['s.attempt'].moduleWritten
    && !step.expect.workerReady && step.expect['s.outcome'].operation === 'build')));
});
