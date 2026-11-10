package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.clock.ClockDays;
import ai.eliza.plugins.system.clock.ClockHandoff;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.provider.AlarmClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Repeat days reach AlarmClock.EXTRA_DAYS. Every launch is intercepted: no alarm is created or changed. */
@RunWith(AndroidJUnit4.class)
public final class ClockRepeatDaysInstrumentedTest {
 @Test public void setIntentCarriesExactRepeatDaysOnlyForSet(){
  Intent once=ClockHandoff.intent("set",7,30,"Run",null,null);
  assertFalse("One-time alarm has no EXTRA_DAYS",once.hasExtra(AlarmClock.EXTRA_DAYS));
  Intent weekdays=ClockHandoff.intent("set",7,30,"Run",null,Arrays.asList(2,3,4,5,6));
  assertEquals(new ArrayList<>(Arrays.asList(2,3,4,5,6)),weekdays.getIntegerArrayListExtra(AlarmClock.EXTRA_DAYS));
  for(java.util.List<Integer> invalid:Arrays.asList(Arrays.asList(0),Arrays.asList(8),Arrays.asList(3,2),Arrays.asList(2,2),new ArrayList<Integer>()))
   try{ClockHandoff.intent("set",7,30,"Run",null,invalid);fail("Invalid repeat days accepted: "+invalid);}catch(IllegalArgumentException expected){}
  try{ClockHandoff.intent("show",null,null,null,null,Arrays.asList(2));fail("Repeat days on a non-set action");}catch(IllegalArgumentException expected){}
  try{ClockDays.strict(new JSONArray().put("2"));fail("String day accepted");}catch(IllegalArgumentException expected){}
 }
 @Test public void agentReviewValidatesDaysAndBuildsTheSameIntent()throws Exception{
  JSONObject operation=new JSONObject().put("type","clock_handoff").put("action","set").put("hour",6).put("minute",0).put("label","Gym").put("timeZone","UTC").put("days",new JSONArray().put(1).put(7));
  ClockAgentReview.validate(operation);
  assertEquals(new ArrayList<>(Arrays.asList(1,7)),ClockAgentReview.intent(operation).getIntegerArrayListExtra(AlarmClock.EXTRA_DAYS));
  try{ClockAgentReview.validate(new JSONObject(operation.toString()).put("days",new JSONArray().put(9)));fail("Invalid agent days accepted");}catch(IllegalArgumentException expected){}
  assertEquals("Mon, Fri",ClockDays.names(Arrays.asList(2,6)));
 }
 @Test public void launchedSetIntentIsInterceptedWithRepeatDays(){
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();
  final java.util.List<Intent> captured=new java.util.concurrent.CopyOnWriteArrayList<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent started){if(AlarmClock.ACTION_SET_ALARM.equals(started.getAction())){captured.add(new Intent(started));return new Instrumentation.ActivityResult(0,null);}return null;}};
  instrumentation.addMonitor(monitor);
  try{
   Intent intent=ClockHandoff.intent("set",8,15,"Repeat fixture",null,Arrays.asList(2,4,6)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
   org.junit.Assume.assumeTrue("A Clock app must resolve ACTION_SET_ALARM",intent.resolveActivity(context.getPackageManager())!=null);
   context.startActivity(intent);
   assertEquals("Launch intercepted before delivery",1,captured.size());
   assertEquals(new ArrayList<>(Arrays.asList(2,4,6)),captured.get(0).getIntegerArrayListExtra(AlarmClock.EXTRA_DAYS));
   assertEquals(8,captured.get(0).getIntExtra(AlarmClock.EXTRA_HOUR,-1));assertFalse(captured.get(0).getBooleanExtra(AlarmClock.EXTRA_SKIP_UI,true));
  }finally{instrumentation.removeMonitor(monitor);}
 }
}
