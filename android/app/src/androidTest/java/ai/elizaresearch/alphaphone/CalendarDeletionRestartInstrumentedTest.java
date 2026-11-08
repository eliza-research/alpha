package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.eliza.plugins.calendar.CalendarEventGuard;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** External host controls real process stops. Only synthetic, disposable-user events are used. */
public final class CalendarDeletionRestartInstrumentedTest {
 private static boolean present(Context context,long id){
  try(Cursor row=context.getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),new String[]{"deleted"},null,null,null)){
   assertNotNull("Provider must be readable",row);return row.moveToFirst()&&row.getInt(0)==0;
  }
 }
 private static Uri calendars(String account){return CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",account).appendQueryParameter("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL).build();}
 @Test public void externalRestartPhase()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();assertEquals("Explicit external restart campaign required","1",args.getString("calendarDeletionRestart"));
  assertTrue("Never mutate the owner user's provider",Process.myUid()/100000>0);
  String run=args.getString("restartRun",""),phase=args.getString("restartPhase",""),mode=args.getString("restartMode","");
  assertTrue(run.matches("[0-9a-f]{32}"));assertTrue(mode.equals("undo")||mode.equals("expiry"));assertTrue(phase.equals("prepare")||phase.equals("verify")||phase.equals("replay"));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
  File file=new File(context.getFilesDir(),"calendar-restart-"+run+".json");DeferredDeletionCoordinator coordinator=NativeDeletionCoordinator.get(context);
  JSONObject fixture;
  if(phase.equals("prepare")){
   assertFalse("Fresh fixture required",file.exists());assertNull(new AlphaCredentialStore(context).readCredentialSlot(NativeDeletionCoordinator.JOURNAL));
   String account="alpha-restart-"+run;ContentValues calendar=new ContentValues();
   calendar.put("account_name",account);calendar.put("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL);calendar.put("name",account);calendar.put("calendar_displayName",account);calendar.put("ownerAccount",account);calendar.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);calendar.put("calendar_timezone","UTC");calendar.put("visible",1);calendar.put("sync_events",1);
   Uri created=context.getContentResolver().insert(calendars(account),calendar);assertNotNull(created);long calendarId=ContentUris.parseId(created);
   long begin=(System.currentTimeMillis()/1000)*1000+172800000,end=begin+3600000;
   ContentValues event=new ContentValues();event.put("calendar_id",calendarId);event.put("title",account);event.put("dtstart",begin);event.put("dtend",end);event.put("eventTimezone","UTC");
   Uri inserted=context.getContentResolver().insert(CalendarContract.Events.CONTENT_URI,event);assertNotNull(inserted);long eventId=ContentUris.parseId(inserted);
   JSONObject target=CalendarScopedDeletionReview.target(CalendarEventGuard.selectScopedDeletion(context.getContentResolver(),eventId,calendarId,"event",begin,end));
   JSONObject row=coordinator.stageCalendar(target,coordinator.manualOwner(),"restart-"+run),deadline=row.getJSONObject("deadline");
   assertEquals("queued",row.getString("phase"));assertEquals(10000,deadline.getLong("expiresElapsed")-deadline.getLong("createdElapsed"));assertTrue(present(context,eventId));
   fixture=new JSONObject().put("run",run).put("mode",mode).put("account",account).put("calendarId",calendarId).put("eventId",eventId).put("operationId",row.getString("id")).put("deadline",deadline).put("preparePid",Process.myPid());
   Files.write(file.toPath(),fixture.toString().getBytes(StandardCharsets.UTF_8));
  }else{
   fixture=new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));assertEquals(run,fixture.getString("run"));assertEquals(mode,fixture.getString("mode"));assertNotEquals("A fresh process must verify",fixture.getInt("preparePid"),Process.myPid());
   String id=fixture.getString("operationId");long expiry=fixture.getJSONObject("deadline").getLong("expiresElapsed"),eventId=fixture.getLong("eventId");
   JSONObject row=coordinator.receipt("calendar",id);assertNotNull("Durable intent survived process stop",row);assertTrue("Original deadline survives unchanged",DeferredDeletionJournal.same(fixture.getJSONObject("deadline"),row.getJSONObject("deadline")));
   if(phase.equals("verify")){
    if(mode.equals("undo")){
     assertTrue("Host must restart inside the original window",SystemClock.elapsedRealtime()<expiry);assertEquals("undone",coordinator.undo("calendar",id).getString("phase"));
     SystemClock.sleep(Math.max(0,expiry-SystemClock.elapsedRealtime()+150));coordinator.reconcile();
    }else{
     assertTrue("Host must wait beyond the original window",SystemClock.elapsedRealtime()>=expiry);
     // AlphaApplication schedules reconciliation on this real process start.
     long limit=SystemClock.elapsedRealtime()+20000;
     while(!"deleted".equals(row.optString("phase"))&&SystemClock.elapsedRealtime()<limit){SystemClock.sleep(100);row=coordinator.receipt("calendar",id);assertNotNull(row);}
    }
    row=coordinator.receipt("calendar",id);assertEquals(mode.equals("undo")?"undone":"deleted",row.getString("phase"));assertEquals("Only the reviewed event changes",mode.equals("undo"),present(context,eventId));
    fixture.put("terminal",row).put("verifyPid",Process.myPid());Files.write(file.toPath(),fixture.toString().getBytes(StandardCharsets.UTF_8));
   }else{
    assertNotEquals("Replay observation uses another process",fixture.getInt("verifyPid"),Process.myPid());coordinator.reconcile();row=coordinator.receipt("calendar",id);
    assertTrue("Terminal receipt remains unchanged",DeferredDeletionJournal.same(fixture.getJSONObject("terminal"),row));assertEquals(mode.equals("undo"),present(context,eventId));
    Uri owned=ContentUris.withAppendedId(calendars(fixture.getString("account")),fixture.getLong("calendarId"));
    try(Cursor calendar=context.getContentResolver().query(owned,new String[]{"account_name","name"},null,null,null)){assertNotNull(calendar);assertTrue(calendar.moveToFirst());assertEquals(fixture.getString("account"),calendar.getString(0));assertEquals(fixture.getString("account"),calendar.getString(1));}
    assertEquals("Remove only the owned synthetic calendar",1,context.getContentResolver().delete(owned,null,null));assertTrue(file.delete());
   }
  }
  Bundle result=new Bundle();result.putString("calendarRestartRun",run);result.putString("calendarRestartPhase",phase);result.putInt("calendarRestartPid",Process.myPid());InstrumentationRegistry.getInstrumentation().addResults(result);
 }
}
