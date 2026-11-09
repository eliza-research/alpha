package ai.elizaresearch.alphaphone;

import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.DialogInterface;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CalendarSyncEnableTraces {
 private static final String SLOT=CalendarSyncBridge.SLOT;
 private final Provider provider=new Provider();
 private final AlphaCalendarPlugin plugin=new AlphaCalendarPlugin(provider);
 private final CalendarSyncBridge bridge=new CalendarSyncBridge(plugin);
 private final Trace trace;
 private PluginCall preparing,enabling,pausing,readingStatus;
 private String leaseId;
 private JSONObject binding;
 private String held="none";
 private int claimedEpoch=-1,enabledEpoch=-1;

 private static final class Provider extends ContentResolver {
  private final CalendarSyncSnapshotTest.Provider rows=new CalendarSyncSnapshotTest.Provider();
  Provider(){rows.events.clear();rows.attendees.clear();rows.reminders.clear();rows.properties.clear();}
  @Override public Cursor query(Uri uri,String[] fields,String where,String[] args,String sort) {
   if(uri.value.equals("calendars")&&where!=null){
    if(!Arrays.equals(args,new String[]{"Alpha Phone","LOCAL","alpha-phone-local"}))
     throw new AssertionError("Unexpected owned source selection");
    return rows.query(uri,fields,null,null,sort);
   }
   if(uri.value.equals("events")&&where!=null&&args.length==1){
    if(!Arrays.equals(args,new String[]{"7"}))throw new AssertionError("Unexpected event source");
    return rows.query(uri,fields,null,null,sort);
   }
   return rows.query(uri,fields,where,args,sort);
  }
  @Override public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations){
   throw new AssertionError("Consent replay must not mutate provider rows");
  }
 }

 private CalendarSyncEnableTraces(String name)throws Exception {
  trace=new Trace(name,observe());
 }
 private static String status(PluginCall call){return call==null?"none":call.status();}
 private static PluginCall call(String kind,Object... fields){
  JSObject data=new JSObject();data.put("kind",kind);
  for(int i=0;i<fields.length;i+=2)data.put((String)fields[i],fields[i+1]);
  return new PluginCall(data);
 }
 private static String classify(String raw) {
  return raw==null?"absent":new JSONObject(raw).getBoolean("enabled")?"enabled":"paused";
 }
 private JSONObject observe()throws Exception {
  Object live=Trace.read(bridge,"lease");
  Object dialog=Trace.read(bridge,"dialog");
  String raw=AlphaCredentialStore.raw;
  String durable=classify(raw);
  JSONObject target=binding==null?new JSONObject():new JSONObject().put("binding",binding);
  JSONObject owner=NativeDeletionCoordinator.get(plugin.context).agentOwner();
  String deletion=CalendarSyncBridge.deletionRefusal(plugin.context,owner,target);
  String body=new JSONObject().put("grantId","fixture-grant").put("calendarId","fixture-calendar")
   .put("accountId","fixture-destination").toString();
  boolean cloud=CalendarSyncConsent.admits(CalendarSyncConsent.EVENT_PATH,null,"PATCH",body,raw);
  JSONArray writes=new JSONArray();
  for(boolean value:AlphaCredentialStore.writes)writes.put(value?"enabled":"paused");
  return Trace.fields("epoch",Trace.read(bridge,"epoch"),"lease",live!=null,
   "leaseEpoch",live==null?-1:Trace.read(live,"epoch"),"dialog",dialog!=null,
   "prepareResult",status(preparing),"enableResult",status(enabling),"pauseResult",status(pausing),
   "statusResult",status(readingStatus),"durable",durable,"writes",writes,
   "compareAttempts",AlphaCredentialStore.compareAttempts,"pauseRefusals",AlphaCredentialStore.pauseRefusals,
   "held",held,"heldExpected",held.equals("after")?classify(AlphaCredentialStore.heldSnapshot):"none",
   "claimedEpoch",claimedEpoch,"enabledEpoch",enabledEpoch,"cloudWriteAllowed",cloud,
   "deletionAllowed",deletion==null);
 }
 private void step(String action,Object... args)throws Exception{trace.step(action,observe(),args);}
 private void seedDisabled()throws Exception{AlphaCredentialStore.raw=AlphaCredentialStore.DISABLED;step("seedDisabled");}
 private void setPauseRefusals(int count)throws Exception{AlphaCredentialStore.pauseRefusals=count;step("setPauseRefusals",count);}
 private void prepare()throws Exception {
  JSONObject selection=new JSONObject().put("environment","production").put("connectionId","fixture-grant")
   .put("calendarId","fixture-calendar");
  preparing=call("prepare","selection",selection);bridge.call(preparing);
  JSONObject result=preparing.result();
  if(!result.getString("status").equals("ready"))throw new AssertionError("Expected live review "+result);
  leaseId=result.getString("lease");binding=result.getJSONObject("binding");step("prepare");
 }
 private void queueEnable()throws Exception {
  enabling=call("enable","lease",leaseId);bridge.call(enabling);
  Runnable show=plugin.activity.ui.poll(5,TimeUnit.SECONDS);
  if(show==null)throw new AssertionError("Consent did not queue");
  step("queueEnable");show.run();
  if(plugin.activity.shown==null||!plugin.activity.shown.message.contains("Synthetic Calendar"))
   throw new AssertionError("Wrong consent destination");
  step("show");
 }
 private void holdEnable(String position)throws Exception {
  AlphaCredentialStore.arm(position);
  plugin.activity.shown.getButton(DialogInterface.BUTTON_POSITIVE).click();
  if(!AlphaCredentialStore.entered.await(5,TimeUnit.SECONDS))throw new AssertionError("Enable did not enter journal read");
  Object current=Trace.read(bridge,"lease");
  claimedEpoch=((Long)Trace.read(current,"epoch")).intValue();
  held=position;step("holdEnable",position);
 }
 private void pause()throws Exception {
  pausing=call("pause");bridge.call(pausing);pausing.result();
  if(pausing.status().equals("paused"))enabledEpoch=-1;
  step("pause");
 }
 private void finishEnable()throws Exception {
  int previous=AlphaCredentialStore.writes.size();
  AlphaCredentialStore.release.countDown();enabling.result();
  if(AlphaCredentialStore.writes.size()>previous)enabledEpoch=claimedEpoch;
  Runnable dismiss=plugin.activity.ui.poll(5,TimeUnit.SECONDS);
  if(dismiss==null)throw new AssertionError("Enable did not queue its dismiss callback");
  dismiss.run();held="none";claimedEpoch=-1;step("finishEnable");
 }
 private void readStatus()throws Exception {
  readingStatus=call("status","lease",leaseId);bridge.call(readingStatus);readingStatus.result();step("readStatus");
 }
 private void run(String name)throws Exception {
  if(name.equals("pause-after-read-unchanged"))seedDisabled();
  prepare();queueEnable();holdEnable(name.startsWith("pause-after-read")?"after":"before");
  switch(name) {
   case "enable-current" -> {finishEnable();readStatus();}
   case "pause-after-enable" -> {finishEnable();pause();readStatus();}
   case "pause-before-read","pause-after-read","pause-after-read-unchanged" -> {pause();finishEnable();readStatus();}
   case "pause-retry" -> {setPauseRefusals(2);pause();finishEnable();readStatus();}
   case "pause-exhausted" -> {setPauseRefusals(8);pause();finishEnable();readStatus();}
   case "fresh-after-pause" -> {pause();finishEnable();prepare();queueEnable();holdEnable("before");finishEnable();readStatus();}
   default -> throw new IllegalArgumentException(name);
  }
 }
 public static void main(String[] args)throws Exception {
  CalendarSyncEnableTraces driver=new CalendarSyncEnableTraces(args[0]);
  try{driver.run(args[0]);System.out.println(driver.trace.value);}
  finally{AlphaCredentialStore.release.countDown();driver.bridge.destroy();}
 }
}
