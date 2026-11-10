package ai.alphacompute.alphaphone;

import ai.eliza.plugins.notifications.NoticeOwner;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.*;
import org.json.JSONObject;

@CapacitorPlugin(name="AlphaHostedResults",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class AlphaHostedResultsPlugin extends Plugin {
 static final String CHANNEL="alpha-hosted-results", ACTION="ai.alphacompute.alphaphone.OPEN_HOSTED_RESULT", PREFIX="alpha-hosted-result:";
 static final String ASK_ACTION="ai.alphacompute.alphaphone.ASK_HOSTED_RESULT";
 private final ExecutorService io=Executors.newSingleThreadExecutor();
 // Capacitor can deliver an already queued bridge call after Activity destruction.
 // Reject it without recreating a worker or crashing the bridge HandlerThread.
 private void submit(PluginCall call,Runnable task){
  PluginWorkers.submit(io,task,()->{if(call!=null)call.reject("Result bridge closed; reopen the app to continue.");});
 }
 private HostedResultNotices notices(){return HostedDelivery.get(getContext()).notices;}
 // MainActivity does not setIntent for warm taps (it keeps its own intent for sign-in returns), so the
 // latest tap stays here until its capture commits; a newer tap replaces it. It is retried on resume and
 // when the page asks for the tap.
 private volatile Intent uncommittedTap,uncommittedRenewal;
 /** The scope the page last reported on screen. A pause stops silencing it; resume restores it. */
 private volatile String showing;
 private void channel(){new HostedNoticePoster(getContext());}
 private boolean enabled(){return new HostedNoticePoster(getContext()).allowed();}
 private void sourceForeground()throws Exception {
  java.util.concurrent.CountDownLatch checked=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean admitted=new java.util.concurrent.atomic.AtomicBoolean();
  android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());Runnable check=()->{try{admitted.set(getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus()&&!getContext().getSystemService(android.app.KeyguardManager.class).isDeviceLocked());}finally{checked.countDown();}};
  if(!main.post(check)||!checked.await(5,java.util.concurrent.TimeUnit.SECONDS)){main.removeCallbacks(check);throw new SecurityException("Phone review unavailable");}if(!admitted.get())throw new SecurityException("Review sources on the unlocked phone");
 }
 @PluginMethod public void nativeSourceIdentity(PluginCall call){submit(call,()->{try{String session=call.getString("sessionId");if(session==null)throw new SecurityException();sourceForeground();call.resolve(new JSObject(HostedDelivery.get(getContext()).nativeSource(session,(binding,guard)->binding).toString()));}catch(Exception unavailable){call.reject("Native source identity unavailable");}});}
 @PluginMethod public void nativeSourceConsent(PluginCall call){submit(call,()->{try{
  sourceForeground();if(!Boolean.TRUE.equals(call.getBoolean("confirmed")))throw new SecurityException("Review source consent on the unlocked phone");
  boolean revoke=Boolean.TRUE.equals(call.getBoolean("revoke"));JSONObject result=new NativeDigestHost(getContext()).consent(call.getString("sessionId"),call.getString("sourceId"),revoke?null:call.getObject("scope"),revoke?0:call.getLong("expiresAt",0L),revoke,call.getObject("expectedBinding"),this::sourceForeground);call.resolve(new JSObject(result.toString()));
 }catch(Exception unavailable){call.reject("Native source consent could not be confirmed. Refresh the current connection.");}});}
 @PluginMethod public void beginBackground(PluginCall call){submit(call,()->{try{HostedDelivery.get(getContext()).begin(call.getString("attemptId"));call.resolve();}catch(Exception error){call.reject("Background reservation unavailable");}});}
 @PluginMethod public void cancelBackground(PluginCall call){java.util.concurrent.CompletableFuture.runAsync(()->{try{HostedDelivery.get(getContext()).cancel(call.getString("attemptId"));call.resolve();}catch(Exception error){call.reject("Background reservation could not be cancelled");}});}
 @PluginMethod public void configureBackground(PluginCall call){submit(call,()->{try{call.resolve(new JSObject(HostedDelivery.get(getContext()).configure(call.getData()).toString()));}catch(Exception error){call.reject("Background delivery needs a verified connection");}});}
 @PluginMethod public void disableBackground(PluginCall call){java.util.concurrent.CompletableFuture.runAsync(()->{try{HostedDelivery.get(getContext()).disableSession(call.getString("sessionId"));call.resolve();}catch(Exception error){call.reject("Background delivery could not be paused");}});}
 @PluginMethod public void syncInbox(PluginCall call){submit(call,()->{try{HostedDelivery d=HostedDelivery.get(getContext());JSObject out=new JSObject();out.put("entries",d.sync(d.generation(call.getString("sessionId"))));call.resolve(out);}catch(Exception error){call.reject("Result sync unavailable; saved history is unchanged");}});}
 @PluginMethod public void setBackgroundPolling(PluginCall call){java.util.concurrent.CompletableFuture.runAsync(()->{try{Boolean enabled=call.getBoolean("enabled");if(enabled==null)throw new IllegalArgumentException();HostedDelivery.get(getContext()).polling(enabled);status(call);}catch(Exception error){call.reject("Background preference could not be saved");}});}
 @PluginMethod public void inboxHistory(PluginCall call){submit(call,()->{try{JSObject out=new JSObject();out.put("entries",HostedDelivery.get(getContext()).history(call.getString("sessionId")));call.resolve(out);}catch(Exception error){call.reject("Saved result history unavailable");}});}
 /** Arms (or clears) the redacted renewal notice for a source bound to a scheduled loop. Only an identity and expiry cross the bridge. */
 @PluginMethod public void scheduleSourceRenewal(PluginCall call){submit(call,()->{try{sourceForeground();Long expiresAt=call.getLong("expiresAt");if(expiresAt==null)throw new IllegalArgumentException();String key=SourceRenewalHost.get(getContext()).arm(call.getObject("selection"),expiresAt,System.currentTimeMillis());HostedDeliveryWorker.scheduleRenewal(getContext(),key,expiresAt,System.currentTimeMillis());call.resolve();}catch(Exception error){call.reject("Renewal reminder unavailable; the in-app notice remains");}});}
 @PluginMethod public void clearSourceRenewal(PluginCall call){submit(call,()->{try{sourceForeground();SourceRenewalHost.get(getContext()).clear(call.getObject("selection"));call.resolve();}catch(Exception error){call.reject("Renewal reminder could not be cleared");}});}
 /** One redacted notice per pending phone-step approval. Only an opaque ID, a route binding and the expiry cross the bridge; a tap opens the run read-only. */
 @PluginMethod public void postWorkflowApprovalNotice(PluginCall call){submit(call,()->{try{
  String id=call.getString("id"),binding=call.getString("bindingHash");Long expiresAt=call.getLong("expiresAt");JSONObject route=call.getObject("route");
  if(!WorkflowNoticeDelivery.approvalId(id)||expiresAt==null||route==null)throw new IllegalArgumentException();
  String status=WorkflowNoticeTapsFactory.delivery(getContext()).postApproval(WorkflowNoticeTapsFactory.create(getContext()),id,binding,route,expiresAt,System.currentTimeMillis());
  JSObject out=new JSObject();out.put("status",status);call.resolve(out);
 }catch(Exception error){call.reject("Approval notice unavailable; the step stays waiting in Workflows");}});}
 /** A decision (or an approval that is no longer pending) withdraws its notice; it is never reposted. */
 @PluginMethod public void withdrawWorkflowApprovalNotice(PluginCall call){submit(call,()->{try{
  String id=call.getString("id");if(!WorkflowNoticeDelivery.approvalId(id))throw new IllegalArgumentException();
  WorkflowNoticeTapsFactory.delivery(getContext()).withdrawApproval(WorkflowNoticeTapsFactory.create(getContext()),id,System.currentTimeMillis());call.resolve();
 }catch(Exception error){call.reject("Approval notice could not be withdrawn; it expires with the approval");}});}
 /** Persisted owner fence; valid suspended notices are revalidated by the matching session before resume. */
 @PluginMethod public void withdrawOtherOwnerApprovalNotices(PluginCall call){submit(call,()->{try{
  if(!call.getData().has("owner"))throw new IllegalArgumentException("Explicit owner or sign-out required");JSONObject rawOwner=call.getObject("owner");if(!call.getData().isNull("owner")&&rawOwner==null)throw new IllegalArgumentException("Owner must be an object or explicit null");JSONObject owner=call.getData().isNull("owner")?null:NoticeOwner.identity(rawOwner);
  // Both privacy fences always run: a failed workflow cancellation never leaves the hosted digest fence unwritten.
  int withdrawn=0;Exception failed=null;
  try{withdrawn=WorkflowNoticeTapsFactory.delivery(getContext()).withdrawOtherOwners(WorkflowNoticeTapsFactory.create(getContext()),owner,System.currentTimeMillis());}catch(Exception workflowFailure){failed=workflowFailure;}
  try{notices().withdrawOtherOwners(owner);}catch(Exception digestFailure){if(failed==null)failed=digestFailure;}
  try{SourceRenewalHost.get(getContext()).withdrawOtherOwners(owner);}catch(Exception renewalFailure){if(failed==null)failed=renewalFailure;}
  if(failed!=null)throw failed;
  JSObject out=new JSObject();out.put("withdrawn",withdrawn);out.put("suspended",WorkflowNoticeTapsFactory.create(getContext()).suspendedApprovals(owner,System.currentTimeMillis()));call.resolve(out);
 }catch(Exception error){call.reject("Another owner's approval notices could not be withdrawn; they expire with their approvals");}});}
 @PluginMethod public void resumeWorkflowApprovalNotice(PluginCall call){submit(call,()->{try{
  Long expiresAt=call.getLong("expiresAt");if(expiresAt==null)throw new IllegalArgumentException();
  String status=WorkflowNoticeTapsFactory.delivery(getContext()).resumeApproval(WorkflowNoticeTapsFactory.create(getContext()),call.getString("id"),call.getString("bindingHash"),call.getObject("route"),expiresAt,System.currentTimeMillis());JSObject out=new JSObject();out.put("status",status);call.resolve(out);
 }catch(Exception error){call.reject("Approval notice remains suspended until it can be revalidated");}});}
 @PluginMethod public void pendingSourceRenewal(PluginCall call){submit(call,()->{try{sourceForeground();retryCaptures();call.resolve(new JSObject(SourceRenewalHost.get(getContext()).pending(System.currentTimeMillis()).toString()));}catch(Exception unavailable){call.reject("Renewal source unavailable");}});}
 @PluginMethod public void settleSourceRenewal(PluginCall call){submit(call,()->{try{sourceForeground();SourceRenewalHost.get(getContext()).settle(call.getString("token",""),Boolean.TRUE.equals(call.getBoolean("discard",false)),System.currentTimeMillis());call.resolve();}catch(Exception stale){call.reject("Renewal source changed");}});}
 private void captureRenewal(Intent intent){if(intent==null||(!HostedNoticePoster.RENEW_ACTION.equals(intent.getAction())&&!HostedNoticePoster.ASK_RENEW_ACTION.equals(intent.getAction()))||intent.getData()==null)return;String data=intent.getData().toString();if(!data.startsWith(HostedNoticePoster.RENEW_PREFIX))return;uncommittedRenewal=intent;submit(null,()->captureRenewalNow(intent));}
 private void captureRenewalNow(Intent intent){if(intent.getData()==null)return;String key=intent.getData().toString().substring(HostedNoticePoster.RENEW_PREFIX.length());boolean question=HostedNoticePoster.ASK_RENEW_ACTION.equals(intent.getAction());try{SourceRenewalHost.get(getContext()).capture(key,question,System.currentTimeMillis());intent.setData(null);if(uncommittedRenewal==intent)uncommittedRenewal=null;notifyListeners("renewSource",new JSObject(),true);}catch(Exception unavailable){}}
 /** Runs on the io worker. */
 private void retryCaptures(){Intent result=uncommittedTap,renewal=uncommittedRenewal;if(result!=null)captureNow(result);if(renewal!=null)captureRenewalNow(renewal);}
 @Override public void load(){channel();capture(getActivity().getIntent());captureRenewal(getActivity().getIntent());}
 @Override protected void handleOnNewIntent(Intent intent){capture(intent);captureRenewal(intent);}
 @Override protected void handleOnResume(){if(uncommittedTap!=null||uncommittedRenewal!=null)submit(null,this::retryCaptures);if(showing!=null)notices().showing(showing);notifyListeners("pendingResult",new JSObject(),true);}
 // A backgrounded app alerts as usual. A pause that leaves the page visible sends no visibility event, so resume restores the report.
 @Override protected void handleOnPause(){if(showing!=null)notices().showing(null);}
 private void capture(Intent intent){if(intent==null||(!ACTION.equals(intent.getAction())&&!ASK_ACTION.equals(intent.getAction()))||intent.getData()==null)return;String data=intent.getData().toString();if(!data.startsWith(PREFIX))return;uncommittedTap=intent;submit(null,()->captureNow(intent));}
 private void captureNow(Intent intent){if(intent.getData()==null)return;String key=intent.getData().toString().substring(PREFIX.length());boolean question=ASK_ACTION.equals(intent.getAction());try{notices().capture(key,question);intent.setData(null);if(uncommittedTap==intent)uncommittedTap=null;notifyListeners("pendingResult",new JSObject(),true);}catch(Exception ignored){/* Kept for a retry; never expose a result from an uncommitted tap. */}}
 /** The page reports which account's results panel is on screen (scope), or none. */
 @PluginMethod public void setResultsShowing(PluginCall call){try{String scope=call.getData().isNull("scope")?null:call.getString("scope");notices().showing(scope);showing=scope;call.resolve();}catch(Exception error){call.reject("Results panel state unavailable");}}
 /** The page showed these runs: their notices are withdrawn. A captured tap is left for the page to open. */
 @PluginMethod public void withdrawResult(PluginCall call){submit(call,()->{try{JSObject out=new JSObject();JSArray runs=call.getArray("runIds");if(runs==null)throw new IllegalArgumentException();out.put("withdrawn",notices().withdraw(call.getString("scope"),runs.<String>toList()));call.resolve(out);}catch(Exception error){call.reject("Result notice could not be withdrawn; it clears after a day");}});}
 @PluginMethod public void publishResult(PluginCall call){submit(call,()->{try{String phase=notices().publish(call.getData());JSObject out=new JSObject();out.put("phase",phase);call.resolve(out);}catch(Exception error){call.reject("Result notice unavailable; saved history is unchanged");}});}
 @PluginMethod public void pendingResult(PluginCall call){submit(call,()->{try{sourceForeground();retryCaptures();call.resolve(new JSObject(notices().peek().toString()));}catch(Exception error){call.reject("Saved result link unavailable");}});}
 @PluginMethod public void consumeResult(PluginCall call){submit(call,()->{try{sourceForeground();notices().consume(call.getString("token",""));call.resolve();}catch(Exception error){call.reject("Result link changed");}});}
 @PluginMethod public void releaseResultQuestion(PluginCall call){submit(call,()->{try{sourceForeground();notices().releaseQuestion(call.getString("token",""));call.resolve();}catch(Exception error){call.reject("Result question changed");}});}
 @PluginMethod public void status(PluginCall call){try{JSObject out=new JSObject(HostedDelivery.get(getContext()).status().toString());out.put("enabled",enabled());call.resolve(out);}catch(Exception error){call.reject("Result status unavailable");}}
 @PluginMethod public void enable(PluginCall call){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){LateLaunch.ask(call,()->requestPermissionForAlias("notifications",call,"permissionResult"));return;}Intent settings=new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,CHANNEL);try{getActivity().startActivity(settings);}catch(RuntimeException unavailable){call.reject("Android notification settings are unavailable");return;}status(call);}
 /** After a repeat denial Android shows no dialog, so a refusal opens the app's notification settings. */
 @PermissionCallback private void permissionResult(PluginCall call){
  if(getPermissionState("notifications")!=PermissionState.GRANTED){Intent settings=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());
   try{if(!LateLaunch.ask(call,()->getActivity().startActivity(settings)))return;}catch(RuntimeException unavailable){call.reject("Android notification settings are unavailable");return;}}
  status(call);
 }
 /** Capacitor's own permission request launches through the activity; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @Override protected void handleOnDestroy(){io.shutdown();}
}
