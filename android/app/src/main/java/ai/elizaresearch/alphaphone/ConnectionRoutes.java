package ai.elizaresearch.alphaphone;

/** Fixed renderer transport policy outside Automations. Pure so it is tested without Android. */
final class ConnectionRoutes {
 private ConnectionRoutes() {}
 /** Decoded path with repeated and trailing slashes removed, so spelling cannot dodge a route rule. */
 private static String canonical(String path){
  if(path==null)return "";
  String value=path.replaceAll("/{2,}","/");
  while(value.length()>1&&value.endsWith("/"))value=value.substring(0,value.length()-1);
  return value;
 }
 /**
  * Production phones run the resident agent and do not pair with a remote agent. The renderer
  * already refuses pairing; this keeps a renderer regression from sending a pairing code.
  * Saved remote credentials are untouched. Test-mocks builds keep pairing for development.
  */
 static boolean retiredPairing(String decodedPath,boolean testMocks){
  return !testMocks&&"/api/auth/pair".equals(canonical(decodedPath));
 }
 /**
  * Origins this transport may contact. A production phone talks to its resident agent over the
  * separate in-process Agent bridge, never through this transport, and does not pair with, restore
  * or connect a remote or Cloud agent (the controller returns before any saved selection is used and
  * the production dialog offers only Cloud sign-in for the subscription plan). Every request a flag-off
  * build legitimately sends here (sign-in, identity, subscription entitlement and its public keys,
  * subscription code redemption, the billing snapshot read while the entitlement
  * route is absent, key self-revocation, the connected
  * services under /api/v1/eliza/, Maps data under /api/v1/maps/) goes to the Cloud API, so the only admitted origin is exactly
  * https://api.eliza.app on the default port. A dedicated Cloud agent runtime
  * (https://&lt;agent-uuid&gt;.cloud.eliza.app) is always refused in product builds (P-22/P-31). A paired remote agent's origin
  * is refused even when the renderer presents a saved credential for it; the refusal is decided from
  * the URL alone and touches no credential slot.
  * Test-mocks builds keep every origin the URL validation admits (remote, Cloud and development agents).
  */
 static boolean admittedOrigin(String scheme,String host,int port,boolean testMocks){
  if(testMocks)return true;
  return "https".equals(scheme)&&CloudDeployment.PRODUCTION_API_HOST.equals(host)&&(port==-1||port==443);
 }
 /**
  * In-app Eliza Cloud sign-in (AlphaCloudSignInPlugin). These fixed routes are sent only by the
  * native sign-in client with URLs it builds itself; the renderer transport never admits them, so
  * no Steward session, authorization code or PKCE verifier crosses the bridge (the minted key is
  * stored in the renderer-readable cloud:<environment> slot, like the hand-off's key). The Cloud
  * sign-in hand-off (/api/auth/cli-session, managedService) stays a product route until the in-app
  * readiness probe passes. GETs are the readiness probe's reads; the email code paths match
  * CloudEmailCode and config/cloud-email-code.json.
  */
 static boolean signInRoute(String path,String method,boolean hasBody){
  if(path==null)return false;
  if("GET".equals(method))return !hasBody&&java.util.Set.of("/api/public/service","/api/v1/app-auth/mobile/config","/steward/auth/providers","/steward/auth/oauth/google/authorize").contains(path);
  if(!"POST".equals(method)||!hasBody)return false;
  return java.util.Set.of("/steward/auth/sms/send","/steward/auth/sms/verify","/steward/auth/email/code/send","/steward/auth/email/code/verify","/steward/auth/oauth/exchange",
   "/steward/auth/mfa/totp/complete","/steward/auth/mfa/sms/complete","/steward/auth/logout",
   "/api/v1/app-auth/connect","/api/v1/app-auth/mobile/token","/api/v1/app-auth/mobile/ack").contains(path);
 }
 /** The readiness probe's one read on the return host: its Digital Asset Links statement list. */
 static boolean signInAssetLinks(String scheme,String host,int port,String rawPath,String rawQuery,boolean testMocks){
  if(!"https".equals(scheme)||(port!=-1&&port!=443)||rawQuery!=null||!"/.well-known/assetlinks.json".equals(rawPath))return false;
  return CloudDeployment.PRODUCTION_WEB_HOST.equals(host)||testMocks&&CloudDeployment.STAGING_WEB_HOST.equals(host);
 }
 /** The sign-in client's origin: exactly the environment's Cloud API on the default port. */
 static boolean signInOrigin(String scheme,String host,int port,boolean testMocks){
  if(!"https".equals(scheme)||(port!=-1&&port!=443))return false;
  return CloudDeployment.PRODUCTION_API_HOST.equals(host)||testMocks&&CloudDeployment.STAGING_API_HOST.equals(host);
 }
 /** P-22/P-31: allow current managed APIs; new services need explicit route review. */
 static boolean managedService(String path,String query,String method,boolean hasBody,boolean testMocks){
  if(testMocks)return true;
  if(path==null||path.contains("%")||path.contains("\\")||path.contains("//"))return false;
  if(calendarSync(path,query,method,hasBody))return true;
  if(path.startsWith(CALENDAR_EVENTS))return googleCalendarEvents(path,query,method,hasBody);
  if("DELETE".equals(method))return "/api/v1/api-keys/current".equals(path)&&query==null&&!hasBody;
  // Eliza Cloud Maps (#412): queries and coordinates travel only in a JSON body; capabilities is a bare read.
  if("POST".equals(method)&&path.matches("/api/v1/maps/(geocode|reverse|places/search|places/details|routes)"))return query==null&&hasBody;
  if("/api/v1/maps/capabilities".equals(path))return "GET".equals(method)&&query==null&&!hasBody;
  // Subscription code redemption carries its code and idempotency key in the JSON body only.
  if("POST".equals(method)&&"/api/v1/subscription/redeem".equals(path))return query==null&&hasBody;
  if("POST".equals(method))return query==null&&(java.util.Set.of("/api/auth/cli-session","/api/v1/eliza/google/connect/initiate","/api/v1/eliza/google/disconnect","/api/v1/eliza/google/gmail/inbox-v1/operations").contains(path)||path.matches("/api/v1/eliza/google/gmail/inbox-v1/operations/[A-Za-z0-9_-]{1,160}/dispatch"));
  if(!"GET".equals(method)||hasBody)return false;
  return path.matches("/api/auth/cli-session/[0-9a-fA-F-]{36}")||java.util.Set.of("/api/v1/user","/api/v1/billing/limits","/api/v1/subscription/entitlement","/api/v1/subscription/entitlement-keys","/api/v1/eliza/google/accounts","/api/v1/eliza/google/status","/api/v1/eliza/google/calendar/calendars","/api/v1/eliza/google/calendar/feed","/api/v1/eliza/google/gmail/search","/api/v1/eliza/google/gmail/read").contains(path)||path.matches("/api/v1/eliza/google/gmail/inbox-v1/(capabilities|thread|attachment|drafts|draft)")||path.matches("/api/v1/eliza/google/gmail/inbox-v1/operations/[A-Za-z0-9_-]{1,160}");
 }
 static final String CALENDAR_EVENTS="/api/v1/eliza/google/calendar/events";
 /**
  * Owner-side Google Calendar writes from the Calendar view (route review P-22/P-31):
  * POST /events creates (JSON body, no query); PATCH /events/{id} changes one event (JSON body,
  * no query); DELETE /events/{id} removes one (query names side, grant and calendar; no body).
  * Event ids are [A-Za-z0-9_]{1,1024}; ids that need percent-encoding stay read-only. Unlike the
  * sync-v1 routes these need no native CalendarSyncConsent: the owner makes each change by hand in
  * the Calendar view (deletes wait out an Undo window), and Cloud admits them only for a grant that
  * holds google.calendar.write, which the owner approved on Google's consent page.
  */
 static boolean googleCalendarEvents(String path,String query,String method,boolean hasBody){
  if(path==null)return false;
  if(CALENDAR_EVENTS.equals(path))return "POST".equals(method)&&query==null&&hasBody;
  if(!path.matches("/api/v1/eliza/google/calendar/events/[A-Za-z0-9_]{1,1024}"))return false;
  if("PATCH".equals(method))return query==null&&hasBody;
  if("DELETE".equals(method))return query!=null&&!query.isEmpty()&&!hasBody;
  return false;
 }
 static boolean calendarSync(String path,String query,String method,boolean hasBody){
  if("/api/v1/eliza/google/calendar/sync-v1/capabilities".equals(path))return "GET".equals(method)&&query!=null&&!query.isEmpty()&&!hasBody;
  if(!"/api/v1/eliza/google/calendar/sync-v1/event".equals(path))return false;
  if("GET".equals(method)||"DELETE".equals(method))return query!=null&&!query.isEmpty()&&!hasBody;
  return ("POST".equals(method)||"PATCH".equals(method))&&query==null&&hasBody;
 }
 /**
  * Hosts openExternal may hand to the system browser. A flag-off renderer opens only Cloud sign-in
  * at the configured web origin, subscription management at the configured services origin,
  * and Google's consent page (https://accounts.google.com). Configured staging web/services
  * hosts are admitted only in test-mocks builds. HTTPS on the default port only; exact hosts
  * refuse lookalikes and trailing-dot spellings.
  */
 static boolean externalHost(String scheme,String host,int port,boolean testMocks){
  if(!"https".equals(scheme)||host==null||(port!=-1&&port!=443))return false;
  String value=host.toLowerCase(java.util.Locale.ROOT);
  if(CloudDeployment.PRODUCTION_WEB_HOST.equals(value)||CloudDeployment.PRODUCTION_SERVICES_HOST.equals(value)||"accounts.google.com".equals(value))return true;
  return testMocks&&(CloudDeployment.STAGING_WEB_HOST.equals(value)||CloudDeployment.STAGING_SERVICES_HOST.equals(value));
 }
 /** The Cloud sign-in page, whose return is a browser handoff rather than a fire-and-forget open. */
 static boolean externalCliLogin(String host,String path,boolean testMocks){
  String value=host==null?"":host.toLowerCase(java.util.Locale.ROOT);
  return (CloudDeployment.PRODUCTION_WEB_HOST.equals(value)||testMocks&&CloudDeployment.STAGING_WEB_HOST.equals(value))&&"/auth/cli-login".equals(path);
 }
 /**
  * Request headers this transport forwards. Product builds talk only to the managed Cloud API, which
  * takes Accept, Content-Type and the sign-in Authorization. The device-identity, device-capability
  * and phone-protocol headers declare this phone to a hosted or paired agent runtime; the agent
  * always runs on the phone (#406), so product builds refuse them before any connection is opened.
  * The resident agent negotiates its capabilities over the in-process Agent bridge, not here.
  * Test-mocks builds keep them for development agents. Names must already be lower-case.
  */
 static boolean admittedHeader(String name,boolean testMocks){
  if(name==null)return false;
  if("accept".equals(name)||"content-type".equals(name)||"authorization".equals(name))return true;
  return testMocks&&("x-eliza-device-id".equals(name)||"x-eliza-device-key".equals(name)||"x-eliza-device-capabilities".equals(name)||"x-eliza-phone-protocol".equals(name));
 }
 /** Maps request identity is admitted only on the reviewed POST data routes. */
 static boolean mapsRequestIdentity(String name,String value,String path,String method){
  return "idempotency-key".equals(name)&&value!=null&&value.matches("[A-Za-z0-9_-]{1,128}")&&"POST".equals(method)&&path!=null&&path.matches("/api/v1/maps/(geocode|reverse|places/search|places/details|routes)");
 }
 /**
  * Cloud self-revocation: the presented sign-in key revokes only itself. Exactly
  * DELETE https://api.eliza.app/api/v1/api-keys/current on the default port, without a query
  * or body. The staging authority exists only in test-mocks builds.
  */
 static boolean cloudSelfRevocation(String scheme,String host,int port,String rawPath,String rawQuery,String method,boolean hasBody,boolean testMocks){
  if(!"DELETE".equals(method)||hasBody||rawQuery!=null||!"https".equals(scheme)||(port!=-1&&port!=443))return false;
  if(!(CloudDeployment.PRODUCTION_API_HOST.equals(host)||(testMocks&&CloudDeployment.STAGING_API_HOST.equals(host))))return false;
  return "/api/v1/api-keys/current".equals(rawPath);
 }
}
