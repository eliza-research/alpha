package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.runtime.ResidentAttachment;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Replays ResidentStartCancel model steps without a credential mutation on the whole
 * AlphaLocalAgentPlugin. The harness plays the service and Android: whether the resident process
 * is up, when a strict stop is acknowledged, window focus, the clock, and whether the facts an
 * attach needs hold. It parks the shutdown recheck at its first probe so that the step that ends
 * the wait is the model's. Every admission, epoch and ownership decision is the plugin's.
 */
public final class ResidentStartCancelReplay {
  /** Credential-stop, focus and clock ports. */
  public static final class Ports {
    public static volatile boolean focused = true, parking = true;
    public static volatile long clockOffset;
    public static volatile int strictStops;
    static long next = 100;
    static final Set<Long> acknowledged = ConcurrentHashMap.newKeySet();
    static final Semaphore arrived = new Semaphore(0);
    static final Object gate = new Object();
    static Object lifecycleLock;
    public static synchronized long reserve() {
      return ++next;
    }
    public static void strictStop(long request) {
      strictStops++;
    }
    /** The recheck's probe runs outside the lifecycle lock and waits here; every other read answers at once. */
    public static boolean confirmed(long request) {
      if (!Thread.holdsLock(lifecycleLock)) {
        arrived.release();
        synchronized (gate) {
          while (parking) {
            try {
              gate.wait();
            } catch (InterruptedException interrupted) {
              Thread.currentThread().interrupt();
              return false;
            }
          }
        }
      }
      return acknowledged.contains(request);
    }
    static void release() {
      synchronized (gate) {
        parking = false;
        gate.notifyAll();
      }
    }
  }
  static final String[] IDS = {null, "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"};
  static AlphaLocalAgentPlugin plugin;
  static PluginCall retry;
  static boolean stopRequested, foreignStop, cancelledStartLaunched;
  static int launches, launchedBy, roots;
  static String outcome = "none";

  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static Object field(String name) throws Exception {
    Field field = AlphaLocalAgentPlugin.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(null);
  }
  static long number(String name) throws Exception {
    return ((Number) field(name)).longValue();
  }
  static int request(Object id) {
    return id == null ? 0 : id.equals(IDS[1]) ? 1 : 2;
  }
  static PluginCall call(int request) {
    return new PluginCall(new JSObject().put("requestId", IDS[request]));
  }
  static void await(PluginCall call) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (call.completions == 0 && System.nanoTime() < end) Thread.sleep(1);
    check(call.completions > 0, "A plugin call did not complete");
  }
  static Set<Integer> cancelled() throws Exception {
    TreeSet<Integer> out = new TreeSet<>();
    for (Object id : (Set<?>) Trace.read(plugin, "cancelledStarts")) out.add(request(id));
    return out;
  }
  static Set<Integer> attached() throws Exception {
    Field ids = ResidentAttachment.Requests.class.getDeclaredField("ids");
    ids.setAccessible(true);
    TreeSet<Integer> out = new TreeSet<>();
    for (Object id : (Set<?>) ids.get(Trace.read(plugin, "attachedStarts"))) out.add(request(id));
    return out;
  }
  static String nativeState() {
    return !ResidentTestPorts.serviceActive ? "stopped" : stopRequested ? "stopping" : "running";
  }
  /** A start request: the ordinary start or, when a shutdown needs rechecking, its strict retry. */
  static void startRequest(int request, boolean attachable, boolean focused) throws Exception {
    Ports.focused = focused;
    if (!attachable)
      ResidentTestPorts.rootToken = "root-fixture-" + ++roots;
    else if (ResidentTestPorts.serviceActive) {
      // The facts an attach is admitted against: an enrollment under the running resident's root
      // and the generation it was launched with.
      AlphaLocalAgentPlugin.enrollForTest(ResidentTestPorts.rootToken, "owner-fixture", "identity-fixture", System.currentTimeMillis() + 3600000);
      AlphaLocalAgentPlugin.launchedGenerationForTest(LocalAgentProviderAdmission.NO_PROVIDER_GENERATION);
    }
    boolean wasCancelled = cancelled().contains(request), active = ResidentTestPorts.serviceActive;
    int starts = ResidentTestPorts.starts, arrivals = Ports.arrived.availablePermits();
    PluginCall call = call(request);
    plugin.start(call);
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (call.completions == 0 && number("credentialShutdownRetryEpoch") != number("lifecycleEpoch") && System.nanoTime() < end) Thread.sleep(1);
    if (call.completions == 0) {
      check(number("credentialShutdownRetryEpoch") == number("lifecycleEpoch"), "A start neither answered nor entered the recheck");
      check(Ports.arrived.tryAcquire(arrivals + 1, 10, TimeUnit.SECONDS), "The recheck did not reach its probe");
      retry = call;
      outcome = "retrying";
    } else if (call.result != null) {
      outcome = call.result.optBoolean("attached") ? "attached" : "started";
    } else {
      String message = call.rejection;
      outcome = message.contains("cancelled") ? "cancelled"
          : message.contains("provider is changing") ? "provider-changing"
          : message.contains("is stopping") ? "stopping"
          : message.contains("already being checked") ? "retry-busy"
          : message.contains("before retrying provider shutdown") ? "retry-needs-focus"
          : "unexpected: " + message;
    }
    launched(starts, active, request, wasCancelled);
    Ports.focused = true;
  }
  static void launched(int starts, boolean active, int request, boolean wasCancelled) {
    if (ResidentTestPorts.starts == starts)
      return;
    check(ResidentTestPorts.starts == starts + 1, "One step started the service twice");
    if (!active) {
      launches++;
      launchedBy = request;
    }
    if (wasCancelled)
      cancelledStartLaunched = true;
  }
  static JSONObject observe() throws Exception {
    long shutdown = number("credentialShutdownRequest");
    return new JSONObject()
        .put("epoch", number("lifecycleEpoch"))
        .put("accepting", field("accepting"))
        .put("stopping", field("stopping"))
        .put("mutationEpoch", number("credentialMutationEpoch"))
        .put("retryEpoch", number("credentialShutdownRetryEpoch"))
        .put("shutdown", shutdown == -1 ? "none" : Ports.acknowledged.contains(shutdown) ? "confirmed" : "unconfirmed")
        .put("startRequest", request(field("startRequestId")))
        .put("startRequestEpoch", number("startRequestEpoch"))
        .put("startOwnsLaunch", field("startOwnsLaunch"))
        .put("cancelledStarts", new JSONArray(cancelled()))
        .put("attachedStarts", new JSONArray(attached()))
        .put("native", nativeState())
        .put("launchedBy", launchedBy)
        .put("launches", launches)
        .put("commits", 0)
        .put("outcome", outcome)
        .put("foreignStop", foreignStop)
        .put("launchDuringShutdown", false)
        .put("commitWhileRunning", false)
        .put("cancelledStartLaunched", cancelledStartLaunched);
  }
  public static void main(String[] args) throws Exception {
    ResidentTestPorts.initialize(args[1]);
    Field lock = AlphaLocalAgentPlugin.class.getDeclaredField("lifecycleLock");
    lock.setAccessible(true);
    Ports.lifecycleLock = lock.get(null);
    plugin = new AlphaLocalAgentPlugin();
    plugin.load();
    JSONArray trace = new JSONArray(Files.readString(Path.of(args[0])));
    JSONArray observed = new JSONArray();
    try {
      for (int i = 0; i < trace.length(); i++) {
        JSONObject step = trace.getJSONObject(i), picks = step.getJSONObject("picks");
        int stops = ResidentTestPorts.stops + Ports.strictStops;
        switch (step.getString("action")) {
          case "init":
          case "":
            break;
          case "start":
            startRequest(picks.getInt("request"), picks.getBoolean("flag"), true);
            break;
          case "retryShutdown":
            startRequest(picks.getInt("request"), false, picks.getBoolean("flag"));
            break;
          case "cancelStart": {
            int request = picks.getInt("request");
            long epoch = number("lifecycleEpoch");
            boolean wasAttached = attached().contains(request);
            PluginCall cancel = call(request);
            plugin.cancelStart(cancel);
            check(cancel.result != null, "cancelStart was refused: " + cancel.rejection);
            boolean stopped = ResidentTestPorts.stops + Ports.strictStops > stops;
            outcome = wasAttached ? "cancel-attached"
                : number("lifecycleEpoch") == epoch ? "cancel-remembered"
                : stopped ? "cancel-stopped-launch" : "cancel-retired-request";
            if (stopped && launchedBy != request)
              foreignStop = true;
            break;
          }
          case "stop": {
            PluginCall stop = new PluginCall(new JSObject());
            plugin.stop(stop);
            check(stop.result != null, "stop was refused: " + stop.rejection);
            outcome = "stop";
            break;
          }
          case "statusPolled": {
            PluginCall status = new PluginCall(new JSObject());
            plugin.getStatus(status);
            await(status);
            check(status.result != null, "getStatus was refused: " + status.rejection);
            break;
          }
          case "nativeStopped":
            ResidentTestPorts.state = "dead";
            ResidentTestPorts.serviceActive = false;
            ResidentTestPorts.socketListening = false;
            stopRequested = false;
            launchedBy = 0;
            break;
          case "acknowledgeShutdown":
            Ports.acknowledged.add(number("credentialShutdownRequest"));
            break;
          case "finishRetry": {
            boolean active = ResidentTestPorts.serviceActive;
            int starts = ResidentTestPorts.starts, request = request(field("startRequestId"));
            Ports.focused = picks.getBoolean("flag");
            // The wait ends on this pass: by success, by its guard, or because its 15 s have passed.
            Ports.clockOffset += 15001;
            Ports.release();
            await(retry);
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (number("credentialShutdownRetryEpoch") >= 0 && System.nanoTime() < end) Thread.sleep(1);
            Ports.parking = true;
            Ports.focused = true;
            outcome = retry.result != null ? "started" : "retry-unconfirmed";
            launched(starts, active, request, false);
            retry = null;
            break;
          }
          case "rearm": {
            boolean active = ResidentTestPorts.serviceActive;
            int starts = ResidentTestPorts.starts;
            ResidentScheduleRearm.Decision decision = AlphaLocalAgentPlugin.startResidentIfAdmissible(
                plugin.getContext(), ResidentScheduleRearm.BOOT_COMPLETED, true, true, true);
            check(decision == ResidentScheduleRearm.Decision.START, "An admitted broadcast answered " + decision);
            launched(starts, active, 0, false);
            outcome = "rearmed";
            break;
          }
          default:
            throw new AssertionError("No product step for " + step.getString("action"));
        }
        if (ResidentTestPorts.stops + Ports.strictStops > stops && ResidentTestPorts.serviceActive)
          stopRequested = true;
        observed.put(observe());
      }
      System.out.println(observed);
    } finally {
      Ports.release();
      System.out.flush();
      System.exit(0);
    }
  }
}
