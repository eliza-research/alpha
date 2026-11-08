import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkDevelopmentRuntimeLoader} from '../specs/quint/refinement/services/development-runtime-loader.mjs';

test('development runtime loader compares with isolated pin, build receipt, state and import schedules', {timeout: 150000}, async () => {
  const bun = process.env.ALPHA_QUINT_BUN;
  const receipt = await checkDevelopmentRuntimeLoader([fileURLToPath(import.meta.url)], bun);
  assert.equal(receipt.model, 'DevelopmentRuntimeLoader');
  assert.equal(receipt.traces, bun ? 22 : 21);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);

  for (const name of ['same_process_rebuild_retains_loaded_module_identity',
    ...(bun ? ['actual_Bun_compiler_rebuild_keeps_cached_import'] : [])]) {
    const observed = receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
    assert.equal(observed['s.artifact'], 2);
    assert.equal(observed['s.receipt'], 2);
    assert.equal(observed['s.returned'], 1);
    assert.equal(observed['s.evaluations'], 1);
    assert.equal(observed['s.saltVersions'], 1);
    assert.equal(observed.ReturnedCurrentArtifact, false);
  }
});
