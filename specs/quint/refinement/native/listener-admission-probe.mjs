import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource} from './current-sources.mjs';
import {listenerServicePlatform} from './listener-service-platform.mjs';
export function probeListenerAdmission(){
 const platform=listenerServicePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-admission-'));
 try{
  const sources=['ListeningService','Listener','ListenerStore','ListeningEpoch','IndicatorLease','ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','SenseConfig'].map(currentNativeSource).concat(directory+'/StorePorts.java',directory+'/ServicePorts.java',platform.paths);
  return javaTraces('ListenerAdmissionProbe.java',sources,[join(state,'settings.json')],'ai.eliza.sense.ListenerAdmissionProbe');
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(probeListenerAdmission(),null,2));
