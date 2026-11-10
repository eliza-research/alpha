package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.*;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** Real OS posts plus encrypted route lifecycle; fixture permission/user are supervisor-owned. */
public final class ReminderTapLifecycleInstrumentedTest {
 private String post(Context context,String id)throws Exception {
  long at=System.currentTimeMillis()+250;
  JSONObject row=ReminderTestAccess.schedule(context,id,"Reminder tap lifecycle","Owned disposable test",at,null);
  while(System.currentTimeMillis()<at)SystemClock.sleep(10);
  ReminderTestAccess.deliver(context,id,row.getString("occurrenceId"));assertEquals("posted",ReminderTestAccess.read(context,id).getString("status"));
  JSONObject rows=new JSONObject(new AlphaCredentialStore(context).readCredentialSlot(ReminderTestAccess.Taps.SLOT));
  for(Iterator<String> it=rows.keys();it.hasNext();){String token=it.next();if(ReminderTestAccess.Taps.same(rows.getJSONObject(token).getJSONObject("target"),ReminderTestAccess.selected(context,id)))return token;}
  throw new AssertionError("Posted route missing");
 }
 @Test public void staleDismissDuplicateCaptureAndConsumedCapacityRemainExact()throws Exception {
  org.junit.Assume.assumeTrue("Owned reminder tap lifecycle campaign","1".equals(InstrumentationRegistry.getArguments().getString("reminderTapLifecycle")));
  assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ReminderTestAccess.channel(context);assertTrue(ReminderTestAccess.allowed(context));
  AlphaCredentialStore store=new AlphaCredentialStore(context);assertNull(store.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
  ReminderTestAccess.Taps taps=new ReminderTestAccess.Taps(context);String first="first_"+UUID.randomUUID(),second="second_"+UUID.randomUUID();
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  try {
   String older=post(context,first),latest=post(context,second);
   taps.capture(older);taps.capture(latest);taps.capture(latest);assertEquals(latest,taps.pending().getString("token"));
   JSONObject before=ReminderTestAccess.read(context,second);ReminderTestAccess.cancel(context,second);
   assertFalse(taps.pending().getBoolean("retained"));
   try{taps.consume(latest);fail("Stale route consumed");}catch(IllegalStateException expected){}
   taps.dismiss(latest);assertEquals(older,taps.pending().getString("token"));assertTrue(taps.pending().getBoolean("retained"));
   taps.capture(latest);assertEquals("Dismissed token cannot revive",older,taps.pending().getString("token"));
   taps.consume(older);assertFalse(taps.pending().has("token"));taps.capture(older);assertFalse("Consumed token cannot revive",taps.pending().has("token"));
   assertEquals(before.getString("occurrenceId"),ReminderTestAccess.read(context,second).getString("occurrenceId"));assertEquals("cancelled",ReminderTestAccess.read(context,second).getString("status"));
   long end=SystemClock.elapsedRealtime()+5000;boolean present;
   do{present=false;for(StatusBarNotification n:manager.getActiveNotifications())if(first.equals(n.getTag())||second.equals(n.getTag()))present=true;if(present)SystemClock.sleep(25);}while(present&&SystemClock.elapsedRealtime()<end);
   assertFalse("Exact original notifications must be absent before reclamation",present);
   // Exact same posted record may be deliberately posted again by an unchanged edit.
   // Its new notification must not inherit a consumed route.
   JSONObject exact=ReminderTestAccess.selected(context,first),current=ReminderTestAccess.read(context,first);
   JSONObject operation=new JSONObject().put("type","reminder_update").put("target",exact).put("fields",new JSONObject().put("title",current.getString("title")).put("body",current.getString("body")));
   ReminderTestAccess.operate(context,UUID.randomUUID().toString(),"c".repeat(64),operation);
   JSONObject reposted=new JSONObject(store.readCredentialSlot(ReminderTestAccess.Taps.SLOT));String sameRecord=null;
   for(Iterator<String> it=reposted.keys();it.hasNext();){String token=it.next();JSONObject row=reposted.getJSONObject(token);if(!row.getString("state").equals("consumed")&&ReminderTestAccess.Taps.same(exact,row.getJSONObject("target")))sameRecord=token;}
   assertNotNull("Unchanged metadata repost needs fresh route",sameRecord);assertNotEquals(older,sameRecord);
   boolean repostVisible=false;long repostEnd=SystemClock.elapsedRealtime()+5000;
   do{for(StatusBarNotification n:manager.getActiveNotifications())if(first.equals(n.getTag())&&n.getNotification().contentIntent!=null)repostVisible=true;if(!repostVisible)SystemClock.sleep(25);}while(!repostVisible&&SystemClock.elapsedRealtime()<repostEnd);
   assertTrue("Metadata update must actually repost",repostVisible);
   taps.capture(sameRecord);assertEquals(sameRecord,taps.pending().getString("token"));taps.consume(sameRecord);
   try{taps.capture(older);}catch(ReminderTestAccess.Taps.UnknownTap reclaimed){}assertFalse(taps.pending().has("token"));
   // Capacity uses encrypted metadata fixtures, not 512 user notifications.
   JSONObject rows=new JSONObject(store.readCredentialSlot(ReminderTestAccess.Taps.SLOT)),consumed=rows.getJSONObject(sameRecord);
   for(int i=rows.length();i<512;i++)rows.put(UUID.randomUUID().toString(),new JSONObject(consumed.toString()).put("order",i+100));
   store.writeCredentialSlot(ReminderTestAccess.Taps.SLOT,rows.toString());
   String replacement=post(context,first);assertNotEquals(older,replacement);
   JSONObject compacted=new JSONObject(store.readCredentialSlot(ReminderTestAccess.Taps.SLOT));assertTrue(compacted.length()<512);assertFalse(compacted.has(older));
   try{taps.capture(older);fail("Forgotten token rebound");}catch(ReminderTestAccess.Taps.UnknownTap expected){}
   taps.capture(replacement);assertEquals(replacement,taps.pending().getString("token"));assertTrue(taps.pending().getBoolean("retained"));
  }finally{manager.cancel(first,0);manager.cancel(second,0);/* Supervisor owns fresh-user durable cleanup. */}
 }
}
