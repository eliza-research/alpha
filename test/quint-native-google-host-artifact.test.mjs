import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNativeGoogleHostArtifact, checkNativeGoogleHostLoaderCompatibility}
  from '../specs/quint/refinement/services/native-google-host-artifact.mjs';

test('native Google host candidate binds emitted and compiled source bytes and preserves the previous pair', {timeout: 120000}, async () => {
  const receipt = await checkNativeGoogleHostArtifact([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 18);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const drift = receipt.traceInputs.find(trace => trace.name.startsWith('coherent drift'));
  assert.ok(drift.steps.some(step => step.expect['s.outcome'].result === 'source'
    && step.expect.ReceiptBindsCompiledSource && step.expect.workerReady));
  const preservedPairs = receipt.traceInputs.filter(trace => trace.name.endsWith('previous exact pair intact'));
  assert.equal(preservedPairs.length, 12);
  assert.ok(preservedPairs.every(trace => trace.steps.some(step => step.expect['s.outcome'].operation === 'build'
    && step.expect['s.outcome'].result !== 'accepted' && step.expect.workerReady && step.expect.FailedBuildPreservesPriorPair)));
  const outputDrift = preservedPairs.find(trace => trace.name.startsWith('output-drift'));
  assert.ok(outputDrift.steps.some(step => step.expect['s.outcome'].result === 'candidate'
    && step.expect['s.attempt'].metadata));
});

test('pinned Bun preserves real loader semantics and the exact reviewed core bytes in the host graph', {
  skip: !process.env.ALPHA_QUINT_BUN && 'set ALPHA_QUINT_BUN to the pinned Bun 1.4.2 binary',
  timeout: 30000,
}, () => {
  const result = checkNativeGoogleHostLoaderCompatibility(process.env.ALPHA_QUINT_BUN);
  assert.equal(result.bun, '1.4.2');
  assert.equal(result.graphInputsChecked, 13);
  assert.equal(result.rawCoreInput, result.effectiveCoreInput);
});
