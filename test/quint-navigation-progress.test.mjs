import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNavigationProgress,navigationProgressScenarios} from '../specs/quint/refinement/native/navigation-progress.mjs';

test('current Maps guidance follows cursor, reroute and exact background ownership transitions', {timeout:120000},async()=>{
 const receipt=await checkNavigationProgress(['test/quint-navigation-progress.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,Object.keys(navigationProgressScenarios).length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.invariant,'safety');
 for(const action of ['start','fix','reroute','routeResult','available','backgroundAck','backgroundStopped','updateResult'])
  assert.ok(receipt.actions[action]>0,action);
 // Availability and native-start refusal both retire a hidden foreground-only watch.
 for(const name of ['hidden-availability-refusal','hidden-start-refusal']){
  const trace=receipt.traceInputs.find(trace=>trace.name===name),after=trace.steps.at(-1).expect;
  assert.equal(after['s.foreground'],false);
  assert.equal(after['s.backgroundRunning'],false);
  assert.equal(after['s.watch'],0);
  assert.equal(after['s.navigating'],false);
  assert.equal(after['s.releases'],1);
  assert.deepEqual(after['s.stopCommands'],[1]);
 }
 const after=name=>receipt.traceInputs.find(trace=>trace.name===name).steps.at(-1).expect;
 assert.equal(after('hidden-permission-refusal')['s.watch'],1);
 assert.equal(after('hidden-permission-refusal')['s.releases'],0);
 assert.equal(after('stale-start-refusal')['s.watch'],3);
 assert.equal(after('stale-start-refusal')['s.bridgeOwner'],3);
 assert.equal(after('stale-start-refusal')['s.releases'],0);
});
