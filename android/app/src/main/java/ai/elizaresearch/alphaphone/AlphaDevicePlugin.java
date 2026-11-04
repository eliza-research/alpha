package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SystemFacts;
import ai.eliza.plugins.system.SystemSettingsPages;
import ai.eliza.plugins.system.SystemShade;
import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Device facts, allowlisted settings, explicit bounded text handoffs to Android, and the owner's one-tap app update. */
@CapacitorPlugin(name="AlphaDevice")
public final class AlphaDevicePlugin extends Plugin {
 /** Explicit bounded text handoff; chooser opening never claims a sent message. */
 static String boundedShareText(String text){
  if(text==null||text.isBlank()||text.indexOf('\0')>=0||text.length()>65536)throw new IllegalArgumentException();
  try{java.nio.ByteBuffer bytes=java.nio.charset.StandardCharsets.UTF_8.newEncoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(text));if(bytes.remaining()>65536)throw new IllegalArgumentException();}
  catch(java.nio.charset.CharacterCodingException malformed){throw new IllegalArgumentException();}
  return text;
 }
 static boolean shareForeground(android.app.Activity activity){
  if(activity==null||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())return false;
  android.app.KeyguardManager lock=activity.getSystemService(android.app.KeyguardManager.class);
  android.os.UserManager users=activity.getSystemService(android.os.UserManager.class);
  return lock!=null&&users!=null&&!lock.isDeviceLocked()&&users.isUserUnlocked()&&activity instanceof androidx.lifecycle.LifecycleOwner&&((androidx.lifecycle.LifecycleOwner)activity).getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED);
 }
 @PluginMethod public void shareText(PluginCall call){
  final String text,title;try{text=boundedShareText(call.getString("text"));title=call.getString("title","");if(title.length()>200||title.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException();}catch(Exception invalid){call.reject("Choose valid text of at most 64 KiB.");return;}
  android.app.Activity activity=getActivity();if(activity==null){call.reject("Open and unlock Alpha before sharing.");return;}
  activity.runOnUiThread(()->{if(!shareForeground(activity)){call.reject("Open and unlock Alpha before sharing.");return;}try{
   Intent send=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text).putExtra(Intent.EXTRA_SUBJECT,title).putExtra(Intent.EXTRA_TITLE,title);
   activity.startActivity(Intent.createChooser(send,"Share externally"));JSObject result=new JSObject();result.put("status","opened");call.resolve(result);
  }catch(RuntimeException unavailable){call.reject("Android sharing is unavailable.");}});
 }
 @PluginMethod public void copyText(PluginCall call){
  final String text;try{text=boundedShareText(call.getString("text"));}catch(Exception invalid){call.reject("Choose valid text of at most 64 KiB.");return;}
  android.app.Activity activity=getActivity();if(activity==null){call.reject("Open and unlock Alpha before copying.");return;}
  activity.runOnUiThread(()->{if(!shareForeground(activity)){call.reject("Open and unlock Alpha before copying.");return;}try{android.content.ClipboardManager clipboard=activity.getSystemService(android.content.ClipboardManager.class);if(clipboard==null)throw new IllegalStateException();clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Alpha text",text));call.resolve();}catch(RuntimeException unavailable){call.reject("Clipboard unavailable.");}});
 }
 static int textScalePercent(Context context){int value=context.getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).getInt("text-scale-percent",100);return value>=75&&value<=150?value:100;}
 static int effectiveTextZoom(Context context,int percent){float scale=context.getResources().getConfiguration().fontScale;if(!Float.isFinite(scale)||scale<=0)scale=1;return Math.max(1,Math.round(percent*scale));}
 static void applyTextScale(MainActivity activity){activity.getBridge().getWebView().getSettings().setTextZoom(effectiveTextZoom(activity,textScalePercent(activity)));}
 @PluginMethod public void setTextScale(PluginCall call){
  Integer percent=call.getInt("percent");if(percent==null||percent<75||percent>150){call.reject("Text size must be between75 and150 percent");return;}
  getActivity().runOnUiThread(()->{
   if(!(getActivity() instanceof MainActivity)||getActivity().isFinishing()||getActivity().isDestroyed()){call.reject("Alpha view is unavailable");return;}
   if(!getContext().getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).edit().putInt("text-scale-percent",percent).commit()){call.reject("Text size could not be saved");return;}
   applyTextScale((MainActivity)getActivity());JSObject out=new JSObject();out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",getBridge().getWebView().getSettings().getTextZoom());call.resolve(out);
  });
 }
 @PluginMethod public void snapshot(PluginCall call) {
  JSObject out=new JSObject();
  // System switch, transport and power facts come from the shared reader (ElizaSystem.getSystemFacts):
  // a key Android did not answer is absent, never off.
  for(java.util.Map.Entry<String,Object> fact:SystemFacts.read(getContext()).entrySet())out.put(fact.getKey(),fact.getValue());
  out.put("model",Build.MODEL);out.put("manufacturer",Build.MANUFACTURER);
  out.put("androidRelease",Build.VERSION.RELEASE);out.put("securityPatch",Build.VERSION.SECURITY_PATCH);
  out.put("build",Build.DISPLAY);out.put("appVersion",BuildConfig.VERSION_NAME);
  out.put("readAt",System.currentTimeMillis());
  out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",effectiveTextZoom(getContext(),textScalePercent(getContext())));
  NotificationManager notifications=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  out.put("notificationsEnabled",notifications!=null&&notifications.areNotificationsEnabled());
  JSObject grants=new JSObject();
  boolean fine=getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,coarse=getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  out.put("locationAccess",fine?"precise":coarse?"approximate":"denied");
  // Only permissions Alpha declares. Contacts is removed from the manifest, so it is not reported.
  String[][] permissions={{"Microphone",Manifest.permission.RECORD_AUDIO},{"Location",Manifest.permission.ACCESS_FINE_LOCATION},{"Camera",Manifest.permission.CAMERA},{"Calendar",Manifest.permission.READ_CALENDAR}};
  for(String[] p:permissions)grants.put(p[0],getContext().checkSelfPermission(p[1])==PackageManager.PERMISSION_GRANTED);
  grants.put("Location",fine||coarse);out.put("permissions",grants);
  out.put("passwordProvider",PasswordProviderSupport.status(getContext()));
  appFacts(getContext(),out);call.resolve(out);
 }
 /** Alpha's own build facts, omitted when Android cannot answer. */
 static void appFacts(Context context,JSObject out){
  java.util.Map<String,Object> facts=new java.util.LinkedHashMap<>();
  SystemFacts.fact(facts,"appVersionCode",()->BuildConfig.VERSION_CODE);
  SystemFacts.fact(facts,"appUpdatedAt",()->{long at=context.getPackageManager().getPackageInfo(context.getPackageName(),0).lastUpdateTime;return at>0?at:null;});
  SystemFacts.fact(facts,"appSigner",()->appSigner(context));
  for(java.util.Map.Entry<String,Object> fact:facts.entrySet())out.put(fact.getKey(),fact.getValue());
 }
 @PluginMethod public void openPasswordProvider(PluginCall call) {
  String action=call.getString("action","");
  getActivity().runOnUiThread(()->{
   try {
    Intent target=PasswordProviderSupport.intent(getContext(),action);
    String destination=Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction())?"provider-picker":"external";
    try { getActivity().startActivity(target); }
    catch(android.content.ActivityNotFoundException missing) {
     if(!"settings".equals(action)||!Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction()))throw missing;
     getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS));destination="system-settings";
    }
    if(Settings.ACTION_SETTINGS.equals(target.getAction()))destination="system-settings";
    JSObject out=new JSObject();out.put("status","opened");out.put("destination",destination);call.resolve(out);
   } catch(RuntimeException unavailable) { call.reject("Password provider setup could not be opened. No provider change is confirmed."); }
  });
 }
 /**
  * Asks Android to open its own notification shade (#416, #417). Launcher flavor only, and only
  * while Alpha's window has focus, so a pull or button on visible Home is the only way to reach it.
  * Resolves with {status}: opened, standalone, permission-missing, unsupported or not-in-front.
  * Any status but opened leaves the renderer's truthful fallback to show.
  */
 @PluginMethod public void openNotificationShade(PluginCall call){
  android.app.Activity activity=getActivity();
  if(activity==null){JSObject out=new JSObject();out.put("status","not-in-front");call.resolve(out);return;}
  activity.runOnUiThread(()->{
   JSObject out=new JSObject();
   if(activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())out.put("status",SystemShade.NOT_IN_FRONT);
   else out.put("status",SystemShade.expand(getContext(),BuildConfig.IS_LAUNCHER));
   call.resolve(out);
  });
 }
 @PluginMethod public void openSettings(PluginCall call) {
  String page=call.getString("page","");
  if(SystemSettingsPages.actions(page)==null){call.reject("Unsupported settings page");return;}
  getActivity().runOnUiThread(()->{
   // The shared allowlist (SystemSettingsPages); "specific" is false when only the broader fallback opened.
   int opened=SystemSettingsPages.open(page,getContext().getPackageName(),intent->getActivity().startActivity(intent));
   if(opened<0){call.reject("This Android settings page is unavailable");return;}
   JSObject out=new JSObject();out.put("status","opened");out.put("page",page);out.put("specific",opened==0);call.resolve(out);
  });
 }

 private final java.util.concurrent.ExecutorService diagnosticsWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 /**
  * Runs problem-log work off the bridge thread. A call that the page made just before the activity
  * was destroyed can arrive after handleOnDestroy has stopped the worker; the executor then throws
  * on the bridge thread and the process dies (seen once on the API 36 emulator in
  * LauncherHomeInstrumentedTest). Such a call is answered with a rejection instead.
  */
 private void diagnostics(PluginCall call,Runnable work){
  PluginWorkers.submit(diagnosticsWorker,work,()->call.reject("Problem log is unavailable"));
 }
 /** Local problem log (shared plugin-native-system crash.CrashLog): failure classes only, never messages, stacks or content. */
 @PluginMethod public void crashLog(PluginCall call){
  diagnostics(call,()->{
   try{
    try{ai.eliza.plugins.system.crash.CrashLog.collectExitReasons(getContext());}catch(Exception unavailable){/* Exit history is best effort. */}
    JSObject out=new JSObject();out.put("entries",ai.eliza.plugins.system.crash.CrashLog.read(getContext()).getJSONArray("entries"));out.put("exitHistory",Build.VERSION.SDK_INT>=Build.VERSION_CODES.R);call.resolve(out);
   }catch(Exception error){call.reject("Problem log is unavailable");}
  });
 }
 @PluginMethod public void recordRendererFailure(PluginCall call){
  diagnostics(call,()->{try{ai.eliza.plugins.system.crash.CrashLog.recordRenderer(getContext(),call.getString("kind"),call.getString("errorClass"));call.resolve();}catch(Exception error){call.reject("Problem was not recorded");}});
 }
 @PluginMethod public void clearCrashLog(PluginCall call){
  diagnostics(call,()->{try{ai.eliza.plugins.system.crash.CrashLog.clear(getContext());call.resolve();}catch(Exception error){call.reject("Problem log could not be cleared");}});
 }
 /** Non-secret build identity for diagnostics: variant, pin and packaged runtime hashes. */
 @PluginMethod public void diagnosticsFacts(PluginCall call){
  diagnostics(call,()->{
   try{
    JSObject out=new JSObject();
    out.put("appVersion",BuildConfig.VERSION_NAME);out.put("versionCode",BuildConfig.VERSION_CODE);
    out.put("variant",BuildConfig.IS_LAUNCHER?"launcher":"standalone");out.put("buildType",BuildConfig.BUILD_TYPE);
    out.put("testMocks",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);out.put("sdkInt",Build.VERSION.SDK_INT);
    out.put("androidRelease",Build.VERSION.RELEASE);out.put("securityPatch",Build.VERSION.SECURITY_PATCH);
    JSObject hashes=new JSObject();
    for(String asset:new String[]{"agent/alpha-source.json","agent/agent-bundle.js","agent/workflow-worker/manifest.json","agent/workflow-worker/files.sha256"}){String hash=assetSha256(asset);if(hash!=null)hashes.put(asset,hash);}
    out.put("runtimeHashes",hashes);
    try(java.io.InputStream in=getContext().getAssets().open("agent/alpha-source.json")){
     java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int count,total=0;
     while((count=in.read(buffer))!=-1){total+=count;if(total>64*1024)throw new java.io.IOException();bytes.write(buffer,0,count);}
     String base=new org.json.JSONObject(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.UTF_8)).optString("base","");
     if(base.matches("[0-9a-f]{40}"))out.put("upstreamPin",base);
    }catch(Exception notPackaged){/* Developer APKs may omit the packaged runtime. */}
    call.resolve(out);
   }catch(Exception error){call.reject("Diagnostics are unavailable");}
  });
 }
 private String assetSha256(String asset){
  try(java.io.InputStream in=getContext().getAssets().open(asset)){
   java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];int count;
   while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);
   return hex(digest.digest());
  }catch(Exception absent){return null;}
 }
 /** User-initiated share of already redacted diagnostics. Android's chooser decides the destination. */
 @PluginMethod public void shareDiagnostics(PluginCall call){
  String text=call.getString("text");
  if(text==null||text.length()>256*1024){call.reject("Diagnostics are too large");return;}
  try{Object parsed=new org.json.JSONTokener(text).nextValue();if(!(parsed instanceof org.json.JSONObject)||!"alpha-diagnostics/v1".equals(((org.json.JSONObject)parsed).optString("format")))throw new IllegalArgumentException();}
  catch(Exception invalid){call.reject("Diagnostics are not valid");return;}
  getActivity().runOnUiThread(()->{
   try{
    Intent send=new Intent(Intent.ACTION_SEND);send.setType("text/plain");send.putExtra(Intent.EXTRA_TEXT,text);send.putExtra(Intent.EXTRA_SUBJECT,"Alpha Phone diagnostics");
    getActivity().startActivity(Intent.createChooser(send,"Share diagnostics"));JSObject out=new JSObject();out.put("status","opened");call.resolve(out);
   }catch(RuntimeException unavailable){call.reject("Sharing is unavailable");}
  });
 }

 /** Largest update APK admitted; UPDATE_MAX_BYTES in settings-adapter.ts is the same bound. */
 static final long UPDATE_MAX_BYTES=1L<<30;
 /** Soft ceiling on one update download, checked only when a read returns: the read timeout bounds only silence, and a trickle never goes silent. A read in flight can outlast it by up to that 60 s timeout unless handleOnDestroy disconnects it first. Fits a 1 GiB APK from about 0.4 Mbit/s, so it ends only a stalled link's trickle. */
 static final long UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.HOURS.toNanos(6);
 /** 64 lowercase hex characters of a SHA-256 digest. */
 static String hex(byte[] digest){return String.format(java.util.Locale.ROOT,"%064x",new java.math.BigInteger(1,digest));}
 /** Stops an update attempt whose bridge is gone: handleOnDestroy interrupts updateWorker, and that bridge's receiver no longer hears any session's status. */
 private static void throwIfDestroyed()throws java.io.IOException{if(Thread.currentThread().isInterrupted())throw new java.io.IOException("Update stopped");}
 /** Copies the update download, throwing at the first read that returns at or past the System.nanoTime() deadline, or unless it was exactly sizeBytes long and hashes to sha256. An undeclared size or digest is refused before any byte is read. */
 static void copyVerified(java.io.InputStream in,java.io.OutputStream out,long sizeBytes,String sha256,long deadline)throws java.io.IOException{
  if(sizeBytes<=0||sizeBytes>UPDATE_MAX_BYTES||sha256==null||!sha256.matches("[0-9a-f]{64}"))throw new java.io.IOException("Update not admitted");
  java.security.MessageDigest digest;
  try{digest=java.security.MessageDigest.getInstance("SHA-256");}catch(java.security.NoSuchAlgorithmException unavailable){throw new java.io.IOException(unavailable);}
  byte[] buffer=new byte[65536];long total=0;
  for(int count;(count=in.read(buffer))!=-1;){
   throwIfDestroyed();if(System.nanoTime()>=deadline)throw new java.io.IOException("Update took too long");
   total+=count;if(total>sizeBytes)throw new java.io.IOException("Update larger than declared");
   digest.update(buffer,0,count);out.write(buffer,0,count);
  }
  if(total!=sizeBytes||!hex(digest.digest()).equals(sha256))throw new java.io.IOException("Update does not match its manifest");
 }

 private static final String UPDATE_STATUS="ai.elizaresearch.alphaphone.UPDATE_STATUS";
 /** SHA-256 of the original certificate of Alpha's one signer (apksigner's digest), which key rotation never changes: an update manifest offers an APK only to installs of that signing lineage. */
 static String appSigner(Context context)throws Exception{android.content.pm.SigningInfo signing=context.getPackageManager().getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;return signing.hasMultipleSigners()?null:hex(java.security.MessageDigest.getInstance("SHA-256").digest(signing.getSigningCertificateHistory()[0].toByteArray()));}
 /**
  * A session's binding: package, versionCode, SHA-256, signer and boot. It is the session's referrer, so it sits in the record Android
  * writes with the seal and goes with the session, and a session comes back from a kill or a reboot with it or not at all (AOSP 10 to 17).
  * A build that states its commit intent ends it with /intent; an earlier bound build wrote the same shape without it.
  */
 private static final java.util.regex.Pattern UPDATE_BINDING=java.util.regex.Pattern.compile("alpha-update://([^/]+)/([1-9][0-9]{0,17})/[0-9a-f]{64}/([0-9a-f]{64})/([0-9]+)(/intent)?");
 /** The session's binding if it reads whole and names this package and signer. Null is unknown: no binding (an earlier build staged it), a part of one, or another target. Unknown fences. */
 private java.util.regex.Matcher updateBinding(PackageInstaller.SessionInfo session)throws Exception{
  java.util.regex.Matcher binding=UPDATE_BINDING.matcher(String.valueOf(session.getReferrerUri()));
  return binding.matches()&&getContext().getPackageName().equals(binding.group(1))&&binding.group(3).equals(appSigner(getContext()))?binding:null;
 }
 /** Moves at every system_server start, ahead of any app (AOSP 10 to 17). Android keeps a session's status receiver in memory only, so no status comes across it. */
 private int updateBoot()throws Settings.SettingNotFoundException{return Settings.Global.getInt(getContext().getContentResolver(),Settings.Global.BOOT_COUNT);}
 /** Downloads run here, never on the problem-log worker. */
 private final java.util.concurrent.ExecutorService updateWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 /** The session this process last handed to Android, set before its commit. Every bridge's receiver hears every session's status, and only updateOwner acts on it. */
 private static volatile int updateSession;
 /**
  * Android's request for the owner's confirmation of updateSession, kept until that session ends: Android offers no way to
  * ask again but a second commit, which can end an install already accepted, so a tap after a dismissal opens this same request.
  */
 private static volatile Intent updateConfirm;
 /** updateConfirm waits for its owner: Android silently drops an activity Alpha starts while it is not in front (screen locked during the download, another app open). */
 private static volatile boolean updateDue;
 /** updateConfirm has started and its owner has not resumed since, so the confirmation may still be up, in a task another bridge cannot see. */
 private static volatile boolean updateOpen;
 /** System.nanoTime() of Alpha's last exchange with Android on this session (a commit, a confirmation opened, or the owner's return from one), 0 with none. */
 private static volatile long updateAsked;
 /** The bridge that last committed a session, reconnected to one or opened its confirmation, until its destroy: the one that opens what Android asks next. A commit that threw keeps it. The fence is Android's list. */
 private static volatile AlphaDevicePlugin updateOwner;
 /** Android's status for the owner's update session. A request for confirmation is not an end; any other status is Android's last for the session, and a confirmation kept for it would open on nothing. */
 private final android.content.BroadcastReceiver updateStatus=new android.content.BroadcastReceiver(){
  @Override public void onReceive(Context context,Intent intent){
   int id=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
   // A restart or a destroy lost the owner. Only a status of this boot for a session bound to this boot takes it up: a pending request is the one way left to reach its confirmation.
   if(updateOwner==null)try{
    PackageInstaller.SessionInfo session=getContext().getPackageManager().getPackageInstaller().getSessionInfo(id);
    java.util.regex.Matcher binding=session==null?null:updateBinding(session);
    if(binding!=null&&binding.group(4).equals(String.valueOf(updateBoot()))){updateOwner=AlphaDevicePlugin.this;updateSession=id;}
   }catch(Exception unanswered){/* Unknown stays fenced. */}
   if(updateOwner!=AlphaDevicePlugin.this||id!=updateSession)return;
   updateDue=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)==PackageInstaller.STATUS_PENDING_USER_ACTION;
   updateConfirm=updateDue?androidx.core.content.IntentCompat.getParcelableExtra(intent,Intent.EXTRA_INTENT,Intent.class):null;
   if(inFront())confirmUpdate();
  }
 };
 private boolean inFront(){return getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED);}
 /**
  * Android has moved past asking the owner about this session, or the session is gone: a confirmation opened now could end an
  * install already accepted. Staging counts 0.8, and only after an accept does Android add 0.1, ahead of marking the stage
  * directory in use (AOSP 10 to 17). isActive() reads an accepted session only from Android 14, once Android's install thread
  * reaches it. A developer-verification request (Android 17) comes on an active session.
  */
 private static boolean pastConfirmation(PackageInstaller.SessionInfo session,Intent confirm){
  return session==null||session.getProgress()>0.8f||session.isActive()&&!"android.content.pm.action.CONFIRM_DEVELOPER_VERIFICATION".equals(confirm.getAction());
 }
 /** Opens the kept confirmation once, never over one still open, on the main thread like updateStatus and handleOnResume. */
 private void confirmUpdate(){
  if(!updateDue||updateOpen)return;
  updateDue=false;updateOpen=true;updateAsked=System.nanoTime();
  try{getActivity().startActivity(updateConfirm);}catch(RuntimeException unavailable){updateOpen=false;/* The next tap opens it. */}
 }
 /** A resume follows a pause, so what this bridge opened above itself is gone: answered, or dismissed with no status. Time may have passed since Android asked for what it kept. */
 @Override protected void handleOnResume(){
  super.handleOnResume();
  if(updateOwner!=this)return;
  if(updateOpen){updateOpen=false;updateAsked=System.nanoTime();}
  try{if(updateDue&&pastConfirmation(getContext().getPackageManager().getPackageInstaller().getSessionInfo(updateSession),updateConfirm))updateDue=false;}catch(RuntimeException unanswered){/* It opens as kept. */}
  confirmUpdate();
 }
 /** The update download in the cache, deleted once the session has its copy or the download is refused. */
 private java.io.File updateApk(){return new java.io.File(getContext().getCacheDir(),"alpha-update.apk");}
 /**
  * Held by the process's one update attempt, from the start of its work until its session is committed or it
  * fails, by a load sweeping, or by a tap reading updatesCommitted. Static because every bridge (AlphaAssistActivity's beside MainActivity's) shares updateApk().
  */
 private static final java.util.concurrent.atomic.AtomicBoolean updating=new java.util.concurrent.atomic.AtomicBoolean();
 /**
  * Commits in this process that returned, counted before their attempt lets go of updating. A tap that waited on a
  * worker finds updating free once the attempt ahead of it ends; this count says whether that attempt reached Android
  * after the tap was taken, whichever bridge ran it. A failed attempt leaves it, so the tap behind reads Android's list.
  */
 private static final java.util.concurrent.atomic.AtomicInteger updatesCommitted=new java.util.concurrent.atomic.AtomicInteger();
 @Override public void load(){
  super.load();
  // Deletes the download a killed process left (up to UPDATE_MAX_BYTES), never one in flight on another bridge.
  if(updating.compareAndSet(false,true)){updateApk().delete();updating.set(false);}
  androidx.core.content.ContextCompat.registerReceiver(getContext(),updateStatus,new android.content.IntentFilter(UPDATE_STATUS),androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
 }
 /** The connection updateWorker opened last, for handleOnDestroy: interrupting a worker does not stop its socket I/O. */
 private volatile javax.net.ssl.HttpsURLConnection updateActive;
 /** HTTPS only: a redirect never changes protocol, and the network security config refuses cleartext. */
 private javax.net.ssl.HttpsURLConnection updateConnection(String url)throws java.io.IOException{
  javax.net.ssl.HttpsURLConnection connection=(javax.net.ssl.HttpsURLConnection)new java.net.URL(url).openConnection();
  connection.setConnectTimeout(20000);connection.setReadTimeout(60000);connection.setUseCaches(false);
  updateActive=connection;
  return connection;
 }
 /**
  * Software update (Settings; policy in settings-adapter.ts): the one configured manifest, app.config.json
  * updateManifestUrl as BuildConfig. Resolves {manifest} for 200 and {} for 404, which means nothing is
  * published or the release was withdrawn. Anything else rejects; the next start, resume or tap checks again.
  */
 @PluginMethod public void checkForUpdate(PluginCall call){
  PluginWorkers.submit(updateWorker,()->{
   try{
    javax.net.ssl.HttpsURLConnection connection=updateConnection(BuildConfig.ALPHA_UPDATE_MANIFEST_URL);
    try{
     int status=connection.getResponseCode();
     if(status==404){call.resolve(new JSObject());return;}
     if(status!=200)throw new java.io.IOException("Update unavailable");
     try(java.io.InputStream in=connection.getInputStream()){call.resolve(new JSObject().put("manifest",new String(ai.eliza.plugins.agent.connection.ConnectionTransport.readBounded(in,64*1024),java.nio.charset.StandardCharsets.UTF_8)));}
    }finally{connection.disconnect();}
   }catch(Exception unavailable){call.reject("Update unavailable");}
  },()->call.reject("Update unavailable"));
 }
 /**
  * From the owner's Install update tap only. Without Android's install-unknown-apps permission for Alpha,
  * only that Android page opens. Otherwise the HTTPS APK is downloaded to the cache and admitted by size and
  * SHA-256 (copyVerified), then by Android's reading of the archive: this package at exactly the offered
  * versionCode, above the installed one. Android shows its own confirmation and installs only an APK signed
  * like Alpha. Nothing is privileged, silent or in the background; a failure settles quietly. One attempt runs
  * per process: a tap while one runs on another bridge, or that a commit overtook while it waited, changes nothing;
  * queued behind one that failed before its commit, it retries. A session is committed once, by the attempt that staged it. One Android
  * lists as sealed, or unsealed with nothing proving that no commit of it is queued (an intent; a level or build whose AOSP does not order a read
  * of 0 after it; an earlier build's binding; no binding), is never abandoned, replaced or committed again: a tap only opens the confirmation
  * kept from Android's own status, and the session stops fencing only when Android lists it no more, its bound target and
  * signer are what is installed, or, still unsealed and bound, a boot has ended any commit queued for it. Only a failure of this attempt's own before its commit gives up what it staged.
  */
 @PluginMethod public void installUpdate(PluginCall call){
  if(!getContext().getPackageManager().canRequestPackageInstalls()){
   getActivity().runOnUiThread(()->{
    try{getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,android.net.Uri.parse("package:"+getContext().getPackageName())));call.resolve();}
    catch(RuntimeException unavailable){call.reject("Update unavailable");}
   });
   return;
  }
  final String apkUrl=call.getString("apkUrl"),sha256=call.getString("sha256");final long size=call.getData().optLong("sizeBytes"),versionCode=call.getData().optLong("versionCode");
  final int seen=updatesCommitted.get();
  PluginWorkers.submit(updateWorker,()->{
   if(!updating.compareAndSet(false,true)){call.resolve();return;}
   // Read holding updating: an attempt ending between a read and the claim above would otherwise pass unseen.
   if(updatesCommitted.get()!=seen){updating.set(false);call.resolve();return;}
   java.io.File apk=updateApk();
   try{
    try{
     PackageInstaller installer=getContext().getPackageManager().getPackageInstaller();
     // Android's own list is the fence, so no process can lose it: a commit seals the session, and Android drops it at
     // its terminal status, whether or not that status reached Alpha. A commit can wait in Binder, unsealed, past its process's
     // death, and it ends when system_server does, so a bound unsealed session of another boot is clear. In this boot only an
     // exact 0 on a session bound with /intent clears, and only where AOSP orders that read after the intent below: API 29 and 30
     // read it under the writer's lock, 33 to 37 snapshot it under that lock, at every public tag. 31 and 32 (12, 12L) read it under
     // another lock, and a later level is unread, as is a build that is not a release: it reports the level it branched from
     // (CODENAME is REL only on a release). There it fences until the next boot, as does a session an earlier build bound without the mark.
     // An unsealed session with no binding, a part of one, or another target fences like a sealed one, until Android ends it.
     // A bound target already installed, on the signer it names, has nothing left to do, so it fences no more and stays for
     // Android to expire. Any later target, or anything else, is unknown: progress and marks do not say whether an owner's
     // accept is already queued, so no tap commits it, and a lost status stays lost, never a failure.
     PackageInstaller.SessionInfo pending=null;
     for(PackageInstaller.SessionInfo listed:installer.getMySessions()){
      java.util.regex.Matcher binding=updateBinding(listed);
      if(binding!=null&&!listed.isSealed()&&(!binding.group(4).equals(String.valueOf(updateBoot()))||binding.group(5)!=null&&"REL".equals(Build.VERSION.CODENAME)&&(Build.VERSION.SDK_INT<=30||Build.VERSION.SDK_INT>=33&&Build.VERSION.SDK_INT<=37)&&listed.getProgress()==0f))continue;
      if(binding==null||Long.parseLong(binding.group(2))>getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0).getLongVersionCode()){pending=listed;break;}
     }
     if(pending!=null){
      throwIfDestroyed();
      Intent confirm=pending.getSessionId()==updateSession?updateConfirm:null;
      AlphaDevicePlugin owner=updateOwner;
      long asked=updateAsked;
      // A kept confirmation opens again, the one thing a tap does here, unless Android is past asking; for three seconds after
      // Alpha's last exchange with it, which spares a status in flight, a start not yet covering Alpha (Android allows a pause
      // 500 ms) and, usually, an accept not yet listed, which waits for Android's one install thread; while a confirmation may
      // be up behind its owner; and while another bridge owes the one it kept. A start Android dropped frees itself.
      if(confirm!=null&&!pastConfirmation(pending,confirm)&&(asked==0||System.nanoTime()-asked>=java.util.concurrent.TimeUnit.SECONDS.toNanos(3))&&(!updateOpen||owner==null||owner.inFront())&&(!updateDue||owner==this)){updateOwner=this;updateOpen=false;updateDue=true;getActivity().runOnUiThread(()->{if(inFront())confirmUpdate();});}
     }else{
      long deadline=System.nanoTime()+UPDATE_DEADLINE_NANOS;
      javax.net.ssl.HttpsURLConnection connection=updateConnection(apkUrl);
      try{
       if(connection.getResponseCode()!=200)throw new java.io.IOException("Update unavailable");
       try(java.io.InputStream in=connection.getInputStream();java.io.OutputStream out=new java.io.FileOutputStream(apk)){copyVerified(in,out,size,sha256,deadline);}
      }finally{connection.disconnect();}
      // Android would also accept a same-versionCode reinstall; only the offered, newer build of this package goes on.
      android.content.pm.PackageInfo archive=getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(),0);
      if(archive==null||!getContext().getPackageName().equals(archive.packageName)||archive.getLongVersionCode()!=versionCode||versionCode<=BuildConfig.VERSION_CODE)throw new java.io.IOException("Update does not match its manifest");
      throwIfDestroyed();
      String binding="alpha-update://"+getContext().getPackageName()+"/"+versionCode+"/"+sha256+"/"+appSigner(getContext())+"/"+updateBoot()+"/intent";
      if(!UPDATE_BINDING.matcher(binding).matches())throw new java.io.IOException("Update not admitted");
      PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
      params.setAppPackageName(getContext().getPackageName());params.setSize(size);params.setReferrerUri(android.net.Uri.parse(binding));
      int id=installer.createSession(params);
      boolean commitAttempted=false;
      try(PackageInstaller.Session session=installer.openSession(id)){
       try(java.io.OutputStream out=session.openWrite("base.apk",0,size)){java.nio.file.Files.copy(apk.toPath(),out);session.fsync(out);}
       throwIfDestroyed();
       android.content.IntentSender status=android.app.PendingIntent.getBroadcast(getContext(),id,new Intent(UPDATE_STATUS).setPackage(getContext().getPackageName()),android.app.PendingIntent.FLAG_UPDATE_CURRENT|android.app.PendingIntent.FLAG_MUTABLE).getIntentSender();
       // The commit intent. Android holds this before the call returns, so on a level that orders a later read after it (above), a
       // session reading 0 was sent no commit, and it lasts in Android's memory for exactly as long as a queued commit can: no corrupt
       // store to read as clear, and nothing for Alpha to clear. On 12, 12L and code not read the boot in the binding does that work alone.
       session.setStagingProgress(1f);
       // Owned before commit, because Android's status can arrive as soon as commit reaches it. From here nothing proves refusal:
       // a commit can succeed ahead of a lost reply and the close after it can throw, and no exception class means the same on
       // every Android, so the session and its owner stay, and what happened comes from Android's status or list.
       updateOwner=this;updateSession=id;updateConfirm=null;updateDue=false;updateOpen=false;updateAsked=System.nanoTime();
       // A destroy past the last check cannot stop this commit, and a dead owner would keep every live receiver from its status. handleOnDestroy interrupts ahead of reading updateOwner, so one side always sees the other.
       if(Thread.currentThread().isInterrupted())updateOwner=null;
       commitAttempted=true;
       session.commit(status);
       updatesCommitted.incrementAndGet();
      }catch(Exception failed){
       if(!commitAttempted)try{installer.abandonSession(id);}catch(RuntimeException cleanup){failed.addSuppressed(cleanup);}
       throw failed;
      }
     }
    }finally{apk.delete();updating.set(false);}
    call.resolve();
   }catch(Exception unavailable){call.reject("Update unavailable");}
  },()->call.reject("Update unavailable"));
 }
 /** Stops an update download too: disconnect only closes the raw socket, which Android allows on this main thread. A session outlives its owner, for a later tap on any bridge. */
 @Override protected void handleOnDestroy(){diagnosticsWorker.shutdown();updateWorker.shutdownNow();javax.net.ssl.HttpsURLConnection active=updateActive;if(active!=null)active.disconnect();getContext().unregisterReceiver(updateStatus);if(updateOwner==this){updateOwner=null;updateDue=false;updateOpen=false;}super.handleOnDestroy();}
}
