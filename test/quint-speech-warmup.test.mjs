import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSpeechWarmup,speechWarmupScenarios} from '../specs/quint/refinement/native/speech-warmup.mjs';

test('actual speech output warmup fences late opens and retires silent writes', {timeout:180000},async()=>{
 const result=await checkSpeechWarmup(['test/quint-speech-warmup.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,speechWarmupScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['create','finishOpen','finishWrite','close'])assert.ok(result.actions[action]>0,action);
});
