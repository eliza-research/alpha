package ai.elizaresearch.alphaphone;

import android.app.AlarmManager;
import android.app.UiAutomation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import java.util.function.Predicate;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** OPT IN: creates one real alarm and waits for its real firing. No clock/time/settings changes.
 * Refuses existing enabled alarms or a list that cannot be exhaustively inspected on one screen.
 * Cleanup deletes only the exact UUID-labeled row; no provider access or global dismiss/clear. */
@RunWith(AndroidJUnit4.class)
public final class RealClockInstrumentedTest {
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private final UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
 private final String label="Alpha fixture "+UUID.randomUUID();
 private File output;
 private ClockHistoryFixture history;
 private boolean notificationShadeOpened;
 private String js(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void waitJs(String s)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Missing Alpha control: "+s);}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")";waitJs(q+"&&("+q+").getAttribute('aria-disabled')!=='true'");js("("+q+").click()");}
 private List<AccessibilityNodeInfo> nodes(AccessibilityNodeInfo root){List<AccessibilityNodeInfo> out=new ArrayList<>();if(root==null)return out;ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();q.add(root);while(!q.isEmpty()){assertTrue("Bounded native hierarchy",out.size()<1000);AccessibilityNodeInfo n=q.remove();out.add(n);for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null)q.add(child);}}return out;}
 private AccessibilityNodeInfo find(Predicate<AccessibilityNodeInfo> predicate){for(AccessibilityNodeInfo n:nodes(ui.getRootInActiveWindow()))if(n.isVisibleToUser()&&predicate.test(n))return n;return null;}
 private boolean id(AccessibilityNodeInfo n,String suffix){return ("com.android.deskclock:id/"+suffix).equals(n.getViewIdResourceName());}
 private AccessibilityNodeInfo waitNative(Predicate<AccessibilityNodeInfo> predicate,long timeout){long end=SystemClock.elapsedRealtime()+timeout;do{AccessibilityNodeInfo n=find(predicate);if(n!=null)return n;SystemClock.sleep(150);}while(SystemClock.elapsedRealtime()<end);throw new AssertionError("Native Clock condition timed out");}
 private void tap(AccessibilityNodeInfo n){for(int i=0;n!=null&&i<6;i++,n=n.getParent())if(n.isClickable()&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;fail("Native control not clickable");}
 private void closeNotificationShade(){
  if(!notificationShadeOpened)return;
  for(int attempt=0;attempt<3;attempt++){
   AccessibilityNodeInfo root=ui.getRootInActiveWindow();
   if(root!=null&&!"com.android.systemui".contentEquals(root.getPackageName()==null?"":root.getPackageName())){notificationShadeOpened=false;return;}
   assertTrue("Android accepted Back from the opened notification shade",ui.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK));SystemClock.sleep(200);
  }
  AccessibilityNodeInfo root=ui.getRootInActiveWindow();assertNotNull(root);assertFalse("Notification shade closed before returning to Alpha","com.android.systemui".contentEquals(root.getPackageName()==null?"":root.getPackageName()));notificationShadeOpened=false;
 }
 private void front()throws Exception{closeNotificationShade();BoundedActivityScenario.main(()->context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));waitJs("!document.hidden");}
 private void handoff(String action)throws Exception{front();click(action);click("Review Clock request");click("Confirm Clock request");history.completed(action.equals("Show alarms")?"show":action.equals("Snooze")?"snooze":"dismiss");}
 private void show()throws Exception{handoff("Show alarms");waitNative(n->"com.android.deskclock".contentEquals(n.getPackageName()==null?"":n.getPackageName())&&id(n,"fab"),15000);}
 private void showForCleanup()throws Exception{
  // Cleanup does not depend on the product flow that may have just failed.
  closeNotificationShade();
  BoundedActivityScenario.main(()->context.startActivity(new Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS).setPackage("com.android.deskclock").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
  waitNative(n->id(n,"fab"),15000);
 }
 private AccessibilityNodeInfo row(){AccessibilityNodeInfo n=find(x->"com.android.deskclock".contentEquals(x.getPackageName()==null?"":x.getPackageName())&&label.contentEquals(x.getText()==null?"":x.getText()));while(n!=null){if(nodes(n).stream().anyMatch(x->id(x,"onoff")))return n;n=n.getParent();}return null;}
 private List<String> baseline(){List<String> result=new ArrayList<>();for(AccessibilityNodeInfo n:nodes(ui.getRootInActiveWindow())){
  if(n.isScrollable())assertFalse("Clock list must be fully visible; refusing any scrollable existing list",n.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)||n.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD));
  if(id(n,"onoff")){
   assertFalse("Refusing existing enabled alarms",n.isChecked());
   // Record only this alarm row, not the changing current-time header.
   AccessibilityNodeInfo alarm=n.getParent();assertNotNull("Alarm row parent",alarm);
   for(AccessibilityNodeInfo value:nodes(alarm))if(id(value,"digital_clock")||id(value,"label")||id(value,"days_of_week"))result.add(value.getViewIdResourceName()+"="+value.getText()+"|"+value.getContentDescription());
  }
 }Collections.sort(result);return result;}
 private void record(String stage)throws Exception{JSONObject event=new JSONObject().put("stage",stage).put("label",label).put("at",new Date().toInstant().toString());try(FileWriter writer=new FileWriter(new File(output,"events.jsonl"),true)){writer.write(event.toString()+"\n");}Bitmap bitmap=ui.takeScreenshot();if(bitmap!=null)try(FileOutputStream file=new FileOutputStream(new File(output,stage+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,file);}android.util.Log.i("RealClockFixture",event.toString());}
 @Test public void realClockSetFireSnoozeDismissAndDelete()throws Exception{
  org.junit.Assume.assumeTrue("Explicit real alarm opt in", "1".equals(InstrumentationRegistry.getArguments().getString("realClock")));
  org.junit.Assume.assumeTrue("Operator confirms exclusive unlocked emulator and no other active timers", "1".equals(InstrumentationRegistry.getArguments().getString("clockExclusive")));
  assertEquals("Fixture qualified for API35",35,android.os.Build.VERSION.SDK_INT);
  assertEquals("Installed AOSP Clock required","com.android.deskclock",context.getPackageManager().resolveActivity(new Intent(android.provider.AlarmClock.ACTION_SET_ALARM),0).activityInfo.packageName);
  assertEquals("Clock notification permission required for real firing evidence",android.content.pm.PackageManager.PERMISSION_GRANTED,context.getPackageManager().checkPermission("android.permission.POST_NOTIFICATIONS","com.android.deskclock"));
  output=new File(context.getExternalFilesDir(null),"real-clock-"+label.substring(14));assertTrue(output.mkdirs());
  android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();int oldFlags=info.flags;info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;ui.setServiceInfo(info);
  boolean mayExist=false;List<String> before=null;Throwable failed=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class);ClockHistoryFixture clockHistory=new ClockHistoryFixture()){
   history=clockHistory;
   try{
    AppNavigation.liveMode();js(AppNavigation.request("Calendar"));waitJs(AppNavigation.selected("Calendar"));click("Clock alarms");show();
    assertNull("No existing scheduled alarm accepted",context.getSystemService(AlarmManager.class).getNextAlarmClock());before=baseline();assertNull("Enable Clock notifications through its normal UI before real alarm acceptance",find(n->String.valueOf(n.getText()).contains("Clock notifications are blocked")));record("01-before");
    Calendar at=Calendar.getInstance();at.add(Calendar.MINUTE,2);at.set(Calendar.SECOND,0);at.set(Calendar.MILLISECOND,0);String time=String.format(Locale.ROOT,"%02d:%02d",at.get(Calendar.HOUR_OF_DAY),at.get(Calendar.MINUTE));
    front();click("Set alarm");for(String[] input:new String[][]{{"Alarm time",time},{"Alarm label",label}})js("(()=>{const e=document.querySelector('input[aria-label=\""+input[0]+"\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(input[1])+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    click("Review Clock request");record("02-reviewed");mayExist=true;click("Confirm Clock request");history.completed("set");waitNative(n->id(n,"onoff")&&row()!=null,15000);assertNotNull("Exact labeled native alarm row",row());record("03-created");
    long firingDeadline=at.getTimeInMillis()+15000;while(System.currentTimeMillis()<firingDeadline&&find(n->id(n,"title")&&label.contentEquals(n.getText()==null?"":n.getText()))==null)SystemClock.sleep(200);
    if(find(n->id(n,"title")&&label.contentEquals(n.getText()==null?"":n.getText()))==null){
     assertTrue("Android opened the actual notification shade",ui.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS));
     notificationShadeOpened=true;
     // Opening the shade is asynchronous; the underlying Clock row has the same label.
     AccessibilityNodeInfo notification=waitNative(n->"com.android.systemui".contentEquals(n.getPackageName()==null?"":n.getPackageName())&&label.contentEquals(n.getText()==null?"":n.getText()),10000);
     JSONArray ancestry=new JSONArray();
     for(AccessibilityNodeInfo parent=notification;parent!=null;parent=parent.getParent())ancestry.put(new JSONObject().put("class",String.valueOf(parent.getClassName())).put("id",String.valueOf(parent.getViewIdResourceName())));
     try(FileWriter writer=new FileWriter(new File(output,"notification-ancestry.json"))){writer.write(ancestry.toString(2));}
     while(notification!=null&&!"com.android.systemui:id/expandableNotificationRow".equals(notification.getViewIdResourceName()))notification=notification.getParent();
     assertNotNull("Exact labelled alarm notification row",notification);
     List<AccessibilityNodeInfo> controls=nodes(notification);
     assertTrue("Firing notification exposes Snooze",controls.stream().anyMatch(n->"SNOOZE".equalsIgnoreCase(String.valueOf(n.getText()))));
     assertTrue("Firing notification exposes Dismiss",controls.stream().anyMatch(n->"DISMISS".equalsIgnoreCase(String.valueOf(n.getText()))));
    }else{assertNotNull(find(n->id(n,"snooze")));assertNotNull(find(n->id(n,"dismiss")));}
    record("04-fired");
    handoff("Snooze");show();waitNative(n->row()!=null&&nodes(row()).stream().anyMatch(x->id(x,"preemptive_dismiss_button")&&String.valueOf(x.getText()).startsWith("Snoozing until")),15000);assertNotNull(row());record("05-snoozed");
    handoff("Dismiss");show();waitNative(n->row()!=null&&nodes(row()).stream().anyMatch(x->id(x,"onoff")&&!x.isChecked()),15000);assertTrue("Exact fixture is disabled",nodes(row()).stream().anyMatch(n->id(n,"onoff")&&!n.isChecked()));assertNull(context.getSystemService(AlarmManager.class).getNextAlarmClock());record("06-dismissed");
   }catch(Throwable t){failed=t;throw t;}finally{
    try{if(mayExist){showForCleanup();AccessibilityNodeInfo exact=row();assertNotNull("Fixture cleanup needs exact label",exact);AccessibilityNodeInfo delete=nodes(exact).stream().filter(n->id(n,"delete")&&n.isVisibleToUser()).findFirst().orElse(null);if(delete==null){AccessibilityNodeInfo arrow=nodes(exact).stream().filter(n->id(n,"arrow")).findFirst().orElseThrow(()->new AssertionError("Exact row expansion missing"));tap(arrow);waitNative(n->id(n,"delete"),5000);exact=row();delete=nodes(exact).stream().filter(n->id(n,"delete")&&n.isVisibleToUser()).findFirst().orElseThrow(()->new AssertionError("Exact row delete missing"));}tap(delete);long end=SystemClock.elapsedRealtime()+5000;while(row()!=null&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(100);assertNull("Only synthetic row deleted",row());assertEquals("Existing disabled alarm rows preserved",before,baseline());record("07-cleaned");}
     front();
    }catch(Throwable cleanup){if(failed!=null)failed.addSuppressed(cleanup);else throw cleanup;}
   }
  }finally{info.flags=oldFlags;ui.setServiceInfo(info);}
 }
}
