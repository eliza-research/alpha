// Cloud provider admission (AP-04). Host-JVM run of the Capacitor-free LocalAgentProviderAdmission
// with synthetic credentials, plus a source check that the plugin delegates to it. Not Android,
// network or real-account evidence. Inference stays qwen-3.8-27b on Cerebras.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

const shared=join(root,'vendor/eliza/plugins/plugin-native-agent');
const admissionSource=join(shared,'android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java');

test('Cloud and direct environments, expiry, credential match, identity and rollback',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([admissionSource,nativeSource('LocalAgentProviderAdmission.java'),join(shared,'test/provider-admission/NativeProviderAdmissionTest.java')],'ai.eliza.plugins.agent.runtime.NativeProviderAdmissionTest',{json:true}),/^PASS local agent provider admission/);
});
