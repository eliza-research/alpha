package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CalendarContract;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native owner, destination consent, exact provider CAS and delayed Undo boundary.
 * Renderer bindings select a review, never confer permission to mutate CalendarProvider. */
final class CalendarSyncBridge {
 static final String SLOT="native-calendar-sync:v1";
 private final AlphaCalendarPlugin plugin;
 private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private final AlphaCredentialStore store;
 private final java.util.Map<JSONObject,String> revisions=java.util.Collections.synchronizedMap(new java.util.WeakHashMap<>());
 private volatile long epoch;
 private volatile boolean retired;
 private android.app.AlertDialog dialog;
 private volatile Context lease;
 private final android.database.ContentObserver observer=new android.database.ContentObserver(new android.os.Handler(android.os.Looper.getMainLooper())){@Override public void onChange(boolean self){if(!retired)plugin.calendarSyncChanged();}};
 private static final class Context {
  String id,generation,credential,credentialId,fingerprint;
  long calendar,epoch,expires;
  JSONObject owner,binding,destination;
  JSONArray events;
  CalendarSyncSnapshot source;
 }
 private boolean observing;
 CalendarSyncBridge(AlphaCalendarPlugin plugin){this.plugin=plugin;store=new AlphaCredentialStore(plugin.getContext());}
 private void observe(){
  if(observing)return;
  try{for(android.net.Uri uri:new android.net.Uri[]{CalendarContract.Calendars.CONTENT_URI,CalendarContract.Events.CONTENT_URI,CalendarContract.Attendees.CONTENT_URI,CalendarContract.Reminders.CONTENT_URI,CalendarContract.ExtendedProperties.CONTENT_URI})plugin.getContext().getContentResolver().registerContentObserver(uri,true,observer);observing=true;}
  catch(RuntimeException unavailable){plugin.getContext().getContentResolver().unregisterContentObserver(observer);throw unavailable;}
 }
 private static JSObject status(String value){JSObject out=new JSObject();out.put("status",value);return out;}
 private boolean granted(){return ContextCompat.checkSelfPermission(plugin.getContext(),Manifest.permission.READ_CALENDAR)==PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(plugin.getContext(),Manifest.permission.WRITE_CALENDAR)==PackageManager.PERMISSION_GRANTED;}
 private boolean foreground(){var a=plugin.getActivity();android.app.KeyguardManager lock=plugin.getContext().getSystemService(android.app.KeyguardManager.class);return !retired&&a!=null&&!a.isFinishing()&&!a.isDestroyed()&&a.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)&&(a.hasWindowFocus()||dialog!=null&&dialog.isShowing()&&dialog.getWindow()!=null&&dialog.getWindow().getDecorView().hasWindowFocus())&&lock!=null&&!lock.isDeviceLocked();}
 private JSONObject saved()throws Exception{
  String raw=store.readCredentialSlot(SLOT);JSONObject data=raw==null?new JSONObject().put("version",1).put("enabled",false).put("operations",new JSONObject()):new JSONObject(raw);
  if(data.getInt("version")!=1||!(data.opt("enabled") instanceof Boolean))throw new IllegalStateException("Calendar sync settings need recovery");data.getJSONObject("operations");revisions.put(data,raw);return data;
 }
 private void save(JSONObject data)throws Exception{save(data,false);}
 private void save(JSONObject data,boolean revoking)throws Exception{
  if(revoking&&data.getBoolean("enabled"))throw new SecurityException("Only revocation may use reserved capacity");
  String encoded=data.toString();if(encoded.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>(revoking?4:3)*1024*1024)throw new IllegalStateException("Calendar sync receipt history needs review");
  if(!revisions.containsKey(data)||!store.compareExchangeCredentialSlot(SLOT,revisions.get(data),encoded))throw new IllegalStateException("Calendar sync journal changed");revisions.put(data,encoded);
 }
 private static String digest(Object value)throws Exception{return HostedResultNotices.hash(value.toString());}
 private static boolean same(Object left,Object right)throws Exception{return DeferredDeletionJournal.same(left,right);}
 private static String scope(Context context)throws Exception{
  JSONObject identity=context.owner.getJSONObject("identity");JSONArray stable=new JSONArray().put(context.binding);
  for(String key:new String[]{"subjectUserId","agentId","installationId","enrollmentId","accountRef","environment"})stable.put(identity.getString(key));
  return digest(stable);
 }
 private boolean enabled(Context context)throws Exception{JSONObject data=saved();return data.getBoolean("enabled")&&same(data.opt("binding"),context.binding)&&same(data.opt("identity"),context.owner.getJSONObject("identity"))&&context.credentialId.equals(data.optString("credentialId"));}
 private void check(Context context,boolean mutation)throws Exception{
  if(context==null||context!=lease||context.epoch!=epoch||android.os.SystemClock.elapsedRealtime()>=context.expires||!foreground()||!granted()||!NativeDeletionCoordinator.get(plugin.getContext()).stageAdmissible(context.owner))throw new SecurityException("Calendar sync context changed");
  String credential=store.readCredentialSlot("cloud:production");
  if(!LocalAgentProviderAdmission.sameCloudCredential(context.credential,credential))throw new SecurityException("Calendar Cloud account changed");
  LocalAgentProviderAdmission.cloudProviderToken(credential,context.credentialId,System.currentTimeMillis());
  if(mutation&&!enabled(context))throw new SecurityException("Calendar sync is paused");
  // Idle expiry must not truncate a long foreground pass; every renewal rechecks native authority.
  context.expires=android.os.SystemClock.elapsedRealtime()+120000;
 }
 private CalendarSyncSnapshot read(Context context,long id,boolean review)throws Exception{
  check(context,false);
  CalendarSyncSnapshot result=review?CalendarSyncSnapshot.review(plugin.getContext().getContentResolver(),context.calendar,id,AlphaCalendarPlugin.CONFIGURATION.accountName,AlphaCalendarPlugin.CONFIGURATION.localCalendarName,context.generation):CalendarSyncSnapshot.read(plugin.getContext().getContentResolver(),context.calendar,id,AlphaCalendarPlugin.CONFIGURATION.accountName,AlphaCalendarPlugin.CONFIGURATION.localCalendarName,context.generation);
  if(NativeDeletionCoordinator.get(plugin.getContext()).calendarPending(context.calendar,id))throw new IllegalStateException("Finish or undo this pending Calendar deletion before syncing");
  check(context,false);return result;
 }
 private JSONArray events(Context context)throws Exception{
  check(context,false);ArrayList<Long> ids=new ArrayList<>();
  try(Cursor rows=plugin.getContext().getContentResolver().query(CalendarContract.Events.CONTENT_URI,new String[]{"_id"},"calendar_id=? AND deleted=0 AND original_id IS NULL AND (original_sync_id IS NULL OR original_sync_id='')",new String[]{Long.toString(context.calendar)},"_id ASC")){
   if(rows==null)throw new IllegalStateException("Calendar source read unavailable");while(rows.moveToNext()){if(ids.size()>=2000)throw new IllegalStateException("Calendar sync supports up to 2,000 local events");ids.add(rows.getLong(0));}
  }
  JSONArray result=new JSONArray();for(long id:ids){CalendarSyncSnapshot snapshot=read(context,id,true);if(snapshot.missing||snapshot.deleted)throw new IllegalStateException("Calendar changed during review");CalendarSyncMutation.plan(snapshot,snapshot.revision,snapshot.semantic());result.put(new JSONObject().put("id",Long.toString(id)).put("revision",snapshot.revision));}check(context,false);return result;
 }
 private Context prepare(JSONObject selection)throws Exception{
  if(!"production".equals(selection.optString("environment")))throw new SecurityException("Calendar Cloud environment changed");
  if(!foreground()||!granted())throw new SecurityException("Calendar permission and unlocked foreground are required");
  observe();Context previous=lease;lease=null;
  long admittedEpoch=epoch;
  JSONObject owner=NativeDeletionCoordinator.get(plugin.getContext()).agentOwner();
  String credential=store.readCredentialSlot("cloud:production");if(credential==null)throw new SecurityException("Connect Cloud before enabling sync");
  String credentialId=new JSONObject(credential).getString("credentialId"),token=LocalAgentProviderAdmission.cloudProviderToken(credential,credentialId,System.currentTimeMillis());
  JSONObject identity=AlphaConnectionPlugin.readCloudIdentity(token);
  if(admittedEpoch!=epoch||!foreground()||!granted()||!NativeDeletionCoordinator.get(plugin.getContext()).stageAdmissible(owner)||!LocalAgentProviderAdmission.sameCloudCredential(credential,store.readCredentialSlot("cloud:production")))throw new SecurityException("Calendar review changed");
  JSONArray account=new JSONArray().put("cloud").put("production").put(identity.getString("userId")).put(identity.getString("organizationId"));
  if(!account.toString().equals(owner.getJSONObject("identity").getString("accountRef")))throw new SecurityException("Calendar and agent Cloud accounts differ");
  String connection=selection.getString("connectionId"),calendar=selection.getString("calendarId");
  JSONObject capabilities=AlphaConnectionPlugin.readCalendarSyncCapabilities(token,connection,calendar);
  if(capabilities.getInt("version")!=1||!calendar.equals(capabilities.getString("calendarId"))||!capabilities.getBoolean("read")||!capabilities.getBoolean("write")||!capabilities.getBoolean("conditionalWrites")||!capabilities.getBoolean("idempotentCreate")||capabilities.getBoolean("providerExactlyOnce"))throw new SecurityException("Google Calendar does not support safe sync");
  String email=capabilities.getString("accountEmail"),label=capabilities.getString("calendarLabel");if(!email.matches("[^\\s@]+@[^\\s@]+")||email.length()>320||label.trim().isEmpty()||label.length()>1024||label.chars().anyMatch(c->c<32||c==127))throw new SecurityException("Google destination could not be verified");
  Context context=new Context();context.id=UUID.randomUUID().toString();context.epoch=admittedEpoch;context.expires=android.os.SystemClock.elapsedRealtime()+120000;context.owner=owner;context.credential=credential;context.credentialId=credentialId;
  String marker=null;
  try(Cursor rows=plugin.getContext().getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,new String[]{"_id","cal_sync1"},"account_name=? AND account_type=? AND name=?",new String[]{AlphaCalendarPlugin.CONFIGURATION.accountName,CalendarContract.ACCOUNT_TYPE_LOCAL,AlphaCalendarPlugin.CONFIGURATION.localCalendarName},null)){
   if(rows==null||!rows.moveToFirst())throw new IllegalStateException("Create a local Calendar event before linking Google");context.calendar=rows.getLong(0);marker=rows.isNull(1)?null:rows.getString(1);if(rows.moveToNext())throw new IllegalStateException("Multiple local Calendar sources need review");
  }
  if(marker!=null&&!marker.isEmpty()&&!UUID.fromString(marker).toString().equals(marker))throw new IllegalStateException("Local Calendar source identity needs recovery");
  context.generation=marker==null||marker.isEmpty()?previous!=null&&previous.calendar==context.calendar&&same(previous.owner,owner)?previous.generation:UUID.randomUUID().toString():marker;
  context.destination=new JSONObject().put("account",email).put("calendar",label);
  context.binding=new JSONObject().put("environment","production").put("userId",identity.getString("userId")).put("organizationId",identity.getString("organizationId")).put("connectionId",connection).put("providerAccountId",capabilities.getString("accountId")).put("calendarId",calendar).put("agentId",owner.getJSONObject("identity").getString("agentId")).put("localSourceId","native:"+context.calendar).put("localSourceRevision",context.generation);
  if(!LocalAgentProviderAdmission.sameCloudCredential(credential,store.readCredentialSlot("cloud:production"))||!foreground()||!granted()||admittedEpoch!=epoch||!NativeDeletionCoordinator.get(plugin.getContext()).stageAdmissible(owner))throw new SecurityException("Calendar context changed during review");
  lease=context;
  context.source=read(context,Long.MAX_VALUE,true);context.events=events(context);
  context.fingerprint=digest(new JSONArray().put(context.binding).put(context.owner).put(context.destination).put(context.source.sourceRevision).put(context.events));
  if(previous!=null&&context.fingerprint.equals(previous.fingerprint))context.id=previous.id;
  return context;
 }
 private JSObject projection(Context context)throws Exception{return JSObject.fromJSONObject(new JSONObject().put("status","ready").put("lease",context.id).put("binding",context.binding).put("destination",context.destination).put("events",context.events).put("enabled",enabled(context)));}
 void call(PluginCall call){String kind=call.getString("kind","");
 if(kind.equals("pause")){epoch++;lease=null;if(dialog!=null)dialog.dismiss();try{boolean saved=false;for(int attempt=0;attempt<8&&!saved;attempt++){JSONObject data=saved();data.put("enabled",false);try{save(data,true);saved=true;}catch(IllegalStateException conflict){if(attempt==7)throw conflict;}}call.resolve(status("paused"));}catch(Exception unavailable){call.resolve(status("unavailable"));}return;}
 if(kind.equals("cancel")){epoch++;lease=null;if(dialog!=null)dialog.dismiss();call.resolve(status("cancelled"));return;}final long requestedEpoch=epoch;try{worker.execute(()->{
  try{
   if(requestedEpoch!=epoch||retired){call.resolve(status("cancelled"));return;}
   if(kind.equals("prepare")&&!granted()){call.resolve(status("permission-required"));return;}
   if(kind.equals("prepare")){Context context=prepare(call.getObject("selection",new JSObject()));call.resolve(projection(context));return;}
   Context context=lease;if(context==null||!context.id.equals(call.getString("lease")))throw new SecurityException("Review Calendar sync again");check(context,false);
   if(kind.equals("enable")){plugin.getActivity().runOnUiThread(()->consent(call,context));return;}
   if(kind.equals("status")){call.resolve(projection(context));return;}
   if(kind.equals("list")){JSObject out=status("ready");out.put("events",events(context));call.resolve(out);return;}
   if(kind.equals("get")){
    CalendarSyncSnapshot observed=read(context,Long.parseLong(call.getString("eventId","")),!enabled(context));JSObject result=snapshot(observed);
    if(!observed.missing&&!observed.deleted){JSONObject data=saved(),event=observed.semantic();JSONArray recovered=CalendarSyncReceiptRecovery.observe(data,scope(context),Long.toString(observed.eventId),observed.revision,digest(CalendarSyncMutation.normalized(event)),event);if(recovered.length()>0){check(context,false);save(data);result.put("recoveries",recovered);}}
    check(context,false);call.resolve(result);return;
   }
   if(kind.equals("apply")||kind.equals("delete")){mutate(call,context,kind);return;}
   if(kind.equals("ack")){
    JSONObject data=saved(),entry=data.getJSONObject("operations").optJSONObject(call.getString("operationId",""));
    if(entry==null||!scope(context).equals(entry.optString("scope")))throw new SecurityException("Calendar receipt changed");
    JSONObject outcome=entry.optJSONObject("outcome");String state=outcome==null?"":outcome.optString("status");
    boolean confirmed=state.equals("saved")||state.equals("conflict");
    if(state.equals("queued")){JSONObject receipt=NativeDeletionCoordinator.get(plugin.getContext()).receipt("calendar",call.getString("operationId",""));confirmed=receipt!=null&&same(receipt.getJSONObject("owner"),context.owner)&&java.util.Set.of("deleted","undone","conflict").contains(receipt.optString("phase"));}
    if(!confirmed)throw new IllegalStateException("Calendar outcome is still uncertain");entry.put("acknowledged",true).put("outcome",new JSONObject().put("status",state));save(data);call.resolve(status("acknowledged"));return;
   }
   if(kind.equals("deletion")){JSONObject receipt=NativeDeletionCoordinator.get(plugin.getContext()).receipt("calendar",call.getString("operationId",""));if(receipt==null||!same(receipt.getJSONObject("owner"),context.owner))throw new SecurityException("Deletion receipt unavailable");call.resolve(JSObject.fromJSONObject(new JSONObject().put("status","receipt").put("receipt",receipt)));return;}
   throw new IllegalArgumentException("Unknown Calendar sync operation");
  }catch(UnsupportedOperationException unsupported){JSObject out=status("unsupported");out.put("message",unsupported.getMessage());call.resolve(out);}catch(SecurityException changed){JSObject out=status("context-changed");if("Calendar and agent Cloud accounts differ".equals(changed.getMessage()))out.put("message","This agent is not bound to your signed-in Cloud account. Check Agent connection before enabling Calendar sync.");call.resolve(out);}catch(IllegalArgumentException unsupported){JSObject out=status("unsupported");out.put("message","An event has unsupported dates, text or repeat fields. Review it in Calendar; nothing was changed.");call.resolve(out);}catch(Exception unavailable){call.resolve(status("unavailable"));}
 });}catch(java.util.concurrent.RejectedExecutionException closed){call.resolve(status("unavailable"));}}
 private static JSObject snapshot(CalendarSyncSnapshot snapshot)throws Exception{return JSObject.fromJSONObject(new JSONObject().put("status","ready").put("snapshot",snapshot.missing||snapshot.deleted?JSONObject.NULL:new JSONObject().put("eventId",Long.toString(snapshot.eventId)).put("revision",snapshot.revision).put("event",snapshot.semantic())));}
 private void consent(PluginCall call,Context context){
  try{check(context,false);if(dialog!=null){call.resolve(status("busy"));return;}
   final boolean[] accepted={false};
   dialog=new android.app.AlertDialog.Builder(plugin.getActivity()).setTitle("Sync Calendar with Google?").setMessage("Google account: "+context.destination.getString("account")+"\nCalendar: "+context.destination.getString("calendar")+"\n\nLink "+context.events.length()+" Alpha events and future events in On this phone. Changes to linked events sync both ways while Alpha is open. Existing Google events stay separate. Deletions have a 10-second Undo window. Unsupported events stay unchanged.").setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Enable sync",null).create();
   android.app.AlertDialog owned=dialog;owned.setOnDismissListener(d->{if(dialog==owned)dialog=null;if(!accepted[0])call.resolve(status("cancelled"));});owned.show();
   owned.getButton(android.content.DialogInterface.BUTTON_POSITIVE).setOnClickListener(view->{
    if(accepted[0])return;
    try{check(context,false);accepted[0]=true;owned.getButton(android.content.DialogInterface.BUTTON_POSITIVE).setEnabled(false);owned.getButton(android.content.DialogInterface.BUTTON_NEGATIVE).setEnabled(false);owned.setCancelable(false);worker.execute(()->{enable(call,context);plugin.getActivity().runOnUiThread(owned::dismiss);});}
    catch(Exception changed){accepted[0]=true;owned.dismiss();call.resolve(status("cancelled"));}
   });
  }catch(Exception changed){call.resolve(status("cancelled"));}
 }
 private void enable(PluginCall call,Context context){
  try{
   check(context,false);Context current=prepare(context.binding);if(current.epoch!=context.epoch||!current.fingerprint.equals(context.fingerprint))throw new SecurityException("Calendar review changed");
   check(current,false);
   String marker=current.source.source.getAsString("cal_sync1");
   if(marker==null||marker.isEmpty()){
    ArrayList<ContentProviderOperation> operations=new ArrayList<>();operations.add(current.source.assertions().get(0));ContentValues values=new ContentValues();values.put("cal_sync1",current.generation);operations.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,current.calendar).buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,AlphaCalendarPlugin.CONFIGURATION.accountName).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build()).withValues(values).withExpectedCount(1).build());
    plugin.getContext().getContentResolver().applyBatch(CalendarContract.AUTHORITY,operations);
   }
   check(current,false);read(current,Long.MAX_VALUE,false);
   JSONObject data=saved();data.put("enabled",true).put("binding",current.binding).put("identity",current.owner.getJSONObject("identity")).put("credentialId",current.credentialId);save(data);
   current.events=events(current);call.resolve(projection(current));
  }catch(Exception changed){call.resolve(status("context-changed"));}
 }
 private void mutate(PluginCall call,Context context,String kind)throws Exception{
  check(context,true);String operationId=call.getString("operationId","");if(!operationId.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid Calendar sync operation");
  long id=Long.parseLong(call.getString("eventId",""));String expected=call.getString("expectedRevision","");CalendarSyncSnapshot before=read(context,id,false);
  JSONObject payload=new JSONObject().put("kind",kind).put("binding",context.binding).put("eventId",id).put("expectedRevision",expected).put("event",kind.equals("apply")?call.getObject("event"):JSONObject.NULL);String fingerprint=digest(payload);
  JSONObject data=saved(),operations=data.getJSONObject("operations"),retained=operations.optJSONObject(operationId);
  if(retained!=null){if(!scope(context).equals(retained.optString("scope"))||!fingerprint.equals(retained.getString("digest")))throw new SecurityException("Calendar operation changed");JSONObject outcome=retained.optJSONObject("outcome");
   if(kind.equals("apply")&&outcome!=null&&outcome.optString("status").equals("saved")){
    if(before.missing||before.deleted||!CalendarSyncMutation.equivalent(before.semantic(),call.getObject("event"))){call.resolve(status("conflict"));return;}
    outcome=new JSONObject().put("status","saved").put("snapshot",new JSONObject().put("eventId",Long.toString(id)).put("revision",before.revision).put("event",before.semantic()));
   }
   call.resolve(JSObject.fromJSONObject(outcome==null?new JSONObject().put("status","unknown"):outcome));return;}
  if(before.missing||before.deleted||!before.revision.equals(expected)){call.resolve(status("conflict"));return;}
  ArrayList<ContentProviderOperation> changes=kind.equals("apply")?CalendarSyncMutation.plan(before,expected,call.getObject("event",new JSObject())):null;
  if(operations.length()>=128){java.util.ArrayList<String> acknowledged=new java.util.ArrayList<>();for(var keys=operations.keys();keys.hasNext();){String key=keys.next();if(operations.getJSONObject(key).optBoolean("acknowledged"))acknowledged.add(key);}acknowledged.sort((a,b)->Long.compare(operations.optJSONObject(a).optLong("createdAt"),operations.optJSONObject(b).optLong("createdAt")));for(String key:acknowledged){if(operations.length()<64)break;operations.remove(key);}}
  if(operations.length()>=128)throw new IllegalStateException("Calendar sync receipt history needs review");
  operations.put(operationId,new JSONObject().put("digest",fingerprint).put("kind",kind).put("eventId",Long.toString(id)).put("semanticHash",kind.equals("apply")?digest(CalendarSyncMutation.normalized(call.getObject("event"))):JSONObject.NULL).put("scope",scope(context)).put("createdAt",System.currentTimeMillis()).put("phase","dispatching"));check(context,true);save(data);
  JSONObject outcome;
  try{
   check(context,true);
   if(kind.equals("delete")){
    JSONObject target=new JSONObject().put("version",3).put("eventId",Long.toString(id)).put("sourceId",Long.toString(context.calendar)).put("generation",context.generation).put("revision",expected).put("binding",context.binding).put("fields",new JSONObject().put("title",before.semantic().getString("title")));
    JSONObject receipt=NativeDeletionCoordinator.get(plugin.getContext()).stageCalendar(target,context.owner,operationId);
    outcome=new JSONObject().put("status","queued").put("receipt",receipt);
   }else{
    plugin.getContext().getContentResolver().applyBatch(CalendarContract.AUTHORITY,changes);
    check(context,true);CalendarSyncSnapshot after=read(context,id,false);
    if(after.missing||after.deleted||!CalendarSyncMutation.equivalent(after.semantic(),call.getObject("event")))outcome=new JSONObject().put("status","unknown");
    else outcome=new JSONObject().put("status","saved").put("snapshot",new JSONObject().put("eventId",Long.toString(id)).put("revision",after.revision).put("event",after.semantic()));
   }
  }catch(android.content.OperationApplicationException conflict){outcome=new JSONObject().put("status","conflict");}catch(Exception uncertain){outcome=new JSONObject().put("status","unknown");}
  data=saved();JSONObject operation=data.getJSONObject("operations").getJSONObject(operationId);operation.put("phase","terminal").put("outcome",outcome);save(data);call.resolve(JSObject.fromJSONObject(outcome));
 }
 static JSONObject dispatchDeletion(android.content.Context context,JSONObject target){boolean dispatched=false;try{
  if(ContextCompat.checkSelfPermission(context,Manifest.permission.READ_CALENDAR)!=PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(context,Manifest.permission.WRITE_CALENDAR)!=PackageManager.PERMISSION_GRANTED)return new JSONObject().put("status","permission-required");
  CalendarSyncSnapshot snapshot=CalendarSyncSnapshot.read(context.getContentResolver(),Long.parseLong(target.getString("sourceId")),Long.parseLong(target.getString("eventId")),AlphaCalendarPlugin.CONFIGURATION.accountName,AlphaCalendarPlugin.CONFIGURATION.localCalendarName,target.getString("generation"));
  if(!snapshot.revision.equals(target.getString("revision"))||snapshot.missing||snapshot.deleted)return new JSONObject().put("status","conflict");
  ArrayList<ContentProviderOperation> operations=snapshot.assertions();operations.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,snapshot.eventId)).withExpectedCount(1).build());dispatched=true;context.getContentResolver().applyBatch(CalendarContract.AUTHORITY,operations);
  CalendarSyncSnapshot after=CalendarSyncSnapshot.read(context.getContentResolver(),snapshot.calendarId,snapshot.eventId,AlphaCalendarPlugin.CONFIGURATION.accountName,AlphaCalendarPlugin.CONFIGURATION.localCalendarName,snapshot.generation);
  return new JSONObject().put("status",after.missing||after.deleted?"deleted":"unknown");
 }catch(android.content.OperationApplicationException conflict){return status("conflict");}catch(Exception failure){return status(dispatched?"unknown":"conflict");}}
 void pause(){epoch++;lease=null;if(dialog!=null)dialog.dismiss();}
 static String deletionRefusal(android.content.Context context,JSONObject owner,JSONObject target){try{
  String raw=new AlphaCredentialStore(context).readCredentialSlot(SLOT);if(raw==null)return "sync-paused";JSONObject data=new JSONObject(raw);
  return data.getBoolean("enabled")&&same(data.getJSONObject("identity"),owner.getJSONObject("identity"))&&same(data.getJSONObject("binding"),target.getJSONObject("binding"))?null:"sync-paused";
 }catch(Exception unavailable){return "sync-unavailable";}}
 void destroy(){retired=true;pause();if(observing)plugin.getContext().getContentResolver().unregisterContentObserver(observer);worker.shutdown();}
}
