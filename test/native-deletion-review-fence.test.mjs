import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const jar=process.env.ALPHA_JSON_JAR||(existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(n=>n==='json-20250517.jar').map(n=>join(cache,hash,n)))[0]:undefined);
test('native staging fence binds full session/provider/enrollment versions without UI HTTP',{skip:!jar?'Pinned JVM dependency unavailable':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-review-fence-')),files=[];
 const source=(name,body)=>{const path=join(dir,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,body);files.push(path);};
 try{
 source('android/content/Context.java','package android.content; public class Context { public Context getApplicationContext(){return this;} }');
 source('android/util/Log.java','package android.util;public class Log {public static int w(String tag,String value){return 0;}}');
 const pack='package ai.elizaresearch.alphaphone; import org.json.*;';
 source('AlphaCredentialStore.java',pack+'class AlphaCredentialStore {AlphaCredentialStore(android.content.Context c){} JSONObject providerAdmissionSnapshot(){throw new AssertionError();}String readCredentialSlot(String key){throw new AssertionError();}}');
 source('AlphaLocalAgentPlugin.java',pack+'class AlphaLocalAgentPlugin {static JSONObject captureReminderOwnerSession(){throw new AssertionError();}static JSONObject readReminderOwnerRoute(JSONObject a,String b,JSONObject c){throw new AssertionError();}}');
 source('HostedInbox.java',pack+'class HostedInbox {static String id(String v){return v;}}');
 source('HostedResultNotices.java',pack+'class HostedResultNotices {static String hash(String v)throws Exception{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(v.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}}');
 source('FenceTest.java',pack+`public class FenceTest {
 static JSONObject provider,session,device;static JSONObject copy(JSONObject x)throws Exception{return new JSONObject(x.toString());}
 public static void main(String[] args)throws Exception{
 provider=new JSONObject().put("accountRef","native-local").put("environment","fixture").put("sessionGeneration","g1").put("providerVersion",1);
 session=new JSONObject().put("ownerId","owner").put("token","synthetic-token").put("expiresAt",System.currentTimeMillis()+60000);
 device=new JSONObject().put("installationId","install").put("enrollmentId","enroll").put("key","synthetic-key");
 JSONObject expected=new JSONObject().put("subjectUserId","owner").put("agentId","agent").put("accountRef","native-local:owner").put("environment","fixture").put("sessionGeneration","g1").put("installationId","install").put("enrollmentId","enroll");
 NativeOwnerReminderHost host=new NativeOwnerReminderHost(new NativeOwnerReminderHost.Ports(){public JSONObject provider()throws Exception{return copy(provider);}public JSONObject ownerSession()throws Exception{return copy(session);}public String device(String slot){return device.toString();}public JSONObject exchange(JSONObject s,String p,JSONObject h){throw new AssertionError("No HTTP during confirmation");}});
 String initial=host.reviewFence(expected);if(!initial.equals(host.reviewFence(expected)))throw new AssertionError();
 session.put("token","replacement-token");if(initial.equals(host.reviewFence(expected)))throw new AssertionError("Session token not bound");session.put("token","synthetic-token");
 device.put("key","replacement-key");if(initial.equals(host.reviewFence(expected)))throw new AssertionError("Enrollment key not bound");device.put("key","synthetic-key");
 provider.put("providerVersion",2);if(initial.equals(host.reviewFence(expected)))throw new AssertionError("Provider version not bound");provider.put("providerVersion",1);
 session.put("ownerId","foreign");try{host.reviewFence(expected);throw new AssertionError("Wrong owner accepted");}catch(SecurityException good){}session.put("ownerId","owner");
 provider.put("sessionGeneration","g2");try{host.reviewFence(expected);throw new AssertionError("Wrong generation accepted");}catch(SecurityException good){}
 System.out.println("PASS full native review fence without network");
 }} `);
 execFileSync('javac',['--release','17','-cp',jar,'-d',dir,...files,'android/app/src/main/java/ai/elizaresearch/alphaphone/NativeOwnerReminderHost.java','android/app/src/main/java/ai/elizaresearch/alphaphone/NativeDeviceEnrollmentKey.java','android/app/src/main/java/ai/elizaresearch/alphaphone/NativeNotificationDiagnostics.java']);
 assert.match(execFileSync('java',['-cp',dir+':'+jar,'ai.elizaresearch.alphaphone.FenceTest'],{encoding:'utf8'}),/^PASS full native/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
