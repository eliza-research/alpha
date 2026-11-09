// Cloud provider admission (AP-04). Host-JVM run of the Capacitor-free LocalAgentProviderAdmission
// with synthetic credentials, plus a source check that the plugin delegates to it. Not Android,
// network or real-account evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

test('Cloud and direct environments, expiry, credential match, identity and rollback',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([nativeSource('CloudDeployment.java'),nativeSource('LocalAgentProviderAdmission.java'),fixture('LocalAgentProviderAdmissionTest.java')],'ai.elizaresearch.alphaphone.LocalAgentProviderAdmissionTest',{json:true}),/^PASS local agent provider admission/);
});

test('the plugin delegates provider rules to the admission class and keeps the direct key a test-mocks route',()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 assert.match(source,/static void applyProviderEnvironment\([^)]*\) throws Exception \{if\("cloud"\.equals\(BuildConfig\.ELIZA_RUNTIME_PROFILE\)&&!"elizacloud"\.equals\(provider\.optString\("provider"\)\)\)throw new SecurityException\("Cloud runtime requires Cloud provider admission"\);LocalAgentProviderAdmission\.applyProviderEnvironment\(provider,cloudSaved,env,now\);\}/);
 assert.match(source,/static String cloudProviderToken\([^)]*\) throws Exception \{return LocalAgentProviderAdmission\.cloudProviderToken\(saved,credentialId,now\);\}/);
 assert.match(source,/LocalAgentProviderAdmission\.bindCloudProvider\(new LocalAgentProviderAdmission\.CloudBindingStore\(\)\{/);
 assert.match(source,/LocalAgentProviderAdmission\.providerStatus\(saved,cloud,System\.currentTimeMillis\(\)\)/);
 assert.doesNotMatch(source,/env\.put\("ELIZAOS_CLOUD_API_KEY"|env\.put\("CEREBRAS_API_KEY"/,'no provider environment is built in the plugin');
 // #410 (main, 2026-10-13): product phones use the Eliza Cloud plan; a direct (bring-your-own)
 // Cerebras key is a test-mocks developer route, refused in production before the key is read.
 const direct=source.slice(source.indexOf('static boolean directProviderAllowed('),source.indexOf('@PluginMethod public void clearProvider('));
 assert.match(direct,/static boolean directProviderAllowed\(boolean testMocks\)\{return testMocks;\}/);
 assert.match(direct,/if\(!directProviderAllowed\(BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)\)/);
 assert.match(direct,/if\(!runtimePackaged\(\)\)/);
});
