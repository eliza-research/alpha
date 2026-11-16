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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Replays ResidentStartCancel model steps on the whole
 * AlphaLocalAgentPlugin. The harness plays the service and Android: whether the resident process
 * is up, when a strict stop is acknowledged, window focus, the clock, and whether the facts an
 * attach needs hold. It parks the shutdown recheck at its first probe so that the step that ends
 * the wait is the model's. Every admission, epoch and ownership decision is the plugin's.
 */
public final class ResidentStartCancelReplay {
  /** Controlled service read held outside the product's lifecycle lock. */
  private static final class BootProbe {
    final CountDownLatch arrived = new CountDownLatch(1);
    final CountDownLatch release = new CountDownLatch(1);
    void park() {
      check(!Thread.holdsLock(Ports.lifecycleLock), "The service boot probe holds the lifecycle lock");
      arrived.countDown();
      try {
        check(release.await(10, TimeUnit.SECONDS), "The fixture boot probe was not released");
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new AssertionError(interrupted);
      }
    }
    void await() throws InterruptedException {
      check(arrived.await(10, TimeUnit.SECONDS), "The product did not enter the held service probe");
    }
  }

  /** Credential-stop, boot observation, focus and clock ports. */
  public static final class Ports {
    public static volatile boolean focused = true, parking = true;
    public static volatile long clockOffset;
    public static volatile int strictStops;
    static long next = 100;
    static final Set<Long> acknowledged = ConcurrentHashMap.newKeySet();
    static final Set<Long> abandoned = ConcurrentHashMap.newKeySet();
    static final Set<Long> released = ConcurrentHashMap.newKeySet();
    static final AtomicReference<BootProbe> nextStartProbe = new AtomicReference<>();
    static volatile Thread mutationWorker;
    static volatile BootProbe mutationProbe;
    public static JSONObject boot() {
      if (Thread.currentThread() == mutationWorker) {
        mutationProbe.park();
        return ResidentTestPorts.boot();
      }
      JSONObject snapshot = ResidentTestPorts.boot();
      BootProbe hold = nextStartProbe.getAndSet(null);
      if (hold != null) hold.park();
      return snapshot;
    }
    public static void abandon(long request) { abandoned.add(request); }
    public static void release(long request) { released.add(request); }
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
  static PluginCall retry, heldStartCall;
  static BootProbe heldStartProbe;
  static FutureTask<Boolean> mutation;
  static int heldStart, commits;
  static boolean commitWhileRunning;
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
  static void holdStart(int request) throws Exception {
    check(heldStartCall == null, "A start probe already owns the fixture");
    heldStartProbe = new BootProbe();
    check(Ports.nextStartProbe.compareAndSet(null, heldStartProbe), "A boot probe is already armed");
    heldStartCall = call(request);
    plugin.start(heldStartCall);
    heldStartProbe.await();
    check(heldStartCall.completions == 0, "The start completed before its service snapshot returned");
    heldStart = request;
  }

  static void resumeStart() throws Exception {
    check(heldStartCall != null, "No start owns the held boot probe");
    int starts = ResidentTestPorts.starts;
    heldStartProbe.release.countDown();
    await(heldStartCall);
    check(heldStartCall.result == null && heldStartCall.rejection.contains("provider is changing"),
        "The stale start did not refuse the current provider change: " + heldStartCall.rejection);
    check(ResidentTestPorts.starts == starts, "The stale start launched the resident during mutation");
    heldStartCall = null;
    heldStartProbe = null;
    heldStart = 0;
    outcome = "provider-changing";
  }

  static void beginMutation() throws Exception {
    check(mutation == null, "A mutation already owns the fixture");
    Ports.mutationProbe = new BootProbe();
    mutation = new FutureTask<>(() -> AlphaLocalAgentPlugin.mutateCredentials(plugin.getContext(), () -> {},
        new AlphaLocalAgentPlugin.CredentialMutation<Boolean>() {
          @Override public boolean requiresShutdown() { return true; }
          @Override public Boolean commit() throws Exception {
            check(Thread.holdsLock(Ports.lifecycleLock), "The fake commit ran outside the lifecycle lock");
            long request = number("credentialShutdownRequest");
            commitWhileRunning |= ResidentTestPorts.serviceActive || ResidentTestPorts.socketListening
                || !Ports.acknowledged.contains(request);
            commits++;
            return true;
          }
        }));
    Ports.mutationWorker = new Thread(mutation, "resident-mutation-fixture");
    Ports.mutationWorker.setDaemon(true);
    Ports.mutationWorker.start();
    Ports.mutationProbe.await();
    check(!mutation.isDone(), "Mutation settled before its shutdown probe returned");
    outcome = "mutation-began";
  }

  static void finishMutation(boolean deadlinePassed) throws Exception {
    check(mutation != null, "No mutation owns the held boot probe");
    long request = number("credentialShutdownRequest");
    if (deadlinePassed) {
      // An acknowledgement for a different stop cannot authorize this mutation.
      Ports.acknowledged.add(request + 1000);
      Ports.clockOffset += 15001;
    }
    Ports.mutationProbe.release.countDown();
    try {
      check(mutation.get(10, TimeUnit.SECONDS), "The exact commit did not return its fixture receipt");
      check(Ports.released.contains(request) && !Ports.abandoned.contains(request), "Commit did not release its exact stop");
      outcome = "committed";
    } catch (ExecutionException failure) {
      Throwable cause = failure.getCause();
      if (!"Native shutdown unconfirmed".equals(cause.getMessage())) throw failure;
      check(Ports.abandoned.contains(request) && !Ports.released.contains(request), "Unconfirmed stop was released");
      outcome = "shutdown-unconfirmed";
    } finally {
      mutation = null;
    }
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
        .put("heldStart", heldStart)
        .put("cancelledStarts", new JSONArray(cancelled()))
        .put("attachedStarts", new JSONArray(attached()))
        .put("native", nativeState())
        .put("launchedBy", launchedBy)
        .put("launches", launches)
        .put("commits", commits)
        .put("outcome", outcome)
        .put("foreignStop", foreignStop)
        .put("launchDuringShutdown", false)
        .put("commitWhileRunning", commitWhileRunning)
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
    boolean completed = false;
    try {
      for (int i = 0; i < trace.length(); i++) {
        JSONObject step = trace.getJSONObject(i), picks = step.getJSONObject("picks");
        int stops = ResidentTestPorts.stops + Ports.strictStops;
        switch (step.getString("action")) {
          case "init":
          case "check":
          case "":
            break;
          case "start":
            startRequest(picks.getInt("request"), picks.getBoolean("flag"), true);
            break;
          case "holdStartProbe":
            holdStart(picks.getInt("request"));
            break;
          case "resumeStartProbe":
            resumeStart();
            break;
          case "beginMutation":
            beginMutation();
            break;
          case "finishMutation":
            finishMutation(picks.getBoolean("flag"));
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
      completed = true;
    } catch (Throwable failure) {
      failure.printStackTrace(System.err);
    } finally {
      Ports.release();
      if (heldStartProbe != null) heldStartProbe.release.countDown();
      if (Ports.mutationProbe != null) Ports.mutationProbe.release.countDown();
      System.out.flush();
      System.exit(completed ? 0 : 1);
    }
  }
}
