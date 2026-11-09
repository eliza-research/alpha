package ai.alphacompute.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.provider.AlarmClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Disposable secondary user only. All outgoing Clock intents are intercepted, never delivered.
 * This proves owner review/selection handoff, show without a second review, replay refusal and
 * re-review after recreation, not real alarm completion. */
@RunWith(AndroidJUnit4.class)
public final class ClockAgentReviewInstrumentedTest {
 private final String scope=ReminderTestAccess.digest("clock-review-fixture-"+UUID.randomUUID());
 private final List<String> proposals=new ArrayList<>();
 private String js(String expression)throws Exception{return WebViewTestDriver.evaluate(expression);}
 private void waitFor(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Owned Clock bridge did not settle");}
 private void begin(String method,JSONObject input)throws Exception{js("window.__clockAgentResult=null;Capacitor.nativePromise('AlphaActionJournal',"+JSONObject.quote(method)+","+input+").then(value=>window.__clockAgentResult=value,()=>window.__clockAgentResult={rejected:true})");}
 private JSONObject result()throws Exception{waitFor("window.__clockAgentResult!==null");return new JSONObject(js("window.__clockAgentResult"));}
 private JSONObject bridge(String method,JSONObject input)throws Exception{begin(method,input);return result();}
 private JSONObject operation(String action)throws Exception{JSONObject op=new JSONObject().put("type","clock_handoff").put("action",action);if("set".equals(action))op.put("hour",7).put("minute",0).put("label","Synthetic intercepted alarm").put("timeZone",java.util.TimeZone.getDefault().getID());if("snooze".equals(action))op.put("snoozeMinutes",10);return op;}
 private JSONObject reserve(JSONObject op)throws Exception{
  String id=UUID.randomUUID().toString();proposals.add(id);JSONObject identity=new JSONObject().put("scope",scope).put("proposalId",id).put("operationId",UUID.randomUUID().toString());
  JSONObject record=new JSONObject().put("operation",op).put("context",new JSONObject().put("view","home").put("sensitive",false)).put("expiresAt",System.currentTimeMillis()+120000).put("ownerId","fixture-owner").put("sessionId","fixture-session").put("agentId","fixture-agent").put("origin","https://fixture.invalid").put("installationId","fixture-installation").put("enrollmentId","fixture-enrollment");
  assertTrue(bridge("reserve",new JSONObject(identity.toString()).put("operationHash",ReminderTestAccess.digest(op.toString())).put("record",record)).getBoolean("created"));
  bridge("markApplying",new JSONObject(identity.toString()).put("attemptId",UUID.randomUUID().toString()));return identity;
 }
 private AccessibilityNodeInfo find(AccessibilityNodeInfo node,String label){if(node==null)return null;if(node.isVisibleToUser()&&label.equalsIgnoreCase(node.getText()==null?"":node.getText().toString()))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=find(node.getChild(i),label);if(found!=null)return found;}return null;}
 private void button(String label)throws Exception{long end=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<end){AccessibilityNodeInfo node=find(InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow(),label);if(node!=null&&node.isEnabled()&&node.isClickable()){assertTrue(node.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}SystemClock.sleep(100);}fail("Missing native owner review control");}
 private void visible()throws Exception{long end=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<end){if(find(InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow(),"Open Clock?")!=null)return;SystemClock.sleep(100);}fail("Native owner review not visible");}
 @Test public void journalBoundOwnerReviewManualSelectionCancellationAndRecreation()throws Exception{
  org.junit.Assume.assumeTrue("Owned intercepted Clock review opt in","1".equals(InstrumentationRegistry.getArguments().getString("clockAgentReview")));
  assertTrue("Fresh secondary user required",android.os.Process.myUid()/100000>0);
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();List<Intent> sent=new java.util.concurrent.CopyOnWriteArrayList<>();java.util.concurrent.atomic.AtomicReference<String> deliveryFailure=new java.util.concurrent.atomic.AtomicReference<>("");
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){String action=intent.getAction();if(action!=null&&SetActions(action)){if("denied".equals(deliveryFailure.get()))throw new SecurityException("Synthetic intercepted denial");if("unavailable".equals(deliveryFailure.get()))throw new android.content.ActivityNotFoundException("Synthetic intercepted removal");sent.add(new Intent(intent));return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}return null;}};
  instrumentation.addMonitor(monitor);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   assertNotNull("Installed external Clock required",context.getPackageManager().resolveActivity(new Intent(AlarmClock.ACTION_SHOW_ALARMS),0));
   for(String action:new String[]{"set","show","snooze","dismiss"}){
    JSONObject op=operation(action),key=reserve(op);int before=sent.size();
    // A caller cannot bypass the native gesture with an invented nonce.
    assertTrue(bridge("confirmClock",new JSONObject(key.toString()).put("reviewToken","invented")).getBoolean("rejected"));assertEquals(before,sent.size());
    // Show changes no alarm: the approved card is its review, so no native dialog opens.
    JSONObject approved;if("show".equals(action)){approved=bridge("reviewClock",new JSONObject(key.toString()).put("operation",op));assertNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Open Clock?"));}
    else{begin("reviewClock",new JSONObject(key.toString()).put("operation",op));visible();assertEquals(before,sent.size());button("Continue to Clock");approved=result();}
    assertTrue(approved.has("reviewToken"));assertEquals(before,sent.size());
    JSONObject confirmation=new JSONObject(key.toString()).put("reviewToken",approved.getString("reviewToken"));assertEquals("opened",bridge("confirmClock",confirmation).getJSONObject("result").getString("status"));assertEquals(before+1,sent.size());
    assertEquals("set".equals(action)?AlarmClock.ACTION_SET_ALARM:AlarmClock.ACTION_SHOW_ALARMS,sent.get(before).getAction());assertFalse(sent.get(before).hasExtra(AlarmClock.EXTRA_ALARM_SNOOZE_DURATION));
    assertEquals("opened",bridge("confirmClock",confirmation).getJSONObject("result").getString("status"));assertEquals(before+1,sent.size());
   }
   for(String outcome:new String[]{"denied","unavailable"}){
    JSONObject op=operation("show"),key=reserve(op);int before=sent.size();String token=bridge("reviewClock",new JSONObject(key.toString()).put("operation",op)).getString("reviewToken");deliveryFailure.set(outcome);
    assertEquals(outcome,bridge("confirmClock",new JSONObject(key.toString()).put("reviewToken",token)).getJSONObject("result").getString("status"));deliveryFailure.set("");assertEquals(before,sent.size());
   }
   JSONObject op=operation("dismiss"),cancelled=reserve(op);int before=sent.size();begin("reviewClock",new JSONObject(cancelled.toString()).put("operation",op));visible();button("Cancel");assertEquals("failed",result().getJSONObject("result").getString("status"));assertEquals("failed",bridge("reviewClock",new JSONObject(cancelled.toString()).put("operation",op)).getJSONObject("result").getString("status"));assertEquals(before,sent.size());
   JSONObject retired=reserve(op);begin("reviewClock",new JSONObject(retired.toString()).put("operation",op));visible();button("Continue to Clock");String nonce=result().getString("reviewToken");bridge("cancelClock",retired);assertEquals("failed",bridge("confirmClock",new JSONObject(retired.toString()).put("reviewToken",nonce)).getJSONObject("result").getString("status"));assertEquals(before,sent.size());
   JSONObject recreated=reserve(op);begin("reviewClock",new JSONObject(recreated.toString()).put("operation",op));visible();scenario.recreate();AppNavigation.liveMode();
   // The closed review sent nothing, so it is offered again rather than reported as unknown.
   begin("reviewClock",new JSONObject(recreated.toString()).put("operation",op));visible();button("Cancel");assertEquals("failed",result().getJSONObject("result").getString("status"));assertEquals(before,sent.size());
  }finally{
   instrumentation.removeMonitor(monitor);AlphaCredentialStore store=new AlphaCredentialStore(context);for(String id:proposals)store.removeCredentialSlot("action-journal:v1:"+scope+":entry:"+id);store.removeCredentialSlot("action-journal:v1:"+scope+":index");
  }
 }
 private static boolean SetActions(String action){return AlarmClock.ACTION_SET_ALARM.equals(action)||AlarmClock.ACTION_SHOW_ALARMS.equals(action)||AlarmClock.ACTION_SNOOZE_ALARM.equals(action)||AlarmClock.ACTION_DISMISS_ALARM.equals(action);}
}
