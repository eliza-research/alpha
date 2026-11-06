package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Device facts, allowlisted settings, and explicit bounded text handoffs to Android. */
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
  Intent battery=getContext().registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
  if(battery!=null){
   int level=battery.getIntExtra(BatteryManager.EXTRA_LEVEL,-1),scale=battery.getIntExtra(BatteryManager.EXTRA_SCALE,-1);
   if(level>=0&&scale>0)out.put("batteryPercent",Math.max(0,Math.min(100,Math.round(level*100f/scale))));
   int status=battery.getIntExtra(BatteryManager.EXTRA_STATUS,-1);
   out.put("charging",status==BatteryManager.BATTERY_STATUS_CHARGING||status==BatteryManager.BATTERY_STATUS_FULL);
  }
  PowerManager power=(PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
  if(power!=null)out.put("powerSave",power.isPowerSaveMode());
  ConnectivityManager connectivity=(ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
  NetworkCapabilities network=connectivity==null?null:connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
  out.put("wifiActive",network!=null&&network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI));
  out.put("cellularActive",network!=null&&network.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR));
  out.put("internetValidated",network!=null&&network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
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
  systemFacts(getContext(),out);call.resolve(out);
 }
 /** Maps Settings.Global.WIFI_ON: 1 and 2 (kept on in airplane mode) are on, 0 and 3 are off; anything else is unknown. */
 static Boolean wifiSwitch(int value){return value==1||value==2?Boolean.TRUE:value==0||value==3?Boolean.FALSE:null;}
 /** Maps a 0/1 system switch; any other stored value is unknown rather than guessed. */
 static Boolean binarySwitch(int value){return value==1?Boolean.TRUE:value==0?Boolean.FALSE:null;}
 /** Maps BluetoothAdapter.getState(): only settled on and off are facts; turning on or off is unknown. */
 static Boolean adapterSwitch(int state){return state==android.bluetooth.BluetoothAdapter.STATE_ON?Boolean.TRUE:state==android.bluetooth.BluetoothAdapter.STATE_OFF?Boolean.FALSE:null;}
 static String interruptionName(int filter){return filter==NotificationManager.INTERRUPTION_FILTER_ALL?"all":filter==NotificationManager.INTERRUPTION_FILTER_PRIORITY?"priority":filter==NotificationManager.INTERRUPTION_FILTER_ALARMS?"alarms":filter==NotificationManager.INTERRUPTION_FILTER_NONE?"none":null;}
 private interface Fact {Object read()throws Exception;}
 private static void fact(JSObject out,String key,Fact source){try{Object value=source.read();if(value!=null)out.put(key,value);}catch(Exception unreadable){/* Omitted: the renderer shows this setting as unknown. */}}
 /**
  * System switch states an ordinary app may read without a permission Alpha does not hold. Each
  * fact is added only when Android answers; a missing key means unknown, never off. Alpha cannot
  * change any of these, so the renderer only shows them and hands off to Android Settings.
  */
 static void systemFacts(Context context,JSObject out){
  android.content.ContentResolver resolver=context.getContentResolver();
  fact(out,"wifiEnabled",()->wifiSwitch(Settings.Global.getInt(resolver,Settings.Global.WIFI_ON)));
  // The adapter state is what the radio is doing now and needs no permission from Android 12. The
  // stored switch is the owner's last choice, which airplane mode can override, and is used only
  // on older releases, where the adapter read needs a permission Alpha does not hold.
  fact(out,"bluetoothEnabled",()->{
   if(Build.VERSION.SDK_INT<Build.VERSION_CODES.S)return binarySwitch(Settings.Global.getInt(resolver,Settings.Global.BLUETOOTH_ON));
   android.bluetooth.BluetoothManager manager=context.getSystemService(android.bluetooth.BluetoothManager.class);
   android.bluetooth.BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
   return adapter==null?null:adapterSwitch(adapter.getState());
  });
  fact(out,"airplaneMode",()->binarySwitch(Settings.Global.getInt(resolver,Settings.Global.AIRPLANE_MODE_ON)));
  fact(out,"locationEnabled",()->{android.location.LocationManager location=context.getSystemService(android.location.LocationManager.class);return location==null?null:location.isLocationEnabled();});
  fact(out,"mobileDataEnabled",()->{
   if(!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY))return null;
   android.telephony.TelephonyManager telephony=context.getSystemService(android.telephony.TelephonyManager.class);
   if(telephony==null||telephony.getSimState()!=android.telephony.TelephonyManager.SIM_STATE_READY)return null;
   // Readable with the ACCESS_NETWORK_STATE install-time permission; a refusal means unknown, never off.
   if(context.checkSelfPermission(android.Manifest.permission.ACCESS_NETWORK_STATE)!=PackageManager.PERMISSION_GRANTED)return null;
   try{return telephony.isDataEnabled();}catch(SecurityException refused){return null;}
  });
  fact(out,"interruptionFilter",()->{NotificationManager manager=context.getSystemService(NotificationManager.class);return manager==null?null:interruptionName(manager.getCurrentInterruptionFilter());});
  fact(out,"adaptiveBrightness",()->{int mode=Settings.System.getInt(resolver,Settings.System.SCREEN_BRIGHTNESS_MODE);return mode==Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC?Boolean.TRUE:mode==Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL?Boolean.FALSE:null;});
  fact(out,"appVersionCode",()->BuildConfig.VERSION_CODE);
  fact(out,"appUpdatedAt",()->{long at=context.getPackageManager().getPackageInfo(context.getPackageName(),0).lastUpdateTime;return at>0?at:null;});
 }
 /** Android pages tried in order for one allowlisted name; the first that opens wins. */
 static String[] settingsActions(String page){
  switch(page){
   // Android's own Settings home: radios, sound, battery and display live there, not in Alpha.
   case "system":return new String[]{Settings.ACTION_SETTINGS};
   case "accounts":return new String[]{Settings.ACTION_SYNC_SETTINGS};
   case "wifi":return new String[]{Settings.ACTION_WIFI_SETTINGS};
   case "bluetooth":return new String[]{Settings.ACTION_BLUETOOTH_SETTINGS};
   // The mobile network page; images without it fall back to Network & internet.
   case "mobile":return new String[]{Settings.ACTION_DATA_ROAMING_SETTINGS,Settings.ACTION_WIRELESS_SETTINGS};
   case "airplane":return new String[]{Settings.ACTION_AIRPLANE_MODE_SETTINGS,Settings.ACTION_WIRELESS_SETTINGS};
   case "location":return new String[]{Settings.ACTION_LOCATION_SOURCE_SETTINGS};
   case "display":return new String[]{Settings.ACTION_DISPLAY_SETTINGS};
   case "sound":return new String[]{Settings.ACTION_SOUND_SETTINGS};
   case "battery":return new String[]{Settings.ACTION_BATTERY_SAVER_SETTINGS};
   case "about":return new String[]{Settings.ACTION_DEVICE_INFO_SETTINGS};
   case "developer":return new String[]{Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS};
   case "notifications":return new String[]{Settings.ACTION_APP_NOTIFICATION_SETTINGS};
   case "privacy":return new String[]{Settings.ACTION_APPLICATION_DETAILS_SETTINGS};
   case "default-apps":return new String[]{Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS};
   // Do not disturb: the platform Zen mode page, then the public priority-mode page.
   case "dnd":return new String[]{"android.settings.ZEN_MODE_SETTINGS",Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS};
   default:return null;
  }
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
   if(activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())out.put("status","not-in-front");
   else out.put("status",SystemShade.expand(getContext(),BuildConfig.IS_LAUNCHER));
   call.resolve(out);
  });
 }
 @PluginMethod public void openSettings(PluginCall call) {
  String page=call.getString("page","");String[] actions=settingsActions(page);
  if(actions==null){call.reject("Unsupported settings page");return;}
  getActivity().runOnUiThread(()->{
   for(int index=0;index<actions.length;index++){
    Intent intent=new Intent(actions[index]);
    if(page.equals("privacy"))intent.setData(Uri.parse("package:"+getContext().getPackageName()));
    if(page.equals("notifications"))intent.putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());
    // "specific" is false when only the broader fallback page opened; the renderer says so.
    try{getActivity().startActivity(intent);JSObject out=new JSObject();out.put("status","opened");out.put("page",page);out.put("specific",index==0);call.resolve(out);return;}
    catch(RuntimeException unavailable){/* Try the next allowlisted page. */}
   }
   call.reject("This Android settings page is unavailable");
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
 /** Local problem log: failure classes only, never messages, stacks or content. */
 @PluginMethod public void crashLog(PluginCall call){
  diagnostics(call,()->{
   try{
    try{AlphaCrashLog.collectExitReasons(getContext());}catch(Exception unavailable){/* Exit history is best effort. */}
    JSObject out=new JSObject();out.put("entries",AlphaCrashLog.read(getContext()).getJSONArray("entries"));out.put("exitHistory",Build.VERSION.SDK_INT>=Build.VERSION_CODES.R);call.resolve(out);
   }catch(Exception error){call.reject("Problem log is unavailable");}
  });
 }
 @PluginMethod public void recordRendererFailure(PluginCall call){
  diagnostics(call,()->{try{AlphaCrashLog.recordRenderer(getContext(),call.getString("kind"),call.getString("errorClass"));call.resolve();}catch(Exception error){call.reject("Problem was not recorded");}});
 }
 @PluginMethod public void clearCrashLog(PluginCall call){
  diagnostics(call,()->{try{AlphaCrashLog.clear(getContext());call.resolve();}catch(Exception error){call.reject("Problem log could not be cleared");}});
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
   StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b));return hex.toString();
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
 @Override protected void handleOnDestroy(){diagnosticsWorker.shutdown();super.handleOnDestroy();}
}
