import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeNavigationOwnership,navigationServiceScenarios} from '../specs/quint/refinement/native/navigation-service.mjs';

test('native Maps service keeps terminal and notification authority with the exact session', {timeout:180000},async()=>{
 const receipt=await checkNativeNavigationOwnership(['test/quint-native-navigation-ownership.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,navigationServiceScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.invariant,'safety');
 for(const action of ['start','destroy','deliver','press','fallback','supersededStart','stop','update'])
  assert.ok(receipt.actions[action]>0,action);
 const after=name=>receipt.traceInputs.find(trace=>trace.name==='native-navigation-'+name).steps.at(-1).expect;
 assert.equal(after('old-plugin-destroy')['s.owner'],2);
 assert.equal(after('stale-start-command')['s.shown'],true);
 assert.equal(after('old-notification')['s.owner'],2);
 assert.equal(after('fallback-successor')['s.fallbackStops'],0);
 assert.equal(after('retired-before-admission')['s.issued'],1);
 assert.equal(after('retired-before-admission')['s.lastCall'],'unavailable');
 for(const name of ['unrelated-assistant-task','unrelated-power-task-after-replacement','unattributed-task-removal']){
  assert.equal(after(name)['s.shown'],true,name);
  assert.equal(after(name)['s.rootComponent'],'main',name);
 }
 for(const name of ['home-task-removal','task-removal','assistant-own-task']){
  assert.equal(after(name)['s.active'],0,name);
  assert.equal(after(name)['s.lastReason'],'task-removed',name);
 }
 const assistant=receipt.traceInputs.find(trace=>trace.name==='native-navigation-assistant-own-task');
 assert.equal(assistant.steps.at(-2).expect['s.shown'],true,'MainActivity root leaves the assistant-owned session active');
 assert.equal(after('unbound-root-uses-exact-owner')['s.lastReason'],'renderer-closed');
});
