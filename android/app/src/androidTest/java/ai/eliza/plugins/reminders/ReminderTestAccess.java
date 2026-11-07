package ai.eliza.plugins.reminders;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import ai.elizaresearch.alphaphone.AlphaReminders;
import java.util.HashMap;
import java.util.IdentityHashMap;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

/** Instrumentation-only access to shared internals; no duplicate reminder implementation. */
public final class ReminderTestAccess {
 private ReminderTestAccess() {}
 private static final IdentityHashMap<Context,ReminderStore> isolated = new IdentityHashMap<>();
 public static synchronized void isolate(Context context) {
  if(isolated.containsKey(context))throw new IllegalStateException("Fixture already registered");
  isolated.put(context,new ReminderStore(FIXTURE,new MemorySecure()));
 }
 public static synchronized void release(Context context) {
  isolated.remove(context);
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  manager.deleteNotificationChannel(FIXTURE.channelId);manager.deleteNotificationChannel(FIXTURE.dueChannelId());
 }
 /** Product preference names (callers isolate them in a ContextWrapper) with a separate tap slot,
  * channels, alarm routes and notification tags, so fixtures never reach production state. */
 static final ReminderConfiguration FIXTURE=fixture(AlphaReminders.CONFIGURATION);
 private static ReminderConfiguration fixture(ReminderConfiguration p){return new ReminderConfiguration(p.envelopeName,p.legacyName,"reminder-taps:fixture","alpha-local-reminders-fixture",p.channelName+" (test)",p.channelDescription,p.publicTitle,p.remindAction,p.decisionAction,p.openAction,"alpha-reminder-fixture:","alpha-reminder-fixture-decision:","alpha-reminder-fixture-tap:",p.idExtra,p.occurrenceExtra,p.decisionExtra,"fixture:",p.receiverClass,p.activityClass,p.questionActionLabel);}
 /** In-memory secure storage that counts writes, standing in for the credential store. */
 static final class MemorySecure implements SecureStringStore {
  private final HashMap<String,String> values=new HashMap<>();private int writes;
  public String identity(){return "reminder-test-memory-"+System.identityHashCode(this);}
  public synchronized String read(String key){return values.get(key);}
  public synchronized void write(String key,String value){values.put(key,value);writes++;}
  synchronized int writes(){return writes;}
 }
 /** The alarm the store armed for this occurrence, or null; same request code and intent as ReminderStore.pending. */
 static PendingIntent alarm(Context c,ReminderConfiguration config,String id,String occurrence){
  Intent intent=new Intent(c,config.receiverClass).setAction(config.remindAction).setData(Uri.parse(config.alarmUriPrefix+id+(occurrence==null?"":"/"+occurrence)));
  return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);
 }
 private static synchronized ReminderStore store(Context context) {
  ReminderStore value=isolated.get(context);
  return value==null?AlphaReminders.engine(context).store:value;
 }
 public static final String CHANNEL=AlphaReminders.CONFIGURATION.channelId;
 public static final String OPEN_ID=AlphaReminders.CONFIGURATION.idExtra;
 public static final String OCCURRENCE=AlphaReminders.CONFIGURATION.occurrenceExtra;
 public static String digest(String value){return ReminderStore.digest(value);}
 public static void channel(Context c){store(c).channel(c);}
 public static boolean allowed(Context c){return store(c).allowed(c);}
 public static JSONObject schedule(Context c,String id,String title,String body,long at)throws JSONException{return store(c).schedule(c,id,title,body,at);}
 public static JSONObject schedule(Context c,String id,String title,String body,long at,JSONObject recurrence)throws JSONException{return store(c).schedule(c,id,title,body,at,recurrence);}
 public static JSONObject schedule(Context c,String id,String title,String body,long at,JSONObject recurrence,JSONObject timing)throws JSONException{return store(c).schedule(c,id,title,body,at,recurrence,timing);}
 public static JSONObject read(Context c,String id)throws JSONException{return store(c).read(c,id);}
 public static JSONArray list(Context c)throws JSONException{return store(c).list(c);}
 public static JSONObject selected(Context c,String id)throws JSONException{return store(c).selected(c,id);}
 public static JSONObject operate(Context c,String id,String binding,JSONObject operation)throws JSONException{return store(c).operate(c,id,binding,operation);}
 public static JSONObject operationReceipt(Context c,String id,String binding,JSONObject operation)throws JSONException{return store(c).operationReceipt(c,id,binding,operation);}
 public static JSONObject decide(Context c,String id,String occurrence,String action)throws JSONException{return store(c).decide(c,id,occurrence,action);}
 public static boolean cancel(Context c,String id)throws JSONException{return store(c).cancel(c,id);}
 public static void restore(Context c){store(c).restore(c);}
 public static void deliver(Context c,String id){store(c).deliver(c,id);}
 public static void deliver(Context c,String id,String occurrence){store(c).deliver(c,id,occurrence);}
 public static final class Envelope {
  private final ReminderEnvelope delegate;
  private final ReminderStore owner;
  public Envelope(Context c){owner=store(c);synchronized(owner){delegate=new ReminderEnvelope(c,owner);}}
  /** A copy taken under the store lock; never the store's cached envelope. */
  public JSONObject value()throws JSONException{synchronized(owner){return new JSONObject(delegate.active().toString());}}
  public SharedPreferences records(){return delegate.records();}
 }
 /** Remove fixture rows and receipts in one store transaction, under the lock the store itself takes. */
 public static void removeFixture(Context c,Iterable<String> ids,Iterable<String> operations)throws JSONException{
  ReminderStore owner=store(c);
  synchronized(owner){
   ReminderEnvelope envelope=new ReminderEnvelope(c,owner);envelope.begin();
   try{for(String id:ids)envelope.active().getJSONObject("records").remove(id);for(String op:operations)envelope.active().getJSONObject("operations").remove(op);envelope.commit();}
   catch(RuntimeException|JSONException failure){envelope.abort();throw failure;}
  }
 }
 public static final class Taps {
  public static final String SLOT=AlphaReminders.CONFIGURATION.tapSlot;
  public static final String ACTION=AlphaReminders.CONFIGURATION.openAction;
  public static final String PREFIX=AlphaReminders.CONFIGURATION.tapUriPrefix;
  public static final class UnknownTap extends Exception {}
  private final ReminderTaps delegate;
  public Taps(Context c){delegate=new ReminderTaps(c,store(c));}
  public static boolean same(JSONObject a,JSONObject b)throws JSONException{return ReminderTaps.same(a,b);}
  public String prepare(JSONObject target)throws Exception{return delegate.prepare(target);}
  public void capture(String token)throws Exception{try{delegate.capture(token);}catch(ReminderTaps.UnknownTap unknown){throw new UnknownTap();}}
  public JSONObject pending()throws Exception{return delegate.pending();}
  public JSONObject consume(String token)throws Exception{return delegate.consume(token);}
  public void dismiss(String token)throws Exception{delegate.dismiss(token);}
 }
}
