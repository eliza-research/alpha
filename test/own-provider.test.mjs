import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {root,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
const shared=join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime');
test('own keys reuse native slot and isolate voice credentials',{skip:jsonJarSkip},()=>{
 assert.match(runJvm(['NativeProviderAdmission.java','NativeProviderSlot.java','NativeRuntimeEmbeddings.java'].map(name=>join(shared,name)).concat(join(root,'test/own-provider/OwnProviderTest.java')),'OwnProviderTest',{json:true}),/^PASS own provider/);
});

test('own Cartesia transport aborts and retires without alternate providers',{skip:jsonJarSkip},()=>{
 const speech=join(root,'vendor/eliza/plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/CartesiaSpeech.java');
 assert.match(runJvm([speech,join(root,'test/own-provider/OwnSpeechTest.java')],'OwnSpeechTest',{json:true}),/^PASS own speech/);
});

test('native-issued request leases recover capacity without stale cancellation', {skip:jsonJarSkip},()=>{
 const secure=join(root,'vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java');
 assert.match(runJvm([secure,join(shared,'CredentialIntentFence.java'),join(shared,'CredentialRequestFence.java'),join(root,'test/own-provider/CredentialRequestFenceTest.java')],'CredentialRequestFenceTest'),/^PASS request lease lifecycle/);
});

test('the Android host stages the request fence used by the provider bridge',()=>{
 const descriptor=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
 const helper='plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/CredentialRequestFence.java';
 assert.ok(descriptor.residentHost.helpers.includes(helper),'provider configuration needs its shared native request fence in every APK');
});
