import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraceCampaign} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {listenerInputPlatform} from './listener-input-platform.mjs';
export const listenerInputScenarios=['invoke','short','ignored-words','partial','busy','locked','locked-pause','call-holds-asr','call-queued-action','mode-partitions','mixed-recording','other-recording','mic-privacy','playback-guard','playback-held-asr','system-sound','indicator-hidden','lease-revoked','destroy-pending-asr','destroy-queued-action'];
export async function checkListenerInput(extraSources=[]){
 const modelPath='specs/quint/native/NativeListenerInput.qnt';
 const platform=listenerInputPlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-input-'));
 const compiled=['ListeningService','Listener','ListenerStore','ListeningEpoch','IndicatorLease','ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','SenseConfig'].map(currentNativeSource).concat(directory+'/StorePorts.java',directory+'/ServicePorts.java',directory+'/ListenerInputPorts.java',platform.paths);
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/ListenerInputTraces.java',directory+'/listener-input-platform.mjs',directory+'/listener-service-platform.mjs',directory+'/listener-store-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraceCampaign('ListenerInputTraces.java',compiled,listenerInputScenarios.map(name=>[join(state,name+'.json'),name]),'ai.eliza.sense.ListenerInputTraces');
  return await checkTraces({model:'NativeListenerInput',modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'Actual ListeningService capture, SpeechGate, WakePhrase, lease, policy and settings execute. Android audio callbacks, clocks, microphone/ASR/notification output and main dispatch are controlled ports.',
   'PCM batches use 14 or 15 synthetic speech frames followed by 35 silence frames and an optional two-part read partition. A held platform start fixes the initial read boundary; existing blocked reads retain their original entry ticket. Actual worker samples, queued callback identity and cleared frame/sample arrays are observed.',
   'The source checkpoint completes one fixed batch or callback boundary. Arbitrary PCM, Android timing, physical audio and real assistant invocation are external obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkListenerInput(),null,2));
