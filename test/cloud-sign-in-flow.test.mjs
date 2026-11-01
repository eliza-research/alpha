import test from 'node:test';
import React from 'react';
import {transformSync} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Alpha's registration of the shared native Eliza Cloud sign-in client (elizaOS/eliza
// packages/auth/android; its policy, plugin methods and contract vectors are tested there). These
// checks cover Alpha's identity, installed names, App Link, callback contract and renderer wiring.
// This builds no APK, runs nothing on Android, verifies no App Link, and contacts neither Eliza Cloud
// nor Google.
const root=resolve(import.meta.dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
const between=(text,start,end)=>{const from=text.indexOf(start),to=text.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`${start} … ${end} located`);return text.slice(from,to);};
const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';
const shared='vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/';

test('Alpha registers the shared native sign-in client with its own identity, deployments and installed names',()=>{
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 assert.match(plugin,/^@CapacitorPlugin\(name = "AlphaCloudSignIn"\)\npublic final class AlphaCloudSignInPlugin extends CloudSignInPlugin \{/m);
 for(const fragment of ['.clientId("ai.elizaresearch.alphaphone")','.deviceName("Alpha Phone")','.productName("Alpha Phone")','.googleClientId("alpha-phone")','.logTag("AlphaCloudSignIn")',
  '.readinessPreferences("alpha-cloud-signin-readiness-" + CloudDeployment.STORAGE_NAMESPACE)','.pendingSlot(PENDING_SLOT).receiptSlotPrefix("cloud-signin:v1:ack:").credentialSlotPrefix("cloud:")',
  'static final String PENDING_SLOT = "cloud-signin:v1:pending";','static final String CALLBACK_PATH = "/alphaphone/auth/callback";','static final CloudSignInConfig REGISTRATION = registration(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);'])
  assert.ok(plugin.includes(fragment),fragment);
 assert.match(plugin,/new CloudSignInEnvironment\("production", CloudDeployment\.PRODUCTION_API_HOST, CloudDeployment\.PRODUCTION_WEB_HOST,\s+CloudDeployment\.PRODUCTION_TENANT, CloudDeployment\.PRODUCTION_NAME, CALLBACK_PATH\)/);
 assert.match(plugin,/if \(testMocks\) builder\.environment\(new CloudSignInEnvironment\("staging"/,'staging only in test-mocks builds');
 assert.match(plugin,/AlphaCredentialStore store = new AlphaCredentialStore\(getContext\(\), guard\);/,'the Keystore store runs the client guard before every write');
 assert.match(plugin,/long intent = AlphaLocalAgentPlugin\.reserveCredentialIntent\(\);\s+return \(\) -> AlphaLocalAgentPlugin\.requireCredentialIntent\(intent\);/,'the minted key follows the credential-intent rule');
 assert.doesNotMatch(plugin,/HttpURLConnection|\/steward\/|app-auth/,'no protocol code remains in Alpha');
 // The only Alpha methods are the explicit Restore saved sign-in extension and the shared entry points it
 // wraps to supersede a restore; each wrapper delegates to the shared client.
 assert.deepEqual([...plugin.matchAll(/@PluginMethod public void (\w+)\(/g)].map(m=>m[1]),['savedSignInRecoveryStatus','restoreSavedSignIn','startGoogle','startEmail','startPhone','cancel']);
 for(const entry of ['startGoogle','startEmail','startPhone','cancel'])assert.match(plugin,new RegExp(`public void ${entry}\\(PluginCall call\\) \\{ supersedeRecovery\\(\\); super\\.${entry}\\(call\\); \\}`));
 for(const moved of ['CloudSignInFlow.java','CloudEmailCode.java','CloudSmsCode.java','CloudSignInReadiness.java','CloudKeyRevocation.java','NativeGoogleCredential.java'])
  assert.equal(existsSync(join(root,native,moved)),false,`${moved} lives only in the shared client`);
 // The generated Gradle host (android/consumer-host.json) compiles the shared client from the reviewed pin.
 const cloudAuth=JSON.parse(read('android/consumer-host.json')).profile.modules.filter(module=>module.name==='eliza-cloud-auth');
 assert.deepEqual(cloudAuth,[{name:'eliza-cloud-auth',source:{root:'upstream',path:'packages/auth/android'}}]);
 assert.match(read(native+'MainActivity.java'),/registerPlugin\(AlphaCloudSignInPlugin\.class\);/);
 assert.match(read(native+'RendererCredentialSlots.java'),/"cloud-signin"/,'pending and receipt slots are native-only');
 for(const route of ['signInRoute','signInOrigin','signInAssetLinks'])assert.doesNotMatch(read(native+'ConnectionRoutes.java'),new RegExp(`static boolean ${route}\\(`),'the renderer transport keeps no sign-in route');
});

// Alpha's callback contract (the registration its App Link and Cloud allowlist use) through the
// shared parser, with the shared contract runner.
test('Alpha callback contract vectors through the shared native parser',()=>{
 const contract=JSON.parse(read('test/fixtures/alphaphone-auth-callback-contract.json'));
 assert.equal(contract.contract,'alphaphone-auth-callback');assert.equal(contract.version,1);
 assert.equal(contract.package,'ai.elizaresearch.alphaphone');assert.equal(contract.callbackPath,'/alphaphone/auth/callback');
 assert.ok(read(native+'AlphaCloudSignInPlugin.java').includes(`CALLBACK_PATH = "${contract.callbackPath}"`),'the registration returns to the contract path');
 assert.deepEqual(contract.hosts,{production:'eliza.app',staging:'staging.eliza.app'});
 for(const kind of ['success','error','return','reject'])assert.ok(contract.cases.some(row=>row.expect===kind),`vectors cover ${kind}`);
 for(const row of contract.fallbackHandoffs){
  assert.ok(!row.intentUrl.split('#Intent')[0].includes('?')&&!/code=|state=/.test(row.intentUrl),row.name);
  assert.equal(`https://${row.intentUrl.slice('intent://'.length).split('#Intent')[0]}`,row.deliveredUrl,row.name);
 }
 const flow=read(shared+'CloudSignInFlow.java');
 for(const error of contract.errorAllowlist)assert.ok(flow.includes(`"${error}"`),`shared client allowlists ${error}`);
 const lines=[...contract.cases.map(row=>[row.environment,row.expect,row.url,row.code??'',row.state??'',row.error??'']),
  ...contract.fallbackHandoffs.map(row=>[row.environment,row.expect,row.deliveredUrl,'','',''])];
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-contract-'));
 try{
  writeFileSync(join(temporary,'vectors.tsv'),lines.map(line=>line.join('\t')).join('\n')+'\n');
  const sources=['CloudSignInConfig.java','CloudSignInEnvironment.java','CloudSignInFlow.java'].map(file=>join(root,shared,file)).concat(join(root,'vendor/eliza/packages/auth/android/test/ai/eliza/auth/cloud/CloudSignInContractTest.java'));
  execFileSync(binary('javac'),['--release','11','-d',temporary,...sources],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.eliza.auth.cloud.CloudSignInContractTest',join(temporary,'vectors.tsv'),contract.callbackPath,contract.hosts.production,contract.hosts.staging],{encoding:'utf8',timeout:60000}),new RegExp(`^PASS callback contract \\(${lines.length} vectors\\)`));
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('the sign-in App Link is build-gated with the delegation return; staging lives in the test-mocks overlay',()=>{
 const strip=text=>text.replace(/<!--[\s\S]*?-->/g,'');
 const main=strip(read('android/app/src/main/AndroidManifest.xml')),mocks=strip(read('android/app/src/testMocks/AndroidManifest.xml')),gradle=read('android/app/product.gradle');
 const filter=host=>`<intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="${host}" android:path="/alphaphone/auth/callback"/></intent-filter>`;
 assert.ok(!main.includes('autoVerify'),'a default build declares no https App Link');
 assert.ok(gradle.includes(filter('\\${appLinkHost}')),'ELIZAOS_APP_LINK_HOST adds the sign-in return beside the delegation return');
 assert.ok(!main.includes('staging.eliza.app'),'no staging host in a product manifest');
 assert.ok(between(main,'<activity android:name=".MainActivity"','</activity>').includes('<data android:scheme="alphaphone" android:host="cloud-delegation"/>'),'the delegation return is unchanged');
 // The shared DelegationCallback admits only the scheme and host the plugin passes; they must be the manifest's.
 const connection=read(native+'AlphaConnectionPlugin.java');
 assert.match(connection,/static final String DELEGATION_SCHEME="alphaphone",DELEGATION_HOST="cloud-delegation";/);
 assert.match(connection,/DelegationCallback\.admit\(DELEGATION_SCHEME,DELEGATION_HOST,uri\.getScheme\(\),uri\.getHost\(\),uri\.getPort\(\),uri\.getUserInfo\(\),uri\.getFragment\(\),uri\.getPath\(\),query\)==null\)return;/);
 assert.ok(main.includes('<intent><action android:name="android.support.customtabs.action.CustomTabsService"/></intent>'),'Custom Tabs providers are visible');
 assert.ok(mocks.includes(filter('${stagingCloudWebHost}'))&&mocks.includes('<activity android:name=".MainActivity" tools:node="merge">'),'the staging return merges into MainActivity in test-mocks builds');
 const assetlinks=JSON.parse(read('android/app/src/main/assetlinks.template.json'));
 assert.equal(assetlinks[0].target.package_name,'ai.elizaresearch.alphaphone');
 assert.deepEqual(assetlinks[0].relation,['delegate_permission/common.handle_all_urls']);
});

test('one email code adapter: shared native constants, the bridge config and the shared route allowlist agree',()=>{
 const config=JSON.parse(read('config/cloud-email-code.json')),adapter=read(shared+'CloudEmailCode.java'),routes=read(shared+'CloudSignInRoutes.java');
 assert.match(adapter,new RegExp(`SEND_PATH = "${config.sendPath}"`));assert.match(adapter,new RegExp(`VERIFY_PATH = "${config.verifyPath}"`));
 assert.match(routes,/CloudEmailCode\.SEND_PATH, CloudEmailCode\.VERIFY_PATH/);
 assert.equal(config.tenants,undefined);assert.equal(config.client,'ai.elizaresearch.alphaphone');
 assert.ok(read(native+'AlphaCloudSignInPlugin.java').includes(`.clientId("${config.client}")`),'the bridge and the native registration name the same client');
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
  const run=new Function('operation','cloudEnvironmentAllowed','work','inAppSignInMethods','cloudSignIn','CloudSignInError','cloud','residentCloudFlow','state','update','ensureResident','cloudServiceName',
   'let epoch=0,signInReadinessOwner=null,inAppGoogle=false,inAppPhone=false,inAppEmail=true;'+compiled+';return controller.beginSignIn("production");');
  await run(false,()=>true,async(message,action)=>{checking=message;return action(new AbortController().signal);},async()=>methods,{},Error,{environment:'production',cancelLogin(){}},()=>true,{purpose:'agent'},v=>updates.push(v),async()=>{ensured=true;},()=> 'Independent Service');
  assert.equal(updates.at(-1).signIn.step,'choose');assert.equal(ensured,true);assert.equal(checking,'Checking Independent Service sign-in…');
 }
 const plugin=read(shared+'CloudSignInPlugin.java');
 const measure=between(plugin,'private CloudSignInReadiness.Result measure(','// ── Google: native');
 for(const part of ['/api/v1/app-auth/mobile/config','/steward/auth/providers','CloudEmailCode.SEND_PATH','googleNative'])assert.ok(measure.includes(part),part);
});

// Evaluate the actual JSX prop, rather than maintaining a second sign-in view.
test('browser resident sign-in has no browser hand-off entry; only test mocks keep the diagnostic',()=>{
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 assert.doesNotMatch(ui,/Sign in with browser/,'owner removed the browser sign-in entry from the sign-in page');
 const expression=between(ui,'      extra={','}/>\n').slice('      extra={'.length);
 const compiled=transformSync('const extra='+expression+';',{loader:'tsx',jsxFactory:'React.createElement'}).code;
 const render=new Function('React','browserCloudResidentEnabled','testMocksEnabled','snapshot','connectionController','signInEntryRequired','residentEnvironment',compiled+'return extra;');
 let calls=0;const controller={signInBrowser(){calls++;},beginSignIn(){}};
 assert.equal(render(React,false,false,{busy:false},controller,false,()=>'production'),undefined,'ordinary browser and packaged views have no extra entry');
 assert.equal(render(React,true,false,{busy:false},controller,false,()=>'production'),undefined,'the browser Cloud resident (dev:cloud) view has no browser sign-in entry');
 assert.equal(render(React,true,false,{busy:false},controller,true,()=>'production').props.children,'Retry sign-in','a required sign-in keeps its retry');
 const diagnostic=render(React,false,true,{busy:false},controller,false,()=>'production');
 assert.equal(diagnostic.type,'button');assert.equal(diagnostic.props.children,'Browser sign-in (diagnostic)');assert.equal(diagnostic.props.disabled,false);
 diagnostic.props.onClick();assert.equal(calls,1,'dispatches the existing hosted sign-in callback');
 assert.equal(render(React,false,true,{busy:true},controller,false,()=>'production').props.disabled,true);
});

test('native sign-in errors survive resident startup without hiding genuine startup failures', async () => {
 const source=between(read('apps/app/src/runtime/connection-ui.tsx'),'async function ensureResident()','/** P-43: a startup path');
 const compiled=transformSync(source,{loader:'ts'}).code;
 const run=new Function('state','update','startResident','residentStartFailure',`const residentAlwaysPresent=true,active=null,operation=null;${compiled};return ensureResident();`);
 for(const row of [{error:'Google sign-in failed',startup:'Agent unavailable',previous:'Earlier failure',expected:'Google sign-in failed'},{error:'Earlier failure',startup:'New startup failure',previous:'Earlier failure',expected:'New startup failure'}]){
  const state={error:row.error,message:'',open:true,session:null};
  await run(state,change=>Object.assign(state,change),async()=>Object.assign(state,{error:row.startup}),row.previous);
  assert.equal(state.error,row.expected);
 }
});


