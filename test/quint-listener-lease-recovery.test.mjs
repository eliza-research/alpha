import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkListenerLeaseRecovery} from '../specs/quint/refinement/native/listener-lease-recovery.mjs';

test('current listener capture is distinct from a restored durable session marker',{timeout:scaledTimeout(120000)},async()=>{
 const {receipt,observations}=await checkListenerLeaseRecovery(['test/quint-listener-lease-recovery.test.mjs']);
 assert.equal(receipt.passed,true);assert.equal(receipt.traces,2);
 assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.inputsUnchanged,true);
 for(const {mode,states} of observations){
  const restored=states.find(state=>state.label==='loadSavedHistory');
  assert.equal(restored.marker,true);assert.equal(restored.durableMarker,true);
  for(const field of ['workerPresent','workerAlive','recordPresent','microphoneHeld','physicalRecording'])assert.equal(restored[field],false,field);
  assert.equal(restored.unsilencedSince,-1);assert.equal(restored.readCalls,0);assert.equal(restored.allocations,0);
  const unopened=states.find(state=>state.label==='processFrame');
  assert.equal(unopened.workerPresent,false);assert.equal(unopened.recordPresent,false);assert.equal(unopened.readCalls,0);
  const opened=states.find(state=>state.label==='openCapture');
  for(const field of ['workerPresent','workerAlive','recordPresent','microphoneHeld','physicalRecording','marker','durableMarker'])assert.equal(opened[field],true,field);
  assert.equal(opened.unsilencedSince,mode==='restored-marker'?2499:0);assert.equal(opened.readCalls,1);assert.equal(opened.allocations,1);
  const frames=states.filter(state=>state.label==='processFrame');
  assert.equal(frames[1].leasePermits,true);
  if(mode==='fresh-grace'){assert.equal(frames[2].leasePermits,true);assert.equal(frames[3].leasePermits,false);}
  const closed=states.find(state=>state.label==='closeCapture');
  for(const field of ['workerPresent','workerAlive','recordPresent','microphoneHeld','physicalRecording','marker','durableMarker'])assert.equal(closed[field],false,field);
  assert.equal(closed.unsilencedSince,-1);
 }
});
