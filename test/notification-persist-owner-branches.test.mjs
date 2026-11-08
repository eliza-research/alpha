import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
test('actual owner persistence distinguishes installation, session, agent, provider and write refusals',{skip:jsonJarSkip},()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');const start=source.indexOf(' static String notificationInstallation('),end=source.indexOf(' static void retireRejectedNotificationSession',start);assert(start>=0&&end>start);
 const dir=mkdtempSync(join(tmpdir(),'alpha-owner-persist-')),files=[];const put=(name,text)=>{const p=join(dir,name);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,text);files.push(p);};
 try{
  put('android/util/Log.java','package android.util;public class Log {public static final java.util.List<String> values=new java.util.ArrayList<>();public static int w(String tag,String value){values.add(value);return 0;}}');
  put('NativeNotificationDiagnostics.java',readFileSync(nativeSource('NativeNotificationDiagnostics.java'),'utf8'));
  put('android/content/Context.java',`package android.content;public class Context {private final java.io.File files;public Context(java.io.File files){this.files=files;}public java.io.File getFilesDir(){return files;}public Context getApplicationContext(){return this;}}`);
  put('ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java','package ai.eliza.plugins.securestore.nativeonly;public class JsonCredentialSlots {public static final Object LOCK=new Object();}');
  put('NativeNotificationSession.java',readFileSync(nativeSource('NativeNotificationSession.java'),'utf8'));
  put('PersistTest.java',`package ai.elizaresearch.alphaphone;import org.json.*;import android.content.Context;import java.nio.file.*;
class HostedInbox {static String id(String v){if(v==null||!v.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw new IllegalArgumentException();return v;}}
class HostedResultNotices {static String hash(String v)throws Exception{byte[] h=java.security.MessageDigest.getInstance("SHA-256").digest(v.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(byte b:h)s.append(String.format("%02x",b&255));return s.toString();}}
class ResidentResultSession {static JSONObject snapshot(String a,String b,long c,String d){throw new AssertionError();}}
class NativeNotificationProjector {static int retired;static void retireOwner(Context c,String o){retired++;}}
class AlphaCredentialStore {
 static String saved;static boolean failProvider,failWrite,failRead;static int writes;
 AlphaCredentialStore(Context c){}JSONObject providerAdmissionSnapshot(){if(failProvider)throw new SecurityException("provider");return new JSONObject().put("provider","fixture");}
 String readCredentialSlot(String slot){if(failRead)throw new SecurityException("previous");return saved;}void writeCredentialSlot(String slot,String value){if(failWrite)throw new SecurityException("write");saved=value;writes++;}
}
class AlphaLocalAgentPlugin {
 static final Object lifecycleLock=new Object();static String notificationAgent;static boolean changed,failFinal;static int checkCalls;
 static void checkNotificationSession(JSONObject expected){if(changed||failFinal&&++checkCalls==2)throw new SecurityException("session");}
 ${source.slice(start,end)}
}
public class PersistTest {
 interface Attempt{void run()throws Exception;}
 static void refuses(String expected,String stage,Attempt work)throws Exception{int count=AlphaCredentialStore.writes;try{work.run();throw new AssertionError("Accepted "+expected);}catch(SecurityException actual){if(!expected.equals(actual.getMessage()))throw actual;if(!android.util.Log.values.get(android.util.Log.values.size()-1).equals("persist="+stage+" family=security"))throw new AssertionError("Wrong finite stage");}if(AlphaCredentialStore.writes!=count)throw new AssertionError("Write after refusal");}
 public static void main(String[]args)throws Exception{
  Path root=Files.createTempDirectory("native-persist-fixture").toRealPath(),files=Files.createDirectory(root.resolve("files")),state=Files.createDirectory(files.resolve(".eliza"));
  Files.writeString(state.resolve("runtime-installation-id"),"30000000-0000-4000-8000-000000000003\\n");Context context=new Context(files.toFile());
  JSONObject session=new JSONObject().put("ownerId","owner"),identity=new JSONObject().put("subjectUserId","owner").put("agentId","agent");
  AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity);if(AlphaCredentialStore.writes!=1)throw new AssertionError("Valid owner not persisted");
  AlphaLocalAgentPlugin.changed=true;refuses("session","SESSION",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));AlphaLocalAgentPlugin.changed=false;
  AlphaLocalAgentPlugin.notificationAgent="foreign";refuses("Notification agent changed after validation","AGENT",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));AlphaLocalAgentPlugin.notificationAgent=null;
  identity.put("subjectUserId","foreign");refuses("Notification owner mismatch","RECORD",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));identity.put("subjectUserId","owner");
  AlphaCredentialStore.failProvider=true;refuses("provider","PROVIDER",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));AlphaCredentialStore.failProvider=false;
  AlphaCredentialStore.failRead=true;refuses("previous","PREVIOUS",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));AlphaCredentialStore.failRead=false;
  AlphaCredentialStore.failWrite=true;refuses("write","STORE",()->AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity));AlphaCredentialStore.failWrite=false;
  Path foreign=Files.createDirectory(root.resolve("foreign"));Files.createSymbolicLink(foreign.resolve(".eliza"),state);refuses("Notification installation unavailable","INSTALLATION",()->AlphaLocalAgentPlugin.rememberNotificationOwner(new Context(foreign.toFile()),session,identity));
  int beforeFinal=AlphaCredentialStore.writes;AlphaLocalAgentPlugin.failFinal=true;AlphaLocalAgentPlugin.checkCalls=0;
  try{AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity);throw new AssertionError("Final check accepted");}catch(SecurityException expected){if(!android.util.Log.values.get(android.util.Log.values.size()-1).equals("persist=FINAL family=security"))throw new AssertionError("Final stage missing");}
  if(AlphaCredentialStore.writes!=beforeFinal+1)throw new AssertionError("Final verification changed write ordering");AlphaLocalAgentPlugin.failFinal=false;
  for(String row:android.util.Log.values)if(!row.matches("persist=(SESSION|AGENT|INSTALLATION|PROVIDER|RECORD|PREVIOUS|STORE|FINAL) family=(security|json|io|other)"))throw new AssertionError("Unbounded diagnostic");
  System.out.println("PASS actual persistence valid path and eight distinct fail-closed branches with finite diagnostics");
 }
}`);
 assert.match(runJvm(files,'ai.elizaresearch.alphaphone.PersistTest',{json:true}),/^PASS actual persistence/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
