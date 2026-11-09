import test from 'node:test';
import React from 'react';
import {transformSync} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fixture,nativeSource,runJvm} from './fixtures/jvm-tools.mjs';

// In-app Eliza Cloud sign-in (owner directive 2026-10-14). The pure policy runs on a plain JVM; the
// Android wiring is checked from source. This builds no APK, runs nothing on Android, verifies no App
// Link, and contacts neither Eliza Cloud nor Google.
const root=resolve(import.meta.dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
const between=(text,start,end)=>{const from=text.indexOf(start),to=text.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`${start} … ${end} located`);return text.slice(from,to);};
const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';

// The pinned server and this consumer both check the App Link contract against
// their respective parsers. Execute the vectors against Alpha's configured deployment.
test('native sign-in policy and App Link contract (plain JVM)',t=>{
 const contract=JSON.parse(read('test/fixtures/alphaphone-auth-callback-contract.json'));
 const lines=[...contract.cases.map(row=>['case',row.environment,row.expect,row.url,row.code??'',row.state??'',row.error??'']),
  ...contract.fallbackHandoffs.map(row=>['case',row.environment,row.expect,row.deliveredUrl,'','','']),
  ...Object.entries(contract.authorizeRequired).map(([name,value])=>['authorize',name,value]),
  ...contract.errorAllowlist.map(error=>['error',error])];
 for(const line of lines)assert.ok(line.every(field=>!/[\t\n]/.test(field)));
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-contract-'));
 t.after(()=>rmSync(temporary,{recursive:true,force:true}));
 const vectors=join(temporary,'vectors.tsv');
 writeFileSync(vectors,lines.map(line=>line.join('\t')).join('\n')+'\n');
 const sources=[
  ...['CloudDeployment.java','CloudSignInFlow.java','CloudSignInReadiness.java','ConnectionRoutes.java'].map(nativeSource),
  ...['CloudSignInFlowTest.java','CloudSignInContractTest.java'].map(fixture),
 ];
 assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.CloudSignInFlowTest',{args:[vectors]}),/^PASS native sign-in policy/);
});

test('the sign-in App Link follows the configured deployment; staging lives in the test-mocks overlay',()=>{
 const strip=text=>text.replace(/<!--[\s\S]*?-->/g,'');
 const main=strip(read('android/app/src/main/AndroidManifest.xml')),mocks=strip(read('android/app/src/testMocks/AndroidManifest.xml')),gradle=read('android/app/build.gradle');
 const filter=host=>`<intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="${host}" android:path="/alphaphone/auth/callback"/></intent-filter>`;
 assert.ok(!main.includes('autoVerify'),'the configured host is generated rather than hard-coded in the main manifest');
 assert.match(gradle,/def appLinkHost = .*\? cloudWebHost :/,'ordinary builds declare the configured Cloud return host');
 assert.ok(gradle.includes(filter('\\${appLinkHost}')),'the generated overlay adds the sign-in return beside the delegation return');
 assert.ok(!main.includes('staging.eliza.app'),'no staging host in a product manifest');
 assert.ok(between(main,'<activity android:name=".MainActivity"','</activity>').includes('<data android:scheme="alphaphone" android:host="cloud-delegation"/>'),'the delegation return is unchanged');
 assert.ok(main.includes('<intent><action android:name="android.support.customtabs.action.CustomTabsService"/></intent>'),'Custom Tabs providers are visible');
 assert.ok(mocks.includes(filter('${stagingCloudWebHost}'))&&mocks.includes('<activity android:name=".MainActivity" tools:node="merge">'),'the staging return merges into MainActivity in test-mocks builds');
 const assetlinks=JSON.parse(read('android/app/src/main/assetlinks.template.json'));
 assert.equal(assetlinks[0].target.package_name,'ai.elizaresearch.alphaphone');
 assert.deepEqual(assetlinks[0].relation,['delegate_permission/common.handle_all_urls']);
});

