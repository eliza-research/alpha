import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSpeechOutputPreparation,speechOutputPreparationScenarios} from '../specs/quint/refinement/native/speech-output-preparation.mjs';

test('actual speech output preparation retains the bounded lead and reports first write once', {timeout:180000},async()=>{
 const receipt=await checkSpeechOutputPreparation(['test/quint-speech-output-preparation.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,speechOutputPreparationScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.invariant,'safety');
 assert.ok(receipt.actions.trim>0);
 assert.ok(receipt.actions.write>0);
 assert.ok(receipt.traceInputs.some(trace=>trace.init.args[0]===727));
});
