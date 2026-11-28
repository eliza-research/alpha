// spec/app/slack/auth.md, "Adding a workspace presents scope consent first, then opens PKCE OAuth with a fresh state nonce"
package ai.alphacompute.alphaphone.slack;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AlphaSlackOAuth")
public final class AlphaSlackOAuthPlugin extends Plugin {
 private String callbackPath() {
  return getConfig().getString("callbackPath");
 }

 private boolean foreground(android.app.Activity activity) {
  var lock = activity.getSystemService(android.app.KeyguardManager.class);
  var users = activity.getSystemService(android.os.UserManager.class);
  return !activity.isFinishing() && !activity.isDestroyed() && activity.hasWindowFocus()
      && activity instanceof androidx.lifecycle.LifecycleOwner owner
      && owner.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
      && lock != null && !lock.isDeviceLocked() && users != null && users.isUserUnlocked();
 }
 private PluginCall pending;
 private String nonce;

 @PluginMethod public void request(PluginCall call) {
  String address = call.getString("url", "");
  Uri url = Uri.parse(address);
  String cloud = getConfig().getString("cloudOrigin");
  boolean registration = (cloud + "/.well-known/alpha-slack").equals(address)
      && "GET".equals(call.getString("method")) && !call.getData().has("data");
  boolean mailbox = "POST".equals(call.getString("method"))
      && ((cloud + "/api/slack/oauth").equals(address)
          || (cloud + "/api/slack/events/read").equals(address));
  boolean api = url.isHierarchical() && "https".equals(url.getScheme()) && "slack.com".equals(url.getEncodedAuthority())
      && url.getEncodedPath() != null && url.getEncodedPath().matches("/api/[A-Za-z][A-Za-z0-9.]*");
  var transport = getBridge().getPlugin("CapacitorHttp");
  if ((!api && !registration && !mailbox) || !Boolean.TRUE.equals(call.getBoolean("disableRedirects"))
      || transport == null || !(transport.getInstance() instanceof com.getcapacitor.plugin.CapacitorHttp http)) {
   call.reject("Slack transport unavailable"); return;
  }
  if (registration) call.getData().put("headers", new JSObject());
  http.request(call);
 }

 @PluginMethod public void authorize(PluginCall call) {
  String source = call.getString("url");
  if (source == null) { call.reject("No Slack authorization request"); return; }
  Uri uri = Uri.parse(source);
  if (!uri.isHierarchical() || !"https".equals(uri.getScheme()) || !"slack.com".equals(uri.getEncodedAuthority())
      || !"/oauth/v2/authorize".equals(uri.getEncodedPath()) || !("alphaphone://slack" + callbackPath()).equals(uri.getQueryParameter("redirect_uri"))
      || !"S256".equals(uri.getQueryParameter("code_challenge_method")) || uri.getQueryParameter("scope") != null) {
   call.reject("Invalid Slack authorization request"); return;
  }
  String state = uri.getQueryParameter("state");
  if (state == null || !state.matches("[A-Za-z0-9_-]{32}")) { call.reject("Invalid Slack authorization state"); return; }
  android.app.Activity activity = getActivity();
  if (activity == null) { call.reject("Open Alpha to connect Slack"); return; }
  activity.runOnUiThread(() -> {
   if (!foreground(activity)) { call.reject("Open Alpha to connect Slack"); return; }
   if (pending != null) pending.reject("Slack authorization superseded");
   pending = call;
   nonce = state;
   try { activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
   catch (RuntimeException unavailable) { pending = null; nonce = null; call.reject("No Slack authorization browser"); }
  });
 }

 @Override protected void handleOnNewIntent(Intent intent) {
  Uri url = intent.getData();
  if (!Intent.ACTION_VIEW.equals(intent.getAction()) || url == null || !url.isHierarchical()
      || !"alphaphone".equals(url.getScheme()) || !"slack".equals(url.getEncodedAuthority())
      || !java.util.Objects.equals(callbackPath(), url.getEncodedPath()) || url.getEncodedFragment() != null) return;
  intent.setData(null);
  if (pending == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
  var states = url.getQueryParameters("state");
  if (states.size() != 1 || !nonce.equals(states.get(0))) return;
  var codes = url.getQueryParameters("code");
  var errors = url.getQueryParameters("error");
  if (!(codes.size() == 1 && errors.isEmpty() || errors.size() == 1 && codes.isEmpty())) return;
  PluginCall caller = pending;
  pending = null;
  nonce = null;
  caller.resolve(new JSObject().put("state", states.get(0)).put("code", codes.isEmpty() ? "" : codes.get(0)).put("error", errors.isEmpty() ? "" : errors.get(0)));
 }

 @Override protected void handleOnDestroy() {
  if (pending != null) pending.reject("Slack authorization ended");
  pending = null;
  nonce = null;
 }
}
