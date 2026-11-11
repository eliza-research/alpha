import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAutomaticAppUpdateSchedule} from '../specs/quint/refinement/application/automatic-app-update-schedule.mjs';

test('foreground updates bind native offers, retire stale attempts, and retry without overlapping native calls',{timeout:60000},async()=>{
  const receipt=await checkAutomaticAppUpdateSchedule();
  assert.equal(receipt.traceInputs.length,19);
  assert.equal(receipt.observedFields.length,19);
  assert.ok(receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound);
});
