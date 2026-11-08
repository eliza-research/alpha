package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import android.net.Uri;
import android.os.Build;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONTokener;

/** First-party renderer transport and encrypted storage. Never injected into browser pages. */
@CapacitorPlugin(name = "AlphaConnection")
public final class AlphaConnectionPlugin extends Plugin {
 private volatile Uri delegationCallback;
 private final Object foregroundLock=new Object();
 private boolean foreground;
 @Override public void load() { super.load(); synchronized(foregroundLock){foreground=getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)||getActivity().hasWindowFocus();}captureDelegationCallback(getActivity().getIntent());captureGoogleReturn(getActivity().getIntent()); }
 @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); captureDelegationCallback(intent); captureGoogleReturn(intent); }
 /**
  * Google connector return on the verified App Link. MainActivity is singleTask, so this intent also
  * finishes the Custom Tab that showed Google's consent. The result names no secret; the renderer
  * reads the grant back from Cloud.
  */
 private void captureGoogleReturn(Intent intent) {
  Uri uri = intent == null ? null : intent.getData();
  if (uri == null || !"https".equals(uri.getScheme()) || BuildConfig.ELIZAOS_APP_LINK_HOST.isEmpty() || !BuildConfig.ELIZAOS_APP_LINK_HOST.equals(uri.getHost())
   || uri.getPort() != -1 || uri.getUserInfo() != null || !GoogleConnectReturn.PATH.equals(uri.getPath())) return;
  java.util.Map<String, String> result = GoogleConnectReturn.parse(uri.getEncodedQuery(), uri.getEncodedFragment());
  intent.setData(null);
  if (result == null) return;
  JSObject out = new JSObject();
  for (java.util.Map.Entry<String, String> entry : result.entrySet()) out.put(entry.getKey(), entry.getValue());
  notifyListeners("googleConnectReturn", out, true);
 }
 /** The return URL Cloud may redirect to, only when Android will hand it to Alpha; otherwise null. */
 @PluginMethod public void googleReturnUrl(PluginCall call) {
  JSObject out = new JSObject();
  String host = BuildConfig.ELIZAOS_APP_LINK_HOST;
  String url = host.isEmpty() ? null : "https://" + host + GoogleConnectReturn.PATH;
  out.put("url", url != null && appLinkHandled(host, url) ? url : JSONObject.NULL);
  call.resolve(out);
 }
 private boolean appLinkHandled(String host, String url) {
  try {
   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    DomainVerificationManager manager = getContext().getSystemService(DomainVerificationManager.class);
    DomainVerificationUserState state = manager == null ? null : manager.getDomainVerificationUserState(getContext().getPackageName());
    Integer verified = state == null ? null : state.getHostToStateMap().get(host);
    if (state == null || !state.isLinkHandlingAllowed() || verified == null
     || (verified != DomainVerificationUserState.DOMAIN_STATE_VERIFIED && verified != DomainVerificationUserState.DOMAIN_STATE_SELECTED)) return false;
   }
   Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(getContext().getPackageName());
   return !getContext().getPackageManager().queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
  } catch (Exception unavailable) { return false; }
 }
 /** Google's consent opens in a Custom Tab on Alpha's task (an App Link return closes it); other pages in the browser. */
 private void startBrowser(URI url, Intent fallback) {
  if ("accounts.google.com".equals(url.getHost())) {
   try {
    String browser = CustomTabsClient.getPackageName(getContext(), null);
    if (browser != null && !browser.equals(getContext().getPackageName())) {
     CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).setShareState(CustomTabsIntent.SHARE_STATE_OFF).build();
     tab.intent.setPackage(browser);
     tab.launchUrl(getActivity(), Uri.parse(url.toASCIIString()));
     return;
    }
   } catch (RuntimeException unavailable) { /* Fall back to the system browser. */ }
  }
  getActivity().startActivity(fallback);
 }
 private void captureDelegationCallback(Intent intent) {
  Uri uri = intent == null ? null : intent.getData();
  if(uri==null || !"alphaphone".equals(uri.getScheme()) || !"cloud-delegation".equals(uri.getHost()) || uri.getPort()!=-1 || uri.getUserInfo()!=null || uri.getFragment()!=null || (uri.getPath()!=null&&!uri.getPath().isEmpty()&&!"/".equals(uri.getPath())))return;
  try {
   Set<String> names=uri.getQueryParameterNames();
   if(!names.equals(Set.of("state","code"))&&!names.equals(Set.of("state","error")))return;
   for(String name:names)if(uri.getQueryParameters(name).size()!=1)return;
   String state=uri.getQueryParameter("state");
   if(state==null||!state.matches("[A-Za-z0-9_-]{43}"))return;
   if(names.contains("code"))required(uri.getQueryParameter("code"),4096);
   getActivity().setIntent(intent);delegationCallback=uri;notifyListeners("cloudDelegationCallback",new JSObject(),true);
  }catch(Exception ignored){ /* Invalid unsolicited links never enter the authentication flow. */ }
 }
 @PluginMethod public void readDelegationCallback(PluginCall call) {
  JSObject out=new JSObject();Uri uri=delegationCallback;
  if(uri==null){out.put("callback",JSONObject.NULL);call.resolve(out);return;}
  JSObject value=new JSObject();value.put("state",uri.getQueryParameter("state"));
  if(uri.getQueryParameter("code")!=null)value.put("code",uri.getQueryParameter("code"));else value.put("error","access_denied");
  out.put("callback",value);call.resolve(out);
 }
 @PluginMethod public void clearDelegationCallback(PluginCall call) {
  String state=call.getString("state");Uri uri=delegationCallback;
  if(uri!=null&&state!=null&&state.equals(uri.getQueryParameter("state"))){delegationCallback=null;Intent intent=getActivity().getIntent();if(intent!=null&&uri.equals(intent.getData()))intent.setData(null);}
  call.resolve();
 }

 private static final int RESPONSE_LIMIT = 2 * 1024 * 1024;
 private final ExecutorService workers = Executors.newFixedThreadPool(4);
 private final SerialStorageTasks storageTasks = new SerialStorageTasks();
 private volatile boolean destroyed;
 private final ConcurrentHashMap<String, Pending> requests = new ConcurrentHashMap<>();
 /** Bridge messages already queued during Activity teardown can arrive after shutdown. */
 private boolean submit(PluginCall call,Runnable task) {
  if(destroyed){call.reject("Connection closed");return false;}
  return PluginWorkers.submit(workers,task,()->call.reject("Connection closed"));
 }
 private boolean submitStorage(PluginCall call,Runnable task) {
  return storageTasks.submit(()->{if(destroyed)call.reject("Connection closed");else task.run();},()->call.reject("Connection closed"));
 }
 private static final class Pending {
  volatile boolean cancelled;
  volatile HttpURLConnection connection;
  volatile PluginCall browserCall;
  volatile boolean browserLaunched,browserPaused;
  synchronized void cancel() { cancelled = true; HttpURLConnection current = connection; if (current != null) current.disconnect(); if(browserCall!=null){PluginCall call=browserCall;browserCall=null;call.reject("Request cancelled");} }
  synchronized void paused(){if(browserCall!=null&&browserLaunched)browserPaused=true;}
  synchronized boolean returned(){if(browserCall==null||!browserPaused||cancelled)return false;PluginCall call=browserCall;browserCall=null;call.resolve();return true;}
  synchronized void launch(Runnable action){if(cancelled||browserCall==null)return;browserLaunched=true;try{action.run();}catch(RuntimeException unavailable){PluginCall call=browserCall;browserCall=null;call.reject("Authentication browser unavailable");}}

 }
 private static String required(String value, int max) {
  if (value == null || value.isEmpty() || value.length() > max) throw new IllegalArgumentException();
  return value;
 }
 private static Object parseJson(String value) throws Exception {
  JSONTokener parser = new JSONTokener(value);
  Object parsed = parser.nextValue();
  if (parser.nextClean() != 0) throw new IllegalArgumentException();
  return parsed;
 }
 /** Stable error code for a definite refusal above a slot's byte cap; nothing was written. */
 static final String STORAGE_FULL="storage-full";
 static final String STORAGE_FULL_MESSAGE="Secure storage is full. Nothing was written.";
 /** Serialized JSON metadata cannot supply native identity or bypass runtime retirement. */
 @PluginMethod public void secureWrite(PluginCall call) {
  final String name;final long intent;
  try{name=RendererCredentialSlots.requireAllowed(call.getString("slot"));intent=credentialIntent(name);}
  catch(Exception invalid){call.reject("Secure storage write failed");return;}
  submitStorage(call,() -> {
   try {
    storage(intent).writeCredentialSlot(name,call.getString("value"));
    call.resolve();
   } catch (AlphaCredentialStore.StorageFullException full) { call.reject(STORAGE_FULL_MESSAGE, STORAGE_FULL); }
   catch (Exception error) { call.reject("Secure storage write failed"); }
  });
 }
 private long credentialIntent(String name){
  if("cloud:production".equals(name)||"cloud:staging".equals(name))return AlphaLocalAgentPlugin.reserveCredentialIntent(foregroundLock,()->{if(destroyed)throw new IllegalStateException("Connection closed");});
  synchronized(foregroundLock){if(destroyed)throw new IllegalStateException("Connection closed");return 0;}
 }
 private AlphaCredentialStore storage(long intent){
  return new AlphaCredentialStore(getContext(),()->{if(destroyed)throw new IllegalStateException("Connection closed");if(intent!=0)AlphaLocalAgentPlugin.requireCredentialIntent(intent);});
 }
 private AlphaCredentialStore storage(){return new AlphaCredentialStore(getContext(),()->{if(destroyed)throw new IllegalStateException("Connection closed");});}
 void writeCredentialSlot(String name,String value)throws Exception{storage().writeCredentialSlot(name,value);}
 String readCredentialSlot(String name)throws Exception{return storage().readCredentialSlot(name);}
 /** The native Calendar sync consent (renderer-inaccessible); read only for a sync write. */
 private String calendarSyncConsent()throws Exception{return readCredentialSlot(CalendarSyncBridge.SLOT);}
 void removeCredentialSlot(String name)throws Exception{storage().removeCredentialSlot(name);}
 /** Required before rendering or persisting mock mode; never resumes automatically. */
 @PluginMethod public void pauseNotificationCollection(PluginCall call) {
  submit(call,()->{try{NotificationAccess.pause(getContext(),true);call.resolve();}catch(Exception failure){call.reject("Notification collection could not be paused");}});
 }
 @PluginMethod public void secureRead(PluginCall call) {
  submitStorage(call,()->{
   try{String value=readCredentialSlot(RendererCredentialSlots.requireAllowed(call.getString("slot")));JSObject result=new JSObject();result.put("value",value==null?JSONObject.NULL:value);call.resolve(result);}
   catch(Exception error){call.reject("Secure storage read failed");}
  });
 }
 /** Compare-and-exchange is scoped to local drafts and pending device actions, never credential slots. */
 @PluginMethod public void secureCompareExchange(PluginCall call) {
  submitStorage(call,()->{
   try {
    String name=RendererCredentialSlots.requireAllowed(call.getString("slot"));
    if(name==null||!(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}")||name.matches("calendar-linked-sync:v1:[a-f0-9]{64}")||name.matches("connected-read-cache:v1:[a-f0-9]{64}")||name.matches("google-calendar-outbox:v1:[a-f0-9]{64}")||name.matches("workflow-draft:v1:[a-f0-9]{64}")||name.matches("assistant-draft:v1:[a-f0-9]{64}")||name.equals("notes-records:v1:device")||name.equals("reminder-deletions:v1:device")||name.equals("reminder-creations:v1:device")||name.equals("clock-handoff:v1:device")||name.equals("notes-audio-deletions:v1:device")||name.equals("notes-trash:v1:device")||name.equals(AlphaCredentialStore.NOTES_DRAFT)||name.equals("note-origins:v1:device")||name.matches("cloud-delegation:v1:[a-f0-9]{64}"))||!call.getData().has("expectedValue")||!call.getData().has("value"))throw new IllegalArgumentException();
    for(String field:new String[]{"expectedValue","value"})if(!call.getData().isNull(field)&&!(call.getData().get(field) instanceof String))throw new IllegalArgumentException();
    String expected=call.getString("expectedValue"), value=call.getString("value");
    JSObject result=new JSObject();
    result.put("status",storage().compareExchangeCredentialSlot(name,expected,value)?"saved":"conflict");call.resolve(result);
   }catch(AlphaCredentialStore.StorageFullException full){call.reject(STORAGE_FULL_MESSAGE,STORAGE_FULL);}
   catch(Exception error){call.reject("Secure draft update failed");}
  });
 }
 @PluginMethod public void secureRemove(PluginCall call) {
  final String name;final long intent;
  try{name=RendererCredentialSlots.requireAllowed(call.getString("slot"));intent=credentialIntent(name);}
  catch(Exception invalid){call.reject("Secure storage removal failed");return;}
  submitStorage(call,() -> {
   try {
    storage(intent).removeCredentialSlot(name);
    call.resolve();
   } catch (Exception error) { call.reject("Secure storage removal failed"); }
  });
 }
 private static URI validatedUrl(String text, boolean allowDevelopment) throws Exception {
  URI url = new URI(required(text, 16384));
  String host = url.getHost(), scheme = url.getScheme();
  if (host == null || url.getRawUserInfo() != null || url.getRawFragment() != null || url.getPort() == 0 || url.getPort() > 65535) throw new IllegalArgumentException();
  boolean development = allowDevelopment && BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS && "http".equals(scheme)
    && ("127.0.0.1".equals(host) || "10.0.2.2".equals(host));
  if (!"https".equals(scheme) && !development) throw new IllegalArgumentException();
  return url;
 }
 private static byte[] readBounded(InputStream input, int limit) throws Exception {
  if (input == null) return new byte[0];
  ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
  while ((count = input.read(buffer)) != -1) {
   if (output.size() + count > limit) throw new IllegalArgumentException();
   output.write(buffer, 0, count);
  }
  return output.toByteArray();
 }
 /** Native-owned read routes; URLs and credentials never come from Calendar renderer calls. */
 static JSONObject readCloudIdentity(String token)throws Exception {
  JSONObject response=readCloudObject(token,"/api/v1/user");
  if(!Boolean.TRUE.equals(response.opt("success")))throw new SecurityException("Cloud identity unavailable");
  return LocalAgentProviderAdmission.verifiedCloudIdentity(response.getJSONObject("data"));
 }
 static JSONObject readCalendarSyncCapabilities(String token,String grant,String calendar)throws Exception {
  if(!java.util.UUID.fromString(grant).toString().equalsIgnoreCase(grant)||calendar==null||calendar.isEmpty()||calendar.length()>1024||calendar.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException();
  JSONObject response=readCloudObject(token,"/api/v1/eliza/google/calendar/sync-v1/capabilities?grantId="+java.net.URLEncoder.encode(grant,"UTF-8")+"&calendarId="+java.net.URLEncoder.encode(calendar,"UTF-8"));
  return response;
 }
 private static JSONObject readCloudObject(String token,String path)throws Exception {
  if(!AlphaLocalAgentPlugin.validProviderToken(token,16384))throw new IllegalArgumentException();
  HttpURLConnection connection=(HttpURLConnection)validatedUrl(CloudDeployment.PRODUCTION_API+path,false).toURL().openConnection();
  try{
   connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
   connection.setConnectTimeout(20000);connection.setReadTimeout(20000);connection.setRequestMethod("GET");
   connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+token);
   int status=connection.getResponseCode();if(status!=200)throw new LocalAgentProviderAdmission.CloudReadFailure(status);if(connection.getContentLengthLong()>RESPONSE_LIMIT)throw new SecurityException("Cloud read unavailable");
   byte[] bytes;try(InputStream input=connection.getInputStream()){bytes=readBounded(input,RESPONSE_LIMIT);}
   return (JSONObject)parseJson(new String(bytes,StandardCharsets.UTF_8));
  }finally{connection.disconnect();}
 }
 static boolean validDeviceCapabilities(String value) {
  if(value==null||value.contains("\r")||value.contains("\n"))return false;
  Set<String> allowed=Set.of("calendar.local-event.v1","calendar.create.v1","calendar.next-read.v1","notes.local-record.v1","notes.query.v1","reminders.local-record.v1","reminders.local-record.v2","reminders.create.v1","maps.selected-read.v1","clock.handoff.v1","clock.handoff.v2");
  String[] parts=value.split(",",-1);if(parts.length<1||parts.length>allowed.size())return false;
  java.util.HashSet<String> seen=new java.util.HashSet<>();
  for(String part:parts){String token=part.trim();if(!allowed.contains(token)||!seen.add(token))return false;}
  if(seen.contains("reminders.local-record.v1")&&seen.contains("reminders.local-record.v2"))return false;
  return true;
 }
 private enum RequestOperation { CLI_CREATE, CLI_POLL, IDENTITY, BILLING_LIMITS, ENTITLEMENT, ENTITLEMENT_KEYS, REDEEM, OTHER }
 private enum RequestStage { VALIDATE, CONNECT, WRITE, STATUS, READ, PARSE, RESOLVE }
 /** Never include exception messages, request identifiers or transport data in diagnostics. */
 private static String debugRequestFailure(RequestOperation operation,RequestStage stage,int status,Exception error) {
  if(!BuildConfig.DEBUG)return null;
  String code="ALPHA_TRANSPORT:"+operation+":"+stage+":"+status+":"+error.getClass().getName();
  android.util.Log.d("AlphaConnection",code);
  return code;
 }
 @PluginMethod public void request(PluginCall call) {
  final String id;
  try { id = required(call.getString("requestId"), 256); }
  catch (Exception error) { call.reject("Invalid request"); return; }
  Pending pending = new Pending();
  if (requests.putIfAbsent(id, pending) != null) { call.reject("Request already active"); return; }
  if(!submit(call,() -> {
   HttpURLConnection connection = null;
   RequestOperation operation=RequestOperation.OTHER;
   RequestStage stage=RequestStage.VALIDATE;
   int status=-1;
   try {
    if (pending.cancelled) throw new IllegalStateException();
    URI url = validatedUrl(call.getString("url"), true);
    // Before any route, header or body handling: a flag-off build contacts only Eliza Cloud here.
    if(!ConnectionRoutes.admittedOrigin(url.getScheme(),url.getHost(),url.getPort(),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))throw new IllegalArgumentException();
    {
     String path=url.getPath();
     if("/api/auth/cli-session".equals(path))operation=RequestOperation.CLI_CREATE;
     else if(path!=null&&path.matches("/api/auth/cli-session/[0-9a-fA-F-]{36}"))operation=RequestOperation.CLI_POLL;
     else if("/api/v1/user".equals(path))operation=RequestOperation.IDENTITY;
     else if("/api/v1/billing/limits".equals(path))operation=RequestOperation.BILLING_LIMITS;
     else if("/api/v1/subscription/entitlement".equals(path))operation=RequestOperation.ENTITLEMENT;
     else if("/api/v1/subscription/entitlement-keys".equals(path))operation=RequestOperation.ENTITLEMENT_KEYS;
     else if("/api/v1/subscription/redeem".equals(path))operation=RequestOperation.REDEEM;
    }
    int responseLimit=url.getPath().startsWith("/api/v1/eliza/google/gmail/inbox-v1/")?8*1024*1024:RESPONSE_LIMIT;
    String method = call.getString("method", "GET");
    if(!ConnectionRoutes.managedService(url.getRawPath(),url.getRawQuery(),method,call.getString("body")!=null,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))throw new IllegalArgumentException();
    // Google Calendar writes need the native sync consent; the renderer's preference alone is not enough.
    if(CalendarSyncConsent.write(url.getRawPath(),method)&&!CalendarSyncConsent.admits(url.getRawPath(),url.getRawQuery(),method,call.getString("body"),calendarSyncConsent()))throw new IllegalArgumentException();
    String route=url.getRawPath()+(url.getRawQuery()==null?"":"?"+url.getRawQuery());
    if(ConnectionRoutes.retiredPairing(url.getPath(),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))throw new IllegalArgumentException();
    boolean selfRevocation=ConnectionRoutes.cloudSelfRevocation(url.getScheme(),url.getHost(),url.getPort(),url.getRawPath(),url.getRawQuery(),method,call.getString("body")!=null,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
    if((AutomationsRoutes.owns(url.getPath())||AutomationsRoutes.owns(route))?!AutomationsRoutes.allowed(route,method):!(Set.of("GET","POST").contains(method)||selfRevocation||ConnectionRoutes.calendarSync(url.getPath(),url.getRawQuery(),method,call.getString("body")!=null)||ConnectionRoutes.googleCalendarEvents(url.getRawPath(),url.getRawQuery(),method,call.getString("body")!=null)))throw new IllegalArgumentException();
    if("GET".equals(method)&&(CloudDeployment.PRODUCTION_API_HOST.equals(url.getHost())||CloudDeployment.STAGING_API_HOST.equals(url.getHost()))&&url.getPath().matches("/api/auth/cli-session/[0-9a-fA-F-]{36}")){
     // Gate only future dispatch. A claim already sent must finish and may be saved while backgrounded.
     long expiresAt=call.getLong("expiresAt",System.currentTimeMillis()+30000);
     synchronized(foregroundLock){
      while(!foreground&&!pending.cancelled&&!destroyed){long remaining=expiresAt-System.currentTimeMillis();if(remaining<=0)throw new java.net.SocketTimeoutException();foregroundLock.wait(remaining);}
      if(pending.cancelled||destroyed)throw new IllegalStateException();
      if(System.currentTimeMillis()>=expiresAt)throw new java.net.SocketTimeoutException();
     }
    }
    stage=RequestStage.CONNECT;
    connection = (HttpURLConnection) url.toURL().openConnection(); pending.connection = connection;
    connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(operation==RequestOperation.CLI_POLL?30000:120000);
    connection.setUseCaches(false); connection.setRequestMethod(method);
    stage=RequestStage.VALIDATE;
    JSObject headers = call.getObject("headers", new JSObject());
    Iterator<String> names = headers.keys();
    while (names.hasNext()) {
     String name = names.next(), normalized = name.toLowerCase(Locale.ROOT);
     Object raw = headers.get(name); if (!(raw instanceof String)) throw new IllegalArgumentException();
     String value = (String) raw;
     if (!ConnectionRoutes.admittedHeader(normalized, BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)&&!ConnectionRoutes.mapsRequestIdentity(normalized,value,url.getRawPath(),method)) throw new IllegalArgumentException();
     if (value.length() > 16384 || value.contains("\r") || value.contains("\n")) throw new IllegalArgumentException();
     if ("x-eliza-device-capabilities".equals(normalized) && !validDeviceCapabilities(value)) throw new IllegalArgumentException();
     if ("x-eliza-phone-protocol".equals(normalized) && !"1".equals(value)) throw new IllegalArgumentException();
     connection.setRequestProperty(name, value);
    }
    String body = call.getString("body");
    if (body != null) {
     if (!("POST".equals(method)||"PUT".equals(method)&&AutomationsRoutes.allowed(route,method)||"PATCH".equals(method)&&(ConnectionRoutes.calendarSync(url.getPath(),url.getRawQuery(),method,true)||ConnectionRoutes.googleCalendarEvents(url.getRawPath(),url.getRawQuery(),method,true)))) throw new IllegalArgumentException();
     byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
     if (encoded.length > responseLimit) throw new IllegalArgumentException();
     parseJson(body); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(encoded.length);
     if (pending.cancelled) throw new IllegalStateException();
     stage=RequestStage.WRITE;
     try (java.io.OutputStream output = connection.getOutputStream()) { output.write(encoded); }
    }
    if (pending.cancelled) throw new IllegalStateException();
    stage=RequestStage.STATUS;
    status = connection.getResponseCode();
    if (status >= 300 && status < 400) throw new IllegalArgumentException();
    // Some Cloud refusals give their wait only in Retry-After (seconds or an HTTP date).
    String retryAfter = status >= 400 ? connection.getHeaderField("Retry-After") : null;
    if (connection.getContentLengthLong() > responseLimit) throw new IllegalArgumentException();
    stage=RequestStage.READ;
    byte[] bytes;
    try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = readBounded(input, responseLimit); }
    if (pending.cancelled) throw new IllegalStateException();
    Object data = JSONObject.NULL;
    if (bytes.length > 0) {
     stage=RequestStage.PARSE;
     try { data = parseJson(new String(bytes, StandardCharsets.UTF_8)); }
     catch (Exception error) { if (status < 400) throw error; }
    }
    stage=RequestStage.RESOLVE;
    JSObject result = new JSObject(); result.put("status", status); result.put("data", data);
    if (retryAfter != null && retryAfter.matches("[A-Za-z0-9 ,:+-]{1,64}")) result.put("retryAfter", retryAfter);
    call.resolve(result);
   } catch (Exception error) {
    String code=debugRequestFailure(operation,stage,status,error);
    if(code!=null)try{getContext().getSharedPreferences("alpha-transport-diagnostics",android.content.Context.MODE_PRIVATE).edit().putString("lastFailure",code).apply();}
    catch(RuntimeException ignored){/* Diagnostic storage must not mask the transport failure. */}
    call.reject(pending.cancelled ? "Request cancelled" : "Connection request failed",code);
   }
   finally { if (connection != null) connection.disconnect(); requests.remove(id, pending); }
  }))requests.remove(id,pending);
 }
 @PluginMethod public void cancel(PluginCall call) {
  String id = call.getString("requestId", ""); Pending pending = requests.get(id); if (pending != null) { boolean browser=pending.browserCall!=null||pending.browserLaunched;pending.cancel();if(browser)requests.remove(id,pending); } synchronized(foregroundLock){foregroundLock.notifyAll();}call.resolve();
 }
 @PluginMethod public void openExternal(PluginCall call) {
  try {
   URI url = validatedUrl(call.getString("url"), false);
   // Production hosts only in a flag-off build; staging and other *.eliza.app hosts need test mocks.
   if (!ConnectionRoutes.externalHost(url.getScheme(), url.getHost(), url.getPort(), BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)) throw new IllegalArgumentException();
   Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.toASCIIString())); intent.addCategory(Intent.CATEGORY_BROWSABLE);
   boolean cliLogin=ConnectionRoutes.externalCliLogin(url.getHost(),url.getPath(),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
   if(cliLogin){
    String id=required(call.getString("requestId"),256);
    Pending pending=new Pending();pending.browserCall=call;
    if(destroyed){call.reject("Connection closed");return;}
    if(requests.putIfAbsent(id,pending)!=null){call.reject("Request already active");return;}
    // Register before launching: the native pause belongs to this browser handoff.
    getActivity().runOnUiThread(()->{
     if(destroyed){pending.cancel();requests.remove(id,pending);return;}
     pending.launch(()->getActivity().startActivity(intent));
     if(pending.browserCall==null)requests.remove(id,pending);
    });
   }else getActivity().runOnUiThread(() -> {
    try { startBrowser(url, intent); call.resolve(); }
    catch (RuntimeException error) { call.reject("Authentication browser unavailable"); }
   });
  } catch (Exception error) { call.reject("Unsupported authentication URL"); }
 }
 @Override protected void handleOnPause(){synchronized(foregroundLock){foreground=false;}for(Pending pending:requests.values())pending.paused();super.handleOnPause();}
 @Override protected void handleOnResume(){
  super.handleOnResume();
  synchronized(foregroundLock){foreground=true;foregroundLock.notifyAll();}
  for(java.util.Map.Entry<String,Pending> entry:requests.entrySet())if(entry.getValue().returned())requests.remove(entry.getKey(),entry.getValue());
 }
 @Override protected void handleOnDestroy() {
  synchronized(foregroundLock){destroyed=true;foregroundLock.notifyAll();}
  for (Pending pending : requests.values()) pending.cancel();
  requests.clear();storageTasks.close();workers.shutdownNow(); super.handleOnDestroy();
 }
}
