package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Resident transport adapter. Shared inbox/wire/projector own delivery and replay semantics. */
final class AlphaCanonicalNotifications {
 private static final ScheduledExecutorService SERIAL=Executors.newSingleThreadScheduledExecutor();
 private static final ExecutorService EVENTS=Executors.newSingleThreadExecutor();
 private static volatile AlphaCanonicalNotifications active;
 private static Intent waitingTap;
 private static JSONObject pendingTap;
 private static final AtomicInteger restoration=new AtomicInteger();
 private static boolean restoring;
 private final Context context;
 private volatile boolean stopped;
 private volatile ElizaAgentService.LocalStreamHandle stream;
 private final AtomicInteger queued=new AtomicInteger();
 private JSONObject session,identity;
 private String owner,fence;
 private NativeNotificationInbox inbox;
 private long attempt;
 private int failures;
 private NativeNotificationDiagnostics.Stage connectStage=NativeNotificationDiagnostics.Stage.CAPTURE_OWNER;
 private AlphaCanonicalNotifications(Context context){this.context=context.getApplicationContext();}
 /** Called by the canonical resident service after provisioning its new private boot token. */
 static void resumeExisting(Context context){
  if(ownsSession()||(android.os.Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED))return;
  NotificationManager manager=context.getSystemService(NotificationManager.class);if(manager==null||!manager.areNotificationsEnabled())return;
  Context app=context.getApplicationContext();final int ticket;
  synchronized(AlphaCanonicalNotifications.class){if(restoring||ownsSession())return;restoring=true;ticket=restoration.incrementAndGet();}
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(60);SERIAL.execute(()->restore(app,ticket,deadline));
 }
 private static void restorationDone(int ticket){synchronized(AlphaCanonicalNotifications.class){if(ticket==restoration.get())restoring=false;}}
 private static void restore(Context context,int ticket,long deadline){
  if(ticket!=restoration.get())return;if(System.nanoTime()>=deadline){restorationDone(ticket);return;}
  String saved=null;
  try{
   saved=new AlphaCredentialStore(context).readCredentialSlot(NativeNotificationSession.SLOT);if(saved==null){restorationDone(ticket);return;}
   if(AlphaLocalAgentPlugin.restoreNotificationOwner(context)){restorationDone(ticket);ensure(context);return;}
  }catch(NativeNotificationSession.Superseded replaced){restorationDone(ticket);return;}
  catch(SecurityException|JSONException|IllegalArgumentException retired){try{if(ticket==restoration.get())AlphaLocalAgentPlugin.retireRejectedNotificationSession(context,saved);}catch(Exception ignored){}restorationDone(ticket);return;}
  catch(Exception notReady){/* Read-only startup retry; never pairs or mints a session. */}
  if(ticket==restoration.get())SERIAL.schedule(()->restore(context,ticket,deadline),2,TimeUnit.SECONDS);
 }
 static void forget(Context context){
  restoration.incrementAndGet();stop();
  try{
   AlphaCredentialStore store=new AlphaCredentialStore(context);String saved=store.readCredentialSlot(NativeNotificationSession.SLOT),owner=null;
   if(saved!=null)try{String value=new JSONObject(saved).optString("projectionOwner","");if(value.matches("[a-f0-9]{64}"))owner=value;}catch(JSONException invalid){}
   store.removeCredentialSlot(NativeNotificationSession.SLOT);
   if(owner!=null)NativeNotificationProjector.retireOwner(context,owner);
  }catch(Exception unavailable){throw new IllegalStateException("Notification recovery authority could not be retired");}
 }
 static boolean ownsSession(){AlphaCanonicalNotifications a=active;return a!=null&&!a.stopped;}
 static void ensure(Context context){
  if(!AlphaLocalAgentPlugin.enrollmentPresent()||(android.os.Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED))return;
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  if(manager==null||!manager.areNotificationsEnabled())return;
  synchronized(AlphaCanonicalNotifications.class){
   if(ownsSession())return;
   AlphaCanonicalNotifications next=new AlphaCanonicalNotifications(context);active=next;SERIAL.execute(next::connect);
  }
 }
 static void stop(){detach(true);}
 static void suspendForRestart(){detach(false);}
 private static void detach(boolean retire){
  synchronized(AlphaCanonicalNotifications.class){restoration.incrementAndGet();restoring=false;}
  AlphaCanonicalNotifications previous=active;active=null;
  // Unverified taps survive cold startup; the eventual owner/token check decides them.
  synchronized(AlphaCanonicalNotifications.class){if(retire)pendingTap=null;}
  if(previous==null)return;previous.stopped=true;
  ElizaAgentService.LocalStreamHandle h=previous.stream;if(h!=null)h.cancel();
  SERIAL.execute(()->{if(retire&&previous.owner!=null)try{NativeNotificationProjector.retireOwner(previous.context,previous.owner);}catch(Exception ignored){}});
 }
 private void check()throws Exception{
  if(stopped||active!=this)throw new SecurityException("Notification connection retired");
  AlphaLocalAgentPlugin.checkNotificationSession(session);
  if(!fence.equals(new NativeOwnerReminderHost(context).reviewFence(identity)))throw new SecurityException("Notification owner changed");
 }
 private void connect(){
  if(stopped||active!=this)return;
  final long generation=++attempt;
  try{
   connectStage=NativeNotificationDiagnostics.Stage.CAPTURE_OWNER;
   session=AlphaLocalAgentPlugin.captureReminderOwnerSession();
   connectStage=NativeNotificationDiagnostics.Stage.READ_OWNER;
   identity=new NativeOwnerReminderHost(context).read();
   String nextOwner=HostedResultNotices.hash(identity.toString());
   if(owner!=null&&!owner.equals(nextOwner))throw new SecurityException("Notification owner changed");
   owner=nextOwner;
   connectStage=NativeNotificationDiagnostics.Stage.FENCE;
   fence=new NativeOwnerReminderHost(context).reviewFence(identity);check();
   connectStage=NativeNotificationDiagnostics.Stage.PERSIST_OWNER;
   AlphaLocalAgentPlugin.rememberNotificationOwner(context,session,identity);
   connectStage=NativeNotificationDiagnostics.Stage.INBOX;
   if(inbox==null)inbox=new NativeNotificationInbox(context.getNoBackupFilesDir().getCanonicalFile().toPath(),owner,record->{
    check();return AlphaLocalAgentPlugin.withNotificationSession(session,()->{
     check();boolean accepted=NativeNotificationProjector.post(context,owner,record);check();return accepted;
    });
   },NativeNotificationProjector::syncDirectory,this::check);
   inbox.beginBaseline();
   ElizaAgentService.LocalStreamHandle handle=new ElizaAgentService.LocalStreamHandle();stream=handle;
   connectStage=NativeNotificationDiagnostics.Stage.SUBSCRIBE;
   EVENTS.execute(()->{
    try{AlphaLocalAgentPlugin.subscribeNotificationEvents(session,event->{
     if(stopped||generation!=attempt)return;
     if(queued.incrementAndGet()>128){queued.decrementAndGet();handle.cancel();return;}
     SERIAL.execute(()->{try{
      check();if(generation!=attempt)return;
      JSONObject frame=new JSONObject(event);String type=frame.optString("type");
      if("subscribed".equals(type)){hydrate(generation);return;}
      if("dropped".equals(type)){fail(generation,new IllegalStateException("Notification event gap"));return;}
      if(!"event".equals(type))return;
      JSONObject envelope=frame.optJSONObject("event");if(envelope==null)return;
      JSONObject notification;
      try{notification=NativeNotificationWire.notification(envelope.toString());}
      catch(JSONException|IllegalArgumentException invalid){return;}
      if(notification!=null)inbox.acceptLive(notification);
     }catch(Exception failure){fail(generation,failure);}finally{queued.decrementAndGet();}});
    },handle);}catch(Exception failure){SERIAL.execute(()->fail(generation,failure));}
    finally{SERIAL.execute(()->fail(generation,new IllegalStateException("Notification event stream ended")));}
   });
   SERIAL.schedule(()->verify(generation),20,TimeUnit.SECONDS);
  }catch(Exception unavailable){fail(generation,unavailable);}
 }
 private void hydrate(long generation){
  try{
   check();if(generation!=attempt)return;
   JSONObject cursor=inbox.pageCursor();JSONObject response=AlphaLocalAgentPlugin.readNotificationPage(session,cursor);
   int status=response.getInt("status");
   if(status==409&&cursor.has("nativeEpoch")){inbox.restartEpoch();SERIAL.execute(()->hydrate(generation));return;}
   if(status==401||status==403)throw new SecurityException("Notification session revoked");
   if(status!=200)throw new IllegalStateException("Notification inbox unavailable");
   String body=response.getString("body");if(body.getBytes(StandardCharsets.UTF_8).length>262144)throw new IllegalArgumentException("Notification page too large");
   JSONObject page=new JSONObject(body);NativeNotificationWire.page(page,cursor);check();
   if(!inbox.acceptPage(page,cursor)){SERIAL.execute(()->hydrate(generation));return;}
   failures=0;consumeWaitingTap();
  }catch(Exception failure){fail(generation,failure);}
 }
 private void verify(long generation){
  if(generation!=attempt||stopped)return;
  try{check();consumeWaitingTap();SERIAL.schedule(()->verify(generation),20,TimeUnit.SECONDS);}catch(Exception failure){fail(generation,failure);}
 }
 private void fail(long generation,Exception failure){
  if(generation!=attempt||stopped||active!=this)return;
  NativeNotificationDiagnostics.failure(connectStage,failure);
  ++attempt;ElizaAgentService.LocalStreamHandle h=stream;stream=null;if(h!=null)h.cancel();
  // An authority change cannot authorize background enrollment or a retry.
  if(failure instanceof SecurityException){stop();return;}
  long delay=Math.min(60000L,1000L<<Math.min(failures++,6));SERIAL.schedule(this::connect,delay,TimeUnit.MILLISECONDS);
 }
 /** Capture only our private-token tap. Strip it before Capacitor can treat it as an external URL. */
 static void captureTap(Context context,Intent intent){
  if(intent==null||!intent.hasExtra("elizaNativeNotificationOwner"))return;
  synchronized(AlphaCanonicalNotifications.class){waitingTap=new Intent(intent);}
  intent.setData(null).setAction(Intent.ACTION_MAIN);
  intent.removeExtra("deepLink");intent.removeExtra("conversationId");intent.removeExtra("messageId");
  AlphaCanonicalNotifications a=active;if(a!=null)SERIAL.execute(a::consumeWaitingTap);
 }
 private void consumeWaitingTap(){
  Intent tap;synchronized(AlphaCanonicalNotifications.class){tap=waitingTap;}
  if(tap==null)return;
  try{
   check();boolean valid=NativeNotificationProjector.onOpened(context,tap,owner);
   synchronized(AlphaCanonicalNotifications.class){if(waitingTap==tap)waitingTap=null;}
   if(!valid)return;check();
   String view=NativeNotificationRoute.view(tap.getStringExtra("deepLink"));if(view==null)return;
   JSONObject pending=new JSONObject().put("token",java.util.UUID.randomUUID().toString()).put("notificationId",tap.getStringExtra("notificationId"))
    .put("view",view).put("ownerId",identity.getString("subjectUserId")).put("agentId",identity.getString("agentId")).put("expiresAt",System.currentTimeMillis()+300000);
   for(String field:new String[]{"conversationId","messageId"})if(tap.getStringExtra(field)!=null)pending.put(field,tap.getStringExtra(field));
   synchronized(AlphaCanonicalNotifications.class){pendingTap=pending;}
   AlphaNotificationsPlugin.canonicalTapReady();
  }catch(Exception unavailable){/* Never open a stale or unverified producer route. */}
 }
 static JSONObject pending()throws Exception{
  AlphaCanonicalNotifications a=active;if(a==null)return new JSONObject();a.check();
  synchronized(AlphaCanonicalNotifications.class){if(pendingTap==null||pendingTap.getLong("expiresAt")<System.currentTimeMillis()||!a.identity.getString("subjectUserId").equals(pendingTap.getString("ownerId"))||!a.identity.getString("agentId").equals(pendingTap.getString("agentId")))return new JSONObject();return new JSONObject(pendingTap.toString());}
 }
 interface ForegroundCheck{void current()throws Exception;}
 static void acknowledge(String token,ForegroundCheck foreground)throws Exception{
  AlphaCanonicalNotifications a=active;if(a==null)throw new SecurityException("Notification owner unavailable");a.check();JSONObject pending;
  foreground.current();
  // Compare-and-clear atomically: acknowledging A must never erase a newer tap B.
  synchronized(AlphaCanonicalNotifications.class){
   if(active!=a||pendingTap==null||!token.equals(pendingTap.optString("token"))||pendingTap.getLong("expiresAt")<System.currentTimeMillis())throw new SecurityException("Notification tap changed");
   pending=new JSONObject(pendingTap.toString());pendingTap=null;
  }
  JSONObject response=AlphaLocalAgentPlugin.markNotificationRead(a.session,pending.getString("notificationId"));a.check();
  if(response.getInt("status")!=200)throw new IllegalStateException("Notification read receipt unconfirmed");
 }
}
