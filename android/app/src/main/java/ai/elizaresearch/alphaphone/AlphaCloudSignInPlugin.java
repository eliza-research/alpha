package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * In-app Eliza Cloud sign-in (owner directive 2026-10-14). Native screens collect an email code or
 * open Google's consent in a Custom Tab; no Eliza Cloud web page is part of a successful sign-in.
 * Every secret-bearing request (Steward code exchange or email/MFA verification, mobile App Auth
 * connect, token and ack, Steward logout) is made here with fixed URLs (CloudSignInFlow,
 * CloudEmailCode, ConnectionRoutes). The Steward session, refresh token, authorization codes and
 * PKCE verifiers never cross the bridge; the Steward session is revoked after one sign-in and never
 * stored.
 *
 * The resulting `eliza_mobile_` key is written to the existing `cloud:<environment>` slot of
 * AlphaCredentialStore before it is acknowledged, so identity, entitlement, redeem and Cerebras
 * inference keep their existing credential path. That slot is renderer-readable, as the Cloud
 * sign-in hand-off's key always was: the renderer reads the key to send it as its Bearer. So this
 * client stays on Cloud's default 30-day key lifetime. Plugin call results carry no secret. A key
 * this sign-in replaces is revoked once, best effort, after the new key is active.
 *
 * Readiness: status() reports `inApp` only after CloudSignInReadiness confirms Cloud is ready for this
 * phone (cached). Email stays in Alpha even if this probe fails. Returns follow the shared
 * callback contract (CloudSignInFlow.parseCallback). Nothing here logs URLs, codes, headers or bodies.
 */
@CapacitorPlugin(name = "AlphaCloudSignIn")
public final class AlphaCloudSignInPlugin extends Plugin {
 /** Native-only namespace (RendererCredentialSlots): the renderer can neither read nor write it. */
 static final String PENDING_SLOT = "cloud-signin:v1:pending";
 static String receiptSlot(CloudSignInFlow.Environment environment) { return "cloud-signin:v1:ack:" + environment.name; }
 /** Non-secret readiness cache (plain preferences): booleans and a timestamp per environment. */
 private static final String READINESS_PREFERENCES = "alpha-cloud-signin-readiness-" + CloudDeployment.STORAGE_NAMESPACE;
 private static final int RESPONSE_LIMIT = 256 * 1024;
 private static final long RETURN_GRACE_MS = 1500;

 /** Thrown with a stable, non-secret code the renderer maps to copy. */
 static final class SignInFailure extends Exception {
  final String code;
  SignInFailure(String code) { super(code); this.code = code; }
 }
 /** The one sign-in in progress. One at a time (the renderer's `login-active` rule). */
 private static final class Attempt {
  final String id = UUID.randomUUID().toString();
  final CloudSignInFlow.Environment environment;
  final boolean google;
  volatile boolean cancelled, browserLaunched, browserPaused, callbackReceived;
  volatile HttpURLConnection connection;
  PluginCall waiting;
  volatile CountDownLatch authorizationDecision;
  volatile boolean authorized;
  String email, phone, emailVerifier, mfaType, mfaChallenge, pendingRecord;
  long expiresAt, resendAt;
  int failedVerifies;
  boolean busy;
  Attempt(CloudSignInFlow.Environment environment, boolean google) { this.environment = environment; this.google = google; }
  void cancel() { cancelled = true; CountDownLatch decision = authorizationDecision; if (decision != null) decision.countDown(); HttpURLConnection current = connection; if (current != null) current.disconnect(); }
 }
 private static final class Response {
  final int status; final JSONObject data; final String location;
  Response(int status, JSONObject data, String location) { this.status = status; this.data = data; this.location = location; }
 }
 private final Object lock = new Object();
 private final ExecutorService worker = Executors.newSingleThreadExecutor();
 /** Readiness probes run apart from sign-in work, so a slow probe never delays a sign-in step. */
 private final ExecutorService prober = Executors.newSingleThreadExecutor();
 private final Handler main = new Handler(Looper.getMainLooper());
 private final Map<CloudSignInFlow.Environment, CloudSignInReadiness.Result> readiness = new EnumMap<>(CloudSignInFlow.Environment.class);
 private final Map<CloudSignInFlow.Environment, List<PluginCall>> probing = new EnumMap<>(CloudSignInFlow.Environment.class);
 private Attempt attempt;
 /** Global code-send cooldown: one send a minute from this phone, whatever the address. */
 private long lastEmailSendAt;
 private volatile boolean destroyed;
 /** Failed retirement is never treated as a consumed callback in this process. */
 private boolean pendingRetirementUnconfirmed;
 private boolean testMocks() { return BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS; }

