package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SenseListenerClient;
import android.app.ComponentCaller;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.service.quicksettings.Tile;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.Map;
import org.json.JSONObject;

public final class AssistantEntryTraces {
 private static final String HOST = "fixture.alpha";
 private static final String OWNER = "33333333-3333-4333-8333-333333333333";
 private static final String OTHER_OWNER = "44444444-4444-4444-8444-444444444444";
 private static final String SESSION = "c".repeat(64);
 private static final AlphaAssistActivity[] views = new AlphaAssistActivity[3];
 private static final boolean[] retainedLoadIntent = new boolean[3];
 private static final Intent[] loadIntent = new Intent[3];
 private static final JSONObject[] beforeLoad = new JSONObject[3];
 private static final AlphaQuickSettingsTile tile = new AlphaQuickSettingsTile();
 private static JSONObject result = reply("none", null, false, true);
 private static Trace trace;

 private static Object mapEntry(String name, Object key) throws Exception {
  Field field = SenseListenerClient.class.getDeclaredField(name);
  field.setAccessible(true);
  return ((Map<?, ?>)field.get(null)).get(key);
 }

 private static int accountClass(Object account) {
  if ("account-a".equals(account)) return 1;
  if ("account-b".equals(account)) return 2;
  if (account == null) return 0;
  throw new AssertionError("Unexpected synthetic account");
 }

 private static JSONObject invocation() throws Exception {
  Object state = mapEntry("invocations", HOST);
  Object origin = state == null ? null : Trace.read(state, "origin");
  return new JSONObject().put("origin", origin == null ? "none" : origin)
    .put("at", origin == null ? 0 : Trace.read(state, "arrivedAt"))
    .put("locked", origin == null ? true : Trace.read(state, "locked"))
    .put("coldOwner", state == null ? 0 : accountClass(Trace.read(state, "coldOwner")))
    .put("adopted", state != null && (boolean)Trace.read(state, "adopted"));
 }

 public static void beforeBridgeReentry(BridgeActivity activity) {
  try {
   beforeLoad[activity.taskId] = invocation();
   loadIntent[activity.taskId] = activity.getIntent();
  }
  catch (Exception error) { throw new AssertionError(error); }
 }

 private static JSONObject grant(AlphaAssistActivity activity) throws Exception {
  Object launch = activity == null ? null : mapEntry("powerLaunches", activity);
  Object validator = launch == null ? null : Trace.read(launch, "validator");
  return new JSONObject().put("present", launch != null)
    .put("invalid", launch != null && (boolean)Trace.read(launch, "invalid"))
    .put("focused", launch != null && (boolean)Trace.read(launch, "focused"))
    .put("bridge", launch == null ? 0 : Trace.read(launch, "bridge"))
    .put("bound", launch != null && SESSION.equals(Trace.read(launch, "session")))
    .put("at", launch == null ? 0 : Trace.read(launch, "arrivedAt"))
    .put("account", validator == null ? 0 : accountClass(Trace.read(validator, "account")))
    .put("epoch", validator == null ? 0 : Trace.read(validator, "mutation"));
 }

 private static boolean clean(Intent intent, Class<?> target, boolean assistant) {
  if (intent == null || intent.target != target || !Intent.ACTION_ASSIST.equals(intent.getAction())
      || intent.getData() != null || intent.getType() != null || intent.getCategories() != null
      || intent.getPackage() != null || intent.component != null) return false;
  return assistant ? intent.flags == 0 && intent.extraKeys().equals(java.util.Set.of("alpha.assistant"))
    && intent.getBooleanExtra("alpha.assistant", false)
    : intent.flags == (Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP) && intent.extraKeys().isEmpty();
 }

