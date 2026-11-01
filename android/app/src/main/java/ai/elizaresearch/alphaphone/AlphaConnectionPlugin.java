package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.eliza.plugins.agent.connection.ConnectionTransport;
import ai.eliza.plugins.agent.connection.DelegationCallback;
import ai.eliza.plugins.agent.connection.PendingRequests;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** First-party renderer transport and encrypted storage. Never injected into browser pages. Transport bounds, route
 * policy, delegation-return admission and the request registry are the shared plugin-native-agent connection
 * policies; this class keeps Alpha's plugin name, link scheme, hosts (ConnectionRoutes), slots and Android plumbing. */
@CapacitorPlugin(name = "AlphaConnection")
public final class AlphaConnectionPlugin extends Plugin {
 /** Alpha's Cloud delegation return link: alphaphone://cloud-delegation?state=...&(code|error)=... */
 static final String DELEGATION_SCHEME="alphaphone",DELEGATION_HOST="cloud-delegation";
 private volatile Uri delegationCallback;
 private volatile String workspaceCallback;
 private final Object foregroundLock=new Object();
 private boolean foreground;
 @Override public void load() { super.load(); synchronized(foregroundLock){foreground=getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)||getActivity().hasWindowFocus();}captureDelegationCallback(getActivity().getIntent());captureWorkspaceCallback(getActivity().getIntent()); }
 @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); captureDelegationCallback(intent);captureWorkspaceCallback(intent); }
 private void captureDelegationCallback(Intent intent) {
  Uri uri = intent == null ? null : intent.getData();
  if(uri==null || !DELEGATION_SCHEME.equals(uri.getScheme()) || !DELEGATION_HOST.equals(uri.getHost()))return;
  try {
   java.util.Map<String,java.util.List<String>> query=new java.util.HashMap<>();
   for(String name:uri.getQueryParameterNames())query.put(name,uri.getQueryParameters(name));
   if(DelegationCallback.admit(DELEGATION_SCHEME,DELEGATION_HOST,uri.getScheme(),uri.getHost(),uri.getPort(),uri.getUserInfo(),uri.getFragment(),uri.getPath(),query)==null)return;
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

 /** Workspace return uses only its own native protected pending slot. */
 private GoogleWorkspaceReturnFlow workspaceFlow(){
  return new GoogleWorkspaceReturnFlow(new GoogleWorkspaceReturnFlow.Store(){
   public String credential()throws Exception{return storage().readCredentialSlot("cloud:production");}
   public String pending()throws Exception{return storage().readCredentialSlot(GoogleWorkspaceReturn.SLOT);}
   public boolean comparePending(String expected,String value)throws Exception{return storage().compareExchangeCredentialSlot(GoogleWorkspaceReturn.SLOT,expected,value);}
  });
 }
 private GoogleWorkspaceReturn.Binding workspaceBinding(PluginCall call,String raw)throws Exception {
  return GoogleWorkspaceReturnFlow.binding(call.getString("environment"),call.getString("userId"),call.getString("organizationId"),call.getString("credentialId"),raw);
 }
 private String workspaceAppLinkAssociation(){
  if(android.os.Build.VERSION.SDK_INT<31)return null;
  try{
   android.content.pm.verify.domain.DomainVerificationManager manager=getContext().getSystemService(android.content.pm.verify.domain.DomainVerificationManager.class);
   android.content.pm.verify.domain.DomainVerificationUserState state=manager==null?null:manager.getDomainVerificationUserState(getContext().getPackageName());
   if(state==null)return null;
   Integer domain=state.getHostToStateMap().get("alphacompute.ai");
   Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(GoogleWorkspaceReturn.CALLBACK));intent.addCategory(Intent.CATEGORY_BROWSABLE);intent.addCategory(Intent.CATEGORY_DEFAULT);intent.setPackage(getContext().getPackageName());
   boolean ownCallback=!getContext().getPackageManager().queryIntentActivities(intent,android.content.pm.PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
   return GoogleWorkspaceReturn.association(state.isLinkHandlingAllowed(),ownCallback,java.util.Objects.equals(domain,android.content.pm.verify.domain.DomainVerificationUserState.DOMAIN_STATE_VERIFIED),java.util.Objects.equals(domain,android.content.pm.verify.domain.DomainVerificationUserState.DOMAIN_STATE_SELECTED));
  }catch(Exception unavailable){return null;}
 }
 @PluginMethod public void prepareGoogleWorkspaceReturn(PluginCall call){
  submit(call,()->{try{
   String association=workspaceAppLinkAssociation();
   if(association==null||!"production".equals(call.getString("environment"))){call.resolve(new JSObject().put("supported",false));return;}
   final long owner=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
   String raw=storage().readCredentialSlot("cloud:production");
   GoogleWorkspaceReturn.Binding binding=workspaceBinding(call,raw);
   JSONObject saved=new JSONObject(raw);if(saved.has("expiresAt")&&saved.getLong("expiresAt")<=System.currentTimeMillis())throw new IllegalArgumentException();
   JSONObject identity=readCloudIdentity(saved.getString("token"));
   if(!binding.userId.equals(identity.optString("userId"))||!binding.organizationId.equals(identity.optString("organizationId")))throw new SecurityException();
   byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);String nonce=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
   final String redirect=AlphaLocalAgentPlugin.withCredentialAuthority(owner,()->workspaceFlow().prepare(binding,nonce,System.currentTimeMillis()));
   workspaceCallback=null;
   call.resolve(new JSObject().put("supported",true).put("redirectUrl",redirect).put("state",nonce).put("association",association));
  }catch(Exception unavailable){call.reject("Google return preparation could not be verified","workspace-binding");}});
 }
 private void captureWorkspaceCallback(Intent intent){
  final String url=intent==null||intent.getData()==null?null:intent.getData().toString();
  if(GoogleWorkspaceReturn.parse(url)==null)return;
  storageTasks.submit(()->{try{
   if(destroyed||workspaceAppLinkAssociation()==null||!workspaceFlow().captureAllowed(url,System.currentTimeMillis()))return;
   workspaceCallback=url;notifyListeners("googleWorkspaceReturn",new JSObject(),true);
  }catch(Exception ignored){/* Invalid or retired returns are not authority. */}},()->{});
 }
 @PluginMethod public void consumeGoogleWorkspaceReturn(PluginCall call){
  submitStorage(call,()->{try{
   final String url=workspaceCallback;
   if(workspaceAppLinkAssociation()==null){call.resolve(new JSObject().put("result","none"));return;}
   GoogleWorkspaceReturn.Callback result=workspaceFlow().consume(workspaceBinding(call,storage().readCredentialSlot("cloud:production")),url,System.currentTimeMillis());
   if(result==null){call.resolve(new JSObject().put("result","none"));return;}
   if(java.util.Objects.equals(workspaceCallback,url))workspaceCallback=null;
   getActivity().runOnUiThread(()->{Intent current=getActivity().getIntent();if(current!=null&&current.getData()!=null&&url.equals(current.getData().toString()))current.setData(null);});
   JSObject out=new JSObject().put("result",result.result);if(result.connectionId!=null)out.put("connectionId",result.connectionId);call.resolve(out);
  }catch(Exception invalid){call.resolve(new JSObject().put("result","none"));}});
 }
 @PluginMethod public void cancelGoogleWorkspaceReturn(PluginCall call){
  submitStorage(call,()->{try{workspaceFlow().cancel(call.getString("state"));call.resolve();}catch(Exception invalid){call.reject("Google return could not be cancelled");}});
 }

 private static final int RESPONSE_LIMIT = ConnectionTransport.RESPONSE_LIMIT;
 private final ExecutorService workers = Executors.newFixedThreadPool(4);
 private final SerialStorageTasks storageTasks = new SerialStorageTasks();
 private volatile boolean destroyed;
 private final PendingRequests requests = new PendingRequests();
 /** Bridge messages already queued during Activity teardown can arrive after shutdown. */
 private boolean submit(PluginCall call,Runnable task) {
  if(destroyed){call.reject("Connection closed");return false;}
  return PluginWorkers.submit(workers,task,()->call.reject("Connection closed"));
 }
 private boolean submitStorage(PluginCall call,Runnable task) {
  return storageTasks.submit(()->{if(destroyed)call.reject("Connection closed");else task.run();},()->call.reject("Connection closed"));
 }
 /** The renderer call a browser handoff settles exactly once. */
 private static PendingRequests.Call settles(PluginCall call){return new PendingRequests.Call(){public void resolve(){call.resolve();}public void reject(String message){call.reject(message);}};}
 private static String required(String value, int max) { return ConnectionTransport.required(value,max); }
 private static Object parseJson(String value) throws Exception { return ConnectionTransport.parseJson(value); }
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
  return RendererCredentialSlots.credentialSlot(name)?AlphaLocalAgentPlugin.reserveCredentialIntent():0;
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
    if(!RendererCredentialSlots.compareExchangeAllowed(name)||!call.getData().has("expectedValue")||!call.getData().has("value"))throw new IllegalArgumentException();
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
  return ConnectionTransport.validatedUrl(text, allowDevelopment, BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
 }
 private static byte[] readBounded(InputStream input, int limit) throws Exception { return ConnectionTransport.readBounded(input, limit); }
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
  Set<String> allowed=Set.of("calendar.local-event.v1","calendar.create.v1","calendar.next-read.v1","notes.local-record.v1","notes.query.v1","reminders.local-record.v1","reminders.local-record.v2","reminders.create.v1","maps.selected-read.v1","clock.handoff.v1","clock.handoff.v2");
  return ConnectionTransport.deviceCapabilities(value,allowed,new String[][]{{"reminders.local-record.v1","reminders.local-record.v2"}});
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
  PendingRequests.Pending pending = requests.register(id);
  if (pending == null) { call.reject("Request already active"); return; }
  if(!submit(call,() -> {
   HttpURLConnection connection = null;
   RequestOperation operation=RequestOperation.OTHER;
   RequestStage stage=RequestStage.VALIDATE;
   int status=-1;
   try {
    if (pending.cancelled()) throw new IllegalStateException();
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
    OwnerRoutes routes=OwnerRoutes.shipped(getContext().getAssets()::open);
    if((routes.group(url.getPath(),"automations")!=null||routes.group(route,"automations")!=null)?!routes.allowed("automations",route,method):!(Set.of("GET","POST").contains(method)||selfRevocation||ConnectionRoutes.calendarSync(url.getPath(),url.getRawQuery(),method,call.getString("body")!=null)))throw new IllegalArgumentException();
    if(ConnectionRoutes.POLICY.cliSessionPoll(url.getHost(),url.getPath(),method)){
     // Gate only future dispatch. A claim already sent must finish and may be saved while backgrounded.
     long expiresAt=call.getLong("expiresAt",System.currentTimeMillis()+30000);
     synchronized(foregroundLock){
      while(!foreground&&!pending.cancelled()&&!destroyed){long remaining=expiresAt-System.currentTimeMillis();if(remaining<=0)throw new java.net.SocketTimeoutException();foregroundLock.wait(remaining);}
      if(pending.cancelled()||destroyed)throw new IllegalStateException();
      if(System.currentTimeMillis()>=expiresAt)throw new java.net.SocketTimeoutException();
     }
    }
    stage=RequestStage.CONNECT;
    connection = (HttpURLConnection) url.toURL().openConnection(); pending.connection(connection::disconnect);
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
     if (!ConnectionTransport.headerValue(value)) throw new IllegalArgumentException();
     if ("x-eliza-device-capabilities".equals(normalized) && !validDeviceCapabilities(value)) throw new IllegalArgumentException();
     if ("x-eliza-phone-protocol".equals(normalized) && !"1".equals(value)) throw new IllegalArgumentException();
     connection.setRequestProperty(name, value);
    }
    String body = call.getString("body");
    if (body != null) {
     if (!("POST".equals(method)||"PUT".equals(method)&&routes.allowed("automations",route,method)||"PATCH".equals(method)&&ConnectionRoutes.calendarSync(url.getPath(),url.getRawQuery(),method,true))) throw new IllegalArgumentException();
     byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
     if (encoded.length > responseLimit) throw new IllegalArgumentException();
     parseJson(body); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(encoded.length);
     if (pending.cancelled()) throw new IllegalStateException();
     stage=RequestStage.WRITE;
     try (java.io.OutputStream output = connection.getOutputStream()) { output.write(encoded); }
    }
    if (pending.cancelled()) throw new IllegalStateException();
    stage=RequestStage.STATUS;
    status = connection.getResponseCode();
    if (status >= 300 && status < 400) throw new IllegalArgumentException();
    // Some Cloud refusals give their wait only in Retry-After (seconds or an HTTP date).
    String retryAfter = status >= 400 ? connection.getHeaderField("Retry-After") : null;
    if (connection.getContentLengthLong() > responseLimit) throw new IllegalArgumentException();
    stage=RequestStage.READ;
    byte[] bytes;
    try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = readBounded(input, responseLimit); }
    if (pending.cancelled()) throw new IllegalStateException();
    Object data = JSONObject.NULL;
    if (bytes.length > 0) {
     stage=RequestStage.PARSE;
     try { data = parseJson(new String(bytes, StandardCharsets.UTF_8)); }
     catch (Exception error) { if (status < 400) throw error; }
    }
    stage=RequestStage.RESOLVE;
    JSObject result = new JSObject(); result.put("status", status); result.put("data", data);
    if (ConnectionTransport.retryAfter(retryAfter) != null) result.put("retryAfter", retryAfter);
    call.resolve(result);
   } catch (Exception error) {
    String code=debugRequestFailure(operation,stage,status,error);
    if(code!=null)try{getContext().getSharedPreferences("alpha-transport-diagnostics",android.content.Context.MODE_PRIVATE).edit().putString("lastFailure",code).apply();}
    catch(RuntimeException ignored){/* Diagnostic storage must not mask the transport failure. */}
    call.reject(pending.cancelled() ? "Request cancelled" : "Connection request failed",code);
   }
   finally { if (connection != null) connection.disconnect(); requests.remove(id, pending); }
  }))requests.remove(id,pending);
 }
 @PluginMethod public void cancel(PluginCall call) {
  requests.cancel(call.getString("requestId", "")); synchronized(foregroundLock){foregroundLock.notifyAll();}call.resolve();
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
    if(destroyed){call.reject("Connection closed");return;}
    PendingRequests.Pending pending=requests.registerBrowser(id,settles(call));
    if(pending==null){call.reject("Request already active");return;}
    // Register before launching: the native pause belongs to this browser handoff.
    getActivity().runOnUiThread(()->{
     if(destroyed){pending.cancel();requests.remove(id,pending);return;}
     pending.launch(()->getActivity().startActivity(intent));
     if(pending.settled())requests.remove(id,pending);
    });
   }else getActivity().runOnUiThread(() -> {
    try { getActivity().startActivity(intent); call.resolve(); }
    catch (RuntimeException error) { call.reject("Authentication browser unavailable"); }
   });
  } catch (Exception error) { call.reject("Unsupported authentication URL"); }
 }
 @Override protected void handleOnPause(){synchronized(foregroundLock){foreground=false;}requests.pauseAll();super.handleOnPause();}
 @Override protected void handleOnResume(){
  super.handleOnResume();
  captureWorkspaceCallback(getActivity().getIntent());
  synchronized(foregroundLock){foreground=true;foregroundLock.notifyAll();}
  requests.resumeAll();
 }
 @Override protected void handleOnDestroy() {
  destroyed=true;
  requests.cancelAll();
  synchronized(foregroundLock){foregroundLock.notifyAll();}
  storageTasks.close();workers.shutdownNow(); super.handleOnDestroy();
 }
}
