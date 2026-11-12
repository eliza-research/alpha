import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSpeechGate,speechGateScenarios} from '../specs/quint/refinement/native/speech-gate.mjs';

test('actual listener speech gate preserves adaptive thresholds and bounded PCM order', {timeout:scaledTimeout(180000)},async()=>{
 const result=await checkSpeechGate(['test/quint-speech-gate.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,speechGateScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['accept','reset','invalidFrame'])assert.ok(result.actions[action]>0,action);
});
