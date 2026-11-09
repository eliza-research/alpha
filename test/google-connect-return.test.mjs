import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Google connector return (docs/flow-redesign-2026-11). The parser runs on a plain JVM; the
// Android and renderer wiring is checked from source. No APK, App Link verification or Cloud call.
const root=resolve(import.meta.dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
const java=process.env.JAVA_HOME||'';const binary=name=>java?join(java,'bin',name):name;
const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';

test('Google connector return parser accepts exactly Cloud\'s two shapes (plain JVM)',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'google-return-'));
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,native,'GoogleConnectReturn.java'),join(root,'test/fixtures/GoogleConnectReturnTest.java')],{stdio:'pipe'});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.GoogleConnectReturnTest'],{encoding:'utf8',timeout:60000}),/^PASS google connect return \(\d+ checks\)/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('Google connect returns to Alpha: App Link filter, Custom Tab, renderer return URL and refresh',()=>{
 const gradle=read('android/app/build.gradle'),plugin=read(native+'AlphaConnectionPlugin.java');
 assert.match(gradle,/android:path="\/alphaphone\/google\/return"/,'the App Link overlay declares the Google return');
 assert.match(plugin,/captureGoogleReturn\(intent\)/,'new intents are checked for the Google return');
 assert.match(plugin,/notifyListeners\("googleConnectReturn"/,'the result reaches the renderer');
 assert.match(plugin,/CustomTabsIntent/,'Google consent opens in a Custom Tab, which the singleTask return finishes');
 assert.match(plugin,/DOMAIN_STATE_VERIFIED/,'the return URL is offered only when Android verified the host');
 const flow=read('apps/app/src/runtime/google-connect-flow.ts');
 assert.match(flow,/connect\(abort\.signal, 'write', 'modify'/,'one consent asks for Gmail changes and Calendar write');
 assert.match(flow,/notifyGoogleAccountsChanged\(\)/,'Inbox, Calendar and Settings refresh on return');
 const protocol=read('apps/app/src/runtime/cloud-protocol.ts');
 assert.match(protocol,/\/alphaphone\\\/google\\\/return\\\?state=/,'only the App Link return shape is sent as redirectUrl');
 const inbox=read('apps/app/src/prototype/inbox-cloud-adapter.ts');
 // Signed out, the same button signs in first; signed in, Connect Gmail starts Google directly.
 assert.match(inbox,/addAcct: \(\) => \{ if \(!connectionController\.getCloudClient\(\)\) connectionController\.openCloudAccount\(\); else void googleConnect\.start\(\); \}/,'Connect Gmail starts Google directly');
 assert.doesNotMatch(inbox,/googleConnectionController\.open\(\)/,'Inbox no longer detours through the Google accounts panel');
});
