import test from 'node:test';
import assert from 'node:assert/strict';
import {checkListenerStore,listenerStoreScenarios} from '../specs/quint/refinement/native/listener-store.mjs';

test('actual listener settings distinguish durable acknowledgement, per-process consent and restart', {timeout:360000},async()=>{
 const result=await checkListenerStore(['test/quint-listener-store.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,listenerStoreScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['grant','revoke','reset','enable','pause','resume','session','processStart','restart'])assert.ok(result.actions[action]>0,action);
});
