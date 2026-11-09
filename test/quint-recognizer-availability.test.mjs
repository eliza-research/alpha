import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRecognizerAvailability,recognizerAvailabilityScenarios} from '../specs/quint/refinement/native/recognizer-availability.mjs';

test('actual recognizer availability preserves timed and ticketed cache authority', {timeout:180000},async()=>{
 const result=await checkRecognizerAvailability(['test/quint-recognizer-availability.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,recognizerAvailabilityScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['beginProbe','completeProbe','lateAnswer','cached','recordNow','advance','demote','demoteAll'])assert.ok(result.actions[action]>0,action);
});
