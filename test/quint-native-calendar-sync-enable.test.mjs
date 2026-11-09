import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeCalendarSyncEnable} from '../specs/quint/refinement/native/calendar-sync-enable.mjs';

test('native Calendar pause and consent replay the two as-built journal races',async()=>{
  const {receipt}=await checkNativeCalendarSyncEnable();
  assert.equal(receipt.traces,8);
  assert.equal(receipt.checkpoints,71);
  assert.equal(receipt.observedFields.length,18);
  assert.equal(receipt.driverInputsBound,true);
  for(const name of ['pause-before-read','pause-after-read-unchanged']){
    const trace=receipt.traceInputs.find(trace=>trace.name===name);
    const paused=trace.steps.find(step=>step.label==='pause').expect;
    const finished=trace.steps.find(step=>step.label==='finishEnable').expect;
    assert.equal(paused['s.pauseResult'],'paused');
    assert.equal(paused['s.durable'],'paused');
    assert.equal(finished['s.enableResult'],'context-changed');
    assert.equal(finished['s.lease'],false);
    assert.equal(finished['s.durable'],'enabled');
    assert.equal(finished['s.cloudWriteAllowed'],true);
    assert.equal(finished['s.deletionAllowed'],true);
  }
});
