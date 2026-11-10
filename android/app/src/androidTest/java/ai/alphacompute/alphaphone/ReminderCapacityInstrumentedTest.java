package ai.alphacompute.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Native scheduling/persistence lifecycle at capacity, with synthetic damaged/history snapshots. */
@RunWith(AndroidJUnit4.class)
public class ReminderCapacityInstrumentedTest {
 @Test public void fullStorePreservesUnresolvedAndDamagedNeighborsUntilExplicitCancellation() throws Exception {
  Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
  String prefix = "capacity_" + UUID.randomUUID().toString().replace("-", "");
  // Isolate every preference, including the restored-boot marker; isolate() gives the store a
  // fixture tap slot and channels. AlarmManager, PendingIntents and notifications still use real
  // Android services; every fixture has a unique ID and is cancelled below.
  Context context = new ContextWrapper(base) {
   @Override public SharedPreferences getSharedPreferences(String name, int mode) { return super.getSharedPreferences(prefix+"_"+name, mode); }
  };

  ReminderTestAccess.isolate(context);
  ArrayList<String> ids = new ArrayList<>();
  long future = System.currentTimeMillis() + 86400000L;
  String replacement = prefix + "_replacement";
  try {
   for (int i = 0; i < 248; i++) {
    String id = prefix + "_" + i; ids.add(id);
    assertEquals("scheduled", ReminderTestAccess.schedule(context, id, "Capacity fixture " + i, "", future + i * 1000L).getString("status"));
   }
   // These persisted historical states are synthetic, not evidence of real permission
   // denial/delivery. Dedicated recovery tests exercise those actual OS boundaries.
   String denied = ids.get(0), posted = ids.get(1);
   JSONObject deniedRecord = ReminderTestAccess.read(context, denied).put("status", "permission-denied");
   JSONObject postedRecord = ReminderTestAccess.read(context, posted).put("status", "posted").put("postedAt", System.currentTimeMillis());
   assertTrue(new ReminderTestAccess.Envelope(context).records().edit().putString(denied, deniedRecord.toString()).putString(posted, postedRecord.toString())
    .putString(prefix + "_bad_json", "broken-json").putInt(prefix + "_bad_type", 7).commit());
   Map<String, ?> before = new ReminderTestAccess.Envelope(context).records().getAll();
   assertEquals(250, before.size());
   try { ReminderTestAccess.schedule(context, replacement, "Must remain unscheduled", "", future); fail("Unresolved reminders must not be reclaimed"); }
   catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("storage is full")); }
   assertEquals("Refusal must not alter any persisted record", before, new ReminderTestAccess.Envelope(context).records().getAll());
   assertNull(ReminderTestAccess.read(context, replacement));
   assertEquals(248, ReminderTestAccess.list(context).length());
   ReminderTestAccess.restore(context); // Corrupted neighbors cannot stop healthy alarm restoration.

   String cancelled = ids.get(2);
   assertTrue(ReminderTestAccess.cancel(context, cancelled));
   assertEquals("cancelled", ReminderTestAccess.read(context, cancelled).getString("status"));
   ids.add(replacement);
   assertEquals("scheduled", ReminderTestAccess.schedule(context, replacement, "Replacement", "", future).getString("status"));
   assertNull("Only explicit cancelled history may be reclaimed", ReminderTestAccess.read(context, cancelled));
   assertEquals(250, new ReminderTestAccess.Envelope(context).records().getAll().size());
   assertEquals(deniedRecord.toString(), new ReminderTestAccess.Envelope(context).records().getString(denied, null));
   assertEquals(postedRecord.toString(), new ReminderTestAccess.Envelope(context).records().getString(posted, null));
   assertEquals("broken-json", new ReminderTestAccess.Envelope(context).records().getString(prefix + "_bad_json", null));
   assertEquals(7, new ReminderTestAccess.Envelope(context).records().getInt(prefix + "_bad_type", 0));
   for (int i = 3; i < 248; i++) assertEquals(before.get(ids.get(i)), new ReminderTestAccess.Envelope(context).records().getString(ids.get(i), null));
   assertEquals("Existing reminders remain editable at capacity", future + 900000L,
    ReminderTestAccess.schedule(context, replacement, "Edited replacement", "", future + 900000L).getLong("at"));
  } finally {
   for (String id : ids) ReminderTestAccess.cancel(context, id);
   ReminderTestAccess.release(context);
   assertTrue(base.getSharedPreferences(prefix+"_alpha-reminder-envelope-v1",0).edit().clear().commit());assertTrue(base.getSharedPreferences(prefix+"_alpha-local-reminders-v1",0).edit().clear().commit());
   base.deleteSharedPreferences(prefix+"_alpha-reminder-envelope-v1_restored_boot");
  }
 }
}
