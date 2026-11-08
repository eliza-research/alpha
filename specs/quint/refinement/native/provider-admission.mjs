import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';

/** Preserve provider-binding and rollback checks using the current shared fixture store. */
export async function checkProviderAdmission(extraSources = []) {
  const compiled = [currentNativeSource('NativeProviderAdmission.java'),
    'vendor/eliza/plugins/plugin-native-agent/test/provider-admission/NativeProviderAdmissionTest.java'];
  const sources = [...compiled,...nativePatchInputs,directory+'/ResidentTraces.java',directory+'/Trace.java',
    directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
  const driverHashes = captureInputs(sources);
  const traces = javaTraces('ResidentTraces.java',compiled,[],'ai.eliza.plugins.agent.runtime.ResidentTraces');
  return checkTraces({model:'ResidentRuntime',id:'ResidentRuntime-provider-admission',sources,driverHashes,traces:traces.ResidentRuntime,
    scope:'bounded-component',assumptions:[
      'The actual shared NativeProviderAdmission binds against its upstream test store, whose compare-exchange calls the real admission policy.',
      'Six source schedules cover successful admission, identity refusal, concurrent CAS, credential replacement, storage failure and exact expiry. HTTP identity and storage primitives remain controlled inputs.',
      'Resident start and binding actions establish the precondition around the helper. The separate whole-plugin campaign covers lifecycle ownership.'
    ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkProviderAdmission(),null,2));
