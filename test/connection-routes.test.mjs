import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nativeSource,fixture,runJvm,upstreamConnection} from './fixtures/jvm-tools.mjs';

// Plain-JVM compile and run of the native renderer-transport route policy. This does not build an
// APK, run on Android, or contact Eliza Cloud or any agent.
// The JDK is JAVA_HOME, else the Homebrew openjdk@21 on darwin when it is installed, else javac on PATH.
test('native transport refuses production pairing and non-Cloud origins and admits DELETE only for Cloud self-revocation',()=>{
 assert.match(runJvm([nativeSource('CloudDeployment.java'),upstreamConnection('CloudConnectionPolicy.java'),nativeSource('ConnectionRoutes.java'),fixture('ConnectionRoutesTest.java')],'ai.elizaresearch.alphaphone.ConnectionRoutesTest'),/^PASS connection routes/);
});

// Source-order check of the plugin that applies the policy; the policy itself is run on the JVM above.
test('the transport applies the origin policy before any connection and never touches a credential slot',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 const request=source.slice(source.indexOf('@PluginMethod public void request('),source.indexOf('@PluginMethod public void cancel('));
 const validated=request.indexOf('validatedUrl(call.getString("url"), true)');
 const guard=request.indexOf('if(!ConnectionRoutes.admittedOrigin(url.getScheme(),url.getHost(),url.getPort(),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))throw new IllegalArgumentException();');
 assert.ok(validated>0&&guard>validated,'the origin guard follows URL validation');
 for(const later of ['openConnection()','call.getObject("headers"','call.getString("body")','foregroundLock.wait','ConnectionRoutes.retiredPairing('])
  assert.ok(request.indexOf(later)>guard,`${later} comes after the origin guard`);
 const service=request.indexOf('if(!ConnectionRoutes.managedService(');
 assert.ok(service>guard&&service<request.indexOf('openConnection()')&&service<request.indexOf('call.getObject("headers"'),'managed path admission precedes transport/header handling');
 // #406: the header allowlist is the pure policy run above, not an inline list that could re-admit device declarations.
 assert.match(request,/if \(!ConnectionRoutes\.admittedHeader\(normalized, BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)&&!ConnectionRoutes\.mapsRequestIdentity\(normalized,value,url\.getRawPath\(\),method\)\) throw new IllegalArgumentException\(\);/);
 assert.doesNotMatch(request,/Set\.of\("accept"/,'no inline header allowlist');
 assert.doesNotMatch(request,/storage\(|CredentialSlot|AlphaCredentialStore|secure(Read|Write|Remove)/,'request() has no credential-slot access');
});

// Source check that openExternal decides its host from ConnectionRoutes (run on the JVM above).
test('openExternal admits only the ConnectionRoutes hosts and reads the sign-in handoff from it',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 const open=source.slice(source.indexOf('@PluginMethod public void openExternal('),source.indexOf('@Override protected void handleOnPause('));
 const guard=open.indexOf('if (!ConnectionRoutes.externalHost(url.getScheme(), url.getHost(), url.getPort(), BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)) throw new IllegalArgumentException();');
 assert.ok(guard>0&&guard<open.indexOf('new Intent(Intent.ACTION_VIEW'),'the host rule precedes the intent');
 assert.match(open,/boolean cliLogin=ConnectionRoutes\.externalCliLogin\(url\.getHost\(\),url\.getPath\(\),BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\);/);
 assert.doesNotMatch(open,/endsWith\("\.eliza\.app"\)|staging\.eliza\.app/,'no host rule remains in the plugin');
});

// Source checks of the native wiring the JVM run above cannot reach (Android classes).
test('Reset Alpha data records the reset, revokes Cloud keys best effort within a deadline, then resets',()=>{
 // The shared DataResetPlugin records first, then runs the before-dispatch step once, bounded by a
 // deadline that resets even when revocation hangs (behavior tested upstream in reset.test.mjs).
 const plugin=readFileSync(resolve(import.meta.dirname,'../vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/reset/DataResetPlugin.java'),'utf8');
 const authenticated=plugin.slice(plugin.indexOf('private void authenticated('));
 const record=authenticated.indexOf('reset.record(context);'),notice=authenticated.indexOf('showProgress(text);'),dispatch=authenticated.indexOf('reset.dispatchAfterBeforeDispatch(context, DataReset.INTERACTIVE_DEADLINE_MS');
 assert.ok(record>0&&notice>record&&dispatch>notice,'recorded before any network request, with a blocking notice over the revocation window');
 const registration=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDataReset.java'),'utf8');
 assert.ok(registration.includes('.beforeDispatch(ai.eliza.auth.cloud.CloudKeyRevocation.resetStep(()->AlphaCloudSignInPlugin.REGISTRATION,AlphaCredentialStore::readSlotBeforeAttach)::run)'),'the live and startup paths use the shared bounded revocation step over only the deployments this build admits');
 const shared=readFileSync(resolve(import.meta.dirname,'../vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudKeyRevocation.java'),'utf8');
 assert.match(shared,/transport\.revoke\(config, environment, token\)/,'revocation goes through the shared exact self-revocation policy');
 assert.match(shared,/Math\.min\(timeoutMs, RESET_BUDGET_CAP_MS\)/,'bounded by the caller budget and the 8 s cap');
 const application=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaApplication.java'),'utf8');
 assert.match(application,/AlphaDataReset\.RESET\.admitBeforeStartup\(base,getProcessName\(\)\);/,'interrupted reset revokes before bounded reset admission');
});
test('production own-key setup uses native secure configuration without a renderer secret store',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'),'utf8');
 const method=source.slice(source.indexOf('@PluginMethod public void configureProvider('),source.indexOf('@PluginMethod public void clearProvider('));
 assert.match(method,/if\(!runtimePackaged\(\)\)/);
 assert.match(method,/NativeProviderSlot\.saveVerifiedProvider\(providerSlot\(store\),key,model,cartesia/);
 assert.match(readFileSync(resolve(import.meta.dirname,'../vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderSlot.java'),'utf8'),/public static boolean directProviderAllowed\(boolean testMocks\) \{\s+return true;\s+\}/);
 const renderer=readFileSync(resolve(import.meta.dirname,'../apps/app/src/runtime/local-agent.ts'),'utf8');
 const configure=renderer.slice(renderer.indexOf('export async function configureLocalProvider('),renderer.indexOf('export async function localProviderStatus('));
 assert.doesNotMatch(configure,/localStorage|secureWrite|VITE_ELIZA_DEV_ALLOW_TEST_MOCKS/);
 assert.match(configure,/native\.configureProvider/);
});
test('native transport labels subscription routes and no longer names the credit balance',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 assert.doesNotMatch(source,/credits\/balance|BALANCE\b/);
 assert.match(source,/"\/api\/v1\/subscription\/redeem"\.equals\(path\)\)operation=RequestOperation\.REDEEM/);
});
