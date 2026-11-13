import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';

async function checkCredentialLeasePolicies(extraSources=[]) {
 const compiled=['CredentialRequestFence','CredentialShutdownLease'].map(name=>'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/'+name+'.java');
 compiled.push('vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/CredentialIntentFence.java','vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java');
 const sources=[...compiled,directory+'/CredentialLeaseTraces.java',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('CredentialLeaseTraces.java',compiled);
 return checkTraces({model:'NativeCredentialMutation',id:'NativeCredentialMutation-current-leases',sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'Real CredentialShutdownLease and CredentialRequestFence public methods execute. Reflection observes their fields and request map.',
  'Two monotonic intent/lease generations, one retained request and the exact 120-second expiry boundary bound this campaign. UUID bytes are abstracted by equality.',
  'Actual service stop inventory, Android process termination, arbitrary request-map capacity and long counter overflow remain separate obligations.'
 ]});
}

test('native request and shutdown leases preserve exact ownership', {timeout:scaledTimeout(120000)}, async () => {
 const receipt=await checkCredentialLeasePolicies(['test/quint-credential-leases.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,13);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
});
