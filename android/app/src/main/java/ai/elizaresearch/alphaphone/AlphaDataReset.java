package ai.elizaresearch.alphaphone;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;

/** Android owns the package-scoped deletion, process stop, jobs, alarms and Keystore cleanup.
 * A persisted request retries before app initialization if interrupted before system dispatch.
 * This marker does not make Android's multi-step storage deletion filesystem-atomic.
 *
 * Fail closed: Alpha's data is never cleared before an installed image listener durably
 * acknowledges consent revocation, and the old runtime never resumes while the marker exists.
 * When the reset cannot finish, the main process still stops, but a start the user is looking at
 * first opens {@link ResetRecoveryActivity} in its own provider-free process. Where Alpha is HOME, that
 * visible surface replaces a silent stop that Android would immediately relaunch. Automatic
 * attempts are bounded; the recovery surface's Try again is always a fresh attempt. */
final class AlphaDataReset {
 /** Automatic (unprompted) attempts allowed within {@link #AUTOMATIC_WINDOW_MS}; then only the recovery surface. */
 static final int AUTOMATIC_ATTEMPTS=3;
 static final long AUTOMATIC_WINDOW_MS=60_000;
 enum Outcome{DISPATCHED,LISTENER_UNACKNOWLEDGED,ANDROID_REFUSED,DEFERRED}
 private static final java.util.concurrent.locks.ReentrantLock ATTEMPT_LOCK=new java.util.concurrent.locks.ReentrantLock();
 private interface Locked<T>{T run()throws Exception;}
 /** Main and recovery run in separate processes. Both must reserve the same durable budget. */
 private static <T>T locked(Context context,Locked<T> operation)throws Exception{
  if(!ATTEMPT_LOCK.tryLock())throw new java.io.IOException("Reset attempt already active");
  try(RandomAccessFile file=new RandomAccessFile(new File(directory(context),"reset-alpha.lock"),"rw")){
   FileLock lease=file.getChannel().tryLock();
   if(lease==null)throw new java.io.IOException("Reset attempt already active");
   try(FileLock ignored=lease){return operation.run();}
  }finally{ATTEMPT_LOCK.unlock();}
 }
 private static File directory(Context context){return context.createDeviceProtectedStorageContext().getNoBackupFilesDir();}
 private static AtomicFile marker(Context context){return new AtomicFile(new File(directory(context),"reset-alpha.pending"));}
 private static AtomicFile failures(Context context){return new AtomicFile(new File(directory(context),"reset-alpha.failures"));}
 private static boolean exists(AtomicFile file){return file.getBaseFile().exists()||new File(file.getBaseFile().getPath()+".bak").exists();}
 static boolean pending(Context context){return exists(marker(context));}
 /** The budget is durable before the marker can authorize an automatic attempt. */
 static void record(Context context)throws Exception{
  locked(context,()->{
   if(pending(context))return null;
   write(failures(context),"0:0".getBytes(StandardCharsets.US_ASCII));
   write(marker(context),new byte[]{1});
   return null;
  });
 }
 private static void write(AtomicFile file,byte[] value)throws Exception{
  FileOutputStream out=null;
  try{out=file.startWrite();out.write(value);out.getFD().sync();file.finishWrite(out);out=null;
   java.io.FileDescriptor directory=android.system.Os.open(file.getBaseFile().getParent(),android.system.OsConstants.O_RDONLY,0);
   try{android.system.Os.fsync(directory);}finally{android.system.Os.close(directory);}
   if(!java.util.Arrays.equals(file.readFully(),value))throw new java.io.IOException("Reset write was not committed");
  }finally{if(out!=null)file.failWrite(out);}
 }
 /** {reserved attempt count, window start}; missing legacy or unreadable budgets block
  * automatic work until an explicit recovery attempt durably repairs the budget. */
 static long[] failureState(Context context){
  AtomicFile file=failures(context);if(!exists(file))return pending(context)?new long[]{AUTOMATIC_ATTEMPTS,-1}:new long[]{0,0};
  try{String[] parts=new String(file.readFully(),StandardCharsets.US_ASCII).trim().split(":",-1);
   long count=Long.parseLong(parts[0]),first=Long.parseLong(parts[1]);
   // A negative or overflowing count would otherwise grant unbounded automatic attempts.
   if(parts.length==2&&count>=0&&count<=Integer.MAX_VALUE&&first>=0)return new long[]{count,first};
  }catch(Exception unreadable){/* Treated as exhausted below. */}
  return new long[]{AUTOMATIC_ATTEMPTS,-1};
 }
 static boolean automaticAttemptAllowed(long[] state,long now){
  if(state[0]<AUTOMATIC_ATTEMPTS)return true;
  if(state[1]<0)return false;
  // A wall-clock step backwards also starts a new window rather than deferring forever.
  return now<state[1]||now-state[1]>=AUTOMATIC_WINDOW_MS;
 }
 /** Explicit recovery retry may repair an unreadable legacy budget or exceed automatic limits. */
 static Outcome retry(Context context,long now){return admittedAttempt(context,now,true);}
 /** Retained for package-local callers that explicitly request a recovery attempt. */
 static Outcome attempt(Context context,long now){return retry(context,now);}
 static Outcome automaticAttempt(Context context,long now){return admittedAttempt(context,now,false);}
 private static Outcome admittedAttempt(Context context,long now,boolean explicit){
  if(now<0||!pending(context))return Outcome.DEFERRED;
  try{return locked(context,()->{
   // A queued caller cannot authorize another clear after Android removed the request.
   if(!pending(context))return Outcome.DEFERRED;
   long[] state=failureState(context);
   if(!explicit&&!automaticAttemptAllowed(state,now))return Outcome.DEFERRED;
   boolean newWindow=state[1]<0||state[0]==0||now<state[1]||now-state[1]>=AUTOMATIC_WINDOW_MS;
   long count=newWindow?1:Math.min(state[0]+1,Integer.MAX_VALUE);
   long first=newWindow?now:state[1];
   // A crash or failed write cannot give the next process this reservation again.
   write(failures(context),(count+":"+first).getBytes(StandardCharsets.US_ASCII));
   if(!pending(context))return Outcome.DEFERRED;
   try{
    if(!AlphaListenerPlugin.resetForData(context))return Outcome.LISTENER_UNACKNOWLEDGED;
    if(!pending(context))return Outcome.DEFERRED;
    ActivityManager manager=context.getSystemService(ActivityManager.class);
    return manager!=null&&manager.clearApplicationUserData()?Outcome.DISPATCHED:Outcome.ANDROID_REFUSED;
   }catch(RuntimeException failure){return Outcome.ANDROID_REFUSED;}
  });}catch(Exception unavailable){return Outcome.DEFERRED;}
 }
 /** The user just confirmed the reset in Alpha, so an unfinished reset always opens recovery. */
 static void dispatchAndExit(Context context){dispatchAndExit(context,true);}
 /** Startup admission, before any provider or initializer. Android also starts Alpha's process
  * for jobs, alarms, broadcasts, pushes, providers and bound services (the notification listener,
  * autofill). Such a start is not a launch the user is looking at: opening recovery from it would
  * take the screen from the app in front, including Phone or Settings opened from recovery. The
  * process still stops; recovery opens on the next activity start. When Android cannot say why
  * this process started, recovery opens. */
 static void admitAndExit(Context context){
  boolean visible;
  try{visible=userVisibleStart(context);}catch(RuntimeException|LinkageError unknown){visible=true;}
  dispatchAndExit(context,visible);
 }
 private static boolean userVisibleStart(Context context){
  if(android.os.Build.VERSION.SDK_INT<35)return true;
  ActivityManager manager=context.getSystemService(ActivityManager.class);if(manager==null)return true;
  java.util.List<android.app.ApplicationStartInfo> starts=manager.getHistoricalProcessStartReasons(1);
  if(starts==null||starts.isEmpty()||starts.get(0).getPid()!=android.os.Process.myPid())return true;
  return !backgroundStart(starts.get(0).getReason());
 }
 static boolean backgroundStart(int reason){
  switch(reason){
   case android.app.ApplicationStartInfo.START_REASON_ALARM: case android.app.ApplicationStartInfo.START_REASON_BACKUP:
   case android.app.ApplicationStartInfo.START_REASON_BOOT_COMPLETE: case android.app.ApplicationStartInfo.START_REASON_BROADCAST:
   case android.app.ApplicationStartInfo.START_REASON_CONTENT_PROVIDER: case android.app.ApplicationStartInfo.START_REASON_JOB:
   case android.app.ApplicationStartInfo.START_REASON_PUSH: case android.app.ApplicationStartInfo.START_REASON_SERVICE:return true;
   default:return false;
  }
 }
 /** Never resumes the old runtime, including when Android refuses or the Binder call fails. */
 private static void dispatchAndExit(Context context,boolean showRecovery){
  try{
   long now=System.currentTimeMillis();
   Outcome outcome=automaticAttempt(context,now);
   if(outcome!=Outcome.DISPATCHED){android.util.Log.w("AlphaReset","Reset not finished ("+outcome+")"+(showRecovery?"; showing recovery":"; background start"));if(showRecovery)showRecovery(context);}
  }catch(RuntimeException failure){android.util.Log.w("AlphaReset","Reset admission failed");if(showRecovery)showRecovery(context);}
  finally{android.os.Process.killProcess(android.os.Process.myPid());System.exit(0);}
 }
 private static void showRecovery(Context context){
  try{context.startActivity(new Intent(context,ResetRecoveryActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));}
  catch(RuntimeException refused){/* Next HOME or launcher start shows it; data stays intact. */}
 }
 private AlphaDataReset(){}
}
