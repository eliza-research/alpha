package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.provider.AlarmClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Visible Calendar UI to real Android Intent construction. Every Clock launch is
 * intercepted before delivery: this test neither creates nor changes an alarm. */
@RunWith(AndroidJUnit4.class)
public final class ClockHandoffInstrumentedTest {
 private String js(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void until(String s)throws Exception{for(int i=0;i<180;i++){if("true".equals(js("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Clock condition: "+s);}
 private void click(String label)throws Exception{String s="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")";until(s+"&&("+s+").getAttribute('aria-disabled')!=='true'");js("("+s+").click()");}
 @Test public void visibleReviewConstructsFourStandardClockIntentsWithoutDeliveringThem()throws Exception{
  org.junit.Assume.assumeTrue("Explicit intercepted Clock fixture required","1".equals(InstrumentationRegistry.getArguments().getString("clockHandoff")));
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();List<Intent> captured=new java.util.concurrent.CopyOnWriteArrayList<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){
   String a=intent.getAction();if(AlarmClock.ACTION_SET_ALARM.equals(a)||AlarmClock.ACTION_SHOW_ALARMS.equals(a)||AlarmClock.ACTION_SNOOZE_ALARM.equals(a)||AlarmClock.ACTION_DISMISS_ALARM.equals(a)){synchronized(captured){captured.add(new Intent(intent));}return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}return null;
  }};
  instrumentation.addMonitor(monitor);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class);ClockHistoryFixture history=new ClockHistoryFixture()){
   AppNavigation.liveMode();js(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));click("Clock alarms");
   for(String action:new String[]{"Set alarm","Show alarms","Snooze","Dismiss"}){
    click(action);int before=captured.size();click("Review Clock request");assertEquals(before,captured.size());click("Confirm Clock request");until("document.querySelector('[role=\"dialog\"][aria-label=\"Clock alarms\"]').textContent.includes('Clock request sent')");assertEquals(before+1,captured.size());history.completed(action.equals("Set alarm")?"set":action.equals("Show alarms")?"show":action.equals("Snooze")?"snooze":"dismiss");
   }
   assertEquals(AlarmClock.ACTION_SET_ALARM,captured.get(0).getAction());assertEquals(7,captured.get(0).getIntExtra(AlarmClock.EXTRA_HOUR,-1));assertEquals(0,captured.get(0).getIntExtra(AlarmClock.EXTRA_MINUTES,-1));assertFalse(captured.get(0).getBooleanExtra(AlarmClock.EXTRA_SKIP_UI,true));
   assertEquals(AlarmClock.ACTION_SHOW_ALARMS,captured.get(1).getAction());assertEquals(AlarmClock.ACTION_SNOOZE_ALARM,captured.get(2).getAction());assertEquals(10,captured.get(2).getIntExtra(AlarmClock.EXTRA_ALARM_SNOOZE_DURATION,-1));assertEquals(AlarmClock.ACTION_DISMISS_ALARM,captured.get(3).getAction());assertNull(captured.get(3).getData());assertFalse(captured.get(3).hasExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE));
   click("Close Clock");until("!document.querySelector('[role=\"dialog\"][aria-label=\"Clock alarms\"]')");
  }finally{instrumentation.removeMonitor(monitor);}
 }
 @Test public void invalidIntentDoesNotBecomeAnotherAlarmRequest(){
  for(String action:new String[]{"set","snooze","show","dismiss","other"}){
   try{ai.eliza.plugins.system.clock.ClockHandoff.intent(action,24,30,"invalid",0,null);fail("Rejected Clock input expected");}catch(IllegalArgumentException expected){}
  }
 }
}
