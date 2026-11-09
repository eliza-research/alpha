import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {listenerServicePlatform} from './listener-service-platform.mjs';
function compiled(platform){return ['ListeningService','Listener','ListenerStore','ListeningEpoch','IndicatorLease','ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','SenseConfig'].map(currentNativeSource).concat(directory+'/StorePorts.java',directory+'/ServicePorts.java',platform.paths);}
export const listenerServiceScenarios=['marker-write-failure','repeated-start','normal','release-failure','both-failure','stop-failure','paused','disabled','retained-refuses-replacement','retained-release-retry','reopen','late-start','destroy-loading','pause-loading'];
export function probeListenerService(mode){const platform=listenerServicePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-service-'));try{return javaTraces('ListenerServiceProbe.java',compiled(platform),[join(state,'settings.json'),mode],'ai.eliza.sense.ListenerServiceProbe');}finally{platform.close();rmSync(state,{recursive:true,force:true});}}
export async function checkListenerService(extraSources=[]){
 const platform=listenerServicePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-service-')),inputs=compiled(platform);
 const sources=[...inputs,...nativePatchInputs,directory+'/ListenerServiceTraces.java',directory+'/ListenerServiceProbe.java',directory+'/listener-service-platform.mjs',directory+'/listener-store-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('ListenerServiceTraces.java',inputs,[state,'campaign',...listenerServiceScenarios],'ai.eliza.sense.ListenerServiceTraces');
  return await checkTraces({model:'NativeListenerService',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'Actual shared Listener, ListeningService, ListenerStore, ListeningEpoch and lease policy execute together. Android framework, AudioRecord, notifications and ASR allocation are controlled ports.',
   'One service instance and two AudioRecord allocations bound lifecycle traces. Initial state has explicit process consent and a fresh visible lease. Pending ASR allocation is independently released before or after destruction.',
   'Unconfirmed AudioRecord release retains the owned handle and durable open marker. Tests observe physical recording separately from resource ownership and do not claim successful release when the port throws.',
   'This lifecycle projection excludes arbitrary frame content, recording/playback callback interleavings and real Android scheduling. Their lower policies and frame processing have separate models; full installed convergence and OS release remain acceptance obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(process.argv[2]==='--probe'?probeListenerService(process.argv[3]||'release'):await checkListenerService(),null,2));
