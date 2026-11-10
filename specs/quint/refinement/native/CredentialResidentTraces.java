package ai.alphacompute.alphaphone;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Map;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Real request/stream entry points must retire before a credential mutation
 * reaches storage.
 */
public final class CredentialResidentTraces {
  static final JSONArray observations = new JSONArray();
  static Object field(String name) throws Exception {
    return CredentialCoordinatorTraces.field(name);
  }
  static JSONObject observe(AlphaLocalAgentPlugin plugin) throws Exception {
    boolean stopping = (Boolean)field("stopping"),
            accepting = (Boolean)field("accepting");
    boolean alive =
        ResidentTestPorts.serviceActive || ResidentTestPorts.socketListening;
    String phase = stopping                      ? "stopping"
                   : !accepting || !alive        ? "stopped"
                   : field("ownerToken") != null ? "ready"
                                                 : "starting";
    JSONObject result = Trace.fields(
        "phase", phase, "epoch", field("lifecycleEpoch"), "localProcess", alive,
        "ownedStart", field("startOwnsLaunch"));
    observations.put(
        new JSONObject()
            .put("projection", result)
            .put("ownedWork", plugin.ownedWorkCount())
            .put("enrolled", AlphaLocalAgentPlugin.enrollmentPresent()));
    return result;
  }
  static void idle(AlphaLocalAgentPlugin plugin) throws Exception {
    ThreadPoolExecutor workers =
        (ThreadPoolExecutor)Trace.read(plugin, "workers");
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while ((workers.getActiveCount() != 0 || !workers.getQueue().isEmpty()) &&
           System.nanoTime() < deadline)
      Thread.sleep(2);
    CredentialCoordinatorTraces.check(workers.getActiveCount() == 0 &&
                                          workers.getQueue().isEmpty(),
                                      "Retired workers did not finish");
  }
  public static void main(String[] args) throws Exception {
    ResidentTestPorts.initialize(args[0]);
    CredentialCoordinatorTraces.put("cloud:production",
                                    CredentialCoordinatorTraces.credential(1));
    CredentialCoordinatorTraces.put("local-agent-provider:v1",
                                    CredentialCoordinatorTraces.provider());
    AlphaLocalAgentPlugin resident = new AlphaLocalAgentPlugin(),
                          configuration = new AlphaLocalAgentPlugin();
    resident.load();
    configuration.load();
    Trace trace = new Trace("credential-retirement-fences-native-work",
                            observe(resident));
    trace.value.put("sourceObservations", observations)
        .put("portEvents", CredentialCoordinatorPorts.events);
    try {
      ResidentTestPorts.pause("/api/auth/status");
      PluginCall start = new PluginCall(new JSObject().put(
          "requestId", "00000000-0000-4000-8000-000000000001"));
      resident.start(start);
      ResidentTestPorts.awaitEntered();
      trace.step("admitStart", observe(resident), true);
      ResidentTestPorts.release.countDown();
      CredentialCoordinatorTraces.await(start);
      CredentialCoordinatorTraces.check(start.rejection == null,
                                        "Resident start failed");
      trace.step("started", observe(resident), 1);
      PluginCall request = new PluginCall(
          new JSObject().put("path", "/api/status").put("method", "GET"));
      resident.request(request);
      CredentialCoordinatorTraces.check(
          CredentialCoordinatorPorts.requestEntered.await(5, TimeUnit.SECONDS),
          "Request did not enter source transport");
      PluginCall stream = new PluginCall(
          new JSObject()
              .put("streamId", "stream-0000000001")
              .put("path", "/api/conversations/thread/messages/stream")
              .put("ownerId", "identity-fixture")
              .put("body", "{}"));
      resident.requestStream(stream);
      CredentialCoordinatorTraces.await(stream);
      CredentialCoordinatorTraces.check(
          CredentialCoordinatorPorts.streamEntered.await(5, TimeUnit.SECONDS),
          "Stream did not enter source transport");
   Map<?,?> streams=(Map<?,?>)Trace.read(resident,"streams");
   ElizaAgentService.LocalStreamHandle handle =
       (ElizaAgentService.LocalStreamHandle)streams.values().iterator().next();
   CredentialCoordinatorTraces.check(resident.ownedWorkCount() == 2,
                                     "Both operations were not admitted");
   PluginCall clear = new PluginCall(new JSObject());
   configuration.clearProvider(clear);
   CredentialCoordinatorTraces.check(
       CredentialCoordinatorPorts.stopped.await(5, TimeUnit.SECONDS),
       "Credential mutation did not retire runtime");
   CredentialCoordinatorTraces.check(resident.ownedWorkCount() == 0 &&
                                         handle.cancelled &&
                                         request.rejection != null,
                                     "Mutation left admitted work alive");
   trace.step("requestStop", observe(resident));
   CredentialCoordinatorPorts.absent();
   CredentialCoordinatorTraces.await(clear);
   CredentialCoordinatorTraces.check(
       clear.rejection == null &&
           CredentialCoordinatorTraces.get("local-agent-provider:v1") == null,
       "Provider clear did not finish");
   PluginCall status = new PluginCall(new JSObject());
   resident.getStatus(status);
   CredentialCoordinatorTraces.await(status);
   CredentialCoordinatorTraces.check(
       "stopped".equals(status.result.getString("state")),
       "Strict shutdown was not confirmed");
   trace.step("shutdownConfirmed", observe(resident));
   int notifications = CredentialCoordinatorPorts.notifications.length();
   CredentialCoordinatorPorts.requestRelease.countDown();
   CredentialCoordinatorPorts.streamRelease.countDown();
   idle(resident);
   CredentialCoordinatorTraces.check(
       request.result == null && request.completions == 1,
       "Late request response resolved retired work");
   CredentialCoordinatorTraces.check(
       CredentialCoordinatorPorts.notifications.length() == notifications,
       "Retired stream emitted a late callback");
   trace.stutter("late callbacks cannot restore enrollment", observe(resident));
   System.out.println(new JSONArray().put(trace.value));
    } finally {
      CredentialCoordinatorPorts.requestRelease.countDown();
      CredentialCoordinatorPorts.streamRelease.countDown();
      ResidentTestPorts.release.countDown();
      resident.handleOnDestroy();
      configuration.handleOnDestroy();
    }
  }
}
