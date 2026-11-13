import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkIndicatorProvider,indicatorProviderScenarios,probeIndicatorProvider} from '../specs/quint/refinement/native/indicator-provider.mjs';

test('actual SystemUI lease provider preserves generation/death ownership and restores caller identity', {timeout:scaledTimeout(360000)},async()=>{
 const result=await checkIndicatorProvider(['test/quint-indicator-provider.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,indicatorProviderScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 assert.ok(result.actions.failedCall>0);
 assert.ok(result.actions.binderDeath>0);
});

test('two held-monitor acquire calls retain the current generation death recipient', {timeout:scaledTimeout(60000)},()=>{
 const result=probeIndicatorProvider();
 assert.equal(result.attempts,32);
 assert.equal(result.mismatches,0);
 assert.equal(result.unrestoredIdentities,0);
});
