package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.CloudSignInFlow;
import ai.eliza.auth.cloud.CloudSignInEnvironment;
import ai.eliza.auth.cloud.CloudSignInConfig;
import ai.eliza.plugins.browsersurface.BrowserSitePermissionRecord;

import ai.eliza.plugins.browsersurface.BrowserSitePermissions;
import ai.eliza.plugins.browsersurface.BrowserDownloadPolicy;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ServicePolicies {
 static JSONArray identity() {
  JSONArray traces = new JSONArray();
  CloudSignInEnvironment environment = new CloudSignInEnvironment("production", CloudDeployment.PRODUCTION_API_HOST,
    CloudDeployment.PRODUCTION_WEB_HOST, CloudDeployment.PRODUCTION_TENANT, CloudDeployment.PRODUCTION_NAME, "/alphaphone/auth/callback");
  CloudSignInConfig config = CloudSignInConfig.builder().clientId("ai.elizaresearch.alphaphone")
    .deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone").environment(environment).build();
  for (int variant = 0; variant < 3; variant++) {
   long now = 1000;
   CloudSignInFlow.Pending original = CloudSignInFlow.Pending.create(environment, now);
   CloudSignInFlow.Pending restored = CloudSignInFlow.Pending.parse(original.serialize(), config);
   Trace trace = new Trace("pending-reload-and-return-" + variant, Trace.fields("callbackAccepted", false));
   trace.step("begin", Trace.fields("pending", restored != null && !restored.expired(now)), "google");
   String state = variant == 0 ? CloudSignInFlow.newState() : restored.state;
   CloudSignInFlow.Callback callback = CloudSignInFlow.parseCallback(restored.environment.callback() + "#code=fixture-code&state=" + state, restored.environment);
   boolean accepted = restored.matches(callback, variant == 2 ? restored.expiresAt : now);
   if (variant == 2) trace.step("expire", Trace.fields("pending", !restored.expired(restored.expiresAt)));
   else trace.step("callback", Trace.fields("callbackAccepted", accepted), accepted ? 1 : 0);
   if (accepted != (variant == 1)) throw new AssertionError("callback admission");
   traces.put(trace.value);
  }
  return traces;
 }
 static String decision(Boolean value) { return value == null ? "unset" : value ? "allow" : "deny"; }
 static JSONObject decisions(BrowserSitePermissions permissions) {
  return new JSONObject().put("quintCollection", "map").put("entries", new JSONArray()
    .put(new JSONArray().put(1).put(decision(permissions.decision("https://a.example", "camera", false))))
    .put(new JSONArray().put(2).put(decision(permissions.decision("https://b.example", "camera", false)))));
 }
 static JSONArray sites() throws Exception {
  JSONArray traces = new JSONArray();
  for (boolean privateTab : new boolean[]{false, true}) for (boolean allow : new boolean[]{false, true}) {
   BrowserSitePermissions permissions = BrowserSitePermissionRecord.read(null);
   Trace trace = new Trace("site-decision-" + privateTab + allow, Trace.fields("decisions", decisions(permissions)));
   trace.value.put("init", Trace.action("initFor", privateTab));
   // WebView construction is an environmental precondition of this persistence projection.
   trace.step("build", Trace.fields("decisions", decisions(permissions)), true);
   trace.macro("page and permission request", Trace.fields("decisions", decisions(permissions)), Trace.action("navigate", 1), Trace.action("commit"), Trace.action("permissionRequest", 1));
   permissions.record("https://a.example", "camera", allow, privateTab);
   permissions = BrowserSitePermissionRecord.read(BrowserSitePermissionRecord.write(permissions));
   trace.step("permissionDecision", Trace.fields("decisions", decisions(permissions)), allow);
   traces.put(trace.value);
  }
  return traces;
 }
 static JSONArray downloads() {
  JSONArray traces = new JSONArray();
  for (boolean ephemeral : new boolean[]{false, true}) {
   BrowserDownloadPolicy.History history = new BrowserDownloadPolicy.History();
   Trace trace = new Trace("download-policy-" + ephemeral, Trace.fields("entry", !history.all().isEmpty()));
   trace.value.put("init", Trace.action("initFor", ephemeral));
   BrowserDownloadPolicy.Entry entry = new BrowserDownloadPolicy.Entry(1, "fixture.txt", "https://a.example", ephemeral, ephemeral ? "tab-A" : null).started();
   history.add(entry);
   trace.macro("transfer entry is not durable while running", Trace.fields("entry", history.get(1) != null, "persisted", !history.persistable().isEmpty()), Trace.action("request", "signed"), Trace.action("approve"));
   trace.step("requestHop", Trace.fields("cookieSent", BrowserDownloadPolicy.cookieAllowed("https://a.example/file", "https://a.example", true)));
   trace.macro("redirect checks actual target origin again", Trace.fields("cookieSent", BrowserDownloadPolicy.cookieAllowed("https://b.example/file", "https://a.example", true)), Trace.action("redirect", 2), Trace.action("requestHop"));
   history.replace(entry.finished("content://fixture/published"));
   trace.macro("provider receipt makes finished entry durable only for normal profile", Trace.fields("persisted", !history.persistable().isEmpty(), "completed", history.get(1).uri != null), Trace.action("response"), Trace.action("publish"));
   history.forgetEphemeralTab("tab-A");
   trace.step("closeTab", Trace.fields("entry", history.get(1) != null, "persisted", !history.persistable().isEmpty()));
   BrowserDownloadPolicy.History restarted = new BrowserDownloadPolicy.History(); restarted.restore(history.persistable());
   trace.step("restart", Trace.fields("entry", restarted.get(1) != null));
   traces.put(trace.value);
  }
  return traces;
 }
 public static void main(String[] args) throws Exception {
  System.out.println(new JSONObject().put("IdentitySession", identity()).put("BrowserSiteState", sites()).put("BrowserDownloads", downloads()));
 }
}
