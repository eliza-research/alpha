package ai.elizaresearch.alphaphone;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Plain-JVM checks of the in-app sign-in policy. No Android, network, storage or account. */
public final class CloudSignInFlowTest {
 private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
 public static void main(String[] args) throws Exception {
  CloudSignInFlow.Environment production = CloudSignInFlow.Environment.PRODUCTION, staging = CloudSignInFlow.Environment.STAGING;

  // Environments: staging only with test mocks.
  check(CloudSignInFlow.environment("production", false) == production, "production always");
  check(CloudSignInFlow.environment("staging", true) == staging, "staging with test mocks");
  for (String refused : new String[]{"staging", "development", "", null}) {
   try { CloudSignInFlow.environment(refused, false); check(false, "refused environment " + refused); } catch (IllegalArgumentException expected) {}
  }
  check("https://eliza.app/alphaphone/auth/callback".equals(production.callback()), "production App Link");
  check("https://staging.eliza.app/alphaphone/auth/callback".equals(staging.callback()), "staging App Link");

  // The shared RFC vector validates S256 and the local attempt generates valid inputs.
  check(CloudSignInFlow.validVerifier(CloudSignInFlow.newVerifier()), "generated verifier");
  check(CloudSignInFlow.validState(CloudSignInFlow.newState()), "generated state");
  String verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  check("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".equals(CloudSignInFlow.s256(verifier)), "RFC 7636 appendix B vector");

  // Authorize URL: exact Steward route, S256, tenant, registered return, no other parameter.
  String state = CloudSignInFlow.newState(), challenge = CloudSignInFlow.s256(CloudSignInFlow.newVerifier());
  URI authorize = new URI(CloudSignInFlow.authorizeUrl(production, challenge, state));
  check("https".equals(authorize.getScheme()) && "api.eliza.app".equals(authorize.getHost()) && authorize.getPort() == -1, "Cloud API authority");
  check("/steward/auth/oauth/google/authorize".equals(authorize.getPath()), "Steward Google authorize");
  check(authorize.getRawQuery().equals("response_type=code&tenant_id=elizacloud&redirect_uri=https%3A%2F%2Feliza.app%2Falphaphone%2Fauth%2Fcallback&code_challenge=" + challenge + "&code_challenge_method=S256&state=" + state + "&prompt=select_account&mfa=exchange"), "exact query, with Google's account chooser and native MFA");
  check(new URI(CloudSignInFlow.authorizeUrl(staging, challenge, state)).getHost().equals("api-staging.eliza.app"), "staging authority");
  for (String[] bad : new String[][]{{challenge, "short"}, {"x", state}, {challenge, state + "&x=1"}}) {
   try { CloudSignInFlow.authorizeUrl(production, bad[0], bad[1]); check(false, "refused authorize input"); } catch (IllegalArgumentException expected) {}
  }

  // The shared contract covers successful, rejected and non-result callbacks.
  CloudSignInContractTest.main(args);
  String code = Base64.getUrlEncoder().withoutPadding().encodeToString("synthetic-one-time-steward-code-0001".getBytes(StandardCharsets.US_ASCII));
  String base = production.callback();

  // Pending record: single attempt, expires after ten minutes, constant-time state match.
  long now = 1_800_000_000_000L;
  CloudSignInFlow.Pending pending = CloudSignInFlow.Pending.create(production, now);
  check(pending.expiresAt == now + 10 * 60 * 1000L, "ten-minute pending record");
  CloudSignInFlow.Callback mine = CloudSignInFlow.parseCallback(base + "#code=" + code + "&state=" + pending.state, production);
  CloudSignInFlow.Callback other = CloudSignInFlow.parseCallback(base + "#code=" + code + "&state=" + CloudSignInFlow.newState(), production);
  check(pending.matches(mine, now + 1000), "matching state");
  check(!pending.matches(other, now + 1000), "unknown state");
  check(!pending.matches(mine, pending.expiresAt), "expired record never matches");
  check(!pending.matches(null, now), "no return");
  check(pending.sameState(mine) && !pending.sameState(other) && !pending.sameState(CloudSignInFlow.Callback.NO_RESULT), "state compared before anything is burned; a return without a result has no state");
  check(CloudSignInFlow.MAX_VERIFY_ATTEMPTS == 5 && CloudSignInFlow.RESEND_COOLDOWN_MS == 60_000L, "verify cap and send cooldown");
  CloudSignInFlow.Pending restored = CloudSignInFlow.Pending.parse(pending.serialize(), false);
  check(restored != null && restored.state.equals(pending.state) && restored.verifier.equals(pending.verifier) && restored.expiresAt == pending.expiresAt && restored.environment == production, "encrypted-at-rest round trip");
  check(CloudSignInFlow.Pending.parse(CloudSignInFlow.Pending.create(staging, now).serialize(), false) == null, "a staging record is refused by a product build");
  for (String bad : new String[]{null, "", "v2.production." + pending.state + "." + pending.verifier + ".1", "v1.production.short." + pending.verifier + ".1", "v1.production." + pending.state + ".short.1", "v1.production." + pending.state + "." + pending.verifier + ".x", pending.serialize() + ".extra"})
   check(CloudSignInFlow.Pending.parse(bad, true) == null, "refused record " + bad);

  // Inputs and responses.
  check(CloudSignInFlow.validEmail("owner@example.invalid") && !CloudSignInFlow.validEmail("owner@") && !CloudSignInFlow.validEmail("a b@example.invalid") && !CloudSignInFlow.validEmail("owner@example.invalid‮"), "email shape");
  check(CloudSignInFlow.validCode("012345") && !CloudSignInFlow.validCode("12345") && !CloudSignInFlow.validCode("1234567") && !CloudSignInFlow.validCode("12a456"), "six digits");
  check(CloudSignInFlow.validMobileSecret("eliza_mobile_" + "a".repeat(40)) && !CloudSignInFlow.validMobileSecret("eliza_" + "a".repeat(40)) && !CloudSignInFlow.validMobileSecret("eliza_mobile_\n" + "a".repeat(40)), "mobile key shape");
  check(CloudSignInFlow.validUuid("55555555-5555-4555-8555-555555555555") && !CloudSignInFlow.validUuid("x"), "credential id");

  // Failure mapping and the bounded acknowledgement retry.
  check("rate-limited".equals(CloudSignInFlow.failureForStatus("send", 429)), "429");
  check("invalid-code".equals(CloudSignInFlow.failureForStatus("verify", 401)) && "invalid-code".equals(CloudSignInFlow.failureForStatus("mfa", 400)), "wrong code");
  check("expired".equals(CloudSignInFlow.failureForStatus("exchange", 401)) && "expired".equals(CloudSignInFlow.failureForStatus("token", 410)), "used or expired code");
  check("account-check".equals(CloudSignInFlow.failureForStatus("verify", 403)) && "unavailable".equals(CloudSignInFlow.failureForStatus("connect", 503)) && "rejected".equals(CloudSignInFlow.failureForStatus("connect", 400)), "other statuses");
  check(CloudSignInFlow.ACK_ATTEMPTS == 3, "at most three acknowledgements");
  check(CloudSignInFlow.ackRetryable(-1) && CloudSignInFlow.ackRetryable(503) && CloudSignInFlow.ackRetryable(429) && !CloudSignInFlow.ackRetryable(400) && !CloudSignInFlow.ackRetryable(401) && !CloudSignInFlow.ackRetryable(410), "retry only transport and server failures");
  check(CloudSignInFlow.ackBackoffMs(0) == 0 && CloudSignInFlow.ackBackoffMs(1) == 1000 && CloudSignInFlow.ackBackoffMs(2) == 2000 && CloudSignInFlow.ackBackoffMs(9) == 4000, "bounded backoff");

  // Routes: the sign-in client admits exactly its fixed routes; the renderer transport admits none.
  String[] routes = {"/steward/auth/email/code/send", "/steward/auth/email/code/verify", "/steward/auth/oauth/exchange", "/steward/auth/mfa/totp/complete", "/steward/auth/mfa/sms/complete", "/steward/auth/logout", "/api/v1/app-auth/connect", "/api/v1/app-auth/mobile/token", "/api/v1/app-auth/mobile/ack"};
  for (String route : routes) {
   check(ConnectionRoutes.signInRoute(route, "POST", true), "sign-in route " + route);
   check(!ConnectionRoutes.signInRoute(route, "GET", false) && !ConnectionRoutes.signInRoute(route, "POST", false), "POST with a body only " + route);
   check(!ConnectionRoutes.managedService(route, null, "POST", true, false), "renderer transport refuses " + route);
  }
  for (String route : new String[]{"/api/v1/app-auth/mobile/config", "/steward/auth/providers", "/steward/auth/oauth/google/authorize"})
   check(ConnectionRoutes.signInRoute(route, "GET", false) && !ConnectionRoutes.signInRoute(route, "GET", true) && !ConnectionRoutes.signInRoute(route, "POST", true), "readiness read " + route);
  for (String route : new String[]{"/steward/auth/email/send", "/steward/auth/mfa/passkey/complete", "/steward/auth/email/send/", "/steward/auth/revoke", "/api/v1/app-auth/mobile/ack/x", "/api/auth/cli-session", null})
   check(!ConnectionRoutes.signInRoute(route, "POST", true), "refused sign-in route " + route);
  check(ConnectionRoutes.signInOrigin("https", "api.eliza.app", -1, false) && ConnectionRoutes.signInOrigin("https", "api.eliza.app", 443, false), "production API");
  check(!ConnectionRoutes.signInOrigin("https", "api-staging.eliza.app", -1, false) && ConnectionRoutes.signInOrigin("https", "api-staging.eliza.app", -1, true), "staging only with test mocks");
  check(!ConnectionRoutes.signInOrigin("http", "api.eliza.app", -1, true) && !ConnectionRoutes.signInOrigin("https", "eliza.app", -1, false) && !ConnectionRoutes.signInOrigin("https", "api.eliza.app", 8443, false), "nothing else");
  check(ConnectionRoutes.signInAssetLinks("https", "eliza.app", -1, "/.well-known/assetlinks.json", null, false) && !ConnectionRoutes.signInAssetLinks("https", "staging.eliza.app", -1, "/.well-known/assetlinks.json", null, false)
   && ConnectionRoutes.signInAssetLinks("https", "staging.eliza.app", -1, "/.well-known/assetlinks.json", null, true) && !ConnectionRoutes.signInAssetLinks("https", "eliza.app", -1, "/.well-known/assetlinks.json", "x=1", false)
   && !ConnectionRoutes.signInAssetLinks("https", "evil.example", -1, "/.well-known/assetlinks.json", null, true), "assetlinks read only on the return host");
  // The Cloud sign-in hand-off stays a product route until the in-app readiness probe passes.
  check(ConnectionRoutes.managedService("/api/auth/cli-session", null, "POST", true, false), "cli-session create in product builds");
  check(ConnectionRoutes.managedService("/api/auth/cli-session/d32f7f34-962b-47b7-8f0d-f2fe7f12610a", null, "GET", false, false), "cli-session poll in product builds");

  // Readiness policy: every part is required; any doubt keeps the hand-off.
  java.util.Set<String> signer = java.util.Set.of(CloudSignInReadiness.fingerprint("b1de6a3ed3003995"+"74807f0c6f63c0212b6263e7ec28aea2253ceb20b170f47e"));
  java.util.List<String> handle = java.util.List.of(CloudSignInReadiness.HANDLE_ALL_URLS);
  check(signer.contains("B1:DE:6A:3E:D3:00:39:95:74:80:7F:0C:6F:63:C0:21:2B:62:63:E7:EC:28:AE:A2:25:3C:EB:20:B1:70:F4:7E"), "fingerprint form");
  check(CloudSignInReadiness.assetLinksGrant(java.util.List.of(new CloudSignInReadiness.Statement(handle, "android_app", "ai.elizaresearch.alphaphone", java.util.List.of("b1:de:6a:3e:d3:00:39:95:74:80:7f:0c:6f:63:c0:21:2b:62:63:e7:ec:28:ae:a2:25:3c:eb:20:b1:70:f4:7e"))), "ai.elizaresearch.alphaphone", signer), "assetlinks grants this package and certificate");
  check(!CloudSignInReadiness.assetLinksGrant(java.util.List.of(new CloudSignInReadiness.Statement(handle, "android_app", "ai.elizaresearch.alphaphone", java.util.List.of("00:" + "11:".repeat(30) + "22"))), "ai.elizaresearch.alphaphone", signer), "another certificate");
  check(!CloudSignInReadiness.assetLinksGrant(java.util.List.of(new CloudSignInReadiness.Statement(handle, "android_app", "other.package", java.util.List.of(signer.iterator().next()))), "ai.elizaresearch.alphaphone", signer), "another package");
  check(!CloudSignInReadiness.assetLinksGrant(java.util.List.of(new CloudSignInReadiness.Statement(java.util.List.of("delegate_permission/common.get_login_creds"), "android_app", "ai.elizaresearch.alphaphone", java.util.List.of(signer.iterator().next()))), "ai.elizaresearch.alphaphone", signer), "another relation");
  check(!CloudSignInReadiness.assetLinksGrant(java.util.List.of(), "ai.elizaresearch.alphaphone", signer), "no statement");
  check(CloudSignInReadiness.registered(200, true, "ai.elizaresearch.alphaphone", "production", "https://eliza.app/alphaphone/auth/callback", "S256", production), "registered client");
  check(!CloudSignInReadiness.registered(404, null, null, null, null, null, production) && !CloudSignInReadiness.registered(200, true, "ai.elizaresearch.alphaphone", "production", "https://staging.eliza.app/alphaphone/auth/callback", "S256", production), "unregistered or another binding");
  check(CloudSignInReadiness.redirectAllowed(302, "https://accounts.google.com/o/oauth2/v2/auth?x") && !CloudSignInReadiness.redirectAllowed(400, null) && !CloudSignInReadiness.redirectAllowed(302, "https://evil.example/"), "redirect allowlist");
  check(CloudSignInReadiness.emailOffered(200, true, false, java.util.List.of("email_otp")) && !CloudSignInReadiness.emailOffered(200, true, true, java.util.List.of("email_otp")) && !CloudSignInReadiness.emailOffered(200, false, null, null), "email without a captcha");
  check(CloudSignInReadiness.emailRoutePresent(400) && CloudSignInReadiness.emailRoutePresent(429) && !CloudSignInReadiness.emailRoutePresent(404) && !CloudSignInReadiness.emailRoutePresent(405) && !CloudSignInReadiness.emailRoutePresent(503) && !CloudSignInReadiness.emailRoutePresent(-1), "email code route");
  long t = 1_800_000_000_000L;
  CloudSignInReadiness.Result ready = CloudSignInReadiness.combine(true, true, true, true, true, true, true, t);
  check(ready.inApp && ready.google && ready.until == t + CloudSignInReadiness.READY_TTL_MS && ready.fresh(t + 1) && !ready.fresh(ready.until), "ready, cached six hours");
  boolean[][] missing = {{false,true,true,true,true},{true,true,true,false,true},{true,true,true,true,false}};
  for (boolean[] row : missing) { CloudSignInReadiness.Result r = CloudSignInReadiness.combine(row[0], row[1], row[2], row[3], row[4], true, true, t); check(!r.inApp && !r.google && r.until == t + CloudSignInReadiness.NOT_READY_TTL_MS, "missing email prerequisite refuses readiness"); }
  for (boolean[] row : new boolean[][] {{false,true},{true,false},{false,false}}) {
   CloudSignInReadiness.Result result = CloudSignInReadiness.combine(true,row[0],row[1],true,true,true,true,t);
   check(result.inApp && !result.google, "missing Google redirect or signer grant preserves native email");
  }
  CloudSignInReadiness.Result emailOnly = CloudSignInReadiness.combine(true, true, true, true, true, true, false, t);
  check(emailOnly.inApp && !emailOnly.google, "Google only when this phone's App Link is verified");
  CloudSignInReadiness.Result restored2 = CloudSignInReadiness.Result.parse(ready.serialize());
  check(restored2 != null && restored2.inApp && restored2.google && restored2.until == ready.until && CloudSignInReadiness.Result.parse("v1|true|true|1") == null && CloudSignInReadiness.Result.parse(null) == null, "cache round trip");
  CloudSignInReadiness.Result phoneOnly = new CloudSignInReadiness.Result(false, false, true, t + 1000);
  check(phoneOnly.inApp && !phoneOnly.email && !phoneOnly.google && phoneOnly.phone, "phone does not depend on email");
  check(CloudSignInReadiness.Result.parse(phoneOnly.serialize()).phone, "phone cache round trip");
  CloudSignInReadiness.Result googleOnly = new CloudSignInReadiness.Result(false, true, false, t + 1000);
  check(googleOnly.inApp && googleOnly.google && !googleOnly.email, "Google does not depend on email");
  check(CloudSignInReadiness.Result.parse("v2|true|true|1800000001000") == null, "old cache must re-probe SMS policy");
  check(CloudSignInReadiness.Result.parse("v3|true|true|yes|true|1800000001000") == null, "malformed method flag refused");
  check(!new CloudSignInReadiness.Result(true, true, t + 365L * 86400000L).fresh(t), "a cache entry from the future is not trusted");
  checkTransport(new java.net.UnknownHostException("private details"), "dns");
  checkTransport(new java.net.ConnectException("private details"), "offline");
  checkTransport(new java.net.NoRouteToHostException("private details"), "offline");
  checkTransport(new java.net.SocketTimeoutException("private details"), "timeout");
  checkTransport(new javax.net.ssl.SSLHandshakeException("private details"), "secure-connection");
  checkTransport(new java.io.IOException("private details"), "unavailable");
  System.out.println("PASS native sign-in policy");
 }

 private static void checkTransport(java.io.IOException error, String expected) {
  check(expected.equals(CloudSignInFlow.failureForTransport(error, false)), expected);
  check("cancelled".equals(CloudSignInFlow.failureForTransport(error, true)), "cancelled");
 }
}
