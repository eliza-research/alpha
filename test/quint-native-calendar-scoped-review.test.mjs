import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeCalendarScopedReview} from '../specs/quint/refinement/native/scoped-calendar-review.mjs';

test('native Calendar review replays exact synthetic tickets and the as-built pause race',async()=>{
  const {receipt}=await checkNativeCalendarScopedReview();
  assert.equal(receipt.traces,17);
  assert.equal(receipt.checkpoints,92);
  assert.equal(receipt.observedFields.length,22);
  assert.equal(receipt.driverInputsBound,true);
  const race=receipt.traceInputs.find(trace=>trace.name==='inspect-pause-commit');
  const publication=race.steps.find(step=>step.label==='finishInspect').expect;
  assert.equal(publication['s.inspectResult'],'ready');
  assert.equal(publication['s.ticket'],true);
  assert.ok(publication['s.ticketEpoch']<publication['s.epoch']);
  assert.ok(race.steps.some(step=>step.expect['s.reviewPhase']==='dialog'));
  assert.equal(race.steps.at(-1).expect['s.stageCount'],0);
});
