package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;

/** Carries the mounted renderer's raw request to the exact Java bridge without reconstructing it. */
public final class AppInfoHandoffProbe {
 public static void main(String[] args) {
  JSONObject input = new JSONObject(args[0]);
  JSONObject environment = new JSONObject(args[1]);
  Context host = new Context();
  host.personal.status = environment.getString("personal");
  host.launcher.packages.status = environment.getString("work");
  host.profile = host.launcher.profile = host.users.profile = environment.getString("profile");
  host.launch = host.launcher.launch = environment.getString("launch");
  AlphaSystemPlugin plugin = new AlphaSystemPlugin();
  plugin.attach(host);
  JSObject request = new JSObject();
  for (String key : input.keySet()) request.put(key, input.get(key));
  PluginCall call = new PluginCall(request);
  plugin.openAppInfo(call);
  if (!call.answered) throw new AssertionError("Native request did not settle");

  PackageManager personal = host.personal;
  PackageManager work = host.launcher.packages;
  if (personal.name != null && work.name != null || host.attempt != null && host.launcher.attempt != null)
   throw new AssertionError("One bridge call must not fall back across profiles");
  PackageManager queried = personal.name != null ? personal : work.name != null ? work : null;
  System.out.println(new JSONObject()
      .put("resolved", call.resolved)
      .put("code", call.code == null ? "" : call.code)
      .put("message", call.reason == null ? "" : call.reason)
      .put("queryPackage", queried == null ? "" : queried.name)
      .put("queryUser", host.launcher.queryUser == null ? -1 : host.launcher.queryUser.id())
      .put("queryFlags", queried == null ? 0 : queried.flags)
      .put("launchUser", host.launcher.launchUser == null ? -1 : host.launcher.launchUser.id())
      .put("intentAction", host.attempt == null ? "" : host.attempt.action)
      .put("intentFlags", host.attempt == null ? 0 : host.attempt.flags)
      .put("target", host.attempt != null ? host.attempt.data.toString()
          : host.launcher.attempt != null ? host.launcher.attempt.flattened() : "")
      .put("opened", host.opened || host.launcher.opened));
 }
}
