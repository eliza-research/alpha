import test from 'node:test';
import assert from 'node:assert/strict';
import {checkListenerService, listenerServiceScenarios, probeListenerService} from '../specs/quint/refinement/native/listener-service.mjs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource} from '../specs/quint/refinement/native/current-sources.mjs';
import {listenerServicePlatform} from '../specs/quint/refinement/native/listener-service-platform.mjs';

function probeListenerAdmission(){
 const platform=listenerServicePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-admission-'));
 try{
  const sources=['ListeningService','Listener','ListenerStore','ListeningEpoch','IndicatorLease','ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','SenseConfig'].map(currentNativeSource).concat(directory+'/StorePorts.java',directory+'/ServicePorts.java',platform.paths);
  return javaTraces('ListenerAdmissionProbe.java',sources,[join(state,'settings.json')],'ai.eliza.sense.ListenerAdmissionProbe');
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}

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
