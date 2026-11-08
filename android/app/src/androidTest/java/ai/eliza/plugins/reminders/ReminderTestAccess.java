package ai.eliza.plugins.reminders;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import ai.elizaresearch.alphaphone.AlphaReminders;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

/** Instrumentation-only access to shared internals; no duplicate reminder implementation. */
public final class ReminderTestAccess {
 private ReminderTestAccess() {}
 private static final IdentityHashMap<Context,ReminderStore> isolated = new IdentityHashMap<>();
 public static synchronized void isolate(Context context) {
  if(isolated.containsKey(context))throw new IllegalStateException("Fixture already registered");
  isolated.put(context,new ReminderStore(fixtureConfiguration(),new Recording()));
 }
 public static synchronized void release(Context context) {
  ReminderStore store=isolated.remove(context);if(store==null)return;
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  manager.deleteNotificationChannel(store.configuration.channelId);manager.deleteNotificationChannel(store.configuration.dueChannelId());
 }
 /** Production preference names, which the caller's ContextWrapper isolates, with a fixture-only
  * tap slot, channels, actions and URIs, so an isolated store never writes a production route. */
 static ReminderConfiguration fixtureConfiguration(){
  ReminderConfiguration p=AlphaReminders.CONFIGURATION;String id="fixture_"+UUID.randomUUID().toString().replace("-","");
  return new ReminderConfiguration(p.envelopeName,p.legacyName,id+"_taps",id+"_channel",p.channelName,p.channelDescription,p.publicTitle,id+".remind",id+".decide",id+".open","fixture:"+id+"/alarm/","fixture:"+id+"/decision/","fixture:"+id+"/tap/",p.idExtra,p.occurrenceExtra,p.decisionExtra,id+":",ReminderDeletionJournalFixture.Receiver.class,android.app.Activity.class,p.questionActionLabel);
 }
 /** In-memory stand-in for encrypted slots that records each write. */
 static final class Recording implements SecureStringStore {
  final HashMap<String,String> slots=new HashMap<>();final ArrayList<String> written=new ArrayList<>();
  public String identity(){return "isolated-reminder-fixture";}
  public synchronized String read(String key){return slots.get(key);}
  public synchronized void write(String key,String value){written.add(key);slots.put(key,value);}
  synchronized int writes(){return written.size();}
 }
 /** The store's alarm PendingIntent (same request code and intent) if it exists; never creates one. */
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
  private final ReminderStore store;
  public Envelope(Context c){store=store(c);delegate=new ReminderEnvelope(c,store);}
  /** A copy of the committed envelope; never the store's cached object. */
  public JSONObject snapshot()throws JSONException{synchronized(store){return new JSONObject(delegate.value.toString());}}
  public SharedPreferences records(){return delegate.records();}
 }
 /** Remove fixture rows and operation receipts in one store transaction under the store lock. */
 public static void removeFixture(Context c,Collection<String> ids,Collection<String> operations)throws JSONException{
  ReminderStore store=store(c);
  synchronized(store){
   ReminderEnvelope envelope=new ReminderEnvelope(c,store);envelope.begin();
   try{JSONObject active=envelope.active();for(String id:ids)active.getJSONObject("records").remove(id);for(String op:operations)active.getJSONObject("operations").remove(op);envelope.commit();}
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
