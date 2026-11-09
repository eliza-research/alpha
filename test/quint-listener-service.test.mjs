import test from 'node:test';
import assert from 'node:assert/strict';
import {checkListenerService,listenerServiceScenarios,probeListenerService} from '../specs/quint/refinement/native/listener-service.mjs';
import {probeListenerAdmission} from '../specs/quint/refinement/native/listener-admission-probe.mjs';

test('actual listener/service lifecycle retains failed resources and completes destruction', {timeout:360000},async()=>{
 const result=await checkListenerService(['test/quint-listener-service.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,listenerServiceScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['create','start','markerWriteFailed','load','pause','disable','destroy'])assert.ok(result.actions[action]>0,action);
});

test('release failure preserves uncertainty while retiring callbacks and recognizer', {timeout:90000},()=>{
 for(const mode of ['release','both']){
  const result=probeListenerService(mode);
  assert.equal(result.threw,false);
  assert.equal(result.markerOpen,true);
  assert.equal(result.microphoneHeld,true);
  assert.equal(result.released,false);
  assert.equal(result.recording,mode==='both');
  assert.equal(result.engineClosed,true);
  assert.equal(result.executorShutdown,true);
  assert.equal(result.superDestroyed,true);
  for(const field of ['modeRegistered','recordingRegistered','playbackRegistered','observerRegistered'])assert.equal(result[field],false,field);
 }
});


test('failed durable listener session admission cannot arm recognition or load an engine', {timeout:90000},()=>{
 const result=probeListenerAdmission();
 assert.equal(result.storageFailed,true);
 assert.equal(result.memoryMarker,true);
 assert.equal(result.durableMarker,false);
 assert.equal(result.released,true);
 assert.equal(result.stops,1);
 for(const field of ['epochActive','analyse','engineLoaded','capture','physical'])assert.equal(result[field],false,field);
});
