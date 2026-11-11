package ai.alphacompute.alphaphone;

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

/** Device facts, allowlisted settings, explicit bounded text handoffs and verified app self-updates. */
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
  Integer percent=call.getInt("percent");if(percent==null||percent<75||percent>150){call.reject("Text size must be 75 to 150 percent.");return;}
  getActivity().runOnUiThread(()->{
   if(!(getActivity() instanceof MainActivity)||getActivity().isFinishing()||getActivity().isDestroyed()){call.reject("Alpha view is unavailable");return;}
   if(!getContext().getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).edit().putInt("text-scale-percent",percent).commit()){call.reject("Text size could not be saved");return;}
   applyTextScale((MainActivity)getActivity());JSObject out=new JSObject();out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",getBridge().getWebView().getSettings().getTextZoom());call.resolve(out);
  });
 }
 /** Android's "Time to take action" setting applied to a renderer notice timeout; the base when unset or before API 29. */
 @PluginMethod public void recommendedTimeout(PluginCall call){
  Integer base=call.getInt("baseMs");if(base==null||base<1||base>600000){call.reject("Base timeout must be 1 to 600000 ms.");return;}
  int timeout=base;
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q){android.view.accessibility.AccessibilityManager accessibility=getContext().getSystemService(android.view.accessibility.AccessibilityManager.class);if(accessibility!=null)timeout=accessibility.getRecommendedTimeoutMillis(base,android.view.accessibility.AccessibilityManager.FLAG_CONTENT_TEXT|android.view.accessibility.AccessibilityManager.FLAG_CONTENT_CONTROLS);}
  JSObject out=new JSObject();out.put("timeoutMs",timeout);call.resolve(out);
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
  SystemFacts.fact(facts,"appAutomaticUpdates",()->automaticUpdateStatus(context));
  for(java.util.Map.Entry<String,Object> fact:facts.entrySet())out.put(fact.getKey(),fact.getValue());
 }
 /** As HOME, an outside screen gets its own task, as stock launchers do, so HOME does not clear it. Never for a result start. */
 private static Intent handOff(Intent intent){return BuildConfig.IS_LAUNCHER?intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK):intent;}
 @PluginMethod public void openPasswordProvider(PluginCall call) {
  String action=call.getString("action","");
  getActivity().runOnUiThread(()->{
   try {
    Intent target=PasswordProviderSupport.intent(getContext(),action);
    String destination=Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction())?"provider-picker":"external";
    try { getActivity().startActivity(handOff(target)); }
    catch(android.content.ActivityNotFoundException missing) {
     if(!"settings".equals(action)||!Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction()))throw missing;
     getActivity().startActivity(handOff(new Intent(Settings.ACTION_SETTINGS)));destination="system-settings";
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
  // The explicit Settings-home action is separate from the shared specific-page allowlist.
  if("system".equals(page)){
   android.app.Activity activity=getActivity();
   if(activity==null){call.reject("This Android settings page is unavailable");return;}
   activity.runOnUiThread(()->{
    try{activity.startActivity(new Intent(Settings.ACTION_SETTINGS));}
    catch(RuntimeException unavailable){call.reject("This Android settings page is unavailable");return;}
    JSObject out=new JSObject();out.put("status","opened");out.put("page",page);out.put("specific",true);call.resolve(out);
   });
   return;
  }
  if(SystemSettingsPages.actions(page)==null){call.reject("Unsupported settings page");return;}
  getActivity().runOnUiThread(()->{
   // The shared allowlist (SystemSettingsPages); "specific" is false when only the broader fallback opened.
   int opened=SystemSettingsPages.open(page,getContext().getPackageName(),intent->getActivity().startActivity(handOff(intent)));
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
    org.json.JSONArray stored=ai.eliza.plugins.system.crash.CrashLog.read(getContext()).getJSONArray("entries");
    org.json.JSONArray entries=new org.json.JSONArray();
    for(int i=0;i<stored.length();i++){
     org.json.JSONObject row=stored.optJSONObject(i);
     if(row==null||!(row.opt("at") instanceof Number timestamp))continue;
     // Keep the renderer's safe integer contract before the redactor reads a long.
     double at=timestamp.doubleValue();
     if(!Double.isFinite(at)||at!=Math.rint(at)||Math.abs(at)>9_007_199_254_740_991d)continue;
     org.json.JSONObject safe=ai.eliza.plugins.system.crash.CrashLog.redact(row);
     if(safe!=null)entries.put(safe);
    }
    JSObject out=new JSObject();out.put("entries",entries);out.put("exitHistory",Build.VERSION.SDK_INT>=Build.VERSION_CODES.R);call.resolve(out);
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
 static final long UPDATE_MAX_BYTES=2L<<30;
 /** Soft ceiling on one update download, checked only when a read returns: the read timeout bounds only silence, and a trickle never goes silent. A read in flight can outlast it by up to that 60 s timeout unless handleOnDestroy disconnects it first. Fits a 2 GiB APK from about 0.8 Mbit/s, so it ends only a stalled link's trickle. */
 static final long UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.HOURS.toNanos(6);
 /** Only declared-byte mismatches permit cache eviction followed by a new fetch. */
 static final class UpdateMismatch extends java.io.IOException{UpdateMismatch(String message){super(message);}}
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
   total+=count;if(total>sizeBytes)throw new UpdateMismatch("Update larger than declared");
   digest.update(buffer,0,count);out.write(buffer,0,count);
  }
  if(total!=sizeBytes||!hex(digest.digest()).equals(sha256))throw new UpdateMismatch("Update does not match its manifest");
 }

 private static final String UPDATE_STATUS="ai.alphacompute.alphaphone.UPDATE_STATUS";
 /** Self-update without a system dialog is supported from Android 12. Android still decides at commit. */
 static String automaticUpdateStatus(Context context){
  if(Build.VERSION.SDK_INT<31)return "unsupported";
  if(!context.getPackageManager().canRequestPackageInstalls())return "permission-required";
  // Android's default silent-update policy also throttles a first attempt during early boot.
  return android.os.SystemClock.uptimeMillis()<=30_000L?"starting":"supported";
 }
 /** A downloaded automatic update may only replace idle, unlocked Home. The image also hosts calls. */
 private boolean automaticUpdateReady(){
  android.app.Activity activity=getActivity();
  if(!(activity instanceof MainActivity)||((MainActivity)activity).isAssistantSurface()||!shareForeground(activity))return false;
  try{
   if(AlphaImageCapability.verified(getContext())){
    android.telecom.TelecomManager calls=getContext().getSystemService(android.telecom.TelecomManager.class);
    if(calls==null||calls.isInCall())return false;
   }
   return true;
  }catch(SecurityException denied){return false;}
  catch(RuntimeException unknown){return false;}
 }
 /** SHA-256 of the original certificate of Alpha's one signer (apksigner's digest), which key rotation never changes: an update manifest offers an APK only to installs of that signing lineage. */
 static String appSigner(Context context)throws Exception{
  return signingRoot(context.getPackageManager().getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES).signingInfo);
 }
 private static String signingRoot(android.content.pm.SigningInfo signing)throws Exception{
  if(signing==null||signing.hasMultipleSigners())return null;
  android.content.pm.Signature[] history=signing.getSigningCertificateHistory();
  return history==null||history.length==0||history[0]==null?null:hex(java.security.MessageDigest.getInstance("SHA-256").digest(history[0].toByteArray()));
 }
 /**
  * A session's binding: package, versionCode, SHA-256, signer and boot. It is the session's referrer, so it sits in the record Android
  * writes with the seal and goes with the session, and a session comes back from a kill or a reboot with it or not at all (AOSP 10 to 17).
  * A build that states its commit intent ends it with /intent; automatic attempts add /automatic so a later
  * process keeps optional Android confirmation quiet. Earlier bound builds wrote the shape without these marks.
  */
 private static final java.util.regex.Pattern UPDATE_BINDING=java.util.regex.Pattern.compile("alpha-update://([^/]+)/([1-9][0-9]{0,17})/[0-9a-f]{64}/([0-9a-f]{64})/([0-9]+)(/intent)?(/automatic)?");
 /** The session's binding if it reads whole and names this package and signer. Null is unknown: no binding (an earlier build staged it), a part of one, or another target. Unknown fences. */
 private java.util.regex.Matcher updateBinding(PackageInstaller.SessionInfo session)throws Exception{
  java.util.regex.Matcher binding=UPDATE_BINDING.matcher(String.valueOf(session.getReferrerUri()));
  return binding.matches()&&getContext().getPackageName().equals(binding.group(1))&&binding.group(3).equals(appSigner(getContext()))?binding:null;
 }
 /** Moves at every system_server start, ahead of any app (AOSP 10 to 17). Android keeps a session's status receiver in memory only, so no status comes across it. */
 private int updateBoot()throws Settings.SettingNotFoundException{return Settings.Global.getInt(getContext().getContentResolver(),Settings.Global.BOOT_COUNT);}
 /** Native-only durable ownership. Android's session is still the commit fence; this record fences runtime starts. */
 static final class UpdatePause {
  static volatile ai.eliza.plugins.agent.updater.RuntimeUpdatePause journal;
  static volatile Context context;
  static volatile String executingApk;
  static volatile String liveOwner;
  static volatile long shutdownRequest=-1;
  static void configure(Context base){
   // Application.attachBaseContext runs before LoadedApk publishes its Application.
   Context application=base.getApplicationContext();context=application!=null?application:base;
   executingApk=base.getApplicationInfo().sourceDir;
   ai.eliza.plugins.agent.updater.RuntimeUpdatePause.configureStartAdmission(()->{
    try{return activation==null&&store().read()==null;}catch(Exception unavailable){return false;}
   });
   // No record means no APK hashing on ordinary startup. A successor reconciles before providers start.
   try{reconcile();}catch(Exception unavailable){/* Durable uncertainty keeps starts fenced. */}
  }
  static ai.eliza.plugins.agent.updater.RuntimeUpdatePause store()throws Exception {
   if(journal==null)synchronized(UpdatePause.class){if(journal==null)journal=new ai.eliza.plugins.agent.updater.RuntimeUpdatePause(new java.io.File(context.getNoBackupFilesDir(),"app-update-pause").toPath());}
   return journal;
  }
  static String digest(String path)throws Exception {
   java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
   try(java.io.InputStream in=new java.io.FileInputStream(path)){byte[] bytes=new byte[65536];for(int n;(n=in.read(bytes))!=-1;)digest.update(bytes,0,n);}
   return hex(digest.digest());
  }
  static void acquire(String id,int session,long version,String sha,int boot)throws Exception {
   liveOwner=id;
   store().acquire(new ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Record(id,session,boot,BuildConfig.VERSION_CODE,digest(executingApk),version,sha,appSigner(context),false));
  }
  static void stop()throws Exception {
   shutdownRequest=AlphaLocalAgentPlugin.pauseForUpdate(context);
   ElizaAgentService.retryCredentialShutdown(context,shutdownRequest);
   long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
   while(!AlphaLocalAgentPlugin.updateShutdownConfirmed(context,shutdownRequest)){
    if(System.nanoTime()>=deadline)throw new java.io.IOException("Update shutdown unconfirmed");
    Thread.sleep(50);
   }
  }
  static void committing(String id)throws Exception{store().committing(id);}
  static boolean binds(ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Record record,PackageInstaller.SessionInfo session){
   String expected="alpha-update://"+context.getPackageName()+"/"+record.targetCode+"/"+record.targetDigest+"/"+record.signer+"/"+record.boot+"/intent";
   return session!=null&&(expected.equals(String.valueOf(session.getReferrerUri()))||(expected+"/automatic").equals(String.valueOf(session.getReferrerUri())));
  }
  /** Returns only a proven settled owner. It never starts the runtime or retains a provider credential. */
  static synchronized ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Record reconcile()throws Exception {
   var record=store().read();if(record==null||record.id.equals(liveOwner))return null;
   PackageInstaller installer=context.getPackageManager().getPackageInstaller();
   PackageInstaller.SessionInfo session=installer.getSessionInfo(record.session);
   var observation=ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Session.PENDING;
   if(session==null)observation=ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Session.ABSENT;
   else {
    int boot=Settings.Global.getInt(context.getContentResolver(),Settings.Global.BOOT_COUNT);
    // PAUSING was durably written before any commit intent. COMMITTING retains the existing Android ordering proof.
    boolean uncommitted=binds(record,session)&&!session.isSealed()&&(!record.committing||record.boot!=boot||"REL".equals(Build.VERSION.CODENAME)&&(Build.VERSION.SDK_INT<=30||Build.VERSION.SDK_INT>=33&&Build.VERSION.SDK_INT<=37)&&session.getProgress()==0f);
    if(uncommitted)observation=ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Session.PROVEN_UNCOMMITTED;
   }
   // An old process with a pending Android session cannot settle. Its WebViews
   // poll this state while waiting, so do not hash the installed APK each time.
   if(observation==ai.eliza.plugins.agent.updater.RuntimeUpdatePause.Session.PENDING&&BuildConfig.VERSION_CODE!=record.targetCode)return null;
   // A stop that timed out in this process does not become success just because its install was abandoned.
   if(shutdownRequest>=0&&!AlphaLocalAgentPlugin.updateShutdownConfirmed(context,shutdownRequest))return null;
   var installed=context.getPackageManager().getPackageInfo(context.getPackageName(),0);
   if(!record.signer.equals(appSigner(context)))return null;
   if(!store().reconcile(record.id,installed.getLongVersionCode(),digest(context.getApplicationInfo().sourceDir),BuildConfig.VERSION_CODE,digest(executingApk),observation,false))return null;
   if(shutdownRequest>=0){AlphaLocalAgentPlugin.releaseUpdateShutdown(shutdownRequest);shutdownRequest=-1;}
   return record;
  }
 }
 private static final class UpdateActivation {
  final String id=java.util.UUID.randomUUID().toString();
  final AlphaDevicePlugin owner;
  final boolean automatic;
  final java.util.concurrent.CompletableFuture<Boolean> ready=new java.util.concurrent.CompletableFuture<>();
  final java.util.Set<AlphaDevicePlugin> waiting=new java.util.HashSet<>();
  final java.util.Set<AlphaDevicePlugin> acknowledged=new java.util.HashSet<>();
  final java.util.Set<String> resumeEligible=new java.util.HashSet<>();
  boolean sealed,invalid;
  UpdateActivation(AlphaDevicePlugin owner,boolean automatic){this.owner=owner;this.automatic=automatic;waiting.addAll(updateBridges);}
 }
 /** Captured reconnect authority is separate from Android confirmation and keeps no WebView alive. */
 private static final class UpdateResume {
  final String id,initiatingBridge;
  final java.util.Set<String> eligible;
  UpdateResume(UpdateActivation preparation){
   id=preparation.id;initiatingBridge=preparation.owner.updateBridgeId;
   eligible=java.util.Collections.unmodifiableSet(new java.util.HashSet<>(preparation.resumeEligible));
  }
 }
 private static final Object updateBarrier=new Object();
 private static final java.util.Set<AlphaDevicePlugin> updateBridges=new java.util.HashSet<>();
 private final String updateBridgeId=java.util.UUID.randomUUID().toString();
 private static volatile UpdateActivation activation;
 private static UpdateResume updateResume;
 private static String settledActivation,settledOutcome,settledResumeBridge;
 private JSObject preparation(UpdateActivation pending){return new JSObject().put("activationId",pending.id).put("bridgeId",updateBridgeId).put("automatic",pending.automatic).put("phase",pending.sealed?"paused":"preparing");}
 private void registerUpdateBridge(){
  UpdateActivation pending;
  synchronized(updateBarrier){
   updateBridges.add(this);pending=activation;
   if(pending!=null&&!pending.sealed){
    // A completed barrier cannot grow. Its installer must retry preparation;
    // this new page has not proved that it has retained its drafts.
    if(pending.ready.isDone()){pending.invalid=true;}
    else pending.waiting.add(this);
   }
  }
  if(pending!=null)notifyListeners("alphaUpdateReady",preparation(pending));
 }
 private void retireUpdateBridge(){
  synchronized(updateBarrier){
   updateBridges.remove(this);
   if(updateBridgeId.equals(settledResumeBridge))settledResumeBridge=null;
   UpdateActivation pending=activation;
   if(pending!=null&&!pending.sealed){pending.invalid=true;pending.ready.complete(false);}
  }
 }
 /** Acknowledges only the current staged activation; false is a pre-commit refusal, not cancellation of an install. */
 @PluginMethod public void activateUpdate(PluginCall call){
  Object ready=call.getData().opt("ready"),resumeEligible=call.getData().opt("resumeEligible");
  synchronized(updateBarrier){
   UpdateActivation pending=activation;
   if(pending==null||pending.invalid||pending.sealed||!pending.id.equals(call.getString("activationId"))||!updateBridgeId.equals(call.getString("bridgeId"))||!(ready instanceof Boolean)||
     resumeEligible!=null&&!(resumeEligible instanceof Boolean)||Boolean.TRUE.equals(resumeEligible)&&!Boolean.TRUE.equals(ready)||
     !pending.waiting.remove(this)){call.reject("Update preparation changed");return;}
   if(!(Boolean)ready){pending.invalid=true;pending.ready.complete(false);}
   else {
    pending.acknowledged.add(this);
    if(Boolean.TRUE.equals(resumeEligible))pending.resumeEligible.add(updateBridgeId);
    if(pending.waiting.isEmpty())pending.ready.complete(true);
   }
  }
  call.resolve();
 }
 private void settleUpdate(String id,String outcome){
  java.util.List<AlphaDevicePlugin> bridges;
  synchronized(updateBarrier){
   if(id.equals(settledActivation))return;
   settledActivation=id;settledOutcome=outcome;
   settledResumeBridge=null;
   UpdateResume resume=updateResume;
   if(resume!=null&&id.equals(resume.id)){
    updateResume=null;
    if("canceled".equals(outcome)){
     AlphaDevicePlugin confirming=updateOwner;
     if(updateBridges.contains(confirming)&&resume.eligible.contains(confirming.updateBridgeId))settledResumeBridge=confirming.updateBridgeId;
     else if(resume.eligible.contains(resume.initiatingBridge)&&updateBridges.stream().anyMatch(bridge->resume.initiatingBridge.equals(bridge.updateBridgeId)))settledResumeBridge=resume.initiatingBridge;
    }
   }
   if(activation!=null&&activation.id.equals(id))activation=null;
   bridges=new java.util.ArrayList<>(updateBridges);
  }
  for(AlphaDevicePlugin bridge:bridges)bridge.notifyListeners("alphaUpdateSettled",new JSObject().put("activationId",id).put("outcome",outcome));
 }
 private JSObject readUpdateState()throws Exception{
  synchronized(updateBarrier){
   UpdateActivation pending=activation;
   if(pending!=null)return preparation(pending).put("pending",true);
   var record=UpdatePause.store().read();
   JSObject result=new JSObject().put("bridgeId",updateBridgeId).put("pending",record!=null);
   if(record!=null){
    Intent confirm=record.session==updateSession?updateConfirm:null;
    boolean canContinue=false;
    if(record.committing&&confirm!=null&&record.boot==updateBoot()){
     var session=getContext().getPackageManager().getPackageInstaller().getSessionInfo(record.session);
     canContinue=UpdatePause.binds(record,session)&&!pastConfirmation(session,confirm);
    }
    result.put("activationId",record.id).put("phase","paused").put("canContinue",canContinue);
   }
   else{
    result.put("idle",true);
    if(settledActivation!=null)result.put("activationId",settledActivation).put("outcome",settledOutcome).put("resume",updateBridgeId.equals(settledResumeBridge));
   }
   return result;
  }
 }
 /** Startup readback can settle a proven terminal session even if the broadcast was lost. */
 @PluginMethod public void updateState(PluginCall call){
  PluginWorkers.submit(diagnosticsWorker,()->{
   if(activation==null)reconcileUpdate();
   try{call.resolve(readUpdateState());}catch(Exception unavailable){call.reject("Update status unavailable");}
  },()->call.reject("Update status unavailable"));
 }
 private boolean reconcileUpdate(){
  try{var settled=UpdatePause.reconcile();if(settled!=null){settleUpdate(settled.id,BuildConfig.VERSION_CODE==settled.targetCode?"installed":"canceled");return true;}}catch(Exception unavailable){/* Unknown stays paused; no replay. */}
  return false;
 }
 @PluginMethod public void reconcileUpdate(PluginCall call){
  PluginWorkers.submit(updateWorker,()->{reconcileUpdate();try{call.resolve(readUpdateState());}catch(Exception unavailable){call.reject("Update status unavailable");}},()->call.reject("Update status unavailable"));
 }
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
 /** Automatic attempts never open Android's optional confirmation without an explicit Continue/Install tap. */
 private static volatile boolean updateAutomatic;
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
    if(binding!=null&&binding.group(4).equals(String.valueOf(updateBoot()))){updateAutomatic=binding.group(6)!=null;updateOwner=AlphaDevicePlugin.this;updateSession=id;}
   }catch(Exception unanswered){/* Unknown stays fenced. */}
   if(updateOwner!=AlphaDevicePlugin.this||id!=updateSession)return;
   updateDue=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)==PackageInstaller.STATUS_PENDING_USER_ACTION;
   updateConfirm=updateDue?androidx.core.content.IntentCompat.getParcelableExtra(intent,Intent.EXTRA_INTENT,Intent.class):null;
   if(inFront()&&!updateAutomatic)confirmUpdate();
   PluginWorkers.submit(updateWorker,()->reconcileUpdate(),()->{});
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
 /** Reopens only Android's kept confirmation, using the same session and timing fence as the Settings tap. */
 private void reopenUpdateConfirmation(PackageInstaller.SessionInfo pending){
  int id=pending.getSessionId();
  Intent confirm=id==updateSession?updateConfirm:null;
  AlphaDevicePlugin owner=updateOwner;
  long asked=updateAsked;
  // Leave time for a queued accept, an activity not yet covering Alpha, or a status in flight.
  if(confirm!=null&&!pastConfirmation(pending,confirm)&&(asked==0||System.nanoTime()-asked>=java.util.concurrent.TimeUnit.SECONDS.toNanos(3))&&(!updateOpen||owner==null||owner.inFront())&&(!updateDue||owner==null||owner==this)){
   getActivity().runOnUiThread(()->{
    // An accept, a new status, an earlier tap's open (updateAsked moved), another bridge taking the kept confirmation, or a
    // retired bridge can overtake this queued launch. The writes happen here on main so two taps queued ahead of main open once.
    if(updateSession!=id||updateConfirm!=confirm||updateAsked!=asked||updateDue&&updateOwner!=null&&updateOwner!=this||updateWorker.isShutdown()||!inFront())return;
    try{
     var current=getContext().getPackageManager().getPackageInstaller().getSessionInfo(id);
     if(pastConfirmation(current,confirm))return;
    }catch(RuntimeException unavailable){return;}
    updateAutomatic=false;updateOwner=this;updateOpen=false;updateDue=true;
    confirmUpdate();
   });
  }
 }
 /** A newly opened WebView can reach the already-staged update without mounting editors or downloading again. */
 @PluginMethod public void continueUpdate(PluginCall call){
  PluginWorkers.submit(updateWorker,()->{
   if(!updating.compareAndSet(false,true)){call.resolve();return;}
   try{
    var record=UpdatePause.store().read();
    if(record==null||!record.committing||!record.id.equals(call.getString("activationId"))||!updateBridgeId.equals(call.getString("bridgeId"))||record.boot!=updateBoot()||!record.signer.equals(appSigner(getContext())))throw new java.io.IOException("Update confirmation unavailable");
    var pending=getContext().getPackageManager().getPackageInstaller().getSessionInfo(record.session);
    if(!UpdatePause.binds(record,pending))throw new java.io.IOException("Update confirmation unavailable");
    throwIfDestroyed();
    reopenUpdateConfirmation(pending);
    call.resolve();
   }catch(Exception unavailable){call.reject("Update confirmation unavailable");}
   finally{updating.set(false);}
  },()->call.reject("Update confirmation unavailable"));
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
  PluginWorkers.submit(updateWorker,()->reconcileUpdate(),()->{});
  if(updateOwner!=this)return;
  if(updateOpen){updateOpen=false;updateAsked=System.nanoTime();}
  try{if(updateDue&&pastConfirmation(getContext().getPackageManager().getPackageInstaller().getSessionInfo(updateSession),updateConfirm))updateDue=false;}catch(RuntimeException unanswered){/* It opens as kept. */}
  if(!updateAutomatic)confirmUpdate();
 }
 /** One download; only a verified automatic lifecycle deferral may keep it for this process. */
 private java.io.File updateApk(){return new java.io.File(getContext().getCacheDir(),"alpha-update.apk");}
 /** Exact URL/size/digest/version, guarded by updating. This is only a cache hint:
  * every reuse rereads the complete bytes and Android archive/signing metadata. */
 private static String updateVerified;
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
  registerUpdateBridge();
  PluginWorkers.submit(updateWorker,()->reconcileUpdate(),()->{});
  // A process restart has no hint, so its orphan is swept. A sibling bridge may
  // keep this process's deferred verified file, never a file another attempt owns.
  if(updating.compareAndSet(false,true)){if(updateVerified==null||!java.nio.file.Files.isRegularFile(updateApk().toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)){updateVerified=null;updateApk().delete();}updating.set(false);}
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
    reconcileUpdate();
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
  * Manual Install update or an automatic idle-Home attempt. An automatic attempt requires API 31+ and existing
  * install-unknown-apps consent; it never opens the settings page. A manual tap without that consent opens
  * only Android's page. Otherwise the HTTPS APK is downloaded to the cache and admitted by size and
  * SHA-256 (copyVerified), then by Android's reading of the archive: this package at exactly the offered
  * versionCode, above the installed one. API 31+ automatic sessions request USER_ACTION_NOT_REQUIRED through
  * Android's nonprivileged self-update API. Android may still require confirmation; for an automatic session
  * only an explicit Continue/Install tap opens that request. Android installs only an APK signed like Alpha.
  * Both paths retain the draft and resident shutdown barriers; a failure settles quietly. One attempt runs
  * per process: a tap while one runs on another bridge, or that a commit overtook while it waited, changes nothing;
  * queued behind one that failed before its commit, it retries. A session is committed once, by the attempt that staged it. One Android
  * lists as sealed, or unsealed with nothing proving that no commit of it is queued (an intent; a level or build whose AOSP does not order a read
  * of 0 after it; an earlier build's binding; no binding), is never abandoned, replaced or committed again: a tap only opens the confirmation
  * kept from Android's own status, and the session stops fencing only when Android lists it no more, its bound target and
  * signer are what is installed, or, still unsealed and bound, a boot has ended any commit queued for it. Only a failure of this attempt's own before its commit gives up what it staged.
  */
 @PluginMethod public void installUpdate(PluginCall call){
  Object automaticValue=call.getData().opt("automatic");
  if(automaticValue!=null&&!(automaticValue instanceof Boolean)){call.reject("Update request is invalid");return;}
  final boolean automatic=Boolean.TRUE.equals(automaticValue);
  if(automatic){
   String status=automaticUpdateStatus(getContext());
   if(!"supported".equals(status)){call.resolve(new JSObject().put("status",status));return;}
  }
  if(!getContext().getPackageManager().canRequestPackageInstalls()){
   // Consent can be revoked between the automatic capability read and this read.
   // Only an explicit manual request may open Android's settings page.
   if(automatic){call.resolve(new JSObject().put("status","permission-required"));return;}
   getActivity().runOnUiThread(()->{
    try{getActivity().startActivity(handOff(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,android.net.Uri.parse("package:"+getContext().getPackageName()))));call.resolve();}
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
   String cacheKey=apkUrl+"/"+size+"/"+sha256+"/"+versionCode;
   UpdateActivation preparation=null;boolean pauseOwned=false,keepApk=false;
   try{
    try{
     reconcileUpdate();
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
      if(!automatic)reopenUpdateConfirmation(pending);
     }else{
      if(UpdatePause.store().read()!=null)throw new java.io.IOException("Update outcome is pending");
      if(automatic&&!automaticUpdateReady()){keepApk=cacheKey.equals(updateVerified);throw new java.io.IOException("Automatic update deferred");}
      long deadline=System.nanoTime()+UPDATE_DEADLINE_NANOS;
      boolean cached=false;
      if(cacheKey.equals(updateVerified)&&java.nio.file.Files.isRegularFile(apk.toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)){
       try(java.io.InputStream in=java.nio.file.Files.newInputStream(apk.toPath(),java.nio.file.StandardOpenOption.READ,java.nio.file.LinkOption.NOFOLLOW_LINKS)){
        copyVerified(in,new java.io.OutputStream(){@Override public void write(int ignored){} @Override public void write(byte[] ignored,int offset,int length){}},size,sha256,deadline);cached=true;
       }catch(UpdateMismatch invalid){throwIfDestroyed();updateVerified=null;}
      }
      if(!cached){
       updateVerified=null;
       if(java.nio.file.Files.exists(apk.toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)&&!apk.delete())throw new java.io.IOException("Update cache unavailable");
       javax.net.ssl.HttpsURLConnection connection=updateConnection(apkUrl);
       try{
        if(connection.getResponseCode()!=200)throw new java.io.IOException("Update unavailable");
        try(java.io.InputStream in=connection.getInputStream();java.io.OutputStream out=java.nio.file.Files.newOutputStream(apk.toPath(),java.nio.file.StandardOpenOption.CREATE_NEW,java.nio.file.StandardOpenOption.WRITE,java.nio.file.LinkOption.NOFOLLOW_LINKS)){copyVerified(in,out,size,sha256,deadline);}
       }finally{connection.disconnect();}
      }
      // Android would also accept a same-versionCode reinstall; only the offered, newer build of this package goes on.
      android.content.pm.PackageInfo archive=getContext().getPackageManager().getPackageArchiveInfo(
       apk.getPath(),PackageManager.GET_PERMISSIONS|PackageManager.GET_SIGNING_CERTIFICATES);
      if(archive==null||!getContext().getPackageName().equals(archive.packageName)||archive.getLongVersionCode()!=versionCode||versionCode<=BuildConfig.VERSION_CODE)throw new java.io.IOException("Update does not match its manifest");
      String signer=appSigner(getContext());
      // The release verifier requires READ_CONTACTS only in the launcher manifest.
      // Read that existing flavor marker from the APK, independent of the offer.
      if(archive.requestedPermissions==null||
       BuildConfig.IS_LAUNCHER!=java.util.Arrays.asList(archive.requestedPermissions).contains("android.permission.READ_CONTACTS")||
       signer==null||!signer.equals(signingRoot(archive.signingInfo)))
       throw new java.io.IOException("Update does not match this installation");
      throwIfDestroyed();
      String binding="alpha-update://"+getContext().getPackageName()+"/"+versionCode+"/"+sha256+"/"+signer+"/"+updateBoot()+"/intent"+(automatic?"/automatic":"");
      if(!UPDATE_BINDING.matcher(binding).matches())throw new java.io.IOException("Update not admitted");
      updateVerified=cacheKey;
      PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
      params.setAppPackageName(getContext().getPackageName());params.setSize(size);params.setReferrerUri(android.net.Uri.parse(binding));
      if(automatic&&Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
      int id=installer.createSession(params);
      boolean commitAttempted=false;
      try(PackageInstaller.Session session=installer.openSession(id)){
       try(java.io.OutputStream out=session.openWrite("base.apk",0,size)){java.nio.file.Files.copy(apk.toPath(),out);session.fsync(out);}
       throwIfDestroyed();
       if(automatic&&!automaticUpdateReady()){keepApk=true;throw new java.io.IOException("Automatic update deferred");}
       java.util.List<AlphaDevicePlugin> participants;
       synchronized(updateBarrier){preparation=new UpdateActivation(this,automatic);activation=preparation;participants=new java.util.ArrayList<>(updateBridges);}
       for(AlphaDevicePlugin bridge:participants)bridge.notifyListeners("alphaUpdateReady",bridge.preparation(preparation));
       if(!preparation.ready.get(30,java.util.concurrent.TimeUnit.SECONDS))throw new java.io.IOException("Update preparation refused");
       synchronized(updateBarrier){
        if(activation!=preparation||preparation.invalid||!preparation.waiting.isEmpty()||!preparation.acknowledged.containsAll(updateBridges))throw new java.io.IOException("Update renderers changed");
        preparation.sealed=true;
        updateResume=new UpdateResume(preparation);
       }
       throwIfDestroyed();
       pauseOwned=true;UpdatePause.acquire(preparation.id,id,versionCode,sha256,updateBoot());
       UpdatePause.stop();
       throwIfDestroyed();
       if(automatic&&!automaticUpdateReady()){keepApk=true;throw new java.io.IOException("Automatic update deferred");}
       UpdatePause.committing(preparation.id);
       android.content.IntentSender status=android.app.PendingIntent.getBroadcast(getContext(),id,new Intent(UPDATE_STATUS).setPackage(getContext().getPackageName()),android.app.PendingIntent.FLAG_UPDATE_CURRENT|android.app.PendingIntent.FLAG_MUTABLE).getIntentSender();
       // The commit intent. Android holds this before the call returns, so on a level that orders a later read after it (above), a
       // session reading 0 was sent no commit, and it lasts in Android's memory for exactly as long as a queued commit can: no corrupt
       // store to read as clear, and nothing for Alpha to clear. On 12, 12L and code not read the boot in the binding does that work alone.
       session.setStagingProgress(1f);
       // Owned before commit, because Android's status can arrive as soon as commit reaches it. From here nothing proves refusal:
       // a commit can succeed ahead of a lost reply and the close after it can throw, and no exception class means the same on
       // every Android, so the session and its owner stay, and what happened comes from Android's status or list.
       updateAutomatic=automatic;
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
    }finally{
     if(preparation!=null){
      if(preparation.id.equals(UpdatePause.liveOwner))UpdatePause.liveOwner=null;
      if(pauseOwned){boolean settled=reconcileUpdate();try{if(!settled&&UpdatePause.store().read()==null&&UpdatePause.shutdownRequest<0)settleUpdate(preparation.id,"failed");}catch(Exception unknown){/* Failed publication may have persisted. */}}else settleUpdate(preparation.id,"failed");
      // Keep a pre-commit attempt visible until its terminal identity is published.
      // After an uncertain commit the durable journal continues to own the pause.
      synchronized(updateBarrier){if(activation==preparation)activation=null;}
     }
     if(!keepApk){updateVerified=null;apk.delete();}updating.set(false);
    }
    call.resolve();
   }catch(Exception unavailable){call.reject("Update unavailable");}
  },()->call.reject("Update unavailable"));
 }
 /** Stops an update download too: disconnect only closes the raw socket, which Android allows on this main thread. A session outlives its owner, for a later tap on any bridge. */
 @Override protected void handleOnDestroy(){retireUpdateBridge();UpdateActivation pending=activation;if(pending!=null&&pending.owner==this)pending.ready.complete(false);diagnosticsWorker.shutdown();updateWorker.shutdownNow();javax.net.ssl.HttpsURLConnection active=updateActive;if(active!=null)active.disconnect();getContext().unregisterReceiver(updateStatus);if(updateOwner==this){updateOwner=null;updateDue=false;updateOpen=false;}super.handleOnDestroy();}
 // End of updater methods for host replay.
 /** Status and navigation icon colors follow Alpha's drawn theme, not only Android's night mode. */
 @PluginMethod public void setSystemBarAppearance(PluginCall call){
  Boolean dark=call.getBoolean("dark");if(dark==null){call.reject("Choose light or dark.");return;}
  android.app.Activity activity=getActivity();if(activity==null){call.reject("Alpha view is unavailable");return;}
  activity.runOnUiThread(()->{
   if(activity.isFinishing()||activity.isDestroyed()){call.reject("Alpha view is unavailable");return;}
   androidx.core.view.WindowInsetsControllerCompat bars=androidx.core.view.WindowCompat.getInsetsController(activity.getWindow(),activity.getWindow().getDecorView());
   bars.setAppearanceLightStatusBars(!dark);bars.setAppearanceLightNavigationBars(!dark);call.resolve();
  });
 }
}
