import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';

// Plain-JVM compile and run of the native renderer-transport route policy. This does not build an
// APK, run on Android, or contact Eliza Cloud or any agent.
// The JDK is JAVA_HOME, else the Homebrew openjdk@21 on darwin when it is installed, else javac on PATH.
test('native transport refuses production pairing and non-Cloud origins and admits DELETE only for Cloud self-revocation',()=>{
 assert.match(runJvm([nativeSource('CloudDeployment.java'),nativeSource('ConnectionRoutes.java'),nativeSource('CloudKeyRevocation.java'),fixture('ConnectionRoutesTest.java')],'ai.elizaresearch.alphaphone.ConnectionRoutesTest'),/^PASS connection routes/);
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
 // Google Calendar owner writes: PATCH and DELETE pass the method gate, and a PATCH carries a body,
 // only through the pure googleCalendarEvents rule, and only after managed path admission.
 const methodGate=request.indexOf('ConnectionRoutes.googleCalendarEvents(url.getRawPath(),url.getRawQuery(),method,call.getString("body")!=null)');
 const bodyGate=request.indexOf('"PATCH".equals(method)&&(ConnectionRoutes.calendarSync(url.getPath(),url.getRawQuery(),method,true)||ConnectionRoutes.googleCalendarEvents(url.getRawPath(),url.getRawQuery(),method,true))');
 assert.ok(methodGate>service&&methodGate<request.indexOf('openConnection()'),'the events method gate follows admission and precedes the connection');
 assert.ok(bodyGate>methodGate&&bodyGate<request.indexOf('connection.setDoOutput(true)'),'the events body gate precedes writing the body');
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
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaResetPlugin.java'),'utf8');
 const authenticated=source.slice(source.indexOf('@ActivityCallback private void authenticated('),source.indexOf('static final long REVOCATION_DEADLINE_MS'));
 const record=authenticated.indexOf('AlphaDataReset.record(getContext());'),revoke=authenticated.indexOf('revokeCloudKeysThenReset(');
 assert.ok(record>0&&revoke>record,'the reset is recorded before any network request');
 assert.match(authenticated,/main\.postDelayed\(reset,REVOCATION_DEADLINE_MS\)/,'a deadline resets even when revocation hangs');
 assert.match(authenticated,/finally\{main\.post\(reset\);\}/,'revocation always ends in the reset');
 assert.match(authenticated,/dispatched\.compareAndSet\(false,true\)/,'the reset is dispatched once');
 assert.match(authenticated,/ResetCloudRevocation\.revoke\(context,REVOCATION_DEADLINE_MS-500\)/,'the live path uses bounded shared revocation');
 const notice=authenticated.indexOf('showRevocationNotice();');
 assert.ok(notice>record&&notice<revoke,'a blocking notice covers the revocation window');
 const shared=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/ResetCloudRevocation.java'),'utf8');
 assert.match(shared,/CloudKeyRevocation\.revoke\(environment,/,'revocation goes through the exact self-revocation policy');
 assert.match(shared,/AlphaCredentialStore\.readSlotBeforeAttach\(context,"cloud:"\+environment\)/);
 const application=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaApplication.java'),'utf8');
 assert.match(application,/AlphaDataReset\.pending\(this\)\)\{ResetCloudRevocation\.revoke\(base,ResetCloudRevocation\.PENDING_DEADLINE_MS\);AlphaDataReset\.admitAndExit\(this\);\}/,'interrupted reset revokes before bounded reset admission');
 assert.match(source,/REVOCATION_DEADLINE_MS=8000;/);
});
test('production refuses a direct (bring-your-own) provider key before reading it',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'),'utf8');
 const method=source.slice(source.indexOf('@PluginMethod public void configureProvider('),source.indexOf('@PluginMethod public void clearProvider('));
 const gate=method.indexOf('if(!directProviderAllowed(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){call.reject(');
 assert.ok(gate>0&&gate<method.indexOf('call.getString("apiKey"')&&gate<method.indexOf('saveVerifiedProvider('),'the gate precedes reading or saving the key');
 assert.match(source,/static boolean directProviderAllowed\(boolean testMocks\)\{return testMocks;\}/);
 const renderer=readFileSync(resolve(import.meta.dirname,'../apps/app/src/runtime/local-agent.ts'),'utf8');
 const configure=renderer.slice(renderer.indexOf('export async function configureLocalProvider('),renderer.indexOf('export async function localProviderStatus('));
 assert.ok(configure.indexOf("VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'))throw")>0&&configure.indexOf("VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'))throw")<configure.indexOf('native.configureProvider('),'the renderer refuses before the native call');
});
test('native transport labels subscription routes and no longer names the credit balance',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 assert.doesNotMatch(source,/credits\/balance|BALANCE\b/);
 assert.match(source,/"\/api\/v1\/subscription\/redeem"\.equals\(path\)\)operation=RequestOperation\.REDEEM/);
});
