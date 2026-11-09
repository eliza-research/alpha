import test from 'node:test';
import assert from 'node:assert/strict';
import {checkListenerInput,listenerInputScenarios} from '../specs/quint/refinement/native/listener-input.mjs';

test('actual listener frames and callbacks retain their original recognition epoch', {timeout:180000},async()=>{
 const result=await checkListenerInput(['test/quint-listener-input.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,listenerInputScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['phone','recordings','playback','time','lock','indicator','loseLease','applyPolicy','frames','asrReply','act','destroy'])assert.ok(result.actions[action]>0,action);
});