 @Override public void load() {
  super.load();
  // A return that starts the process (Alpha was stopped while the Custom Tab was open) is matched
  // against the encrypted pending record. A plain start leaves that record alone: it expires on its
  // own, and a launcher restart must not discard a sign-in still in the browser.
  captureCallback(getActivity().getIntent());
  run(this::resumeAcknowledgements);
  // Warm the cached readiness answer so opening sign-in rarely waits for it.
  probe(CloudSignInFlow.Environment.PRODUCTION, null);
 }
 @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); captureCallback(intent); }
 @Override protected void handleOnPause() { synchronized (lock) { if (attempt != null && attempt.google && attempt.browserLaunched) attempt.browserPaused = true; } super.handleOnPause(); }
 /**
  * Android delivers a returning App Link with onNewIntent before onResume. Coming back to Alpha
  * after the Custom Tab opened, without a return, ends the waiting step (after a short grace for a
  * late intent). The pending record is kept until it expires or the owner starts again, so a return
  * that still arrives from the browser completes the sign-in (signInCompleted).
  */
 @Override protected void handleOnResume() {
  super.handleOnResume();
  final Attempt current;
  synchronized (lock) { current = attempt; }
  if (current == null || !current.google || !current.browserPaused) return;
  main.postDelayed(() -> {
   boolean closed;
   synchronized (lock) { closed = attempt == current && !current.callbackReceived && !current.cancelled; }
   if (closed) end(current, "browser-closed", false);
  }, RETURN_GRACE_MS);
 }
 @Override protected void handleOnDestroy() {
  destroyed = true;
  synchronized (lock) { if (attempt != null) attempt.cancel(); attempt = null; }
  worker.shutdownNow();
  prober.shutdownNow();
  super.handleOnDestroy();
 }
 private void run(Runnable task) {
  try { worker.execute(task); } catch (java.util.concurrent.RejectedExecutionException closed) { /* Activity teardown. */ }
 }
 private AlphaCredentialStore store() {
  return new AlphaCredentialStore(getContext(), () -> { if (destroyed) throw new IllegalStateException("Sign-in closed"); });
 }

 // ── Readiness: in-app only once Cloud is ready for this phone ───────────────────────────────

 /** Public provider documents come only from this build's configured API origin. */
 @PluginMethod public void serviceInfo(PluginCall call) {
  final CloudSignInFlow.Environment environment;
  try { environment = CloudSignInFlow.environment(call.getString("environment", "production"), testMocks()); }
  catch (Exception invalid) { call.reject("Unsupported Cloud environment", "invalid-request"); return; }
  try {
   prober.execute(() -> {
    try {
     Response response = get(environment.api() + "/api/public/service");
     if (response.status != 200) { call.reject("Service information unavailable", "unavailable"); return; }
     call.resolve(JSObject.fromJSONObject(response.data));
    } catch (Exception unavailable) { call.reject("Service information unavailable", "unavailable"); }
   });
  } catch (java.util.concurrent.RejectedExecutionException closed) { call.reject("Sign-in closed", "unavailable"); }
 }
 @PluginMethod public void status(PluginCall call) {
  final CloudSignInFlow.Environment environment;
  try { environment = CloudSignInFlow.environment(call.getString("environment", "production"), testMocks()); }
  catch (Exception invalid) { call.reject("Unsupported Cloud environment", "invalid-request"); return; }
  probe(environment, call, Boolean.TRUE.equals(call.getBoolean("refresh", false)));
 }
 private JSObject statusOutcome(CloudSignInReadiness.Result result) {
  synchronized (lock) {
   JSObject out = new JSObject().put("active", attempt != null);
   if (attempt != null) out.put("kind", attempt.google ? "google" : attempt.mfaType != null ? "mfa" : attempt.phone != null ? "phone" : "email");
   return out.put("methodsKnown", result.methodsKnown).put("inApp", result.inApp).put("email", result.email).put("phone", result.phone).put("google", result.google);
  }
 }
 /** Startup may reuse a fresh answer; opening sign-in explicitly refreshes provider availability. */
 private void probe(CloudSignInFlow.Environment environment, PluginCall call) {
  probe(environment, call, false);
 }
 /** One probe per environment answers every waiting call, including refreshes during an active probe. */
 private void probe(CloudSignInFlow.Environment environment, PluginCall call, boolean refresh) {
  long now = System.currentTimeMillis();
  CloudSignInReadiness.Result cached;
  synchronized (lock) {
   List<PluginCall> waiting = probing.get(environment);
   if (waiting != null) { if (call != null) waiting.add(call); return; }
   if (refresh) forgetReadiness(environment);
   cached = refresh ? null : readiness.get(environment);
   if (cached == null && !refresh) { cached = storedReadiness(environment); if (cached != null) readiness.put(environment, cached); }
   if (cached != null && cached.fresh(now)) { if (call != null) call.resolve(statusOutcome(cached)); return; }
   waiting = new ArrayList<>(); if (call != null) waiting.add(call); probing.put(environment, waiting);
  }
  try {
   prober.execute(() -> {
    CloudSignInReadiness.Result result;
    try { result = measure(environment); } catch (Exception failure) { result = CloudSignInReadiness.Result.notReady(System.currentTimeMillis()); }
    List<PluginCall> answered;
    synchronized (lock) { readiness.put(environment, result); answered = probing.remove(environment); }
    storeReadiness(environment, result);
    if (answered != null) for (PluginCall waiting : answered) waiting.resolve(statusOutcome(result));
   });
  } catch (java.util.concurrent.RejectedExecutionException closed) {
   List<PluginCall> answered;
   synchronized (lock) { answered = probing.remove(environment); }
   if (answered != null) for (PluginCall waiting : answered) waiting.resolve(statusOutcome(CloudSignInReadiness.Result.notReady(now)));
  }
 }
 /** Cloud refused this phone's in-app sign-in: invalidate the optional-method readiness cache. */
 private void forgetReadiness(CloudSignInFlow.Environment environment) {
  synchronized (lock) { readiness.remove(environment); }
  try { getContext().getSharedPreferences(READINESS_PREFERENCES, android.content.Context.MODE_PRIVATE).edit().remove(environment.name).apply(); } catch (Exception ignored) { /* Re-probed anyway. */ }
 }
 private CloudSignInReadiness.Result storedReadiness(CloudSignInFlow.Environment environment) {
  try { return CloudSignInReadiness.Result.parse(getContext().getSharedPreferences(READINESS_PREFERENCES, android.content.Context.MODE_PRIVATE).getString(environment.name, null)); }
  catch (Exception unreadable) { return null; }
 }
 private void storeReadiness(CloudSignInFlow.Environment environment, CloudSignInReadiness.Result result) {
  try { getContext().getSharedPreferences(READINESS_PREFERENCES, android.content.Context.MODE_PRIVATE).edit().putString(environment.name, result.serialize()).apply(); }
  catch (Exception ignored) { /* Kept in memory. */ }
 }
 /** The readiness observations (CloudSignInReadiness). Every read is short, fixed and fail-safe. */
 private CloudSignInReadiness.Result measure(CloudSignInFlow.Environment environment) throws Exception {
  long now = System.currentTimeMillis();
  String callback = environment.callback();
  Response config = get(environment.api() + "/api/v1/app-auth/mobile/config?clientId=" + CloudSignInFlow.CLIENT_ID
   + "&environment=" + environment.name + "&redirectUri=" + Uri.encode(callback));
  boolean registered = CloudSignInReadiness.registered(config.status, config.data.opt("success"), config.data.optString("clientId", null),
   config.data.optString("environment", null), config.data.optString("redirectUri", null), config.data.optString("codeChallengeMethod", null), environment);
  if (!registered) return CloudSignInReadiness.Result.notReady(now);
  Response providers = get(environment.api() + "/steward/auth/providers?tenantId=" + environment.tenant);
  if (providers.status != 200) return CloudSignInReadiness.Result.notReady(now);
  JSONObject captcha = providers.data.optJSONObject("captcha");
  JSONArray required = captcha == null ? null : captcha.optJSONArray("requiredFor");
  List<String> requiredFor = required == null ? null : new ArrayList<>();
  if (required != null) for (int i = 0; i < required.length(); i++) requiredFor.add(required.optString(i));
  boolean emailOffered = CloudSignInReadiness.emailOffered(providers.status, providers.data.opt("email"), captcha == null ? null : captcha.opt("enabled"), requiredFor);
  boolean phoneOffered = CloudSmsCode.offered(providers.status, providers.data.opt("sms"), captcha == null ? null : captcha.opt("enabled"), requiredFor);
  // An empty object names no address, so Steward refuses it and no email is sent.
  boolean emailRoute = false;
  if (emailOffered) try { emailRoute = CloudSignInReadiness.emailRoutePresent(probePost(environment, CloudEmailCode.SEND_PATH)); } catch (Exception unavailable) { /* Other providers remain independent. */ }
  boolean redirectAllowed = false, assetLinks = false, deviceVerified = false;
  if (CloudSignInReadiness.googleOffered(providers.status, providers.data.opt("google")) && appLinkVerified(environment)) {
   // Google readiness is optional: a failed request cannot disable email.
   try {
    Response authorize = get(CloudSignInFlow.authorizeUrl(environment, CloudSignInFlow.s256(CloudSignInFlow.newVerifier()), CloudSignInFlow.newState()));
    redirectAllowed = CloudSignInReadiness.redirectAllowed(authorize.status, authorize.location);
    assetLinks = assetLinksGrant(environment);
    deviceVerified = appLinkVerified(environment);
   } catch (Exception unavailable) { /* Email remains available. */ }
  }
  boolean emailReady = emailOffered && emailRoute;
  boolean googleReady = redirectAllowed && assetLinks && deviceVerified;
  return new CloudSignInReadiness.Result(emailReady, googleReady, phoneOffered,
   now + (emailReady || googleReady || phoneOffered ? CloudSignInReadiness.READY_TTL_MS : CloudSignInReadiness.NOT_READY_TTL_MS));
 }
 private boolean assetLinksGrant(CloudSignInFlow.Environment environment) {
  try {
   URI url = new URI("https://" + environment.callbackHost + "/.well-known/assetlinks.json");
   if (!ConnectionRoutes.signInAssetLinks(url.getScheme(), url.getHost(), url.getPort(), url.getRawPath(), url.getRawQuery(), testMocks())) return false;
   Object parsed = new JSONTokener(fetch(url, null, null).body).nextValue();
   if (!(parsed instanceof JSONArray)) return false;
   JSONArray array = (JSONArray) parsed;
   List<CloudSignInReadiness.Statement> statements = new ArrayList<>();
   for (int i = 0; i < array.length() && i < 64; i++) {
    JSONObject row = array.optJSONObject(i); if (row == null) continue;
    JSONObject target = row.optJSONObject("target"); if (target == null) continue;
    statements.add(new CloudSignInReadiness.Statement(strings(row.optJSONArray("relation")), target.optString("namespace", null),
     target.optString("package_name", null), strings(target.optJSONArray("sha256_cert_fingerprints"))));
   }
   return CloudSignInReadiness.assetLinksGrant(statements, getContext().getPackageName(), signers());
  } catch (Exception unavailable) { return false; }
 }
 private static List<String> strings(JSONArray array) {
  List<String> out = new ArrayList<>();
  if (array != null) for (int i = 0; i < array.length() && i < 64; i++) out.add(array.optString(i));
  return out;
 }
 /** SHA-256 fingerprints of the certificates this installed APK is signed with. */
 private Set<String> signers() throws Exception {
  PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
  Set<String> out = new HashSet<>();
  if (info.signingInfo == null) return out;
  Signature[] signatures = info.signingInfo.getApkContentsSigners();
  if (signatures != null) for (Signature signature : signatures) { String value = CloudSignInReadiness.certificateFingerprint(signature.toByteArray()); if (value != null) out.add(value); }
  return out;
 }
 /**
  * Android hands this environment's return to Alpha: on Android 12+ the return host is verified for
  * this package (or the owner selected it); earlier, the build declares the return filter.
  */
 private boolean appLinkVerified(CloudSignInFlow.Environment environment) {
  try {
   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    DomainVerificationManager manager = getContext().getSystemService(DomainVerificationManager.class);
    DomainVerificationUserState state = manager == null ? null : manager.getDomainVerificationUserState(getContext().getPackageName());
    Integer host = state == null ? null : state.getHostToStateMap().get(environment.callbackHost);
    return state != null && state.isLinkHandlingAllowed() && host != null
     && (host == DomainVerificationUserState.DOMAIN_STATE_VERIFIED || host == DomainVerificationUserState.DOMAIN_STATE_SELECTED);
   }
   Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(environment.callback())).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(getContext().getPackageName());
   return !getContext().getPackageManager().queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
  } catch (Exception unavailable) { return false; }
 }

 // ── Google: Authorization Code + PKCE, verified App Link return ─────────────────────────────

 @PluginMethod public void startGoogle(PluginCall call) {
  final CloudSignInFlow.Environment environment;
  try { environment = CloudSignInFlow.environment(call.getString("environment"), testMocks()); }
  catch (Exception invalid) { call.reject("Unsupported Cloud environment", "invalid-request"); return; }
  final Attempt next = new Attempt(environment, true);
  final CloudSignInFlow.Pending pending = CloudSignInFlow.Pending.create(environment, System.currentTimeMillis());
  next.pendingRecord = pending.serialize();
  synchronized (lock) {
   if (attempt != null) { call.reject("Another sign-in is in progress", "login-active"); return; }
   attempt = next; next.waiting = call; pendingRetirementUnconfirmed = true;
  }
  run(() -> {
   try {
    // Encrypted at rest before the browser opens, so a return after process death can be matched.
    // Starting again replaces any earlier pending record (the explicit retry).
    store().writeCredentialSlot(PENDING_SLOT, next.pendingRecord);
    synchronized (lock) {
     if (next.cancelled || attempt != next) throw new SignInFailure("cancelled");
     pendingRetirementUnconfirmed = false;
    }
    final String url = CloudSignInFlow.authorizeUrl(environment, CloudSignInFlow.s256(pending.verifier), pending.state);
    getActivity().runOnUiThread(() -> {
     synchronized (lock) { if (attempt != next || next.cancelled) return; next.browserLaunched = true; }
     if (!openBrowser(url)) end(next, "browser-unavailable", true);
    });
   } catch (SignInFailure failure) { end(next, failure.code, true); }
   catch (Exception storage) { end(next, "storage", true); }
  });
 }
 /** Custom Tab in a browser that supports it, never an embedded user agent (Google refuses those); plain ACTION_VIEW otherwise. */
 private boolean openBrowser(String url) {
  Uri uri = Uri.parse(url);
  try {
   String browser = CustomTabsClient.getPackageName(getContext(), null);
   if (browser != null && !browser.equals(getContext().getPackageName())) {
    CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).setShareState(CustomTabsIntent.SHARE_STATE_OFF).build();
    tab.intent.setPackage(browser);
    tab.launchUrl(getActivity(), uri);
    return true;
   }
  } catch (RuntimeException unavailable) { /* Fall through to the system browser. */ }
  try {
   Intent view = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
   getActivity().startActivity(view);
   return true;
  } catch (RuntimeException unavailable) { return false; }
 }
 /**
  * Strict App Link capture under the shared callback contract. Only this environment's exact
  * callback is considered, and the intent's data is cleared so a relaunch never replays it.
  * - RETURN (no result, e.g. the fallback page's parameterless hand-off): nothing is compared or
  *   burned; the waiting step ends with an honest retry message and the pending record stays until
  *   it expires or the owner starts again.
  * - SUCCESS or ERROR: the state is compared (constant time) before anything is burned. A state that
  *   does not match the pending record is ignored and leaves the attempt alone, so another app's
  *   intent cannot cancel a sign-in. A match burns the record before any network request.
  */
 private boolean captureCallback(Intent intent) {
  Uri data = intent == null ? null : intent.getData();
  if (data == null || !"https".equals(data.getScheme())) return false;
  CloudSignInFlow.Environment environment = null;
  CloudSignInFlow.Callback callback = null;
  for (CloudSignInFlow.Environment candidate : CloudSignInFlow.Environment.values()) {
   if (candidate == CloudSignInFlow.Environment.STAGING && !testMocks()) continue;
   CloudSignInFlow.Callback parsed = CloudSignInFlow.parseCallback(data.toString(), candidate);
   if (parsed != null) { environment = candidate; callback = parsed; break; }
  }
  if (callback == null) return false;
  intent.setData(null);
  final CloudSignInFlow.Environment returned = environment;
  final CloudSignInFlow.Callback received = callback;
  run(() -> {
   CloudSignInFlow.Pending pending = null;
   String pendingRaw = null;
   AlphaCredentialStore store = null;
   synchronized (lock) { if (pendingRetirementUnconfirmed) return; }
   try { store = store(); pendingRaw = store.readCredentialSlot(PENDING_SLOT); pending = CloudSignInFlow.Pending.parse(pendingRaw, testMocks()); }
   catch (Exception storage) { /* Treated as no pending record. */ }
   long now = System.currentTimeMillis();
   final Attempt waiting;
   synchronized (lock) { waiting = attempt != null && attempt.google && attempt.environment == returned && !attempt.callbackReceived ? attempt : null; }
   if (received.kind == CloudSignInFlow.ReturnKind.RETURN) {
    if (pending == null || pending.environment != returned || pending.expired(now)) return;
    if (waiting != null) { synchronized (lock) { waiting.callbackReceived = true; } end(waiting, "app-link-unverified", false); }
    else notifyListeners("signInIncomplete", new JSObject().put("code", "app-link-unverified"), true);
    return;
   }
   // Not this phone's request (unknown, foreign or duplicate): ignored, nothing burned or ended.
   if (pending == null || pending.environment != returned || !pending.sameState(received)) return;
   // The matching return: single use, burned before any network request, whatever the outcome.
   try {
    if (!store.compareExchangeCredentialSlot(PENDING_SLOT, pendingRaw, null)) throw new IllegalStateException("Pending sign-in changed");
   } catch (Exception storage) {
    synchronized (lock) { pendingRetirementUnconfirmed = true; }
    if (waiting != null) end(waiting, "storage", false);
    else notifyListeners("signInIncomplete", new JSObject().put("code", "storage"), true);
    return;
   }
   Attempt owner = waiting;
   if (owner != null) synchronized (lock) { owner.callbackReceived = true; }
   else {
    // A cold start (process death in the browser) or a step that already ended: complete into storage
    // and announce it (signInCompleted) unless another sign-in has started meanwhile.
    owner = new Attempt(returned, true);
    owner.pendingRecord = pendingRaw;
    synchronized (lock) { if (attempt != null || pendingRetirementUnconfirmed) return; attempt = owner; }
   }
   if (pending.expired(now)) { end(owner, "expired", false); return; }
   owner.expiresAt = pending.expiresAt;
   owner.callbackReceived = true;
   if (received.kind == CloudSignInFlow.ReturnKind.ERROR) {
    end(owner, "mfa_required".equals(received.error) ? "mfa-browser" : "app_link_unverified".equals(received.error) ? "app-link-unverified" : "provider-refused", false);
    return;
   }
   try {
    JSONObject body = new JSONObject().put("code", received.code).put("redirectUri", returned.callback())
     .put("tenantId", returned.tenant).put("codeVerifier", pending.verifier);
    Response exchanged = post(owner, "/steward/auth/oauth/exchange", body, null);
    if (exchanged.status != 200) throw new SignInFailure(CloudSignInFlow.failureForStatus("exchange", exchanged.status));
    complete(owner, exchanged.data);
   } catch (SignInFailure failure) { end(owner, failure.code, false); }
   catch (Exception unexpected) { end(owner, "unavailable", false); }
  });
  return true;
 }
 /** Retire only this attempt; a later explicit retry may already own the slot. */
 private void burnUnclaimedPending(Attempt current) {
  run(() -> { try { store().compareExchangeCredentialSlot(PENDING_SLOT, current.pendingRecord, null); } catch (Exception ignored) { /* The failed start keeps callback retirement fenced. */ } });
 }

 // ── Email code and MFA: fully native ─────────────────────────────────────────────────────────

 @PluginMethod public void startEmail(PluginCall call) {
  final CloudSignInFlow.Environment environment;
  final String email = call.getString("email") == null ? null : call.getString("email").trim().toLowerCase(java.util.Locale.ROOT);
  try { environment = CloudSignInFlow.environment(call.getString("environment"), testMocks()); }
  catch (Exception invalid) { call.reject("Unsupported Cloud environment", "invalid-request"); return; }
  if (!CloudSignInFlow.validEmail(email)) { call.reject("Enter a valid email address", "invalid-email"); return; }
  final Attempt current;
  synchronized (lock) {
   long now = System.currentTimeMillis();
   if (attempt != null && (attempt.google || attempt.busy)) { call.reject("Another sign-in is in progress", "login-active"); return; }
   // One send a minute from this phone, whatever the address (Steward also limits sends server-side).
   if (now < lastEmailSendAt + CloudSignInFlow.RESEND_COOLDOWN_MS) { call.reject("Wait before requesting another code", "cooldown"); return; }
   if (attempt != null) attempt.cancel();
   current = new Attempt(environment, false);
   current.email = email; current.emailVerifier = CloudSignInFlow.newVerifier(); current.busy = true; attempt = current;
   lastEmailSendAt = now;
  }
  run(() -> {
   try {
    Response sent = post(current, CloudEmailCode.SEND_PATH, CloudEmailCode.sendBody(current.environment, email, current.emailVerifier), null);
    if (sent.status != 200 && sent.status != 202) throw new SignInFailure(CloudSignInFlow.failureForStatus("send", sent.status));
    JSONObject data = sent.data.optJSONObject("data") != null ? sent.data.optJSONObject("data") : sent.data;
    long now = System.currentTimeMillis(), expiresAt = CloudEmailCode.expiresAt(data.opt("expiresAt"), now);
    synchronized (lock) {
     if (attempt != current || current.cancelled) throw new SignInFailure("cancelled");
     current.expiresAt = expiresAt; current.resendAt = lastEmailSendAt + CloudSignInFlow.RESEND_COOLDOWN_MS; current.busy = false;
    }
    call.resolve(new JSObject().put("attemptId", current.id).put("expiresAt", expiresAt).put("resendAt", current.resendAt));
   } catch (SignInFailure failure) { release(current); refused(current.environment, failure.code); call.reject(failure.code, failure.code); }
   catch (Exception unexpected) { release(current); call.reject("unavailable", "unavailable"); }
  });
 }
 @PluginMethod public void startPhone(PluginCall call) {
  final CloudSignInFlow.Environment environment;
  final String phone = call.getString("phone") == null ? null : call.getString("phone").trim();
  try { environment = CloudSignInFlow.environment(call.getString("environment"), testMocks()); }
  catch (Exception invalid) { call.reject("Unsupported Cloud environment", "invalid-request"); return; }
  if (!CloudSmsCode.validPhone(phone)) { call.reject("Enter a phone number with country code", "invalid-phone"); return; }
  final Attempt current;
  synchronized (lock) {
   long now = System.currentTimeMillis();
   if (attempt != null && (attempt.google || attempt.busy)) { call.reject("Another sign-in is in progress", "login-active"); return; }
   // One send a minute from this phone, whatever the address (Steward also limits sends server-side).
   if (now < lastEmailSendAt + CloudSignInFlow.RESEND_COOLDOWN_MS) { call.reject("Wait before requesting another code", "cooldown"); return; }
   if (attempt != null) attempt.cancel();
   current = new Attempt(environment, false);
   current.phone = phone; current.busy = true; attempt = current;
   lastEmailSendAt = now;
  }
  run(() -> {
   try {
    requirePhoneAvailable(current);
    Response sent = post(current, CloudSmsCode.SEND_PATH, CloudSmsCode.sendBody(current.environment, phone), null);
    if (sent.status != 200 && sent.status != 202) throw new SignInFailure(CloudSignInFlow.failureForStatus("send", sent.status));
    JSONObject data = sent.data.optJSONObject("data") != null ? sent.data.optJSONObject("data") : sent.data;
    long now = System.currentTimeMillis(), expiresAt = CloudEmailCode.expiresAt(data.opt("expiresAt"), now);
    synchronized (lock) {
     if (attempt != current || current.cancelled) throw new SignInFailure("cancelled");
     current.expiresAt = expiresAt; current.resendAt = lastEmailSendAt + CloudSignInFlow.RESEND_COOLDOWN_MS; current.busy = false;
    }
    call.resolve(new JSObject().put("attemptId", current.id).put("expiresAt", expiresAt).put("resendAt", current.resendAt));
   } catch (SignInFailure failure) { release(current); refused(current.environment, failure.code); call.reject(failure.code, failure.code); }
   catch (Exception unexpected) { release(current); call.reject("unavailable", "unavailable"); }
  });
 }
 /** Check registration and tenant SMS policy before sending a real code. No website alias or captcha bypass. */
 private void requirePhoneAvailable(Attempt current) throws Exception {
  CloudSignInFlow.Environment environment = current.environment;
  Response config = get(environment.api() + "/api/v1/app-auth/mobile/config?clientId=" + CloudSignInFlow.CLIENT_ID
   + "&environment=" + environment.name + "&redirectUri=" + Uri.encode(environment.callback()));
  if (!CloudSignInReadiness.registered(config.status, config.data.opt("success"), config.data.optString("clientId", null),
   config.data.optString("environment", null), config.data.optString("redirectUri", null), config.data.optString("codeChallengeMethod", null), environment))
   throw new SignInFailure("unavailable");
  Response providers = get(environment.api() + "/steward/auth/providers?tenantId=" + environment.tenant);
  JSONObject captcha = providers.data.optJSONObject("captcha");
  JSONArray required = captcha == null ? null : captcha.optJSONArray("requiredFor");
  List<String> requiredFor = required == null ? null : new ArrayList<>();
  if (required != null) for (int i = 0; i < required.length(); i++) requiredFor.add(required.optString(i));
  if (!CloudSmsCode.offered(providers.status, providers.data.opt("sms"), captcha == null ? null : captcha.opt("enabled"), requiredFor))
   throw new SignInFailure("unavailable");
  synchronized (lock) { if (attempt != current || current.cancelled) throw new SignInFailure("cancelled"); }
 }
 @PluginMethod public void verifyPhone(PluginCall call) { verify(call, false, true); }
 @PluginMethod public void verifyEmail(PluginCall call) { verify(call, false); }
 @PluginMethod public void verifyMfa(PluginCall call) { verify(call, true); }
 private void verify(PluginCall call, boolean mfa) { verify(call, mfa, false); }
 private void verify(PluginCall call, boolean mfa, boolean phone) {
  final String code = call.getString("code");
  if (!CloudSignInFlow.validCode(code)) { call.reject("Enter the six-digit code", "invalid-code"); return; }
  final Attempt current;
  synchronized (lock) {
   current = attempt;
   if (current == null || (current.google && !mfa) || !current.id.equals(call.getString("attemptId"))) { call.reject("Sign-in expired. Start again.", "expired"); return; }
   if (!mfa && phone != (current.phone != null)) { call.reject("Sign-in step changed. Start again.", "expired"); return; }
   if (current.busy) { call.reject("Another sign-in is in progress", "login-active"); return; }
   if (System.currentTimeMillis() >= current.expiresAt) { attempt = null; call.reject("Sign-in expired. Start again.", "expired"); return; }
   if (current.failedVerifies >= CloudSignInFlow.MAX_VERIFY_ATTEMPTS) { attempt = null; call.reject("Too many incorrect codes", "attempts-exhausted"); return; }
   if (mfa != (current.mfaType != null)) { call.reject("Sign-in step changed. Start again.", "expired"); return; }
   if (mfa && !("totp".equals(current.mfaType) || "sms".equals(current.mfaType))) { call.reject("Unsupported verification", "mfa-unsupported"); return; }
   current.busy = true; current.waiting = call;
  }
  run(() -> {
   try {
    Response verified = mfa
     ? post(current, "/steward/auth/mfa/" + current.mfaType + "/complete", new JSONObject().put("challengeId", current.mfaChallenge).put("code", code), null)
     : phone ? post(current, CloudSmsCode.VERIFY_PATH, CloudSmsCode.verifyBody(current.environment, current.phone, code), null)
     : post(current, CloudEmailCode.VERIFY_PATH, CloudEmailCode.verifyBody(current.environment, current.email, code, current.emailVerifier), null);
    if (verified.status != 200) throw new SignInFailure(CloudSignInFlow.failureForStatus(mfa ? "mfa" : "verify", verified.status));
    JSONObject session = verified.data.optJSONObject("data") != null && !verified.data.has("token") ? verified.data.optJSONObject("data") : verified.data;
    complete(current, session);
   } catch (SignInFailure failure) {
    if (!"invalid-code".equals(failure.code)) { end(current, failure.code, false); return; }
    // A wrong code keeps the step for a retry, up to the per-attempt cap; then the attempt ends.
    boolean exhausted;
    synchronized (lock) { current.failedVerifies++; exhausted = current.failedVerifies >= CloudSignInFlow.MAX_VERIFY_ATTEMPTS; }
    if (exhausted) { end(current, "attempts-exhausted", false); return; }
    release(current); synchronized (lock) { current.waiting = null; } call.reject(failure.code, failure.code);
   }
   catch (Exception unexpected) { end(current, "unavailable", false); }
  });
 }
 private void release(Attempt current) { synchronized (lock) { current.busy = false; if (attempt == current && current.expiresAt == 0) attempt = null; } }

 /** A retained MFA event is only a hint: the renderer must re-check its live attempt before displaying it. */
 @PluginMethod public void resumeMfa(PluginCall call) {
  synchronized (lock) {
   boolean active = attempt != null && !attempt.cancelled && attempt.mfaType != null
    && attempt.id.equals(call.getString("attemptId")) && attempt.environment.name.equals(call.getString("environment"))
    && attempt.expiresAt > System.currentTimeMillis();
   call.resolve(new JSObject().put("active", active));
  }
 }

 @PluginMethod public void cancel(PluginCall call) {
  Attempt current;
  synchronized (lock) { current = attempt; attempt = null; pendingRetirementUnconfirmed = true; }
  if (current != null) { current.cancel(); PluginCall waiting; synchronized (lock) { waiting = current.waiting; current.waiting = null; } if (waiting != null) waiting.reject("cancelled", "cancelled"); }
  // Capture ownership at admission, before a queued cancellation can observe a later attempt.
  final String pending;
  try {
   pending = current != null && current.google
    ? current.pendingRecord : store().readCredentialSlot(PENDING_SLOT);
  } catch (Exception storage) {
   notifyListeners("signInIncomplete", new JSObject().put("code", "storage"), true);
   call.reject("Pending sign-in cancellation was not saved", "storage");
   return;
  }
  // Report durable cancellation only after the exact pending record has been retired.
  try { worker.execute(() -> {
   try {
    synchronized (lock) { if (attempt != null) { call.resolve(); return; } }
    if (pending != null) store().compareExchangeCredentialSlot(PENDING_SLOT, pending, null);
    synchronized (lock) { if (attempt == null) pendingRetirementUnconfirmed = false; }
    call.resolve();
   } catch (Exception storage) {
    notifyListeners("signInIncomplete", new JSObject().put("code", "storage"), true);
    call.reject("Pending sign-in cancellation was not saved", "storage");
   }
  }); } catch (java.util.concurrent.RejectedExecutionException closed) {
   notifyListeners("signInIncomplete", new JSObject().put("code", "storage"), true);
   call.reject("Sign-in closed", "storage");
  }
 }

 /** Post-authentication consent is owned by Android, never a renderer-supplied boolean.
  * The worker retains the session only in memory while this bounded prompt is open.
  * Closing the activity, cancellation and expiration all refuse access. */
 private void requireAuthorization(Attempt current) throws Exception {
  CountDownLatch decision = new CountDownLatch(1);
  final AlertDialog[] shown = new AlertDialog[1];
  synchronized (lock) {
   if (attempt != current || current.cancelled || destroyed) throw new SignInFailure("cancelled");
   current.authorized = false;
   current.authorizationDecision = decision;
  }
  main.post(() -> {
   synchronized (lock) {
    if (attempt != current || current.cancelled || destroyed || System.currentTimeMillis() >= current.expiresAt
     || getActivity() == null || getActivity().isFinishing() || getActivity().isDestroyed()) { decision.countDown(); return; }
    String service = current.environment == CloudSignInFlow.Environment.STAGING ? CloudDeployment.STAGING_NAME : CloudDeployment.PRODUCTION_NAME;
    try {
     shown[0] = new AlertDialog.Builder(getActivity())
      .setTitle("Authorize Alpha Phone")
      .setMessage("Allow Alpha Phone to use your " + service + " account?")
      .setPositiveButton("Authorize", (dialog, which) -> {
       synchronized (lock) {
        if (attempt == current && !current.cancelled && !destroyed && System.currentTimeMillis() < current.expiresAt) current.authorized = true;
       }
       decision.countDown();
      })
      .setNegativeButton("Cancel", (dialog, which) -> decision.countDown())
      .setOnCancelListener(dialog -> decision.countDown())
      .create();
     shown[0].setCanceledOnTouchOutside(false);
     shown[0].show();
    } catch (RuntimeException unavailable) { decision.countDown(); }
   }
  });
  try {
   long remaining = Math.max(0, current.expiresAt - System.currentTimeMillis());
   if (!decision.await(remaining, TimeUnit.MILLISECONDS)) throw new SignInFailure("expired");
   synchronized (lock) {
    if (System.currentTimeMillis() >= current.expiresAt) throw new SignInFailure("expired");
    if (attempt != current || current.cancelled || destroyed || !current.authorized) throw new SignInFailure("cancelled");
   }
  } finally {
   current.authorizationDecision = null;
   main.post(() -> { if (shown[0] != null) shown[0].dismiss(); });
  }
 }

 // ── Shared tail: Steward session → eliza_mobile_ key ─────────────────────────────────────────

 private void complete(Attempt current, JSONObject session) throws Exception {
  if (Boolean.TRUE.equals(session.opt("mfaRequired"))) {
   JSONObject challenge = session.optJSONObject("mfa");
   String type = challenge == null ? null : challenge.optString("type", null), id = challenge == null ? null : challenge.optString("challengeId", null);
   long expiresAt = challenge == null ? 0 : instant(challenge.opt("expiresAt"));
   if (id == null || id.isEmpty() || id.length() > 256 || !("totp".equals(type) || "sms".equals(type) || "passkey".equals(type))) throw new SignInFailure("unavailable");
   PluginCall waiting;
   synchronized (lock) {
    if (attempt != current || current.cancelled) throw new SignInFailure("cancelled");
    if (current.mfaType != null) throw new SignInFailure("unavailable");
    long deadline = Math.min(current.expiresAt, expiresAt);
    if (deadline <= System.currentTimeMillis()) throw new SignInFailure("expired");
    current.mfaType = type; current.mfaChallenge = id; current.failedVerifies = 0; current.expiresAt = deadline;
    current.busy = false; waiting = current.waiting; current.waiting = null;
   }
   // Only the local attempt ID crosses the bridge; the server challenge stays native.
   JSObject required = new JSObject().put("status", "mfa").put("method", type).put("expiresAt", current.expiresAt)
    .put("attemptId", current.id).put("environment", current.environment.name);
   if (waiting != null) waiting.resolve(required);
   else notifyListeners("signInMfaRequired", required, true);
   return;
  }
  String token = session.optString("token", null), refresh = session.optString("refreshToken", null);
  if (!CloudSignInFlow.validStewardToken(token)) throw new SignInFailure("unavailable");
  CloudSignInFlow.Environment environment = current.environment;
  try {
   requireAuthorization(current);
   String state = CloudSignInFlow.newState(), verifier = CloudSignInFlow.newVerifier();
   JSONObject binding = new JSONObject().put("clientId", CloudSignInFlow.CLIENT_ID).put("environment", environment.name).put("redirectUri", environment.callback());
   Response connected = post(current, "/api/v1/app-auth/connect", new JSONObject(binding.toString()).put("flow", "mobile_pkce").put("state", state)
    .put("codeChallenge", CloudSignInFlow.s256(verifier)).put("codeChallengeMethod", "S256").put("deviceName", CloudSignInFlow.DEVICE_NAME), token);
   if (connected.status != 200) throw new SignInFailure(CloudSignInFlow.failureForStatus("connect", connected.status));
   String code = connected.data.optString("code", "");
   if (!"mobile_app_auth_code".equals(connected.data.optString("codeType")) || !code.matches("emac_[0-9a-f]{64}")) throw new SignInFailure("unavailable");
   Object created = connected.data.opt("accountCreated");
   JSONObject proof = new JSONObject(binding.toString()).put("code", code).put("state", state).put("codeVerifier", verifier);
   Response minted = post(current, "/api/v1/app-auth/mobile/token", new JSONObject(proof.toString()).put("grantType", "authorization_code"), null);
   if (minted.status != 200) throw new SignInFailure(CloudSignInFlow.failureForStatus("token", minted.status));
   String secret = minted.data.optString("secret", null), credentialId = minted.data.optString("credentialId", null);
   long expiresAt = instant(minted.data.opt("expiresAt")), acknowledgeBy = instant(minted.data.opt("acknowledgeBy"));
   if (!Boolean.TRUE.equals(minted.data.opt("acknowledgementRequired")) || !"Bearer".equals(minted.data.optString("tokenType"))
    || !CloudSignInFlow.validMobileSecret(secret) || !CloudSignInFlow.validUuid(credentialId) || expiresAt <= System.currentTimeMillis() || acknowledgeBy <= System.currentTimeMillis())
    throw new SignInFailure("unavailable");
   synchronized (lock) { if (current.cancelled || attempt != current) throw new SignInFailure("cancelled"); }
   // Durable receipt first (no secret: the key is read back from its slot), then the key itself.
   AlphaCredentialStore receipts = store();
   receipts.writeCredentialSlot(receiptSlot(environment), new JSONObject(proof.toString()).put("credentialId", credentialId).put("acknowledgeBy", acknowledgeBy).toString());
   // The key this sign-in replaces, if any, is revoked after the new one is active (as CloudProtocol.login does).
   String previous = previousToken(receipts, environment, secret);
   long intent = AlphaLocalAgentPlugin.reserveCredentialIntent();
   AlphaCredentialStore credentials = new AlphaCredentialStore(getContext(), () -> { if (destroyed || current.cancelled) throw new IllegalStateException("Sign-in closed"); AlphaLocalAgentPlugin.requireCredentialIntent(intent); });
   JSONObject saved = new JSONObject().put("credentialId", UUID.randomUUID().toString()).put("token", secret).put("expiresAt", expiresAt).put("serverCredentialId", credentialId);
   credentials.writeCredentialSlot("cloud:" + environment.name, saved.toString());
   // Commit point: the key is stored. Cancelling now cannot unstore it; activation proceeds.
   boolean acknowledged = acknowledge(current, proof, credentialId, secret);
   if (acknowledged) try { receipts.removeCredentialSlot(receiptSlot(environment)); } catch (Exception kept) { /* Retried on next start. */ }
   if (!acknowledged) throw new SignInFailure("activation-pending");
   JSObject outcome = new JSObject().put("status", "authenticated").put("environment", environment.name).put("expiresAt", expiresAt)
    .put("accountCreated", created instanceof Boolean ? created : JSONObject.NULL);
   if (previous != null) outcome.put("previousSignIn", CloudKeyRevocation.revoke(environment.name, previous, testMocks()) ? "revoked" : "unconfirmed");
   finish(current, outcome);
  } finally {
   // The Steward session is not needed past this point: revoke it, best effort, never stored.
   try { JSONObject body = new JSONObject(); if (refresh != null && refresh.length() <= 16384) body.put("refreshToken", refresh); post(null, environment, "/steward/auth/logout", body, token); }
   catch (Exception ignored) { /* Best effort; the session expires on its own. */ }
  }
 }
 /** The saved key for this environment that the new one replaces, or null when none (or the same key). */
 private static String previousToken(AlphaCredentialStore store, CloudSignInFlow.Environment environment, String issued) {
  try {
   String raw = store.readCredentialSlot("cloud:" + environment.name);
   String token = raw == null ? null : new JSONObject(raw).optString("token", null);
   return token == null || token.isEmpty() || token.equals(issued) ? null : token;
  } catch (Exception unreadable) { return null; }
 }
 /** Bounded retry: ack is idempotent and the key is re-revealed until acknowledgeBy. */
 private boolean acknowledge(Attempt current, JSONObject proof, String credentialId, String secret) throws Exception {
  CloudSignInFlow.Environment environment = current == null ? CloudSignInFlow.environment(proof.getString("environment"), testMocks()) : current.environment;
  for (int round = 0; round < CloudSignInFlow.ACK_ATTEMPTS; round++) {
   if (round > 0) Thread.sleep(CloudSignInFlow.ackBackoffMs(round));
   if (destroyed) return false;
   Response acked;
   try { acked = post(null, environment, "/api/v1/app-auth/mobile/ack", new JSONObject(proof.toString()).put("credentialId", credentialId).put("secret", secret), null); }
   catch (SignInFailure transport) { continue; }
   if (acked.status == 200) return "acknowledged".equals(acked.data.optString("status")) && credentialId.equals(acked.data.optString("credentialId"));
   if (acked.status == 409 && "authorization_complete".equals(acked.data.optString("error"))) return true;
   if (!CloudSignInFlow.ackRetryable(acked.status)) return false;
  }
  return false;
 }
 /** A key stored before an interrupted ack is activated on the next start, while Cloud allows it. */
 private void resumeAcknowledgements() {
  for (CloudSignInFlow.Environment environment : CloudSignInFlow.Environment.values()) {
   if (environment == CloudSignInFlow.Environment.STAGING && !testMocks()) continue;
   try {
    AlphaCredentialStore store = store();
    String raw = store.readCredentialSlot(receiptSlot(environment));
    if (raw == null) continue;
    JSONObject receipt = new JSONObject(raw), proof = new JSONObject();
    for (String key : new String[]{"clientId", "environment", "redirectUri", "code", "state", "codeVerifier"}) proof.put(key, receipt.getString(key));
    String credentialId = receipt.getString("credentialId"), saved = store.readCredentialSlot("cloud:" + environment.name);
    JSONObject credential = saved == null ? null : new JSONObject(saved);
    boolean current = credential != null && credentialId.equals(credential.optString("serverCredentialId")) && environment.name.equals(proof.getString("environment"));
    boolean done = !current || receipt.getLong("acknowledgeBy") <= System.currentTimeMillis()
     || acknowledge(null, proof, credentialId, credential.getString("token"));
    if (done) store.removeCredentialSlot(receiptSlot(environment));
   } catch (Exception unavailable) { /* Kept for the next start; a stale receipt expires with acknowledgeBy. */ }
  }
 }

 // ── Outcomes and transport ───────────────────────────────────────────────────────────────────

 private void finish(Attempt current, JSObject outcome) {
  PluginCall waiting;
  synchronized (lock) { waiting = current.waiting; current.waiting = null; if (attempt == current) attempt = null; }
  if (waiting != null) waiting.resolve(outcome);
  // A return that completed without a waiting renderer call (after process death, or after the
  // waiting step ended) is announced, retained until the renderer listens. It carries no secret.
  else notifyListeners("signInCompleted", outcome, true);
 }
 /** Ends the attempt with a stable code. `burn` also removes a pending Google record (explicit cancel or a failed start). */
 private void end(Attempt current, String code, boolean burn) {
  PluginCall waiting;
  synchronized (lock) { current.cancel(); waiting = current.waiting; current.waiting = null; if (attempt == current) { attempt = null; if (burn) pendingRetirementUnconfirmed = true; } }
  if (current.google && burn) burnUnclaimedPending(current);
  refused(current.environment, code);
  if (waiting != null) waiting.reject(code, code);
 }
 /** Cloud refusing the in-app sign-in invalidates the cached readiness, so the next sign-in re-checks it. */
 private void refused(CloudSignInFlow.Environment environment, String code) {
  if ("rejected".equals(code) || "invalid-request".equals(code)) forgetReadiness(environment);
 }
 private static long instant(Object value) {
  if (value instanceof Number) return ((Number) value).longValue();
  if (!(value instanceof String)) return 0;
  try { return Instant.parse((String) value).toEpochMilli(); } catch (Exception invalid) { return 0; }
 }
 private Response post(Attempt current, String path, JSONObject body, String bearer) throws Exception {
  return post(current, current.environment, path, body, bearer);
 }
 /** Fixed sign-in routes only; no redirects, bounded bodies, nothing logged. */
 private Response post(Attempt current, CloudSignInFlow.Environment environment, String path, JSONObject body, String bearer) throws Exception {
  URI url = new URI(environment.api() + path);
  if (!ConnectionRoutes.signInOrigin(url.getScheme(), url.getHost(), url.getPort(), testMocks()) || !ConnectionRoutes.signInRoute(url.getRawPath(), "POST", true) || url.getRawQuery() != null)
   throw new IllegalArgumentException();
  if (current != null && current.cancelled) throw new SignInFailure("cancelled");
  Fetched fetched = fetch(url, body.toString().getBytes(StandardCharsets.UTF_8), bearer, current, 20000, 30000);
  return response(fetched);
 }
 /** The readiness probe's one POST: an empty object to a fixed sign-in route, short timeouts; only the status is used. */
 private int probePost(CloudSignInFlow.Environment environment, String path) throws Exception {
  URI url = new URI(environment.api() + path);
  if (!ConnectionRoutes.signInOrigin(url.getScheme(), url.getHost(), url.getPort(), testMocks()) || !ConnectionRoutes.signInRoute(url.getRawPath(), "POST", true) || url.getRawQuery() != null)
   throw new IllegalArgumentException();
  return fetch(url, "{}".getBytes(StandardCharsets.UTF_8), null).status;
 }
 /** Readiness probe reads: fixed GET routes on the Cloud API, nothing followed. */
 private Response get(String text) throws Exception {
  URI url = new URI(text);
  if (!ConnectionRoutes.signInOrigin(url.getScheme(), url.getHost(), url.getPort(), testMocks()) || !ConnectionRoutes.signInRoute(url.getRawPath(), "GET", false))
   throw new IllegalArgumentException();
  return response(fetch(url, null, null));
 }
 private static Response response(Fetched fetched) throws SignInFailure {
  JSONObject data = new JSONObject();
  if (!fetched.body.isEmpty()) {
   try { Object parsed = new JSONTokener(fetched.body).nextValue(); if (parsed instanceof JSONObject) data = (JSONObject) parsed; else if (fetched.status < 300) throw new SignInFailure("unavailable"); }
   catch (SignInFailure invalid) { throw invalid; }
   catch (Exception invalid) { if (fetched.status < 300) throw new SignInFailure("unavailable"); }
  }
  return new Response(fetched.status, data, fetched.location);
 }
 private Fetched fetch(URI url, byte[] body, String bearer) throws Exception {
  return fetch(url, body, bearer, null, CloudSignInReadiness.REQUEST_TIMEOUT_MS, CloudSignInReadiness.REQUEST_TIMEOUT_MS);
 }
 /** One request: no redirects followed (a redirect's Location is reported, never loaded), bounded body. */
 private Fetched fetch(URI url, byte[] body, String bearer, Attempt current, int connectTimeout, int readTimeout) throws Exception {
  HttpURLConnection connection = null;
  try {
   connection = (HttpURLConnection) url.toURL().openConnection();
   if (current != null) current.connection = connection;
   connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
   connection.setConnectTimeout(connectTimeout); connection.setReadTimeout(readTimeout); connection.setRequestMethod(body == null ? "GET" : "POST");
   connection.setRequestProperty("Accept", "application/json");
   if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
   if (body != null) {
    connection.setRequestProperty("Content-Type", "application/json");
    connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
   }
   int status = connection.getResponseCode();
   if (status >= 300 && status < 400) return new Fetched(status, "", connection.getHeaderField("Location"));
   if (connection.getContentLengthLong() > RESPONSE_LIMIT) throw new SignInFailure("unavailable");
   byte[] bytes;
   try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = readBounded(input); }
   if (current != null && current.cancelled) throw new SignInFailure("cancelled");
   return new Fetched(status, new String(bytes, StandardCharsets.UTF_8), null);
  } catch (java.io.IOException transport) {
   throw new SignInFailure(CloudSignInFlow.failureForTransport(transport, current != null && current.cancelled));
  } finally {
   if (connection != null) connection.disconnect();
   if (current != null) current.connection = null;
  }
 }
 private static final class Fetched {
  final int status; final String body, location;
  Fetched(int status, String body, String location) { this.status = status; this.body = body; this.location = location; }
 }
 private static byte[] readBounded(InputStream input) throws Exception {
  if (input == null) return new byte[0];
  ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
  while ((count = input.read(buffer)) != -1) { if (output.size() + count > RESPONSE_LIMIT) throw new SignInFailure("unavailable"); output.write(buffer, 0, count); }
  return output.toByteArray();
 }
}
