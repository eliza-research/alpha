package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.Manifest;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Seed with the old APK, replace the APK without clearing data, verify in a new process. */
@RunWith(AndroidJUnit4.class)
public final class ReminderUpgradeInstrumentedTest {
 private static final String ENVELOPE="alpha-reminder-envelope-v1", LEGACY="alpha-local-reminders-v1";
 private PendingIntent alarm(Context c,String id,String occurrence){return PendingIntent.getBroadcast(c,0,new Intent(c,ReminderReceiver.class).setAction("ai.elizaresearch.alphaphone.REMIND").setData(Uri.parse("alpha-reminder:"+id+"/"+occurrence)),PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);}
 private PendingIntent tap(Context c,String token){return PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class).setAction("ai.elizaresearch.alphaphone.OPEN_REMINDER").setData(Uri.parse("alpha-reminder-tap:"+token)),PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);}
 @Test public void installedUpgradePreservesIdentityAndReceipts()throws Exception {
  String phase=InstrumentationRegistry.getArguments().getString("reminderUpgrade");
  org.junit.Assume.assumeTrue("Explicit owned upgrade fixture required",phase!=null);
  assertTrue("Owned secondary user required",android.os.Process.myUid()/100000>0);
  assertTrue(phase.equals("seed")||phase.equals("verify"));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals("ai.elizaresearch.alphaphone",c.getPackageName());
  assertEquals(PackageManager.PERMISSION_GRANTED,c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));
  java.io.File evidence=new java.io.File(c.getFilesDir(),"reminder-upgrade-fixture.json");
  AlphaCredentialStore secure=new AlphaCredentialStore(c);
  if(phase.equals("seed")){
   assertFalse("Fresh fixture required",evidence.exists());
   String empty=c.getSharedPreferences(ENVELOPE,0).getString("envelope",null);
   if(empty!=null){JSONObject initial=new JSONObject(empty);assertEquals(1,initial.getInt("version"));assertEquals(0,initial.getJSONObject("records").length());assertEquals(0,initial.getJSONObject("operations").length());assertTrue(c.getSharedPreferences(ENVELOPE,0).edit().remove("envelope").commit());}
   assertEquals(0,c.getSharedPreferences(LEGACY,0).getAll().size());
   assertNull(secure.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
   long future=System.currentTimeMillis()+86400000;
   JSONObject legacy=new JSONObject().put("id","upgrade_legacy").put("title","Synthetic legacy reminder").put("body","Owned upgrade fixture").put("at",future).put("status","scheduled");
   assertTrue(c.getSharedPreferences(LEGACY,0).edit().putString("upgrade_legacy",legacy.toString()).putInt("malformed_neighbor",7).commit());
   ReminderTestAccess.read(c,"upgrade_legacy");
   ReminderTestAccess.schedule(c,"upgrade_future","Synthetic future","Owned upgrade fixture",future);
   java.time.ZonedDateTime next=java.time.ZonedDateTime.now(java.time.ZoneId.of("UTC")).plusDays(2).withSecond(0).withNano(0);
   JSONObject recurrence=new JSONObject().put("rule","daily").put("zone","UTC").put("date",next.toLocalDate().toString()).put("time",next.toLocalTime().toString()).put("leadMinutes",0);
   ReminderTestAccess.schedule(c,"upgrade_repeat","Synthetic repeat","Owned upgrade fixture",next.toInstant().toEpochMilli(),recurrence);
   String operationId=UUID.randomUUID().toString(),binding="b".repeat(64);
   JSONObject operation=new JSONObject().put("type","reminder_create").put("fields",new JSONObject().put("title","Synthetic quiet task").put("body","Owned upgrade fixture").put("schedule",new JSONObject().put("at",future).put("dueAt",future).put("alertMinutes",JSONObject.NULL).put("recurrence",JSONObject.NULL)));
   JSONObject receipt=ReminderTestAccess.operate(c,operationId,binding,operation);assertEquals("succeeded",receipt.getString("status"));
   long due=System.currentTimeMillis()+1500;
   ReminderTestAccess.schedule(c,"upgrade_posted","Synthetic posted reminder","Owned upgrade fixture",due);
   while(System.currentTimeMillis()<due)SystemClock.sleep(50);
   ReminderTestAccess.deliver(c,"upgrade_posted",ReminderTestAccess.read(c,"upgrade_posted").getString("occurrenceId"));
   assertEquals("posted",ReminderTestAccess.read(c,"upgrade_posted").getString("status"));
   JSONObject ledger=new JSONObject(secure.readCredentialSlot(ReminderTestAccess.Taps.SLOT));String token=ledger.keys().next();
   new ReminderTestAccess.Taps(c).capture(token);
   assertEquals(token,new ReminderTestAccess.Taps(c).pending().getString("token"));
   JSONObject targets=new JSONObject();for(String id:new String[]{"upgrade_legacy","upgrade_future","upgrade_repeat","upgrade_posted"})targets.put(id,ReminderTestAccess.selected(c,id));
   for(String id:new String[]{"upgrade_future","upgrade_repeat"})assertNotNull("Baseline alarm identity",alarm(c,id,targets.getJSONObject(id).getString("occurrenceId")));
   assertNotNull("Baseline opaque tap identity",tap(c,token));
   JSONObject snapshot=new JSONObject().put("envelope",c.getSharedPreferences(ENVELOPE,0).getString("envelope",null)).put("ledger",secure.readCredentialSlot(ReminderTestAccess.Taps.SLOT)).put("targets",targets).put("operationId",operationId).put("binding",binding).put("operation",operation).put("receipt",receipt).put("token",token);
   Files.write(evidence.toPath(),snapshot.toString().getBytes(StandardCharsets.UTF_8));
  }else{
   assertTrue("Baseline seed required",evidence.isFile());JSONObject saved=new JSONObject(new String(Files.readAllBytes(evidence.toPath()),StandardCharsets.UTF_8));
   assertEquals(saved.getString("envelope"),c.getSharedPreferences(ENVELOPE,0).getString("envelope",null));
   assertEquals(saved.getString("ledger"),secure.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
   JSONObject targets=saved.getJSONObject("targets");for(String id:new String[]{"upgrade_legacy","upgrade_future","upgrade_repeat","upgrade_posted"})assertEquals(targets.getJSONObject(id).toString(),ReminderTestAccess.selected(c,id).toString());
   assertEquals(saved.getJSONObject("receipt").toString(),ReminderTestAccess.operationReceipt(c,saved.getString("operationId"),saved.getString("binding"),saved.getJSONObject("operation")).toString());
   assertEquals(saved.getJSONObject("receipt").toString(),ReminderTestAccess.operate(c,saved.getString("operationId"),saved.getString("binding"),saved.getJSONObject("operation")).toString());
   // Instrumentation force-stops the target; Android 15 cancels its PendingIntents.
   // The host checks installed-update identity before starting this process. Test
   // the actual receiver recovery route here, independently of persisted bytes.
   new ReminderReceiver().onReceive(c,new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));
   for(String id:new String[]{"upgrade_future","upgrade_repeat"})assertNotNull("Restored alarm identity: "+id,alarm(c,id,targets.getJSONObject(id).getString("occurrenceId")));
   assertEquals(saved.getString("token"),new ReminderTestAccess.Taps(c).pending().getString("token"));
   assertEquals(7,c.getSharedPreferences(LEGACY,0).getInt("malformed_neighbor",0));
   assertEquals(saved.getString("envelope"),c.getSharedPreferences(ENVELOPE,0).getString("envelope",null));
   assertEquals(saved.getString("ledger"),secure.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
  }
 }
}
