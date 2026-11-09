import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAutomaticAppUpdateSchedule} from '../specs/quint/refinement/application/automatic-app-update-schedule.mjs';

test('foreground updates keep polling, back off offline, and retire stale owners without overlapping native calls',{timeout:60000},async()=>{
  const receipt=await checkAutomaticAppUpdateSchedule();
  assert.equal(receipt.traceInputs.length,4);
  assert.equal(receipt.observedFields.length,7);
  assert.ok(receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound);
});