test('the native sign-in client owns every secret, compares state before burning and never logs',()=>{
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 assert.match(read(native+'MainActivity.java'),/registerPlugin\(AlphaCloudSignInPlugin\.class\);/);
 assert.match(read(native+'RendererCredentialSlots.java'),/"cloud-signin"/,'pending and receipt slots are native-only');
 assert.doesNotMatch(plugin,/android\.util\.Log|System\.out|printStackTrace|Log\.[dewiv]\(/,'nothing is logged');
 // The renderer receives only these outcome fields.
 for(const resolved of plugin.match(/\.resolve\([^;]*;/g)||[])assert.doesNotMatch(resolved,/token|secret|verifier|refresh|code"/i,resolved);
 const finish=between(plugin,'JSObject outcome = new JSObject()','finish(current, outcome);');assert.doesNotMatch(finish,/\.put\("(?:secret|token)"/);
 // Fixed routes only, no redirects, origin and route checked before any connection.
 const post=between(plugin,'private Response post(Attempt current, CloudSignInFlow.Environment environment,','/** The readiness probe');
 assert.ok(post.indexOf('ConnectionRoutes.signInOrigin(')<post.indexOf('fetch(')&&post.indexOf('ConnectionRoutes.signInRoute(')<post.indexOf('fetch('));
 assert.match(between(plugin,'private Fetched fetch(URI url, byte[] body, String bearer, Attempt current','private static final class Fetched'),/setInstanceFollowRedirects\(false\)/);
 // Google: pending record encrypted before the browser opens.
 const google=between(plugin,'@PluginMethod public void startGoogle(','/** Custom Tab in a browser');
 assert.ok(google.indexOf('writeCredentialSlot(PENDING_SLOT')<google.indexOf('openBrowser(url)'));
 const capture=between(plugin,'private boolean captureCallback(','private void burnUnclaimedPending()');
 assert.ok(capture.indexOf('intent.setData(null)')>0&&capture.indexOf('intent.setData(null)')<capture.indexOf('run(() ->'),'the return is consumed once');
 // Contract: a return without a result keeps the pending record; a state mismatch is ignored; the
 // record is burned only after the state matched, and before any network request.
 const noResult=between(capture,'ReturnKind.RETURN) {','// Not this phone');
 assert.doesNotMatch(noResult,/removeCredentialSlot|burnUnclaimedPending/);assert.match(noResult,/"app-link-unverified", false/);
 assert.ok(capture.indexOf('!pending.sameState(received)) return;')<capture.indexOf('store.removeCredentialSlot(PENDING_SLOT)'),'state compared before burning');
 assert.ok(capture.indexOf('store.removeCredentialSlot(PENDING_SLOT)')<capture.indexOf('"/steward/auth/oauth/exchange"'),'single use before any network request');
 assert.match(capture,/\.put\("codeVerifier", pending\.verifier\)/);
 assert.match(between(plugin,'@Override protected void handleOnResume()','@Override protected void handleOnDestroy()'),/end\(current, "browser-closed", false\)/,'closing the browser keeps the pending record until expiry or a retry');
 assert.match(between(plugin,'@PluginMethod public void cancel(','// ── Shared tail'),/burnUnclaimedPending\(\);/,'an explicit cancel burns it');
 // Tail: receipt and key stored before ack; bounded ack; Steward session revoked and never stored.
 const tail=between(plugin,'private void complete(Attempt current, JSONObject session)','/** The saved key for this environment');
 const key=tail.indexOf('credentials.writeCredentialSlot("cloud:" + environment.name'),ack=tail.indexOf('acknowledge(current, proof');
 assert.ok(tail.indexOf('receipts.writeCredentialSlot(receiptSlot(environment)')<key&&key<ack,'receipt, then key, then ack');
 assert.ok(tail.indexOf('previousToken(')<key&&tail.indexOf('CloudKeyRevocation.revoke(')>ack,'a replaced key is read before the write and revoked after activation');
 assert.match(tail,/AlphaLocalAgentPlugin\.reserveCredentialIntent\(\)/,'the key write follows the credential-intent rule');
 assert.match(tail,/"\/steward\/auth\/logout"/);
 assert.doesNotMatch(tail,/writeCredentialSlot\([^)]*(refresh|token\b)/,'the Steward session is never stored');
 assert.match(plugin,/for \(int round = 0; round < CloudSignInFlow\.ACK_ATTEMPTS; round\+\+\)/);
 assert.match(plugin,/@Override public void load\(\) \{[\s\S]*?run\(this::resumeAcknowledgements\);/,'an interrupted ack resumes on the next start');
 // Email: the code adapter, a per-attempt verify cap and a global send cooldown.
 const email=between(plugin,'@PluginMethod public void startEmail(','@PluginMethod public void verifyEmail(');
 assert.match(email,/if \(now < lastEmailSendAt \+ CloudSignInFlow\.RESEND_COOLDOWN_MS\) \{ call\.reject\("Wait before requesting another code", "cooldown"\); return; \}/);
 assert.match(email,/CloudEmailCode\.SEND_PATH, CloudEmailCode\.sendBody\(/);assert.doesNotMatch(plugin,/"\/steward\/auth\/email\/send"/,'no magic-link send');
 const verify=between(plugin,'private void verify(PluginCall call, boolean mfa)','private void release(');
 assert.match(verify,/CloudEmailCode\.VERIFY_PATH, CloudEmailCode\.verifyBody\(/);
 assert.match(verify,/current\.failedVerifies >= CloudSignInFlow\.MAX_VERIFY_ATTEMPTS/);assert.match(verify,/"attempts-exhausted"/);
 // One sign-in at a time.
 assert.match(google,/if \(attempt != null\) \{ call\.reject\("Another sign-in is in progress", "login-active"\); return; \}/);
});

test('one email code adapter: native constants, the bridge config and the route allowlist agree',()=>{
 const config=JSON.parse(read('config/cloud-email-code.json')),adapter=read(native+'CloudEmailCode.java'),routes=read(native+'ConnectionRoutes.java');
 assert.match(adapter,new RegExp(`SEND_PATH = "${config.sendPath}"`));assert.match(adapter,new RegExp(`VERIFY_PATH = "${config.verifyPath}"`));
 for(const path of [config.sendPath,config.verifyPath])assert.ok(routes.includes(`"${path}"`),path);
 assert.equal(config.tenants,undefined);assert.equal(config.client,'ai.elizaresearch.alphaphone');
 for(const field of ['"email"','"tenantId"','"client"','"pkce"','"codeChallenge"','"codeChallengeMethod"','"code"','"codeVerifier"'])assert.ok(adapter.includes(field),field);
 const bridge=read('scripts/browser-cloud-dev-bridge.ts');
 assert.match(bridge,/CLOUD_EMAIL_CODE\.sendPath,emailCodeSendBody\(/);assert.match(bridge,/CLOUD_EMAIL_CODE\.verifyPath,emailCodeVerifyBody\(/);
 assert.doesNotMatch(bridge,/'\/steward\/auth\/email\/send'/);
});

test('native sign-in never falls back to hosted login when readiness fails',async()=>{
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 const begin=between(ui,'async beginSignIn(','cancelSignIn() {');
 assert.doesNotMatch(begin,/residentBrowserLoginAction|browserCloudLoginAction|Opening Eliza Cloud sign-in/);
 // Execute the controller method with an unavailable, malformed, or timed-out readiness result.
 const method=begin.slice(0,begin.lastIndexOf('},')+1);
 const compiled=transformSync('const controller={'+method+'};',{loader:'ts'}).code;
 for(const methods of [null,{google:false},{google:true}]) {
  const updates=[];let ensured=false,checking='';
  let refreshed=false;const connectionController={refreshSignInMethods(){refreshed=true;}};
  const run=new Function('connectionController','signInFailureMessage','operation','cloudEnvironmentAllowed','work','inAppSignInMethods','cloudSignIn','CloudSignInError','cloud','residentCloudFlow','state','update','ensureResident','cloudServiceName','RESIDENT_UNPACKAGED',
   'let inAppGoogle=false,inAppPhone=false,inAppEmail=true,inAppMethodsUnconfirmed=true,inAppReturnToStart=false;'+compiled+';return controller.beginSignIn("production");');
  await run(connectionController,code=>code,false,()=>true,async(message,action)=>{checking=message;return action(new AbortController().signal);},async()=>methods,{},Error,{environment:'production',cancelLogin(){}},()=>true,{purpose:'agent'},v=>updates.push(v),async()=>{ensured=true;},()=> 'Independent Service','Runtime unavailable');
  // The chooser opens at once (email and phone); readiness runs in the background and never opens hosted login.
  assert.equal(updates.at(-1).signIn.step,'choose');assert.equal(ensured,true);assert.equal(checking,'');assert.equal(refreshed,true);
 }
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 const measure=between(plugin,'private CloudSignInReadiness.Result measure(','private boolean assetLinksGrant(');
 for(const part of ['/api/v1/app-auth/mobile/config','/steward/auth/providers','CloudEmailCode.SEND_PATH','CloudSignInFlow.authorizeUrl(','assetLinksGrant(environment)','appLinkVerified(environment)'])assert.ok(measure.includes(part),part);
});

// Evaluate the actual JSX prop, rather than maintaining a second sign-in view.
test('browser resident sign-in exposes the existing hosted hand-off only in its admitted view',()=>{
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 const expression=between(ui,'      extra={','}/>\n  </div></div>;').slice('      extra={'.length);
 const compiled=transformSync('const extra='+expression+';',{loader:'tsx',jsxFactory:'React.createElement'}).code;
 const render=new Function('React','browserCloudResidentEnabled','testMocksEnabled','snapshot','connectionController',compiled+'return extra;');
 let calls=0;const controller={signInBrowser(){calls++;}};
 assert.equal(render(React,false,false,{busy:false},controller),undefined,'ordinary browser and packaged views have no extra entry');
 const browser=render(React,true,false,{busy:false},controller);
 assert.equal(browser.type,'button');assert.equal(browser.props.children,'Sign in with browser');assert.equal(browser.props.disabled,false);
 browser.props.onClick();assert.equal(calls,1,'dispatches the existing hosted sign-in callback');
 assert.equal(render(React,true,false,{busy:true},controller).props.disabled,true);
 assert.equal(render(React,false,true,{busy:false},controller).props.children,'Browser sign-in (diagnostic)');
});


test('the native session exchange requires Android authorization before requesting an app key',()=>{
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 const complete=between(plugin,'private void complete(Attempt current, JSONObject session)','/** The saved key');
 assert.ok(complete.indexOf('requireAuthorization(current);')>complete.indexOf('validStewardToken(token)'));
 assert.ok(complete.indexOf('requireAuthorization(current);')<complete.indexOf('"/api/v1/app-auth/connect"'));
 assert.match(complete,/finally[\s\S]*"\/steward\/auth\/logout"/);
 const gate=between(plugin,'private void requireAuthorization(Attempt current)','// ── Shared tail');
 assert.match(gate,/new AlertDialog.Builder/);assert.match(gate,/decision.await/);
 assert.match(gate,/!current.authorized/);assert.match(gate,/current.expiresAt/);
 assert.doesNotMatch(gate,/PluginCall|call.getBoolean|writeCredentialSlot/);
});
