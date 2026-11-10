package ai.alphacompute.alphaphone;

import android.content.Context;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** The same extracted update methods and platform ports as UpdateFlowTest. */
public final class UpdateBarrierHarness {
 private final Context context;
 private final Map<Integer,AlphaDevicePlugin> bridges = new HashMap<>();
 private final Map<Plugin,JSObject> requests = new ConcurrentHashMap<>();
 private final Map<String,Integer> activationIds = new HashMap<>();
 private final Object lock;
 private final Trace trace;
 private PluginCall install;
 private String activeId;

 private UpdateBarrierHarness(String name, File cache) throws Exception {
  context = UpdateFlowTest.installing(cache);
  AlphaDevicePlugin.UpdatePause.configure(context);
  AlphaLocalAgentPlugin.stops = 0;
  AlphaLocalAgentPlugin.releases = 0;
  AlphaLocalAgentPlugin.confirmed = false;
  lock = field("updateBarrier").get(null);
  Plugin.ready = requests::put;
  trace = new Trace(name, observe());
 }

 private static void require(boolean condition, String error) {
  if (!condition) throw new AssertionError(error);
 }
 private static Field field(String name) throws Exception {
  Field field = AlphaDevicePlugin.class.getDeclaredField(name);
  field.setAccessible(true);
  return field;
 }
 private int bridgeNumber(Object bridge) {
  if (bridge == null) return 0;
  for (var entry : bridges.entrySet()) if (entry.getValue() == bridge) return entry.getKey();
  throw new AssertionError("Unknown bridge");
 }
 private int bridgeIdNumber(Object id) throws Exception {
  if (id == null) return 0;
  for (var entry : bridges.entrySet())
   if (id.equals(Trace.read(entry.getValue(), "updateBridgeId"))) return entry.getKey();
  throw new AssertionError("Unknown bridge receipt");
 }
 private int activationNumber(String id) {
  return id == null ? 0 : activationIds.computeIfAbsent(id, key -> activationIds.size() + 1);
 }
 private JSONArray bridgeSet(Object raw) {
  var ids = new ArrayList<Integer>();
  for (Object bridge : (Set<?>) raw) ids.add(bridgeNumber(bridge));
  Collections.sort(ids);
  return new JSONArray(ids);
 }

 private JSONArray receiptSet(Object raw) throws Exception {
  var ids = new ArrayList<Integer>();
  for (Object receipt : (Set<?>) raw) ids.add(bridgeIdNumber(receipt));
  Collections.sort(ids);
  return new JSONArray(ids);
 }

 private JSONObject observe() throws Exception {
  synchronized (lock) {
   Object active = field("activation").get(null);
   int activeNumber = active == null ? 0 : activationNumber((String) Trace.read(active, "id"));
   Boolean ready = active == null ? null : (Boolean) ((CompletableFuture<?>) Trace.read(active, "ready")).getNow(null);
   Object prepared = field("updateResume").get(null);
   var record = AlphaDevicePlugin.UpdatePause.store().read();
   int pendingSession = record != null && context.packages.installer.committed.contains(record.session)
     ? activationNumber(record.id) : 0;
   String outcome = (String) field("settledOutcome").get(null);
   return Trace.fields(
     "registered", bridgeSet(field("updateBridges").get(null)), "seen", bridgeSet(Set.copyOf(bridges.values())),
     "serial", activationIds.size(),
     "active", activeNumber, "installerOwner", active == null ? 0 : bridgeNumber(Trace.read(active, "owner")),
     "waiting", active == null ? new JSONArray() : bridgeSet(Trace.read(active, "waiting")),
     "acknowledged", active == null ? new JSONArray() : bridgeSet(Trace.read(active, "acknowledged")),
     "eligible", active == null ? new JSONArray() : receiptSet(Trace.read(active, "resumeEligible")),
     "ready", active == null ? "none" : ready == null ? "pending" : ready ? "yes" : "no",
     "invalid", active != null && (Boolean) Trace.read(active, "invalid"),
     "sealed", active != null && (Boolean) Trace.read(active, "sealed"),
     "stopRequested", active != null && AlphaDevicePlugin.UpdatePause.shutdownRequest >= 0,
     "pendingSession", pendingSession,
     "prepared", prepared == null ? 0 : activationNumber((String) Trace.read(prepared, "id")),
     "preparedOwner", prepared == null ? 0 : bridgeIdNumber(Trace.read(prepared, "initiatingBridge")),
     "preparedEligible", prepared == null ? new JSONArray() : receiptSet(Trace.read(prepared, "eligible")),
     "confirmationOwner", bridgeNumber(field("updateOwner").get(null)),
     "terminal", activationNumber((String) field("settledActivation").get(null)),
     "outcome", outcome == null ? "none" : outcome, "resumeBridge", bridgeIdNumber(field("settledResumeBridge").get(null)),
     "stopCalls", AlphaLocalAgentPlugin.stops, "commits", context.packages.installer.committed.size());
  }
 }

