// Cloud provider admission (AP-04). Host-JVM run of the Capacitor-free LocalAgentProviderAdmission
// with synthetic credentials, plus a source check that the plugin delegates to it. Not Android,
// network or real-account evidence. Inference stays qwen-3.8-27b on Cerebras.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

const shared=join(root,'vendor/eliza/plugins/plugin-native-agent');
const admissionSource=join(shared,'android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java');

test('Cloud and direct environments, expiry, credential match, identity and rollback',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([admissionSource,nativeSource('LocalAgentProviderAdmission.java'),join(shared,'test/provider-admission/NativeProviderAdmissionTest.java')],'ai.eliza.plugins.agent.runtime.NativeProviderAdmissionTest',{json:true}),/^PASS local agent provider admission/);
});

test('the plugin delegates provider rules to the admission class and admits explicitly selected own keys',()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 assert.match(source,/static void applyProviderEnvironment\([^)]*\) throws Exception \{LocalAgentProviderAdmission\.applyProviderEnvironment\(provider,cloudSaved,env,now\);\}/);
 assert.match(source,/static String cloudProviderToken\([^)]*\) throws Exception \{return LocalAgentProviderAdmission\.cloudProviderToken\(saved,credentialId,now\);\}/);
 assert.match(source,/LocalAgentProviderAdmission\.bindCloudProvider\(new LocalAgentProviderAdmission\.CloudBindingStore\(\)\{/);
 assert.match(source,/NativeProviderSlot\.managementStatus\(/);
 assert.doesNotMatch(source,/env\.put\("ELIZAOS_CLOUD_API_KEY"|env\.put\("CEREBRAS_API_KEY"/,'no provider environment is built in the plugin');
 assert.match(source,/static final String CLOUD_PROVIDER_MODEL=LocalAgentProviderAdmission\.CLOUD_PROVIDER_MODEL;/);
 const wrapper=readFileSync(nativeSource('LocalAgentProviderAdmission.java'),'utf8');
 assert.match(wrapper,/extends ai\.eliza\.plugins\.agent\.runtime\.NativeProviderAdmission/);
 assert.match(wrapper,/PROVIDER_SLOT="local-agent-provider:v1"/);
 const admission=readFileSync(admissionSource,'utf8');
 assert.doesNotMatch(admission,/com\.getcapacitor|android\./,'the admission class is host-testable');
 assert.match(admission,/CEREBRAS_PROVIDER_MODEL="qwen-3\.8-27b"/);
 assert.match(admission,/CLOUD_PROVIDER_MODEL="cerebras\/qwen-3\.8-27b"/);
 // #410 (main, 2026-10-13): product phones use the Eliza Cloud plan; a direct (bring-your-own)
 // Cerebras key is a test-mocks developer route, refused in production before the key is read.
 const direct=source.slice(source.indexOf('static boolean directProviderAllowed('),source.indexOf('@PluginMethod public void clearProvider('));
 assert.match(direct,/static boolean directProviderAllowed\(boolean testMocks\)\{return NativeProviderSlot\.directProviderAllowed\(testMocks\);\}/);
 assert.match(direct,/if\(!directProviderAllowed\(BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)\)/);
 assert.match(direct,/if\(!runtimePackaged\(\)\)/);
});