 private static JSONObject surface(int id) throws Exception {
  AlphaAssistActivity view = views[id];
  JSONObject before = beforeLoad[id];
  Object activityBinding = view == null ? null : mapEntry("activityBridges", view);
  if (view != null && view.getBridge() != null) {
   var bridge = view.getBridge();
   if (bridge.windowEvents.stream().anyMatch(event -> !event.equals("alpha:assist-invocation")))
    throw new AssertionError("Unexpected window event");
   if (bridge.intentDeliveries.size() != bridge.windowEvents.size()
       || bridge.intentDeliveries.stream().anyMatch(intent -> !clean(intent, view.getClass(), true))
       || !bridge.intentDeliveries.isEmpty() && bridge.intentDeliveries.getLast() != view.getIntent())
    throw new AssertionError("Capacitor must receive each exact sanitized Intent");
  }
  return new JSONObject()
    .put("kind", view == null ? "none" : view instanceof AlphaPowerVoiceActivity ? "power" : "assist")
    .put("live", view != null && !view.isDestroyed()).put("bridge", view != null && view.getBridge() != null)
    .put("clean", view != null && clean(view.getIntent(), view.getClass(), true))
    .put("focus", view != null && view.hasWindowFocus())
    .put("events", view == null || view.getBridge() == null ? 0 : view.getBridge().windowEvents.size())
    .put("beforeLoad", before == null ? "none" : before.getString("origin"))
    .put("beforeCold", before == null ? 0 : before.getInt("coldOwner"))
    .put("retainedLoadIntent", retainedLoadIntent[id])
    .put("activityBinding", activityBinding == null ? 0 : activityBinding)
    .put("grant", grant(view));
 }

 private static JSONObject tileState() {
  Tile current = tile.tile;
  PendingIntent pending = tile.pendingEntry;
  if (current.updates > 0 && (!"resource-201".contentEquals(current.label)
      || !"resource-204".contentEquals(current.description) || current.icon.id() != 205))
    throw new AssertionError("Wrong assistant tile presentation");
  if (pending != null && (pending.code() != 41 ||
      pending.flags() != (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)))
    throw new AssertionError("Unexpected tile PendingIntent authority");
  return new JSONObject().put("updates", current.updates)
    .put("subtitle", current.subtitle == null ? "none" : switch (current.subtitle.toString()) {
     case "resource-202" -> "locked";
     case "resource-203" -> "open";
     default -> throw new AssertionError("Unexpected subtitle");
    })
    .put("inactive", current.state == Tile.STATE_INACTIVE).put("awaitingUnlock", tile.unlock != null)
    .put("launches", tile.launches).put("dispatch", tile.entry == null ? "none" : pending == null ? "intent" : "pending-intent")
    .put("clean", clean(tile.entry, AlphaAssistActivity.class, false));
 }

 private static String policy() {
  if (!Context.mic) return "no-mic";
  if (AlphaLocalAgentPlugin.stopping) return "stopping";
  if (AlphaLocalAgentPlugin.credentialMutationEpoch != -1) return "mutation";
  if (AlphaLocalAgentPlugin.credentialShutdownRequest != -1) return "shutdown";
  if (!AlphaCredentialStore.available) return "unavailable";
  return AlphaCredentialStore.production ? "current" : "nonproduction";
 }

 private static JSONObject observe() throws Exception {
  Object state = mapEntry("invocations", HOST);
  Object latest = state == null ? 0 : Trace.read(state, "bridgeGeneration");
  return Trace.fields("sdk", Build.VERSION.SDK_INT, "now", SystemClock.now, "locked", Context.keyguard.locked,
    "policy", policy(), "account", accountClass(AlphaCredentialStore.account),
    "epoch", AlphaLocalAgentPlugin.powerAuthorizationMutationEpoch,
    "signers", Context.packages.listener && Context.packages.system, "protected", Context.packages.protectedPower,
    "latest", latest, "bound", state != null && Trace.read(state, "session") != null ? latest : 0,
    "invocation", invocation(), "surfaces", new JSONObject().put("1", surface(1)).put("2", surface(2)),
    "tile", tileState(), "reply", result);
 }

 private static JSONObject reply(String kind, String origin, boolean assistant, boolean locked) {
  return new JSONObject().put("kind", kind).put("origin", origin == null ? "none" : origin)
   .put("assistant", assistant).put("locked", locked);
 }

