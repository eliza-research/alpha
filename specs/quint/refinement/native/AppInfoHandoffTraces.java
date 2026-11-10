package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.Intent;
import android.content.pm.LauncherApps;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exercises the production entry point and records only closed Android and Capacitor ports. */
public final class AppInfoHandoffTraces {
 private static final String PACKAGE = "fixture.app";
 private final Context host = new Context();
 private final AlphaSystemPlugin plugin = new AlphaSystemPlugin();
 private final Trace trace;
 private String entry = "personal";
 private PluginCall call;

 private AppInfoHandoffTraces(String name) {
  plugin.attach(host);
  trace = new Trace(name, state());
 }

 private JSONObject state() {
  PackageManager personal = host.personal;
  LauncherApps launcher = host.launcher;
  PackageManager work = launcher.packages;
  Intent personalAttempt = host.attempt;
  boolean personalQuery = personal.name != null, workQuery = work.name != null, workAttempt = launcher.attempt != null;
  if (personalQuery && workQuery || personalAttempt != null && workAttempt)
   throw new AssertionError("One invocation must not fall back across profiles");
  PackageManager queried = personalQuery ? personal : workQuery ? work : null;
  if (queried != null && (!PACKAGE.equals(queried.name) || queried.flags != PackageManager.MATCH_DISABLED_COMPONENTS))
   throw new AssertionError("Look up the named package including disabled apps");
  if (personalAttempt != null && personalAttempt.flags != Intent.FLAG_ACTIVITY_NEW_TASK)
   throw new AssertionError("Personal App info needs exactly NEW_TASK");
  return Trace.fields("entry", entry, "personalStatus", personal.status, "workStatus", work.status,
      "profile", host.profile, "launch", host.launch,
      "reply.result", result(), "reply.query", personalQuery ? "personal" : workQuery ? "work" : "none",
      "reply.queryUser", launcher.queryUser == null ? -1 : launcher.queryUser.id(),
      "reply.includeDisabled", queried != null && (queried.flags & PackageManager.MATCH_DISABLED_COMPONENTS) != 0,
      "reply.attempt", personalAttempt != null ? "personal" : workAttempt ? "work" : "none",
      "reply.launchUser", workAttempt ? launcher.launchUser.id() : -1,
      "reply.target", personalAttempt != null ? personalAttempt.data.toString() : workAttempt ? launcher.attempt.flattened() : "",
      "reply.intentAction", personalAttempt != null ? personalAttempt.action : "",
      "reply.newTask", personalAttempt != null && (personalAttempt.flags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
      "reply.opened", host.opened || launcher.opened);
 }

 private String result() {
  if (call == null) return "none";
  if (!call.answered) throw new AssertionError("Native request did not settle");
  if (call.resolved) return "resolved";
  if (call.code == null && "Choose an installed app".equals(call.reason)) return "invalid";
  if ("not-installed".equals(call.code)) {
   String message = host.personal.name != null ? "This app is no longer installed." : "This app is no longer available in that profile.";
   if (message.equals(call.reason)) return "notInstalled";
  }
  if ("profile-unavailable".equals(call.code) && "This profile is no longer on the phone.".equals(call.reason))
   return "profileUnavailable";
  if ("failed".equals(call.code) && "App info could not be opened".equals(call.reason) && call.failure instanceof SecurityException)
   return "failed";
  throw new AssertionError("Unexpected native reply " + call.code + " " + call.reason);
 }

 private JSObject payload() {
  JSObject data = new JSObject();
  switch (entry) {
   case "missingPackage" -> {}
   case "nullPackage" -> data.put("packageName", JSONObject.NULL);
   case "emptyPackage" -> data.put("packageName", "");
   case "numericPackage" -> data.put("packageName", 8);
   case "ownPackage" -> data.put("packageName", host.getPackageName());
   default -> data.put("packageName", PACKAGE);
  }
  switch (entry) {
   case "personal" -> data.put("activityName", "fixture.app.Personal");
   case "nullUser" -> data.put("user", JSONObject.NULL);
   case "work" -> data.put("user", "270").put("activityName", "fixture.app.Work");
   case "workNoActivity" -> data.put("user", "270");
   case "workEmptyActivity" -> data.put("user", "270").put("activityName", "");
   case "workNullActivity" -> data.put("user", "270").put("activityName", JSONObject.NULL);
   case "currentProfile" -> data.put("user", "10");
   case "numericActivity" -> data.put("user", "270").put("activityName", 12);
   case "numericUser" -> data.put("user", 270);
   case "badSerial" -> data.put("user", "9223372036854775808");
   default -> {}
  }
  return data;
 }

 private void clearObservation() {
  call = null;
  host.personal.name = host.launcher.packages.name = null;
  host.launcher.queryUser = host.launcher.launchUser = null;
  host.launcher.attempt = null;
  host.attempt = null;
  host.launcher.opened = host.opened = false;
 }

 private AppInfoHandoffTraces select(String selected) {
  entry = selected;
  clearObservation();
  trace.step("selectEntry", state(), selected);
  return this;
 }

 private AppInfoHandoffTraces personal(String status) {
  host.personal.status = status;
  trace.step("setPersonalStatus", state(), status);
  return this;
 }

 private AppInfoHandoffTraces work(String status) {
  host.launcher.packages.status = status;
  trace.step("setWorkStatus", state(), status);
  return this;
 }

 private AppInfoHandoffTraces profile(String profile) {
  host.profile = host.launcher.profile = host.users.profile = profile;
  trace.step("setProfile", state(), profile);
  return this;
 }

 private AppInfoHandoffTraces launch(String outcome) {
  host.launch = host.launcher.launch = outcome;
  trace.step("setLaunch", state(), outcome);
  return this;
 }

 private AppInfoHandoffTraces invoke() {
  clearObservation();
  call = new PluginCall(payload());
  plugin.openAppInfo(call);
  trace.step("invoke", state());
  return this;
 }

 private static AppInfoHandoffTraces scenario(String name) {return new AppInfoHandoffTraces(name);}

 public static void main(String[] args) {
  JSONArray traces = new JSONArray();
  traces.put(scenario("personal package details").invoke().select("nullUser").invoke().trace.value);
  traces.put(scenario("disabled personal package").personal("disabled").invoke().trace.value);
  traces.put(scenario("personal package removed after selection").select("personal").personal("removed").invoke().trace.value);
  traces.put(scenario("exact work profile and component").select("work").invoke().trace.value);
  traces.put(scenario("work component package fallback").select("workNoActivity").invoke().select("workEmptyActivity").invoke()
      .select("workNullActivity").invoke().trace.value);
  traces.put(scenario("disabled work package in a paused or locked profile").select("work").work("disabled").profile("paused").invoke()
      .profile("locked").invoke().trace.value);
  traces.put(scenario("work package removed after selection without personal fallback").select("work").work("removed").invoke().trace.value);
  traces.put(scenario("work profile removed or unavailable after selection").select("work").profile("removed").invoke()
      .profile("unmapped").invoke().profile("noUsers").invoke().profile("noLauncher").invoke().trace.value);
  traces.put(scenario("current profile serial does not use personal fallback").select("currentProfile").invoke().trace.value);
  AppInfoHandoffTraces malformed = scenario("invalid arguments refuse before lookup");
  for (String entry : new String[]{"ownPackage","missingPackage","nullPackage","emptyPackage","numericPackage","numericActivity","numericUser","badSerial"})
   malformed.select(entry).invoke();
  traces.put(malformed.trace.value);
  traces.put(scenario("platform lookup refusal").personal("denied").invoke().select("work").work("denied").invoke()
      .profile("denied").invoke().trace.value);
  traces.put(scenario("dispatch refusals preserve exact attempted target").launch("argument").invoke().launch("runtime").invoke()
      .select("work").invoke().launch("argument").invoke().trace.value);
  System.out.println(traces);
 }
}
