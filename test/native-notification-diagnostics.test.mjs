import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
test('native diagnostics use only finite labels and preserve terminal authority failure',{skip:jsonJarSkip},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-notification-diagnostics-'));const files=[];
 const put=(name,text)=>{const path=join(dir,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);files.push(path);};
 const source=readFileSync(nativeSource('AlphaCanonicalNotifications.java'),'utf8');
 const start=source.indexOf(' private void fail('),end=source.indexOf(' /** Capture only',start);assert(start>=0&&end>start);
 try{
  put('android/util/Log.java',`package android.util;public class Log {public static final java.util.List<String> values=new java.util.ArrayList<>();public static int w(String tag,String value){values.add(tag+":"+value);return 0;}}`);
  put('NativeNotificationDiagnostics.java',readFileSync(nativeSource('NativeNotificationDiagnostics.java'),'utf8'));
  put('DiagnosticTest.java',`package ai.elizaresearch.alphaphone;import java.util.concurrent.TimeUnit;import org.json.*;
class ElizaAgentService {static class LocalStreamHandle{void cancel(){}}}
public class DiagnosticTest {
 static class Actor {
  static Actor active;boolean stopped;long attempt=1;int failures;ElizaAgentService.LocalStreamHandle stream;
  NativeNotificationDiagnostics.Stage connectStage=NativeNotificationDiagnostics.Stage.READ_OWNER;
  static class Queue{int scheduled;void schedule(Runnable r,long d,TimeUnit u){scheduled++;}}
  static Queue SERIAL=new Queue();void connect(){}static void stop(){if(active!=null)active.stopped=true;active=null;}
  ${source.slice(start,end)}
 }
 public static void main(String[]args)throws Exception{
  String secret="credential-secret owner-id https://secret.invalid body-text";
  for(NativeNotificationDiagnostics.Stage stage:NativeNotificationDiagnostics.Stage.values())NativeNotificationDiagnostics.failure(stage,new SecurityException(secret));
  NativeNotificationDiagnostics.failure(NativeNotificationDiagnostics.Stage.READ_OWNER,new java.io.IOException(secret));
  NativeNotificationDiagnostics.failure(NativeNotificationDiagnostics.Stage.READ_OWNER,new JSONException(secret));
  NativeNotificationDiagnostics.failure(NativeNotificationDiagnostics.Stage.READ_OWNER,new IllegalStateException(secret));
  for(String path:new String[]{"/api/auth/me","/api/agents","/api/client-devices/context"})NativeNotificationDiagnostics.ownerRead(path,503);
  NativeNotificationDiagnostics.ownerRead("/api/auth/me",900);int count=android.util.Log.values.size();NativeNotificationDiagnostics.ownerRead(secret,401);if(android.util.Log.values.size()!=count)throw new AssertionError("Unknown route logged");
  for(String row:android.util.Log.values){if(!row.matches("AlphaNotification:(stage=(CAPTURE_OWNER|READ_OWNER|FENCE|PERSIST_OWNER|INBOX|SUBSCRIBE) family=(security|json|io|other)|ownerRead=(auth-me|agents|device-context) status=(0|503))"))throw new AssertionError("Unbounded diagnostic");}
  Actor a=new Actor();Actor.active=a;a.fail(1,new SecurityException(secret));if(!a.stopped||Actor.SERIAL.scheduled!=0)throw new AssertionError("Authority retry changed");
  Actor b=new Actor();Actor.active=b;b.fail(1,new java.io.IOException(secret));if(b.stopped||Actor.SERIAL.scheduled!=1)throw new AssertionError("Transient retry changed");
  int total=android.util.Log.values.size();b.fail(1,new SecurityException(secret));if(android.util.Log.values.size()!=total)throw new AssertionError("Stale failure logged");
  System.out.println("PASS bounded diagnostics and original authority/transient/stale failure semantics");
 }
}`);
  assert.match(runJvm(files,'ai.elizaresearch.alphaphone.DiagnosticTest',{json:true}),/^PASS bounded diagnostics/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
