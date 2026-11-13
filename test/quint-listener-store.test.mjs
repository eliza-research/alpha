import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {currentNativeSource, nativePatchInputs} from '../specs/quint/refinement/native/current-sources.mjs';
import {listenerStorePlatform} from '../specs/quint/refinement/native/listener-store-platform.mjs';

const listenerStoreScenarios=['full-history','malformed-history','grant','revoke','pause','restart-consent','stale-consent','reset-recovery','reset-failed','reset-durable-throw','reset-early-throw','failed-close','tripped','window','reboot','update','unknown-boot','permission','failed-crash-write','clear-errors','failed-enable','failed-pause','failed-revoke','memory-failure','early-throw','durable-throw'];
async function checkListenerStore(extraSources=[]){
 const platform=listenerStorePlatform(),state=mkdtempSync(join(tmpdir(),'quint-listener-settings-'));
 const compiled=['ListenerStore.java','ListeningEpoch.java','CrashLoopBreaker.java','ListenerPolicy.java'].map(currentNativeSource).concat(directory+'/StorePorts.java',platform.paths);
 const sources=[...compiled,...nativePatchInputs,directory+'/ListenerStoreTraces.java',directory+'/listener-store-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('ListenerStoreTraces.java',compiled,[state,'campaign',...listenerStoreScenarios],'ai.eliza.sense.ListenerStoreTraces');
  return await checkTraces({model:'NativeListenerStore',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'Actual ListenerStore, ListeningEpoch and CrashLoopBreaker execute. Android SharedPreferences, clock/package facts and stopService are controlled ports.',
   'Four persistence outcomes separate acknowledgement, memory-only failure, pre-write exception and exception after durable replacement. Restart observations come from a new JVM loading the actual durable fixture file.',
   'Zero to eight seeded history timestamps and boundary clocks partition crash recovery; finite model uses the actual eight-entry history cap. Stored malformed text is normalized by the actual CrashLoopBreaker decoder.',
   'Calls are serialized at the source method boundary. Arbitrary simultaneous preference writers, Android filesystem power loss, actual stopService acceptance and whole ListeningService reaction remain separate obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}

test('actual listener settings distinguish durable acknowledgement, per-process consent and restart', {timeout:360000},async()=>{
 const result=await checkListenerStore(['test/quint-listener-store.test.mjs']);
 assert.equal(result.passed,true);
 assert.equal(result.traces,listenerStoreScenarios.length);
 assert.equal(result.driverInputsBound,true);
 assert.equal(result.inputsUnchanged,true);
 for(const action of ['grant','revoke','reset','enable','pause','resume','session','processStart','restart'])assert.ok(result.actions[action]>0,action);
});
