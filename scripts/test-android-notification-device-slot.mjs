import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {nativeSource,javaBinary} from '../test/fixtures/jvm-tools.mjs';
const android=process.env.ALPHA_ANDROID_JSON_SOURCE;
assert.ok(android,'Set ALPHA_ANDROID_JSON_SOURCE to the reviewed Android SDK source directory for this diagnostic');
// Actual Android JSON serializers; only unavailable annotation types are stubbed.
// Expected key is independently computed with the renderer's JSON.stringify bytes.
test('Android native owner lookup matches the renderer device key and rejects escaped legacy bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-device-key-'));const files=[];
 const put=(name,text)=>{const p=join(dir,name);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,text);files.push(p);};
 try{
  for(const name of ['JSON','JSONArray','JSONObject','JSONStringer','JSONTokener','JSONException'])put('org/json/'+name+'.java',readFileSync(join(android,'org/json',name+'.java'),'utf8'));
  put('android/compat/annotation/UnsupportedAppUsage.java','package android.compat.annotation; public @interface UnsupportedAppUsage {}');
  put('android/annotation/SystemApi.java','package android.annotation; public @interface SystemApi {enum Client {MODULE_LIBRARIES} Client client();}');
  for(const name of ['NonNull','Nullable'])put('libcore/util/'+name+'.java','package libcore.util; @java.lang.annotation.Target({java.lang.annotation.ElementType.TYPE_USE}) public @interface '+name+' {}');
  put('android/util/Log.java','package android.util;public class Log {public static int w(String tag,String value){return 0;}}');
  put('NativeNotificationDiagnostics.java',readFileSync(nativeSource('NativeNotificationDiagnostics.java'),'utf8'));
  put('android/content/Context.java','package android.content; public class Context {public Context getApplicationContext(){return this;}}');
  put('Support.java',`package ai.elizaresearch.alphaphone; import org.json.*;
class AlphaCredentialStore {AlphaCredentialStore(android.content.Context c){} JSONObject providerAdmissionSnapshot(){throw new AssertionError();}String readCredentialSlot(String key){throw new AssertionError();}}
class AlphaLocalAgentPlugin {static JSONObject captureReminderOwnerSession(){throw new AssertionError();}static JSONObject readReminderOwnerRoute(JSONObject a,String b,JSONObject c){throw new AssertionError();}}
class HostedInbox {static String id(String value){if(!value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw new SecurityException();return value;}}
class HostedResultNotices {static String hash(String text)throws Exception{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}}`);
  const owner='10000000-0000-4000-8000-000000000001',agent='20000000-0000-4000-8000-000000000002';
  const expected='device:'+createHash('sha256').update(JSON.stringify(['https://device.alpha.invalid',owner,agent])).digest('hex');
  put('DeviceKeyTest.java',`package ai.elizaresearch.alphaphone;import org.json.*;
public class DeviceKeyTest {public static void main(String[]args)throws Exception{
 String owner="${owner}",agent="${agent}",expected="${expected}";
 if(!NativeDeviceEnrollmentKey.local("https://remote.example.test/api",owner,agent).equals("device:${createHash('sha256').update(JSON.stringify(['https://remote.example.test/api',owner,agent])).digest('hex')}"))throw new AssertionError("Remote key differs");
 if(!NativeDeviceEnrollmentKey.cloud("https://cloud.example.test/api","user_alias",agent).equals("device:${createHash('sha256').update(JSON.stringify(['cloud','https://cloud.example.test/api','user_alias',agent])).digest('hex')}"))throw new AssertionError("Cloud key differs");

 String legacy="device:"+HostedResultNotices.hash(new JSONArray().put("https://device.alpha.invalid").put(owner).put(agent).toString());
 if(expected.equals(legacy))throw new AssertionError("Test did not reproduce Android slash escaping");
 JSONObject provider=new JSONObject().put("accountRef","native-local").put("environment","fixture").put("sessionGeneration","generation");
 JSONObject session=new JSONObject().put("ownerId",owner).put("token","synthetic").put("expiresAt",System.currentTimeMillis()+60000);
 JSONObject device=new JSONObject().put("installationId","30000000-0000-4000-8000-000000000003").put("enrollmentId","40000000-0000-4000-8000-000000000004").put("key","a".repeat(64));
 final int[] requested={0};
 NativeOwnerReminderHost.Ports ports=new NativeOwnerReminderHost.Ports(){public JSONObject provider(){return provider;}public JSONObject ownerSession(){return session;}public String device(String slot){requested[0]++;return expected.equals(slot)?device.toString():null;}public JSONObject exchange(JSONObject s,String path,JSONObject headers)throws Exception{
 JSONObject body;
 if(path.equals("/api/auth/me"))body=new JSONObject().put("identity",new JSONObject().put("id",owner).put("kind","owner")).put("access",new JSONObject().put("role","OWNER").put("mode","session")).put("session",new JSONObject().put("kind","machine").put("id","synthetic").put("expiresAt",session.getLong("expiresAt")));
 else if(path.equals("/api/agents"))body=new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id",agent).put("status","running")));
 else if(path.equals("/api/client-devices/context"))body=new JSONObject().put("subjectUserId",owner).put("agentId",agent).put("installationId",device.getString("installationId")).put("enrollmentId",device.getString("enrollmentId"));
 else throw new AssertionError("Unexpected identity route");return new JSONObject().put("status",200).put("body",body.toString());}};
 JSONObject identity=NativeOwnerReminderHost.read(ports);new NativeOwnerReminderHost(ports).reviewFence(identity);
 if(requested[0]<2)throw new AssertionError("Both read and fence were not tested");
 session.put("ownerId","50000000-0000-4000-8000-000000000005");
 try{new NativeOwnerReminderHost(ports).reviewFence(identity);throw new AssertionError("Wrong owner accepted");}catch(SecurityException expectedRefusal){}
 session.put("ownerId",owner);identity.put("agentId","50000000-0000-4000-8000-000000000005");
 try{new NativeOwnerReminderHost(ports).reviewFence(identity);throw new AssertionError("Wrong agent accepted");}catch(SecurityException expectedRefusal){}

 System.out.println("PASS Android JSON mismatch reproduced; renderer-derived native read and review fence verified");}}
`);
  put('NativeDeviceEnrollmentKey.java',readFileSync(nativeSource('NativeDeviceEnrollmentKey.java'),'utf8'));
  put('NativeOwnerReminderHost.java',readFileSync(process.env.ALPHA_NOTIFICATION_HOST_SOURCE||nativeSource('NativeOwnerReminderHost.java'),'utf8'));
  execFileSync(javaBinary('javac'),['--release','17','-d',dir,...files],{timeout:30000,stdio:'pipe'});
  assert.match(execFileSync(javaBinary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.DeviceKeyTest'],{encoding:'utf8',timeout:30000,stdio:'pipe'}),/^PASS Android JSON mismatch reproduced/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
