package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.runtime.ResidentAttachment;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Drives the entire plugin. Observations read source state and controlled service replies. */
public final class ResidentCoordinatorTraces {
  static final String FIRST = "00000000-0000-4000-8000-000000000001";
  static final String SECOND = "00000000-0000-4000-8000-000000000002";
  static final ArrayList<AlphaLocalAgentPlugin> plugins = new ArrayList<>();
  static final JSONArray raw = new JSONArray();
  static Object field(String name) throws Exception {
    Field field = AlphaLocalAgentPlugin.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(null);
  }
  static long epoch() throws Exception {
    return ((Number) field("lifecycleEpoch")).longValue();
  }
  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static PluginCall call(String id) {
    return new PluginCall(new JSObject().put("requestId", id));
  }
  static AlphaLocalAgentPlugin plugin() {
    AlphaLocalAgentPlugin plugin = new AlphaLocalAgentPlugin();
    plugin.load();
    plugins.add(plugin);
    return plugin;
  }
  static void await(PluginCall call) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (call.completions == 0 && System.nanoTime() < end) Thread.sleep(2);
    check(call.completions > 0, "Plugin call did not complete");
  }
  static JSONObject observe() throws Exception {
    boolean stopping = (Boolean) field("stopping");
    boolean accepting = (Boolean) field("accepting");
    boolean running = ResidentTestPorts.serviceActive || ResidentTestPorts.socketListening;
    boolean enrolled = field("ownerToken") != null;
    boolean currentStart =
        field("startRequestId") != null && ((Number) field("startRequestEpoch")).longValue() == epoch();
    String phase = stopping      ? "stopping"
        : !accepting || !running ? "stopped"
        : enrolled               ? "ready"
        : currentStart           ? "starting"
                                 : "ready";
    JSONObject observation = Trace.fields(
        "epoch", epoch(), "phase", phase, "localProcess", running, "ownedStart", field("startOwnsLaunch"));
    JSONArray surfaces = new JSONArray();
    for (AlphaLocalAgentPlugin plugin : plugins) {
      surfaces.put(new JSONObject()
                       .put("disposed", Trace.read(plugin, "disposed"))
                       .put("pendingCalls", ((Set<?>) Trace.read(plugin, "pending")).size())
                       .put("streams", ((java.util.Map<?, ?>) Trace.read(plugin, "streams")).size())
                       .put("attachedRequests", ((ResidentAttachment.Requests) Trace.read(plugin, "attachedStarts")).size())
                       .put("cancelledRequests", ((Set<?>) Trace.read(plugin, "cancelledStarts")).size())
                       .put("attachUnverified", Trace.read(plugin, "attachUnverified")));
    }
    raw.put(new JSONObject()
            .put("projection", observation)
            .put("accepting", accepting)
            .put("stopping", stopping)
            .put("enrolled", enrolled)
            .put("startRequestId", field("startRequestId"))
            .put("startRequestEpoch", field("startRequestEpoch"))
            .put("instances", ((Set<?>) field("instances")).size())
            .put("starts", ResidentTestPorts.starts)
            .put("stops", ResidentTestPorts.stops)
            .put("pairs", ResidentTestPorts.pairs)
            .put("requests", ResidentTestPorts.requests)
            .put("surfaces", surfaces));
    return observation;
  }
  static Trace trace(String name) throws Exception {
    Trace trace = new Trace(name, observe());
    trace.value.put("sourceObservations", raw);
    return trace;
  }
  static AlphaLocalAgentPlugin start(Trace trace) throws Exception {
    AlphaLocalAgentPlugin plugin = plugin();
    PluginCall call = call(FIRST);
    ResidentTestPorts.pause("/api/auth/status");
    plugin.start(call);
    ResidentTestPorts.awaitEntered();
    trace.step("admitStart", observe(), true);
    ResidentTestPorts.release.countDown();
    await(call);
    check(call.rejection == null, "Source startup rejected: " + call.rejection);
    trace.step("started", observe(), epoch());
    AlphaLocalAgentPlugin.launchedGenerationForTest(LocalAgentProviderAdmission.NO_PROVIDER_GENERATION);
    return plugin;
  }
  static void stop(Trace trace, boolean failure) throws Exception {
    AlphaLocalAgentPlugin plugin = start(trace);
    ResidentTestPorts.failStop = failure;
    PluginCall stop = new PluginCall(new JSObject());
    plugin.stop(stop);
    trace.step("requestStop", observe());
    check(failure ? stop.rejection != null : stop.result != null, "Stop outcome");
    PluginCall status = new PluginCall(new JSObject());
    plugin.getStatus(status);
    await(status);
    check("stopping".equals(status.result.getString("state")), "Incomplete shutdown admitted");
    trace.step("shutdownUnconfirmed", observe());
    ResidentTestPorts.state = "dead";
    ResidentTestPorts.serviceActive = false;
    ResidentTestPorts.socketListening = false;
    PluginCall stoppedStatus = new PluginCall(new JSObject());
    plugin.getStatus(stoppedStatus);
    await(stoppedStatus);
    trace.step("shutdownConfirmed", observe());
  }
  static void lateSurface(Trace trace, boolean cancel) throws Exception {
    AlphaLocalAgentPlugin first = start(trace), second = plugin();
    PluginCall attached = call(SECOND);
    second.start(attached);
    await(attached);
    check(attached.result.optBoolean("attached"), "Second surface did not attach");
    trace.step("attachStart", observe());
    first.handleOnDestroy();
    trace.stutter("destroy one of two surfaces", observe());
    long epoch = epoch();
    int stops = ResidentTestPorts.stops;
    PluginCall late = call(FIRST);
    if (cancel)
      first.cancelStart(late);
    else
      first.stop(late);
    check(late.rejection != null && epoch() == epoch && ResidentTestPorts.stops == stops,
        "Destroyed surface retired live resident");
    trace.stutter(cancel ? "late owned cancel rejected" : "late stop rejected", observe());
  }
  static void cancel(Trace trace, boolean attached, boolean unowned) throws Exception {
    AlphaLocalAgentPlugin plugin;
    if (attached) {
      start(trace);
      plugin = plugin();
    } else {
      plugin = plugin();
      if (unowned) {
        ResidentTestPorts.state = "listening";
        ResidentTestPorts.serviceActive = true;
        ResidentTestPorts.socketListening = true;
        trace.step("observeResident", observe());
      }
    }
    String id = attached ? SECOND : FIRST;
    PluginCall start = call(id);
    ResidentTestPorts.pause(attached ? "/api/auth/status" : "/api/auth/pair");
    plugin.start(start);
    ResidentTestPorts.awaitEntered();
    if (attached)
      trace.step("attachStart", observe());
    else
      trace.step("admitStart", observe(), !unowned);
    int stopped = ResidentTestPorts.stops;
    plugin.cancelStart(call(id));
    trace.step(attached ? "cancelAttachedStart"
            : unowned   ? "cancelUnownedStart"
                        : "cancelOwnedStart",
        observe());
    ResidentTestPorts.release.countDown();
    await(start);
    check(ResidentTestPorts.stops == stopped + (attached || unowned ? 0 : 1),
        "Cancellation stopped unowned service");
    check(ResidentTestPorts.pairs <= 1, "Pairing retried after cancellation");
    trace.stutter("late source completion stays retired", observe());
  }
  static void lostPair(Trace trace) throws Exception {
    AlphaLocalAgentPlugin plugin = plugin();
    PluginCall start = call(FIRST);
    ResidentTestPorts.losePairResponse = true;
    ResidentTestPorts.pause("/api/auth/pair");
    plugin.start(start);
    ResidentTestPorts.awaitEntered();
    trace.step("admitStart", observe(), true);
    ResidentTestPorts.release.countDown();
    await(start);
    check(start.rejection != null && ResidentTestPorts.pairs == 1, "Uncertain pairing was retried");
    trace.step("failedStart", observe(), true);
  }
  static void lastSurface(Trace trace) throws Exception {
    AlphaLocalAgentPlugin plugin = start(trace);
    plugin.handleOnDestroy();
    trace.step("retireLastSurface", observe());
  }
  static void broadcastRace(Trace trace) throws Exception {
    AlphaLocalAgentPlugin plugin = plugin();
    java.util.concurrent.CountDownLatch starting = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch continueStart = new java.util.concurrent.CountDownLatch(1);
    ResidentTestPorts.onStart = () -> {
      starting.countDown();
      try {
        if (!continueStart.await(5, TimeUnit.SECONDS))
          throw new AssertionError("Broadcast not released");
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(interrupted);
      }
    };
    Thread broadcast = new Thread(()
                                      -> AlphaLocalAgentPlugin.startResidentIfAdmissible(plugin.getContext(),
                                          ResidentScheduleRearm.BOOT_COMPLETED, true, true, true));
    broadcast.start();
    check(starting.await(5, TimeUnit.SECONDS), "Broadcast did not enter service start");
    trace.step("observeResident", observe());
    Thread stop = new Thread(() -> plugin.stop(new PluginCall(new JSObject())));
    stop.start();
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (stop.getState() != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.sleep(1);
    check(stop.getState() == Thread.State.BLOCKED && epoch() == 0 && ResidentTestPorts.stops == 0,
        "Stop escaped broadcast lock");
    trace.stutter("stop waits until admitted broadcast starts", observe());
    continueStart.countDown();
    broadcast.join(5000);
    stop.join(5000);
    check(!broadcast.isAlive() && !stop.isAlive(), "Lifecycle race did not finish");
    trace.step("requestStop", observe());
    int starts = ResidentTestPorts.starts;
    check(AlphaLocalAgentPlugin.startResidentIfAdmissible(
              plugin.getContext(), ResidentScheduleRearm.BOOT_COMPLETED, true, true, true)
            == ResidentScheduleRearm.Decision.LIFECYCLE_BUSY,
        "Stopped lifecycle admitted broadcast");
    check(ResidentTestPorts.starts == starts, "Blocked broadcast started service");
    trace.stutter("broadcast after stop remains fenced", observe());
  }
  public static void main(String[] args) throws Exception {
    ResidentTestPorts.initialize(args[1]);
    String scenario = args[0];
    Trace trace = trace(scenario);
    try {
      switch (scenario) {
        case "stop":
          stop(trace, false);
          break;
        case "stop-error":
          stop(trace, true);
          break;
        case "late-stop":
          lateSurface(trace, false);
          break;
        case "late-cancel":
          lateSurface(trace, true);
          break;
        case "owned-cancel":
          cancel(trace, false, false);
          break;
        case "attached-cancel":
          cancel(trace, true, false);
          break;
        case "unowned-cancel":
          cancel(trace, false, true);
          break;
        case "lost-pair":
          lostPair(trace);
          break;
        case "last-surface":
          lastSurface(trace);
          break;
        case "broadcast-race":
          broadcastRace(trace);
          break;
        default:
          throw new AssertionError(scenario);
      }
      System.out.println(new JSONArray().put(trace.value));
    } finally {
      ResidentTestPorts.release.countDown();
      for (AlphaLocalAgentPlugin plugin : plugins) plugin.handleOnDestroy();
    }
  }
}
