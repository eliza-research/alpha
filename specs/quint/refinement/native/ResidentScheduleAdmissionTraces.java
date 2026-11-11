package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** The complete receiver and plugin run over controlled Android/service boundaries. */
public final class ResidentScheduleAdmissionTraces {
  public static final class Ports {
    public static boolean unlocked = true, enabled = true, refuse;
    public static String decision = "IGNORE";
    public static int attempts, deferredLogs, logsAtAllocation;
    public static void start() {
      try {
        if (!Thread.holdsLock(field("lifecycleLock"))) throw new AssertionError("Start escaped lifecycle lock");
        if (!(Boolean)field("accepting") || (Boolean)field("stopping")
            || ((Number)field("credentialMutationEpoch")).longValue() >= 0
            || ((Number)field("credentialShutdownRequest")).longValue() != -1)
          throw new AssertionError("Start admitted while lifecycle closed");
        attempts++;
        if (refuse) throw new SecurityException("Controlled service refusal");
        // Android/service allocation is an external port. Repeated starts target one instance.
        if (!ResidentTestPorts.serviceActive) ResidentTestPorts.starts++;
        ResidentTestPorts.state = "listening";
        ResidentTestPorts.serviceActive = true;
        ResidentTestPorts.socketListening = true;
        logsAtAllocation = deferredLogs;
      } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
    }
    public static void warning(String tag, String message) {
      if (tag.equals("AlphaResidentSchedule") && message.startsWith("Resident start deferred for ")) deferredLogs++;
    }
  }

  static Object field(String name) throws ReflectiveOperationException {
    Field field = AlphaLocalAgentPlugin.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(null);
  }
  static long epoch() throws ReflectiveOperationException { return ((Number)field("lifecycleEpoch")).longValue(); }
  static long acknowledgedEpoch = -1;
  static final JSONArray raw = new JSONArray();
  static JSONObject observe() throws Exception {
    boolean accepting = (Boolean)field("accepting"), stopping = (Boolean)field("stopping");
    boolean idle = accepting && !stopping && ((Number)field("credentialMutationEpoch")).longValue() < 0
        && ((Number)field("credentialShutdownRequest")).longValue() == -1;
    raw.put(new JSONObject().put("accepting", accepting).put("stopping", stopping)
        .put("nativeEpoch", epoch()).put("physicalServiceActive", ResidentTestPorts.serviceActive)
        .put("physicalSocketListening", ResidentTestPorts.socketListening)
        .put("serviceStartAttempts", Ports.attempts).put("successfulAllocations", ResidentTestPorts.starts)
        .put("receiverDeferredLogs", Ports.deferredLogs).put("acknowledgedEpoch", acknowledgedEpoch));
    // No equality with the abstract epoch or instantaneous physical-stop claim is made here.
    return Trace.fields("unlocked", Ports.unlocked, "packaged", ResidentTestPorts.packaged,
        "enabled", Ports.enabled, "lifecycle", idle ? "idle" : "stopping",
        "lastDecision", Ports.decision, "starts", ResidentTestPorts.starts,
        "deferred", Ports.deferredLogs > Ports.logsAtAllocation, "failedStarts", Ports.deferredLogs,
        "confirmed", acknowledgedEpoch == epoch());
  }
  static PluginCall call() { return new PluginCall(new JSObject().put("requestId", "00000000-0000-4000-8000-000000000001")); }
  static void await(PluginCall call) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(6);
    while (call.completions == 0 && System.nanoTime() < end) Thread.sleep(2);
    if (call.completions != 1 || call.rejection != null) throw new AssertionError("Call failed: " + call.rejection);
  }
  static final ResidentScheduleReceiver receiver = new ResidentScheduleReceiver();
  static final Context context = new Context();
  static String action(String event) {
    switch(event) {
      case "boot": return ResidentScheduleRearm.BOOT_COMPLETED;
      case "update": return ResidentScheduleRearm.PACKAGE_REPLACED;
      case "time": return ResidentScheduleRearm.TIME_SET;
      case "zone": return ResidentScheduleRearm.TIMEZONE_CHANGED;
      default: return "unrelated";
    }
  }
  static void broadcast(Trace trace, String event, boolean works) throws Exception {
    Ports.refuse = !works;
    receiver.onReceive(context, new Intent(action(event)));
    Ports.refuse = false;
    if (works) trace.step("broadcast", observe(), event);
    else trace.step("broadcastOutcome", observe(), event, false);
  }
  public static void main(String[] args) throws Exception {
    if (args[0].equals("table")) {
      System.out.println(FinitePolicyTraces.schedulingTraces());
      return;
    }
    ResidentTestPorts.initialize(args[1]);
    AlphaLocalAgentPlugin plugin = new AlphaLocalAgentPlugin();
    plugin.load();
    try {
      Trace trace = new Trace("service-admission-" + args[0], observe());
      trace.value.put("sourceObservations", raw);
      if (args[0].equals("deferred") || args[0].equals("foreground")) {
        broadcast(trace, "boot", false);
        if (Ports.attempts != 1 || Ports.deferredLogs != 1 || ResidentTestPorts.serviceActive)
          throw new AssertionError("Receiver did not retain a real service refusal");
        if (args[0].equals("foreground")) {
          PluginCall start = call(); plugin.start(start); await(start);
          trace.step("foregroundLaunch", observe());
        } else {
          broadcast(trace, "time", true);
          broadcast(trace, "update", true);
          broadcast(trace, "zone", true);
        }
      } else if (args[0].equals("stop")) {
        broadcast(trace, "boot", true);
        PluginCall stop = call(); plugin.stop(stop); await(stop);
        trace.step("beginLifecycle", observe(), "stopping");
        int before = Ports.attempts;
        broadcast(trace, "time", true);
        if (Ports.attempts != before) throw new AssertionError("Stopped lifecycle admitted a broadcast");
        // An external service ACK is read through the actual plugin status method.
        ResidentTestPorts.state = "dead"; ResidentTestPorts.serviceActive = false; ResidentTestPorts.socketListening = false;
        PluginCall status = call(); plugin.getStatus(status); await(status);
        if (!status.result.getString("state").equals("stopped")) throw new AssertionError("Missing stop ACK");
        acknowledgedEpoch = epoch();
        trace.step("confirmLifecycle", observe());
        broadcast(trace, "zone", true);
        if (Ports.attempts != before) throw new AssertionError("Stop ACK reopened broadcast admission");
        PluginCall start = call(); plugin.start(start); await(start);
        trace.step("explicitStart", observe());
        broadcast(trace, "zone", true);
      } else throw new AssertionError("Unknown scenario");
      System.out.println(new JSONArray().put(trace.value));
    } finally { plugin.handleOnDestroy(); }
  }
}
