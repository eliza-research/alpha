import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {app, root} from './java.mjs';

export const crashDeviceSource=app+'AlphaDevicePlugin.java';
export const crashCallSource='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java';
export const crashLogPath='plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/crash/CrashLog.java';

function exact(text, first, last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`crash journal anchors ${first}, ${last}`);
  return text.slice(start,end);
}

export function crashJournalPlatform(temporary) {
  const device=readFileSync(join(root,crashDeviceSource),'utf8');
  const destroy=device.match(/^ @Override protected void handleOnDestroy\(\)\{[^\n]+/m)?.[0];
  assert.ok(destroy);
  const calls=readFileSync(join(root,crashCallSource),'utf8');
  const files={
    'ai/elizaresearch/alphaphone/AlphaDevicePlugin.java': `package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import android.os.Build;
public final class AlphaDevicePlugin extends Plugin {
${exact(device,' private final java.util.concurrent.ExecutorService diagnosticsWorker=', ' /** Non-secret build identity')}
${destroy}
 // Unused update coordinator ports for the exact destruction member.
 private static UpdateActivation activation;
 private static AlphaDevicePlugin updateOwner;
 private static boolean updateDue,updateOpen;
 private static final class UpdateActivation {
  AlphaDevicePlugin owner;java.util.concurrent.CompletableFuture<Boolean> ready;
 }
 private void retireUpdateBridge(){}
 private final java.util.concurrent.ExecutorService updateWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private javax.net.ssl.HttpsURLConnection updateActive;
 private final Object updateStatus=new Object();
}`,
    'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {
 private android.content.Context context;
 public void attach(android.content.Context value){context=value;}
 public android.content.Context getContext(){return context;}
 protected void handleOnDestroy(){}
}`,
    'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
    'com/getcapacitor/JSObject.java':'package com.getcapacitor;public final class JSObject extends org.json.JSONObject {}',
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;
 public volatile boolean answered;
 public final java.util.concurrent.CountDownLatch answerReady=new java.util.concurrent.CountDownLatch(1);
 public String error;
 public JSObject result;
 public PluginCall(JSObject data){this.data=data;}
${exact(calls,'    public String getString(String name)', '    @Nullable\n    public Integer getInt')
  .replaceAll('    @Nullable\n','').replace('@Nullable String defaultValue','String defaultValue')}
 public void resolve(){resolve(new JSObject());}
 public void resolve(JSObject value){result=value;answer();}
 public void reject(String reason){error=reason;answer();}
 private void answer(){if(answered)throw new AssertionError("Duplicate plugin answer");answered=true;answerReady.countDown();}
}`,
    'android/content/Context.java': `package android.content;
public final class Context {
 public static final String ACTIVITY_SERVICE="activity";
 private final java.io.File directory;
 public android.app.ActivityManager manager;
 public Context(java.io.File directory){this.directory=directory;}
 public Context getApplicationContext(){return this;}
 public java.io.File getNoBackupFilesDir(){return directory;}
 public String getPackageName(){return "fixture.example";}
 public Object getSystemService(String key){if(!ACTIVITY_SERVICE.equals(key))throw new AssertionError(key);return manager;}
 public void unregisterReceiver(Object receiver){}
}`,
    'android/os/Build.java': `package android.os;
public final class Build {
 public static final class VERSION {public static int SDK_INT=36;}
 public static final class VERSION_CODES {public static final int R=30;}
}`,
    'android/os/Looper.java': `package android.os;
public final class Looper {
 private static final Looper main=new Looper();
 private final Thread thread=Thread.currentThread();
 public static Looper getMainLooper(){return main;}
 public Thread getThread(){return thread;}
}`,
    'android/app/ActivityManager.java': `package android.app;
public final class ActivityManager {
 public volatile java.util.List<ApplicationExitInfo> exits=java.util.List.of(),captured=java.util.List.of();
 public volatile boolean fail;
 public Runnable onSnapshot=()->{};
 public int reads;
 public java.util.List<ApplicationExitInfo> getHistoricalProcessExitReasons(String pkg,int pid,int max){
  if(pkg!=null||pid!=0||max!=16)throw new AssertionError("Package-scoped bounded exit history");
  reads++;
  if(fail)throw new IllegalStateException("Synthetic history refusal");
  var snapshot=java.util.List.copyOf(exits.subList(0,Math.min(exits.size(),max)));
  captured=snapshot;onSnapshot.run();
  return snapshot;
 }
}`,
    'android/app/ApplicationExitInfo.java': `package android.app;
public record ApplicationExitInfo(long timestamp,int reason,int status,String processName) {
 public static final int REASON_UNKNOWN=0,REASON_EXIT_SELF=1,REASON_SIGNALED=2,REASON_LOW_MEMORY=3,REASON_CRASH=4,REASON_CRASH_NATIVE=5,
  REASON_ANR=6,REASON_INITIALIZATION_FAILURE=7,REASON_PERMISSION_CHANGE=8,REASON_EXCESSIVE_RESOURCE_USAGE=9,
  REASON_USER_REQUESTED=10,REASON_USER_STOPPED=11,REASON_DEPENDENCY_DIED=12,REASON_OTHER=13,REASON_FREEZER=14;
 public long getTimestamp(){return timestamp;}
 public int getReason(){return reason;}
 public int getStatus(){return status;}
 public String getProcessName(){return processName;}
}`,
    'ai/eliza/plugins/system/crash/System.java': `package ai.eliza.plugins.system.crash;
final class System {static long currentTimeMillis(){return ai.elizaresearch.alphaphone.CrashJournalTraces.clock;}}`,
    'android/util/AtomicFile.java': `package android.util;
import java.io.*;
import java.nio.file.*;
public final class AtomicFile {
 public static volatile String fault="none";
 private final File target,temporary;
 public AtomicFile(File file){target=file;temporary=new File(file.getPath()+".new");}
 public FileInputStream openRead()throws FileNotFoundException{return new FileInputStream(target);}
 public FileOutputStream startWrite()throws IOException{
  if(fault.equals("before"))throw new IOException("Synthetic write refusal before open");
  return new FileOutputStream(temporary);
 }
 public void finishWrite(FileOutputStream output){
  try{
   output.getFD().sync();output.close();
   if(fault.equals("staged"))throw new IOException("Synthetic refusal before replace");
   Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
   if(fault.equals("after"))throw new IOException("Synthetic refusal after replace");
  }catch(IOException refused){throw new java.io.UncheckedIOException(refused);}
 }
 public void failWrite(FileOutputStream output){
  try{output.close();Files.deleteIfExists(temporary.toPath());}catch(IOException refused){throw new java.io.UncheckedIOException(refused);}
 }
}`,
  };
  return Object.entries(files).map(([name,body])=>{
    const file=join(temporary,'driver',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);return file;
  });
}