 private static Intent hostile() {
  Intent intent = new Intent(Intent.ACTION_VIEW).setData("fixture://caller-data").setType("text/plain")
    .setPackage("untrusted").addCategory("caller-category").addFlags(128)
    .putExtra("caller", HOST + ".sense").putExtra("invocation", "power").putExtra("alpha.assistant", false);
  intent.brokenExtras = true;
  return intent;
 }

 private static String callerPackage(String caller) {
  return switch (caller) {
   case "listener" -> HOST + ".sense";
   case "system" -> "com.android.systemui";
   case "foreign" -> "fixture.alpha.unknown";
   case "none" -> null;
   default -> throw new AssertionError(caller);
  };
 }

 private static void create(int id, String kind, boolean restored, boolean bridge, String caller) throws Exception {
  createWithLoad(id, kind, restored, bridge, caller, true);
 }

 private static void createWithLoad(int id, String kind, boolean restored, boolean bridge, String caller,
                                    boolean exactLoad) throws Exception {
  MainActivityPorts.bridgeAvailable = bridge;
  AlphaAssistActivity view = kind.equals("power") ? new AlphaPowerVoiceActivity() : new AlphaAssistActivity();
  views[id] = view;
  view.taskId = id;
  view.copyLoadIntent = !exactLoad;
  view.launchedFrom = callerPackage(caller);
  view.setIntent(hostile());
  view.onCreate(restored ? new Bundle() : null);
  retainedLoadIntent[id] = loadIntent[id] != null && loadIntent[id] == view.getIntent();
  if (exactLoad) trace.step("create", observe(), id, kind, restored, bridge, caller);
  else trace.step("createWithLoad", observe(), id, kind, restored, bridge, caller, false);
 }

 private static void offer(int id, String caller, boolean modern) throws Exception {
  AlphaAssistActivity view = views[id];
  String name = callerPackage(caller);
  if (modern) view.onNewIntent(hostile(), name == null ? null : new ComponentCaller(name));
  else view.onNewIntent(hostile());
  trace.step("offer", observe(), id, caller, modern);
 }

 private static SenseListenerClient sense(int id) { return new SenseListenerClient(views[id]); }

 private static void bind(int id) throws Exception {
  sense(id).attachProtectedPowerBridge(id);
  sense(id).bindInvocationSession(id, 1, OWNER, SESSION);
  trace.step("bind", observe(), id);
 }

 private static void focus(int id, boolean value) throws Exception {
  views[id].onWindowFocusChanged(value);
  trace.step("focus", observe(), id, value);
 }

 private static void retire(int id, boolean destroyed) throws Exception {
  if (destroyed) views[id].onDestroy(); else views[id].onPause();
  trace.step("retire", observe(), id, destroyed);
 }

 private static void release(int id) throws Exception {
  sense(id).releaseInvocationBridge(id);
  trace.step("release", observe(), id);
 }

 private static void readSurface(int id) throws Exception {
  AlphaLocalAgentPlugin plugin = new AlphaLocalAgentPlugin();
  plugin.attach(views[id] == null ? new MainActivity() : views[id]);
  PluginCall surface = new PluginCall(), invocation = new PluginCall();
  plugin.launchSurface(surface);
  plugin.takeInvocation(invocation);
  if (!surface.result.keySet().equals(java.util.Set.of("assistant"))
      || surface.result.getBoolean("assistant") != invocation.result.getBoolean("assistant")
      || !java.util.Set.of("assistant","invocation","locked").containsAll(invocation.result.keySet()))
    throw new AssertionError("Unexpected legacy reply shape");
  result = reply("legacy", invocation.result.optString("invocation", null),
    invocation.result.getBoolean("assistant"), invocation.result.getBoolean("locked"));
  trace.step("readSurface", observe(), id);
 }

 private static void take(int id, boolean foreground, boolean exact) throws Exception {
  Bundle taken = sense(id).takeInvocation(id, 1, exact ? OWNER : OTHER_OWNER, SESSION, foreground);
  result = reply("sense", taken.getString("invocation"), taken.getBoolean("assistant"), taken.getBoolean("locked"));
  trace.step("take", observe(), id, foreground, exact);
 }

