package ai.elizaresearch.alphaphone;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pure policy for the in-app Eliza Cloud sign-in (no Android classes, so it runs on a plain JVM).
 *
 * Google: Authorization Code + PKCE through Eliza Cloud's Steward. Alpha opens a Custom Tab at
 * {api}/steward/auth/oauth/google/authorize with its own S256 challenge and state and
 * prompt=select_account; Steward returns to the verified App Link {@link Environment#callback} with a
 * one-time Steward code and the state in the URL fragment. The return shapes follow the shared
 * callback contract (test/fixtures/alphaphone-auth-callback-contract.json, the same file in
 * elizaOS/eliza). Email: the six-digit code is typed into Alpha and verified natively
 * (CloudEmailCode). Either
 * Steward session is exchanged once for an `eliza_mobile_` Cloud key through the first-party mobile
 * App Auth routes (a second, independent state and PKCE pair), and the Steward session is dropped.
 *
 * Nothing here logs, and nothing here reads or writes storage.
 */
final class CloudSignInFlow {
 private CloudSignInFlow() {}
 static final String CLIENT_ID = "ai.elizaresearch.alphaphone";
 static final String DEVICE_NAME = "Alpha Phone";
 /** A pending Google sign-in is single use and expires after ten minutes. */
 static final long PENDING_TTL_MS = 10 * 60 * 1000L;
 /** Ack is idempotent and the token route re-reveals the same key until acknowledgeBy. */
 static final int ACK_ATTEMPTS = 3;
 /** Steward rate-limits sends; this phone waits a minute between any two code sends, whatever the address. */
 static final long RESEND_COOLDOWN_MS = 60 * 1000L;
 /** Wrong codes allowed per email attempt before it ends; a new code starts a new attempt. */
 static final int MAX_VERIFY_ATTEMPTS = 5;
 /** Google's account chooser: a user gesture precedes Steward's final redirect, so Chrome hands the App Link to Alpha. */
 static final String PROMPT = "select_account";
 /** Errors a return may carry (shared callback contract errorAllowlist). */
 static final java.util.Set<String> RETURN_ERRORS = java.util.Set.of("app_link_unverified", "mfa_required",
  "oauth_authentication_failed", "oauth_authorization_failed", "oauth_callback_incomplete", "oauth_identity_incomplete",
  "oauth_login_disabled", "oauth_profile_fetch_failed", "oauth_provider_mismatch", "oauth_provider_unavailable",
  "oauth_provider_unknown", "oauth_redirect_invalid", "oauth_state_consumed", "oauth_state_expired", "oauth_state_invalid",
  "oauth_token_exchange_failed");
 static final String CALLBACK_PATH = "/alphaphone/auth/callback";

 /** Fixed authorities. Staging exists only in ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds. */
 enum Environment {
  PRODUCTION("production", CloudDeployment.PRODUCTION_API_HOST, CloudDeployment.PRODUCTION_WEB_HOST, CloudDeployment.PRODUCTION_TENANT),
  STAGING("staging", CloudDeployment.STAGING_API_HOST, CloudDeployment.STAGING_WEB_HOST, CloudDeployment.STAGING_TENANT);
  final String name, apiHost, callbackHost, tenant;
  /** Steward tenant: staging Cloud only accepts tokens from its own tenant. */
  Environment(String name, String apiHost, String callbackHost, String tenant) { this.name = name; this.apiHost = apiHost; this.callbackHost = callbackHost; this.tenant = tenant; }
  String api() { return "https://" + apiHost; }
  /** The verified App Link Steward returns to; also the mobile App Auth binding string. */
  String callback() { return "https://" + callbackHost + CALLBACK_PATH; }
 }
 static Environment environment(String name, boolean testMocks) {
  if ("production".equals(name)) return Environment.PRODUCTION;
  if (testMocks && "staging".equals(name)) return Environment.STAGING;
  throw new IllegalArgumentException("Unsupported Cloud environment");
 }

 private static final SecureRandom RANDOM = new SecureRandom();
 private static String random(int bytes) {
  byte[] value = new byte[bytes]; RANDOM.nextBytes(value);
  return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
 }
 /** 48 random bytes: a 64-character RFC 7636 verifier. */
 static String newVerifier() { return random(48); }
 /** 32 random bytes: a 43-character base64url state, also a valid mobile App Auth state. */
 static String newState() { return random(32); }
 static String s256(String verifier) {
  try {
   byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
   return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
  } catch (Exception unavailable) { throw new IllegalStateException("SHA-256 unavailable"); }
 }
 static boolean validVerifier(String value) { return value != null && value.matches("[A-Za-z0-9._~-]{43,128}"); }
 static boolean validState(String value) { return value != null && value.matches("[A-Za-z0-9_-]{43}"); }

 /** The exact Steward authorize URL. Parameters are base64url or fixed ASCII, so none needs escaping. */
 static String authorizeUrl(Environment environment, String challenge, String state) {
  if (!validState(state) || challenge == null || !challenge.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException();
  return environment.api() + "/steward/auth/oauth/google/authorize?response_type=code&tenant_id=" + environment.tenant
   + "&redirect_uri=" + percent(environment.callback()) + "&code_challenge=" + challenge
   + "&code_challenge_method=S256&state=" + state + "&prompt=" + PROMPT + "&mfa=exchange";
 }
 private static String percent(String value) {
  StringBuilder out = new StringBuilder();
  for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
   char c = (char) (b & 0xff);
   if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') out.append(c);
   else out.append('%').append(String.format("%02X", b & 0xff));
  }
  return out.toString();
 }

 /** What a return to the callback URL carries (shared callback contract). */
 enum ReturnKind { SUCCESS, ERROR, RETURN }
 /** A return to this environment's callback. SUCCESS sets code and state, ERROR sets error and state, RETURN sets neither. */
 static final class Callback {
  final ReturnKind kind; final String state, code, error;
  Callback(ReturnKind kind, String state, String code, String error) { this.kind = kind; this.state = state; this.code = code; this.error = error; }
  static final Callback NO_RESULT = new Callback(ReturnKind.RETURN, null, null, null);
 }
 /**
  * Shared callback contract (test/fixtures/alphaphone-auth-callback-contract.json):
  * - not this environment's callback (scheme, host, port, userinfo or exact path differ): null, ignored;
  * - SUCCESS: exactly {code,state} in the fragment and no query, as Steward's setRedirectFragment emits;
  * - ERROR: exactly {error,state} in the query or the fragment (not both), error from RETURN_ERRORS;
  * - RETURN: anything else on the callback, including no parameters (the fallback page's hand-off) and a
  *   code in the query. RETURN never carries a code.
  * Names appear once and values are non-empty, unescaped [A-Za-z0-9_.~-]; state is 43 base64url characters.
  */
 static Callback parseCallback(String text, Environment environment) {
  if (text == null || text.length() > 8192) return null;
  URI uri;
  try { uri = new URI(text); } catch (Exception invalid) { return null; }
  if (!"https".equals(uri.getScheme()) || !environment.callbackHost.equals(uri.getRawAuthority()) || uri.getPort() != -1
   || uri.getRawUserInfo() != null || !CALLBACK_PATH.equals(uri.getRawPath())) return null;
  String fragment = emptyAsNull(uri.getRawFragment()), query = emptyAsNull(uri.getRawQuery());
  if (fragment == null && query == null) return Callback.NO_RESULT;
  if (fragment != null && query != null) return Callback.NO_RESULT;
  boolean fromFragment = fragment != null;
  Map<String, String> values = parameters(fromFragment ? fragment : query);
  if (values == null || values.size() != 2 || !validState(values.get("state"))) return Callback.NO_RESULT;
  String state = values.get("state");
  if (values.containsKey("code")) return fromFragment ? new Callback(ReturnKind.SUCCESS, state, values.get("code"), null) : Callback.NO_RESULT;
  String error = values.get("error");
  if (error != null && RETURN_ERRORS.contains(error)) return new Callback(ReturnKind.ERROR, state, null, error);
  return Callback.NO_RESULT;
 }
 private static String emptyAsNull(String value) { return value == null || value.isEmpty() ? null : value; }
 private static Map<String, String> parameters(String source) {
  Map<String, String> values = new LinkedHashMap<>();
  for (String part : source.split("&", -1)) {
   int equals = part.indexOf('=');
   if (equals <= 0) return null;
   String name = part.substring(0, equals), value = part.substring(equals + 1);
   if (!name.matches("[a-z_]{1,16}") || !value.matches("[A-Za-z0-9_.~-]{1,4096}")) return null;
   if (values.put(name, value) != null) return null;
  }
  return values;
 }

 /**
  * The one Google attempt this phone waits for. Single use: burned by the return whose state matches,
  * by expiry, by an explicit cancel or by a new attempt. A return whose state does not match leaves it
  * alone (a foreign intent cannot cancel a sign-in), and so does a return without a result.
  */
 static final class Pending {
  final Environment environment; final String state, verifier; final long expiresAt;
  Pending(Environment environment, String state, String verifier, long expiresAt) {
   if (!validState(state) || !validVerifier(verifier)) throw new IllegalArgumentException();
   this.environment = environment; this.state = state; this.verifier = verifier; this.expiresAt = expiresAt;
  }
  static Pending create(Environment environment, long now) { return new Pending(environment, newState(), newVerifier(), now + PENDING_TTL_MS); }
  boolean expired(long now) { return now >= expiresAt; }
  /** Constant-time comparison of the returned state with this record's; expiry is checked separately. */
  boolean sameState(Callback callback) {
   if (callback == null || callback.state == null) return false;
   return MessageDigest.isEqual(state.getBytes(StandardCharsets.US_ASCII), callback.state.getBytes(StandardCharsets.US_ASCII));
  }
  /** Same state and not expired. */
  boolean matches(Callback callback, long now) { return !expired(now) && sameState(callback); }
  /** Encrypted at rest by AlphaCredentialStore. Every field is base64url or a number: '.' cannot occur. */
  String serialize() { return "v1." + environment.name + "." + state + "." + verifier + "." + expiresAt; }
  static Pending parse(String value, boolean testMocks) {
   if (value == null) return null;
   String[] parts = value.split("\\.", -1);
   if (parts.length != 5 || !"v1".equals(parts[0])) return null;
   try { return new Pending(environment(parts[1], testMocks), parts[2], parts[3], Long.parseLong(parts[4])); }
   catch (Exception invalid) { return null; }
  }
 }

 static boolean validEmail(String value) {
  return value != null && value.length() <= 320 && value.matches("[^\\s@\\p{Cc}\\p{Cf}]+@[^\\s@\\p{Cc}\\p{Cf}]+\\.[^\\s@\\p{Cc}\\p{Cf}]+");
 }
 static boolean validCode(String value) { return value != null && value.matches("[0-9]{6}"); }
 static boolean validMobileSecret(String value) { return value != null && value.length() >= 20 && value.length() <= 512 && value.startsWith("eliza_mobile_") && value.matches("[\\x21-\\x7e]+"); }
 static boolean validStewardToken(String value) { return value != null && value.length() >= 20 && value.length() <= 16384 && value.matches("[\\x21-\\x7e]+"); }
 static boolean validUuid(String value) { return value != null && value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"); }

 /** Safe transport categories, without URLs, exception messages or response bodies. */
 static String failureForTransport(java.io.IOException failure, boolean cancelled) {
  if (cancelled) return "cancelled";
  if (failure instanceof java.net.UnknownHostException) return "dns";
  if (failure instanceof java.net.SocketTimeoutException) return "timeout";
  if (failure instanceof javax.net.ssl.SSLException) return "secure-connection";
  if (failure instanceof java.net.ConnectException || failure instanceof java.net.NoRouteToHostException) return "offline";
  return "unavailable";
 }

 /** Stable, non-secret failure codes shown to the renderer. Never derived from a response body. */
 static String failureForStatus(String stage, int status) {
  if (status == 429) return "rate-limited";
  if (status == 410) return "expired";
  if (status == 403) return "account-check";
  if ((status == 400 || status == 401) && ("verify".equals(stage) || "mfa".equals(stage))) return "invalid-code";
  if ((status == 400 || status == 401) && "exchange".equals(stage)) return "expired";
  if (status >= 500 || status == 408) return "unavailable";
  return "rejected";
 }
 /** Ack is retried only for a transport failure or a retryable server status. */
 static boolean ackRetryable(int status) { return status == -1 || status == 408 || status == 429 || status >= 500; }
 static long ackBackoffMs(int attempt) { return attempt <= 0 ? 0 : Math.min(4000L, 1000L << (attempt - 1)); }
}
