import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOnDeviceRecognizer,onDeviceRecognizerScenarios} from '../specs/quint/refinement/native/on-device-recognizer.mjs';
import {probeRecognizerRetirement} from '../specs/quint/refinement/native/recognizer-retirement.mjs';

test('actual on-device recognition preserves audio bounds and first result authority', {timeout:180000},async()=>{
 const result=await checkOnDeviceRecognizer(['test/quint-on-device-recognizer.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,onDeviceRecognizerScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['feed','stall','finish','callback','timeout','cancel','requestCancel','settleCancel'])assert.ok(result.actions[action]>0,action);
});

test('retired recognition errors preserve availability and an active missing-language result demotes', {timeout:90000},()=>{
 const results=probeRecognizerRetirement();
 assert.deepEqual(results.map(row=>[row.mode,row.availabilityAfterError]),[['answered',true],['cancelled',true],['active',false]]);
 for(const row of results){assert.equal(row.answered,true);assert.equal(row.supportProbes,1);}
});