 private static void claim(int id, int account, boolean foreground, boolean exact) throws Exception {
  Bundle taken = sense(id).claimProtectedPowerLaunch(id, 1, exact ? OWNER : OTHER_OWNER, SESSION,
    account == 1 ? "account-a" : "account-b", foreground);
  result = reply("claim", taken.getString("invocation"), taken.getBoolean("assistant"), taken.getBoolean("locked"));
  trace.step("claim", observe(), id, account, foreground, exact);
 }

 private static void env(boolean locked, String policy, boolean signers, boolean protectedPower) throws Exception {
  Context.keyguard.locked = tile.locked = locked;
  Context.mic = !policy.equals("no-mic");
  AlphaLocalAgentPlugin.stopping = policy.equals("stopping");
  AlphaLocalAgentPlugin.credentialMutationEpoch = policy.equals("mutation") ? 1 : -1;
  AlphaLocalAgentPlugin.credentialShutdownRequest = policy.equals("shutdown") ? 1 : -1;
  AlphaCredentialStore.available = !policy.equals("unavailable");
  AlphaCredentialStore.production = !policy.equals("nonproduction");
  Context.packages.listener = Context.packages.system = signers;
  Context.packages.protectedPower = protectedPower;
  trace.step("environment", observe(), locked, policy, signers, protectedPower);
 }

 private static void replaceAuthority(int account) throws Exception {
  synchronized (AlphaLocalAgentPlugin.lifecycleLock) {
   synchronized (ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK) {
    AlphaLocalAgentPlugin.powerAuthorizationMutationEpoch++;
    AlphaCredentialStore.account = account == 1 ? "account-a" : "account-b";
    AlphaCredentialStore.generation = account == 1 ? "generation-a" : "generation-b";
   }
  }
  trace.step("replaceAuthority", observe(), account);
 }

 private static void tick(int value) throws Exception {
  SystemClock.now = value;
  trace.step("tick", observe(), value);
 }

 private static void listen(boolean present) throws Exception {
  Tile current = tile.tile;
  if (!present) tile.tile = null;
  try { tile.onStartListening(); }
  finally { tile.tile = current; }
  trace.step("tileListen", observe(), present);
 }

 private static void click() throws Exception {
  tile.onClick();
  trace.step("tileClick", observe());
 }

 private static void unlock(boolean delivered) throws Exception {
  Runnable callback = tile.unlock;
  if (callback == null) throw new AssertionError("No pending system unlock");
  tile.unlock = null;
  if (delivered) {
   Context.keyguard.locked = tile.locked = false;
   callback.run();
  }
  trace.step("tileUnlock", observe(), delivered);
 }

 private static void preparePower() throws Exception {
  create(1, "power", false, true, "none");
  bind(1);
  focus(1, true);
 }

