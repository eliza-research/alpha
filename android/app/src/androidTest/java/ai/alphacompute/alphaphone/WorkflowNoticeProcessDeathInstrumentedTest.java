package ai.alphacompute.alphaphone;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import static org.junit.Assert.*;

/** The process-death boundary shared by WorkflowApprovalNoticeProcessDeathInstrumentedTest and
 * ReminderTapProcessDeathInstrumentedTest: main dies while the separate instrumentation host stays alive. */
public final class WorkflowNoticeProcessDeathInstrumentedTest {
 private static final String APP="ai.alphacompute.alphaphone";
 /** Package-visible: WorkflowApprovalNoticeProcessDeathInstrumentedTest and ReminderTapProcessDeathInstrumentedTest prove the same death boundary. */
 static final class Identity {
  final int pid,uid;final String start,argvState;final boolean argvReady;
  Identity(int pid)throws Exception {
   this.pid=pid;
   String status=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/status")), java.nio.charset.StandardCharsets.UTF_8);
   java.util.regex.Matcher match=java.util.regex.Pattern.compile("(?m)^Uid:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$").matcher(status);
   assertTrue("Process UID unavailable",match.find());uid=Integer.parseInt(match.group(1));
   for(int i=2;i<=4;i++)assertEquals(uid,Integer.parseInt(match.group(i)));
   assertFalse("Ambiguous UID",match.find());
   String cmdline=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/cmdline")), java.nio.charset.StandardCharsets.UTF_8);
   argvReady=cmdline.startsWith(APP+"\0")&&cmdline.substring(APP.length()).chars().allMatch(ch->ch==0);
   argvState=argvReady?"expected":cmdline.isEmpty()?"empty":cmdline.startsWith(APP+"\0")?"expected-prefix-with-extra-bytes":"other";
   String stat=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/stat")), java.nio.charset.StandardCharsets.UTF_8);int close=stat.lastIndexOf(')');assertTrue(close>0);
   String[] fields=stat.substring(close+2).trim().split("\\s+");assertTrue(fields.length>19);start=fields[19];assertTrue(start.matches("[0-9]+"));
   assertEquals(android.os.Process.myUid(),uid);assertNotEquals(android.os.Process.myPid(),pid);
  }
  void exact()throws Exception {Identity now=new Identity(pid);assertEquals(uid,now.uid);assertEquals(start,now.start);assertTrue("Unexpected process argv at kill boundary: "+now.argvState,now.argvReady);}
 }
 static List<Integer> mainPids(Context context){
  List<Integer> found=new ArrayList<>();List<ActivityManager.RunningAppProcessInfo> rows=context.getSystemService(ActivityManager.class).getRunningAppProcesses();
  assertNotNull("Process inventory unavailable",rows);
  for(ActivityManager.RunningAppProcessInfo row:rows)if(APP.equals(row.processName)){assertEquals(android.os.Process.myUid(),row.uid);found.add(row.pid);}
  assertTrue("Multiple main processes",found.size()<=1);return found;
 }
 static Identity awaitMain(Context context)throws Exception {
  long end=SystemClock.elapsedRealtime()+15000;Identity candidate=null;String argvState="not-observed";
  do{
   List<Integer> rows=mainPids(context);
   if(rows.size()==1){
    Identity current=new Identity(rows.get(0));
    if(candidate==null)candidate=current;
    else {assertEquals("Main PID changed during readiness",candidate.pid,current.pid);assertEquals(candidate.uid,current.uid);assertEquals("Main start changed during readiness",candidate.start,current.start);}
    argvState=current.argvState;if(current.argvReady)return current;
   }else if(candidate!=null)throw new AssertionError("Main disappeared during readiness");
   SystemClock.sleep(50);
  }while(SystemClock.elapsedRealtime()<end);
  throw new AssertionError("Main process readiness deadline; argv="+argvState);
 }
 /** Removes only this package's tasks (no foreground task recovery), SIGKILLs exactly the observed main and proves it absent. */
 static void killMainWithoutTasks(Context context,Identity before)throws Exception {
  ActivityManager activities=context.getSystemService(ActivityManager.class);
  for(ActivityManager.AppTask task:activities.getAppTasks()){
   ActivityManager.RecentTaskInfo info=task.getTaskInfo();assertNotNull(info.baseIntent.getComponent());assertEquals(APP,info.baseIntent.getComponent().getPackageName());task.finishAndRemoveTask();
  }
  long taskEnd=SystemClock.elapsedRealtime()+10000;
  while(!activities.getAppTasks().isEmpty()&&SystemClock.elapsedRealtime()<taskEnd)SystemClock.sleep(50);
  assertTrue("Main tasks still active",activities.getAppTasks().isEmpty());
  before.exact();Os.kill(before.pid,OsConstants.SIGKILL);
  long deathEnd=SystemClock.elapsedRealtime()+10000;
  while((Files.exists(Path.of("/proc/"+before.pid))||!mainPids(context).isEmpty())&&SystemClock.elapsedRealtime()<deathEnd)SystemClock.sleep(50);
  assertFalse("Original process did not die",Files.exists(Path.of("/proc/"+before.pid)));
  assertTrue("Main restarted before notification tap",mainPids(context).isEmpty());
 }
 /** Sends the original OS-owned PendingIntent once, as the shade sends a tapped notice: with the
  * sender's activity-start allowance on API 34+, where no app task is left to start from. */
 static void sendOriginalTap(Context context,PendingIntent pending)throws PendingIntent.CanceledException {
  if(Build.VERSION.SDK_INT<34){pending.send();return;}
  ActivityOptions options=ActivityOptions.makeBasic();options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
  pending.send(context,0,null,null,null,null,options.toBundle());
 }
}
