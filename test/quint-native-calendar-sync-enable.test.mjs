import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeCalendarSyncEnable} from '../specs/quint/refinement/native/calendar-sync-enable.mjs';

test('native Calendar pause retires old consent before the enabled CAS',async()=>{
  const {receipt}=await checkNativeCalendarSyncEnable();
  assert.equal(receipt.traces,9);
  assert.equal(receipt.checkpoints,80);
  assert.equal(receipt.observedFields.length,18);
  assert.equal(receipt.driverInputsBound,true);
  const scenario=name=>receipt.traceInputs.find(trace=>trace.name===name);
  for(const name of ['pause-before-read','pause-after-read','pause-after-read-unchanged']){
    const trace=scenario(name);
    const paused=trace.steps.find(step=>step.label==='pause').expect;
    const finished=trace.steps.find(step=>step.label==='finishEnable').expect;
    assert.equal(paused['s.pauseResult'],'paused');
    assert.equal(paused['s.durable'],'paused');
    assert.equal(finished['s.enableResult'],'context-changed');
    assert.equal(finished['s.lease'],false);
    assert.equal(finished['s.durable'],'paused');
    assert.equal(finished['s.cloudWriteAllowed'],false);
    assert.equal(finished['s.deletionAllowed'],false);
    assert.deepEqual(finished['s.writes'],['paused']);
    assert.equal(finished['s.compareAttempts'],1);
  }
  const fresh=scenario('fresh-after-pause').steps.at(-1).expect;
  assert.equal(fresh['s.enableResult'],'ready');
  assert.equal(fresh['s.enabledEpoch'],1);
  assert.deepEqual(fresh['s.writes'],['paused','enabled']);
  const refused=scenario('pause-exhausted-enabled').steps.at(-1).expect;
  assert.equal(refused['s.pauseResult'],'unavailable');
  assert.equal(refused['s.durable'],'enabled');
  assert.equal(refused['s.lease'],false);
});