 private void register(int id) throws Exception {
  synchronized (lock) {
   bridges.put(id, UpdateFlowTest.bridge(context, Lifecycle.State.RESUMED));
   trace.step("register", observe(), id);
  }
 }
 private void retire(int id) throws Exception {
  synchronized (lock) {
   bridges.get(id).handleOnDestroy();
   trace.step("retire", observe(), id);
  }
 }
 private void begin(int owner) throws Exception {
  requests.clear();
  install = UpdateFlowTest.offered();
  bridges.get(owner).installUpdate(install);
  await(() -> requests.containsKey(bridges.get(owner)));
  activeId = requests.get(bridges.get(owner)).optString("activationId");
  trace.step("begin", observe(), owner);
 }
 private void acknowledge(int bridge, String activation, int receipt, String vote, boolean valid) throws Exception {
  acknowledge(bridge, activation, receipt, vote, "absent", valid);
 }
 private void acknowledge(int bridge, String activation, int receipt, String vote, String eligibility, boolean valid) throws Exception {
  var payload = new JSObject().put("activationId", activation)
    .put("bridgeId", Trace.read(bridges.get(receipt), "updateBridgeId"));
  if (vote.equals("yes") || vote.equals("no")) payload.put("ready", vote.equals("yes"));
  else if (vote.equals("string")) payload.put("ready", "true");
  if (eligibility.equals("eligible") || eligibility.equals("ineligible"))
   payload.put("resumeEligible", eligibility.equals("eligible"));
  else if (eligibility.equals("string")) payload.put("resumeEligible", "true");
  var call = new PluginCall(payload);
  synchronized (lock) {
   bridges.get(bridge).activateUpdate(call);
   require(call.resolved.get() == (valid ? 1 : 0) && call.rejected.get() == (valid ? 0 : 1), "ACK outcome");
   int expectedActivation = activationIds.getOrDefault(activation, 0);
   var action = Trace.action("acknowledge", bridge, expectedActivation, receipt, vote, eligibility);
   if (!valid) action.put("reject", true);
   trace.steps.put(new JSONObject().put("label", valid ? "exact participant ACK" : "native rejected ACK")
     .put("action", action).put("expect", observe()));
  }
 }
 private void ack(int bridge, String vote) throws Exception { acknowledge(bridge, activeId, bridge, vote, true); }
 private void ackMounted(int bridge) throws Exception { acknowledge(bridge, activeId, bridge, "yes", "eligible", true); }
 private void sealed() throws Exception {
  await(() -> AlphaLocalAgentPlugin.stops > 0);
  trace.macro("seal admitted exact participant set before requesting shutdown", observe(),
    Trace.action("seal"), Trace.action("requestStop"));
 }
 private void handOff() throws Exception {
  AlphaLocalAgentPlugin.confirmed = true;
  install.awaitAnswer();
  require(install.resolved.get() == 1, "native install dispatched one synthetic commit");
  trace.step("handOff", observe());
 }
 private void failed() throws Exception {
  install.awaitAnswer();
  require(install.rejected.get() == 1, "native attempt refused");
  trace.step("failPreparation", observe());
 }
 private JSObject readState(int bridge) throws Exception {
  var call = new PluginCall(new JSObject());
  bridges.get(bridge).updateState(call);
  call.awaitAnswer();
  require(call.resolved.get() == 1, "native read answered");
  return call.result;
 }
 private void continueConfirmation(int owner, int next) throws Exception {
  int session = UpdateFlowTest.committed(context);
  UpdateFlowTest.confirmation(context, session);
  UpdateFlowTest.dismissed(bridges.get(owner));
  var paused = readState(next);
  require("paused".equals(paused.optString("phase")) && paused.optBoolean("canContinue", false), "exact kept confirmation is available");
  var call = new PluginCall(new JSObject().put("activationId", paused.optString("activationId")).put("bridgeId", paused.optString("bridgeId")));
  bridges.get(next).continueUpdate(call);
  call.awaitAnswer();
  require(call.resolved.get() == 1 && field("updateOwner").get(null) == bridges.get(next), "confirmation belongs to exact continuing bridge");
  trace.step("continueConfirmation", observe(), next);
 }
 private void canceled(int caller, int resume) throws Exception {
  context.packages.installer.destroy(UpdateFlowTest.committed(context));
  var state = readState(caller);
  require("canceled".equals(state.optString("outcome")) && activeId.equals(state.optString("activationId")),
    "readback publishes the exact terminal identity");
  trace.step("settle", observe(), caller, "canceled");
  for (var entry : bridges.entrySet()) {
   if (!((Set<?>) field("updateBridges").get(null)).contains(entry.getValue())) continue;
   require(readState(entry.getKey()).optBoolean("resume", false) == (entry.getKey() == resume), "single cancellation audience");
  }
 }
 private void replayTerminal(int caller) throws Exception {
  var bridge = bridges.get(caller);
  int events = bridge.events.size();
  var settle = AlphaDevicePlugin.class.getDeclaredMethod("settleUpdate", String.class, String.class);
  settle.setAccessible(true);
  settle.invoke(bridge, activeId, "failed");
  require(bridge.events.size() == events, "same terminal identity cannot republish or alter outcome");
  trace.step("repeatSettlement", observe(), activationNumber(activeId));
 }
 private static void await(java.util.function.BooleanSupplier predicate) throws Exception {
  long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
  while (!predicate.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(1);
  require(predicate.getAsBoolean(), "source boundary did not arrive");
 }

 private static Trace scenario(String name, File cache) throws Exception {
  var h = new UpdateBarrierHarness(name, cache);
  switch (name) {
   case "foreign-and-duplicate-with-pre-ready-join":
    h.register(1); h.register(2); h.begin(1);
    h.acknowledge(1, "wrong", 1, "yes", false);
    h.acknowledge(2, h.activeId, 1, "yes", false);
    h.acknowledge(1, h.activeId, 1, "absent", false);
    h.acknowledge(1, h.activeId, 1, "string", false);
    h.acknowledge(1, h.activeId, 1, "yes", "string", false);
    h.acknowledge(1, h.activeId, 1, "no", "eligible", false);
    h.ackMounted(1);
    h.acknowledge(1, h.activeId, 1, "no", false);
    h.register(3); h.ack(2, "yes"); h.ack(3, "yes");
    h.sealed(); h.handOff(); h.canceled(2, 1); h.replayTerminal(2);
    break;
   case "new-bridge-after-ready-before-seal":
    h.register(1); h.begin(1);
    synchronized (h.lock) { h.ack(1, "yes"); h.register(2);
     h.acknowledge(2, h.activeId, 2, "yes", false); }
    h.failed();
    break;
   case "retirement-cannot-satisfy-draft-barrier":
    h.register(1); h.register(2); h.begin(1); h.ack(1, "yes");
    h.retire(2); h.failed();
    break;
   case "stale-receipt-after-a-refused-attempt":
    h.register(1); h.begin(1);
    String previous = h.activeId;
    h.ack(1, "no"); h.failed(); h.begin(1);
    h.acknowledge(1, previous, 1, "yes", false);
    h.ack(1, "no"); h.failed();
    break;
   case "post-seal-confirmation-preserves-initiating-reconnect":
    h.register(1); h.begin(1); h.ackMounted(1); h.sealed();
    h.register(2);
    require("paused".equals(h.requests.get(h.bridges.get(2)).optString("phase")), "post-seal bridge sees pause");
    h.acknowledge(2, h.activeId, 2, "yes", "eligible", false);
    h.handOff(); h.continueConfirmation(1, 2); h.canceled(2, 1);
    h.replayTerminal(2);
    h.retire(1);
    require(!h.readState(2).optBoolean("resume", false), "no resume handoff after settlement");
    break;
   case "eligible-mounted-sibling-keeps-confirmation-reconnect":
    h.register(1); h.register(2); h.begin(1); h.ackMounted(1); h.ackMounted(2);
    h.sealed(); h.handOff(); h.continueConfirmation(1, 2); h.canceled(1, 2);
    break;
   case "retired-confirmation-owner-cannot-nominate-arbitrary-settler":
    h.register(1); h.register(2); h.begin(1); h.ackMounted(1); h.ackMounted(2);
    h.sealed(); h.handOff(); h.retire(1); h.canceled(2, 0);
    break;
   case "old-and-startup-ack-can-prepare-but-cannot-reconnect":
    h.register(1); h.register(2); h.begin(1); h.ack(1, "yes");
    h.acknowledge(2, h.activeId, 2, "yes", "ineligible", true);
    h.sealed(); h.handOff(); h.continueConfirmation(1, 2); h.canceled(1, 0);
    break;
   default: throw new IllegalArgumentException(name);
  }
  return h.trace;
 }

 public static void main(String[] args) throws Exception {
  UpdateFlowTest.serveFixtureHttps();
  var cache = Files.createTempDirectory("alpha-barrier-traces");
  var original = Plugin.ready;
  try { System.out.println(new JSONArray().put(scenario(args[0], cache.toFile()).value)); }
  finally {
   Plugin.ready = original;
   UpdateFlowTest.retireFixtureWorkers();
   try (var files = Files.list(cache)) {
    for (var file : files.toArray(java.nio.file.Path[]::new)) Files.delete(file);
   }
   Files.delete(cache);
  }
 }
}
