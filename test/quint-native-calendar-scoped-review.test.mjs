import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeCalendarScopedReview} from '../specs/quint/refinement/native/scoped-calendar-review.mjs';

test('native Calendar review retires a held ticket across pause or destruction',async()=>{
  const {receipt}=await checkNativeCalendarScopedReview();
  assert.equal(receipt.traces,19);
  assert.equal(receipt.observedFields.length,22);
  assert.equal(receipt.driverInputsBound,true);
  const scenario=name=>receipt.traceInputs.find(trace=>trace.name===name);
  const completed=name=>scenario(name).steps.find(step=>step.label==='finishInspect').expect;
  assert.equal(completed('inspect-held-current')['s.inspectResult'],'ready');
  assert.equal(completed('inspect-held-current')['s.ticket'],true);
  for(const name of ['inspect-pause-commit','inspect-destroy-commit']){
    assert.equal(completed(name)['s.inspectResult'],'unavailable');
    assert.equal(completed(name)['s.ticket'],false);
    assert.equal(scenario(name).steps.at(-1).expect['s.stageCount'],0);
  }
  const afterPause=scenario('inspect-pause-commit').steps;
  assert.equal(afterPause.find(step=>step.label==='request').expect['s.reviewResult'],'conflict');
  assert.equal(afterPause.find(step=>step.label==='inspect').expect['s.ticketEpoch'],1);
  assert.equal(afterPause.find(step=>step.label==='show').expect['s.reviewPhase'],'dialog');
});
