import {fileURLToPath} from 'node:url';
import {app,directory,javaTraces} from './java.mjs';
import {captureInputs,checkTraces} from '../check-traces.mjs';

export function checkNativeDeletionReviewAdmission(extraSources=[]){
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
