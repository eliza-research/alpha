import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {app, directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

function checkNativeDeletionReviewAdmission(extraSources=[]){
 const model='NativeDeletionReviewAdmission';
 const modelPath='specs/quint/native/NativeDeletionReviewAdmission.qnt';
 const compiled=[app+'DeletionReviewAdmission.java'];
 const sources=[modelPath,...compiled,directory+'/DeletionReviewAdmissionTraces.java',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('DeletionReviewAdmissionTraces.java',compiled);
 return checkTraces({model,modelPath,sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'Every ordered sequence of four admit, retire and settle calls is executed on the real Java helper. Successful returns are counted independently of token state.',
  'Android Activity, AlertDialog, worker dispatch and journal persistence are separate callers. The host-JVM concurrency test exercises competing real threads separately.',
 ]});
}

test('actual native deletion review admission refines every four-call token history',async()=>{
 const receipt=await checkNativeDeletionReviewAdmission();
 assert.equal(receipt.passed,true);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.traces,81);
 assert.equal(receipt.checkpoints,405);
});
