package ai.elizaresearch.alphaphone;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Installed-upgrade companion to ReminderUpgradeInstrumentedTest: after the old APK seeded a
 * pre-revision one-off reminder ("upgrade_legacy") and the new APK replaced it without clearing
 * data, the real reminder engine reports it as a legacyAlarm row and a reviewed native digest
 * source over reminders includes it as an open reminder on its due day instead of dropping it.
 * Read-only: it never mutates the reminder envelope that the reminder verify phase compares.
 */
public final class WorkflowLegacyReminderUpgradeInstrumentedTest {
 @Test public void upgradedLegacyOneOffReminderIsIncludedInNativeDigest()throws Exception {
  String phase=InstrumentationRegistry.getArguments().getString("reminderUpgrade");
  org.junit.Assume.assumeTrue("Runs only in the explicit installed-upgrade verify phase","verify".equals(phase));
  assertTrue("Owned secondary user required",android.os.Process.myUid()/100000>0);
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals("ai.elizaresearch.alphaphone",c.getPackageName());
  JSONArray rows=AlphaReminders.engine(c).list();JSONObject legacy=null;
  for(int i=0;i<rows.length();i++)if("upgrade_legacy".equals(rows.getJSONObject(i).getString("id")))legacy=rows.getJSONObject(i);
  assertNotNull("Seeded legacy reminder survives the upgrade",legacy);
  assertTrue("Pre-revision one-off reads as a legacy alarm",legacy.optBoolean("legacyAlarm"));
  assertEquals(legacy.getLong("at"),legacy.getLong("dueAt"));
  final JSONArray snapshot=rows;
  Map<String,String> slots=new HashMap<>();
  NativeDigestSources sources=new NativeDigestSources(new NativeDigestSources.Storage(){public String read(String key){return slots.get(key);}public void write(String key,String value){slots.put(key,value);}},new Object());
  JSONObject binding=new JSONObject().put("ownerId","owner").put("agentId","agent").put("installationId","installation").put("enrollmentId","enrollment");
  JSONObject scope=new JSONObject().put("calendars",new JSONArray()).put("reminders",true).put("timeZone","UTC").put("window","owner_day_and_overdue_reminders").put("maximumItems",200).put("modelEgress",true);
  long now=System.currentTimeMillis();JSONObject grant=sources.approve(binding,"upgrade",scope,now+7*86400000L,now,()->{});
  NativeDigestSources.Reader reader=new NativeDigestSources.Reader(){
   public JSONArray calendar(JSONArray ids,String start,String end,int maximum,String startDate,String endDateExclusive){throw new AssertionError("No calendars were selected");}
   public JSONArray reminders(){return snapshot;}
  };
  long due=legacy.getLong("dueAt");
  for(String template:new String[]{"morning","evening"}){
   JSONObject result=sources.read(binding,"upgrade",grant.getString("revision"),due,now,template,reader,()->{});
   JSONArray reminders=result.getJSONArray("reminders");JSONObject included=null;
   for(int i=0;i<reminders.length();i++)if("upgrade_legacy".equals(reminders.getJSONObject(i).getString("id")))included=reminders.getJSONObject(i);
   assertNotNull(template+" digest includes the upgraded legacy reminder",included);
   assertEquals(due,Instant.parse(included.getString("dueAt")).toEpochMilli());
   assertNotEquals("completed",included.getString("status"));
   assertFalse("Reminder bodies never leave the reviewed fields",result.toString().contains("Owned upgrade fixture"));
  }
 }
}
