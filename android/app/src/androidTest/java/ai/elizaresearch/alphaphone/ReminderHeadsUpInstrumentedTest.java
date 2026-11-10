package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderLifecycleTestAccess;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.NotificationManager;
import android.app.UiAutomation;
import android.content.Context;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** A due reminder on the high-importance channel appears as a heads-up in System UI. Emulator evidence only. */
@RunWith(AndroidJUnit4.class)
public class ReminderHeadsUpInstrumentedTest {
 private static boolean visible(UiAutomation automation,String title){
  for(AccessibilityWindowInfo window:automation.getWindows()){
   AccessibilityNodeInfo root=window.getRoot();if(root==null||root.getPackageName()==null||!"com.android.systemui".contentEquals(root.getPackageName()))continue;
   if(!root.findAccessibilityNodeInfosByText(title).isEmpty())return true;
  }
  return false;
 }
 // On API 36 the pinned heads-up row is drawn in a System UI window that is not reported to
 // accessibility, so System UI's own HeadsUpManager entry map is the second evidence source:
 // it lists exactly the notifications currently pinned as heads-up.
 private static boolean pinnedHeadsUp(UiAutomation automation,String key)throws Exception{
  try(java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("dumpsys activity service com.android.systemui"));java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(in))){
   String line;boolean map=false;
   while((line=reader.readLine())!=null){
    if(line.contains("[HeadsUpManagerImpl.mHeadsUpEntryMap]")){map=true;continue;}
    if(map){if(line.trim().isEmpty()){map=false;continue;}if(line.trim().equals(key))return true;}
   }
  }
  return false;
 }
 @Test public void dueReminderIsShownHeadsUpWithoutOpeningTheShade()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  UiAutomation automation=InstrumentationRegistry.getInstrumentation().getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
  automation.grantRuntimePermission(c.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  ReminderTestAccess.channel(c);org.junit.Assume.assumeTrue("Notifications enabled",ReminderTestAccess.allowed(c));
  org.junit.Assume.assumeTrue("Heads-up requires no Do Not Disturb",c.getSystemService(NotificationManager.class).getCurrentInterruptionFilter()<=NotificationManager.INTERRUPTION_FILTER_ALL);
  AccessibilityServiceInfo info=automation.getServiceInfo();info.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;automation.setServiceInfo(info);
  String id="headsup_"+UUID.randomUUID(),title="Heads-up fixture "+id.substring(8,16);
  try{
   ReminderTestAccess.schedule(c,id,title,"Disposable heads-up fixture",System.currentTimeMillis()+1000);SystemClock.sleep(1500);
   ReminderTestAccess.deliver(c,id,ReminderTestAccess.read(c,id).getString("occurrenceId"));
   assertEquals("posted",ReminderTestAccess.read(c,id).getString("status"));
   String key="0|"+c.getPackageName()+"|0|"+AlphaReminders.CONFIGURATION.notificationTagPrefix+id+"|"+android.os.Process.myUid();
   boolean shown=false;for(int i=0;i<50&&!shown;i++){shown=visible(automation,title)||pinnedHeadsUp(automation,key);if(!shown)SystemClock.sleep(200);}
   assertTrue("Heads-up notification shown by System UI without opening the shade",shown);
   assertEquals(NotificationManager.IMPORTANCE_HIGH,c.getSystemService(NotificationManager.class).getNotificationChannel(ReminderLifecycleTestAccess.dueChannel()).getImportance());
  }finally{ReminderTestAccess.cancel(c,id);assertTrue(new ReminderTestAccess.Envelope(c).records().edit().remove(id).commit());}
 }
}
