package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.os.SystemClock;
import android.provider.CalendarContract;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real bridge, native review controls and provider readback; disposable local data only. */
public final class CalendarDeletionReviewInstrumentedTest {
 private String eval(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String condition)throws Exception{for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Calendar review condition missing: "+condition);}
 private void foreground()throws Exception{for(int i=0;i<150;i++){boolean[] ready={false};WebViewTestDriver.withActivity(MainActivity.class,a->ready[0]=a.hasWindowFocus()&&!a.isFinishing()&&!a.isDestroyed());if(ready[0])return;SystemClock.sleep(100);}fail("Calendar review requires actual Activity focus");}
 private void begin(String plugin,String method,JSONObject args)throws Exception{foreground();eval("window.__calendarDeletionReviewResult=null;Capacitor.Plugins."+plugin+"."+method+"("+args+").then(v=>window.__calendarDeletionReviewResult=v,e=>window.__calendarDeletionReviewResult={error:String(e)})");}
 private JSONObject result()throws Exception{until("window.__calendarDeletionReviewResult");JSONObject result=new JSONObject(eval("window.__calendarDeletionReviewResult"));assertFalse(result.toString(),result.has("error"));return result;}
 private void clickReview(String label,String title,String account)throws Exception{
  for(int i=0;i<150;i++){
   assertEquals("Operation cannot settle before review", "null",eval("window.__calendarDeletionReviewResult"));
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null&&root.getPackageName()!=null&&"ai.alphacompute.alphaphone".contentEquals(root.getPackageName())){
    boolean titleShown=false,detailsShown=false;AccessibilityNodeInfo button=null;
    java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);
    while(!queue.isEmpty()){
     AccessibilityNodeInfo node=queue.removeFirst();String text=node.getText()==null?"":node.getText().toString();
     if(node.isVisibleToUser()){
      if(text.equals("Delete calendar event?"))titleShown=true;
      if(text.contains(title)&&text.contains("Calendar: "+account)&&text.contains("This event")&&text.contains("Time zone: UTC")&&text.contains("10 seconds"))detailsShown=true;
      if(text.equalsIgnoreCase(label)&&node.isClickable())button=node;
     }
     for(int c=0;c<node.getChildCount();c++){AccessibilityNodeInfo child=node.getChild(c);if(child!=null)queue.add(child);}
    }
    if(titleShown&&detailsShown&&button!=null){assertTrue("Native review control accepted",button.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}
   }
   SystemClock.sleep(100);
  }
  fail("Exact native Calendar review missing");
 }
 private boolean present(ContentResolver resolver,long id){try(Cursor row=resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),new String[]{"deleted"},null,null,null)){assertNotNull(row);return row.moveToFirst()&&row.getInt(0)==0;}}
 @Test public void nativeReviewCancelUndoAndExpiry()throws Exception{
  org.junit.Assume.assumeTrue("Explicit Calendar review gate", "1".equals(InstrumentationRegistry.getArguments().getString("calendarDeletionReview")));assertTrue("Disposable secondary user required",Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
  String account="alpha-review-"+java.util.UUID.randomUUID(),title="Owned Calendar review";
  ContentValues calendar=new ContentValues();calendar.put("account_name",account);calendar.put("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL);calendar.put("name",account);calendar.put("calendar_displayName",account);calendar.put("ownerAccount",account);calendar.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);calendar.put("calendar_timezone","UTC");calendar.put("visible",1);calendar.put("sync_events",1);
  Uri calendars=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",account).appendQueryParameter("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL).build();
  Uri created=resolver.insert(calendars,calendar);assertNotNull(created);long calendarId=ContentUris.parseId(created);
  Throwable primary=null;
  try{
   long begin=System.currentTimeMillis()/1000*1000+172800000,end=begin+3600000;
   ContentValues event=new ContentValues();event.put("calendar_id",calendarId);event.put("title",title);event.put("dtstart",begin);event.put("dtend",end);event.put("eventTimezone","UTC");Uri inserted=resolver.insert(CalendarContract.Events.CONTENT_URI,event);assertNotNull(inserted);long eventId=ContentUris.parseId(inserted);
   JSONObject inspect=new JSONObject().put("id",Long.toString(eventId)).put("calendarId",Long.toString(calendarId)).put("scope","event").put("expected",new JSONObject().put("title",title).put("body","").put("location","").put("begin",begin).put("end",end));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    begin("AlphaCalendar","inspectDeletion",inspect);JSONObject selected=result();assertEquals("ready",selected.getString("status"));
    begin("AlphaCalendar","removeScoped",selected);clickReview("Cancel",title,account);assertEquals("cancelled",result().getString("status"));assertTrue("Cancel preserves exact provider event",present(resolver,eventId));assertEquals(0,NativeDeletionCoordinator.get(context).pending().length());
    begin("AlphaCalendar","inspectDeletion",inspect);selected=result();assertEquals("ready",selected.getString("status"));
    begin("AlphaCalendar","removeScoped",selected);clickReview("Delete event",title,account);JSONObject queued=result();assertEquals("queued",queued.getString("status"));assertTrue("Review queues without immediate deletion",present(resolver,eventId));
    JSONObject deletion=queued.getJSONObject("deletion"),deadline=deletion.getJSONObject("deadline");assertEquals(10000,deadline.getLong("expiresElapsed")-deadline.getLong("createdElapsed"));
    begin("AlphaDeletions","undo",new JSONObject().put("kind","calendar").put("id",deletion.getString("id")));assertEquals("undone",result().getString("phase"));
    SystemClock.sleep(Math.max(0,deadline.getLong("expiresElapsed")-SystemClock.elapsedRealtime()+200));assertTrue("Undo keeps event after original deadline",present(resolver,eventId));
    begin("AlphaCalendar","inspectDeletion",inspect);selected=result();assertEquals("ready",selected.getString("status"));
    begin("AlphaCalendar","removeScoped",selected);clickReview("Delete event",title,account);queued=result();assertEquals("queued",queued.getString("status"));deletion=queued.getJSONObject("deletion");assertTrue(present(resolver,eventId));
    long limit=SystemClock.elapsedRealtime()+30000;JSONObject receipt=null;
    while(SystemClock.elapsedRealtime()<limit){receipt=NativeDeletionCoordinator.get(context).receipt("calendar",deletion.getString("id"));if("deleted".equals(receipt.optString("phase")))break;SystemClock.sleep(100);}
    assertNotNull(receipt);assertEquals("Actual scheduled expiry", "deleted",receipt.getString("phase"));assertFalse(present(resolver,eventId));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   try{
   Uri exact=ContentUris.withAppendedId(calendars,calendarId);try(Cursor row=resolver.query(exact,new String[]{"account_name","name"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(account,row.getString(0));assertEquals(account,row.getString(1));}assertEquals(1,resolver.delete(exact,null,null));
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
}