 public static void main(String[] args) throws Exception {
  String name = args[0];
  int sdk = Integer.parseInt(args[1]);
  BuildConfig.IS_LAUNCHER = false;
  Build.VERSION.SDK_INT = sdk;
  new SenseListenerClient(Context.APP).admitOwner(() -> AlphaCredentialStore.account);
  trace = new Trace(name, observe());
  trace.value.put("init", Trace.action("initWith", sdk));
  switch (name) {
   case "cold-listener", "cold-system" -> {
    create(1, "assist", false, true, name.substring(5));
    readSurface(1); bind(1); take(1, true, true); take(1, true, true);
   }
   case "cold-exact-deadline", "cold-expired" -> {
    create(1, "assist", false, true, "listener");
    tick(name.equals("cold-exact-deadline") ? 15100 : 15101);
    bind(1); take(1, true, true);
   }
   case "cold-rebound" -> {
    create(1, "assist", false, true, "system");
    replaceAuthority(2); bind(1); take(1, true, true);
   }
   case "cold-locked" -> {
    env(true, "current", true, true);
    create(1, "assist", false, true, "system");
    env(false, "current", true, true); bind(1); take(1, true, true);
   }
   case "public-same-object" -> {
    create(1, "assist", false, true, "listener");
    AlphaAssistActivity view = views[1];
    view.onNewIntent(view.getIntent());
    trace.macro("Public one-argument same-object delivery after load", observe(), Trace.action("offer", 1, "none", false));
    bind(1); take(1, true, true);
    view.onNewIntent(view.getIntent(), new ComponentCaller(callerPackage("system")));
    trace.macro("Public caller delivery with same object after load", observe(), Trace.action("offer", 1, "system", true));
    take(1, true, true);
   }
   case "copy-during-load" -> {
    createWithLoad(1, "assist", false, true, "listener", false);
    bind(1); take(1, true, true);
   }
   case "restored-and-warm" -> {
    readSurface(1);
    create(1, "assist", true, true, "listener");
    bind(1); offer(1, "listener", true); readSurface(1);
    take(1, true, false); take(1, false, true); take(1, true, true); take(1, true, true);
    offer(1, "system", true); take(1, true, true);
    offer(1, "foreign", true); take(1, true, true);
    env(false, "current", false, true);
    offer(1, "listener", true); take(1, true, true);
    offer(1, "system", true); take(1, true, true);
   }
   case "legacy-caller" -> {
    create(1, "assist", false, true, "listener");
    bind(1); offer(1, "listener", false); take(1, true, true);
   }
   case "cold-no-bridge" -> {
    create(1, "assist", false, false, "listener");
    readSurface(1);
   }
   case "locked-warm" -> {
    create(1, "assist", false, true, "none"); bind(1);
    env(true, "current", true, true); offer(1, "system", true); readSurface(1);
    env(false, "current", true, true); take(1, true, true);
    offer(1, "system", true); env(true, "current", true, true); take(1, true, true);
   }
   case "power-exact" -> {
    preparePower(); readSurface(1); tick(5100);
    claim(1, 1, true, false); claim(1, 1, true, true); claim(1, 1, true, true);
    offer(1, "none", true); take(1, false, true); take(1, true, true);
    offer(1, "foreign", true); take(1, true, true);
   }
   case "power-focus" -> {
    preparePower(); focus(1, false); focus(1, true); claim(1, 1, true, true);
   }
   case "power-pause" -> {
    preparePower(); retire(1, false); claim(1, 1, true, true);
   }
   case "power-destroy" -> {
    preparePower(); retire(1, true); claim(1, 1, true, true);
   }
   case "power-expired" -> {
    preparePower(); tick(5101); claim(1, 1, true, true);
   }
   case "power-wrong-account" -> {
    preparePower(); claim(1, 2, true, true); claim(1, 1, true, true);
   }
   case "power-replaced-account", "power-replaced-epoch" -> {
    preparePower(); replaceAuthority(name.endsWith("account") ? 2 : 1); claim(1, 1, true, true);
   }
   case "power-mic-revoked" -> {
    preparePower(); env(false, "no-mic", true, true); claim(1, 1, true, true);
    env(false, "current", true, true); claim(1, 1, true, true);
   }
   case "power-restored" -> {
    create(1, "power", true, true, "system"); bind(1); focus(1, true); claim(1, 1, true, true);
   }
   case "power-locked" -> {
    env(true, "current", true, true);
    create(1, "power", false, true, "none"); bind(1); focus(1, true);
    env(false, "current", true, true); claim(1, 1, true, true);
   }
   case "power-unprotected" -> {
    env(false, "current", true, false);
    create(1, "power", false, true, "none"); bind(1); focus(1, true);
    claim(1, 1, true, true); offer(1, "none", true); take(1, true, true);
   }
   case "stale-power" -> {
    preparePower();
    create(2, "assist", false, true, "none"); bind(2); offer(2, "system", true);
    bind(1); offer(1, "none", true); retire(1, true); release(1);
    take(2, true, true);
   }
   case "tile" -> {
    listen(false); listen(true); click(); env(true, "current", true, true);
    listen(true); click(); unlock(false); click(); unlock(true); listen(true);
   }
   default -> {
    if (!name.startsWith("power-denied-")) throw new AssertionError(name);
    env(false, name.substring("power-denied-".length()), true, true);
    create(1, "power", false, true, "none"); bind(1); focus(1, true);
    env(false, "current", true, true); claim(1, 1, true, true);
   }
  }
  System.out.println(trace.value);
 }
}
