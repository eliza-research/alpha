import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkRecoveryUI} from '../specs/quint/refinement/application/recovery-ui.mjs';

test('actual startup and React failures share one private-content-free recovery surface',{timeout:60000},async()=>{
  const receipt=await checkRecoveryUI([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,14);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
});
