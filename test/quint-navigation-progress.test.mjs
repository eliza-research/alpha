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
 const fixes=name=>receipt.traceInputs.find(trace=>trace.name===name).steps.filter(step=>step.action.name==='fix').map(step=>
  [step.expect['s.navStep'],step.expect['s.navCleared']]);
 assert.deepEqual(fixes('two-clear-fixes'),[[0,1],[1,0],[1,1],[2,0]]);
 assert.deepEqual(fixes('nonclear-resets-clearance'),[[0,1],[0,0],[0,1]]);
 assert.deepEqual(fixes('offroute-resets-clearance'),[[0,1],[0,0],[0,1]]);
 assert.deepEqual(fixes('retired-watch-cannot-confirm'),[[0,1],[0,1],[1,0]]);
 assert.equal(after('end-during-reroute')['s.watch'],3);
 assert.equal(after('end-during-reroute')['s.navStep'],0);
 assert.equal(after('end-during-reroute')['s.navCleared'],0);
});

for(const mutant of ['single-clear-fix','retain-clearance','retired-watch-fix']){
 test(`navigation source canary rejects ${mutant}`,{timeout:120000},async()=>{
  await assert.rejects(checkNavigationProgress(['test/quint-navigation-progress.test.mjs'],{mutant}),/Source\/model trace mismatch/);
 });
}
