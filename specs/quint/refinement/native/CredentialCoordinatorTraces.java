package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Whole-plugin credential mutation campaigns. Primitive storage and service
 * replies are controlled.
 */
public final class CredentialCoordinatorTraces {
  static Trace trace;
  static final JSONArray observations = new JSONArray();
  static String selected = "cloud:production";
  static boolean needsStop = true, prepared, written;
  static int stopBase;
  static void check(boolean condition, String message) {
    if (!condition)
      throw new AssertionError(message);
  }
  static Object field(String name) throws Exception {
    Field field = AlphaLocalAgentPlugin.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(null);
  }
  static long intent() throws Exception {
    return AlphaLocalAgentPlugin.currentCredentialIntent();
  }
  static String key(String name) { return CloudDeployment.storageSlot(name); }
  static void put(String slot, String value) {
    if (value == null)
      JsonCredentialSlots.VALUES.remove(key(slot));
    else
      JsonCredentialSlots.VALUES.put(key(slot), value);
  }
  static String get(String slot) {
    return JsonCredentialSlots.VALUES.get(key(slot));
  }
  static String credential(int n) {
    return new JSONObject()
        .put("credentialId", String.format("00000000-0000-4000-8000-%012d", n))
        .put("token",
             "eliza_mobile_" + String.valueOf((char)('a' + n)).repeat(40))
        .put("expiresAt", System.currentTimeMillis() + 3600000)
        .toString();
  }
  static String provider() throws Exception {
    JSONObject selection =
        new JSONObject()
            .put("provider", "elizacloud")
            .put("credentialId", new JSONObject(get("cloud:production"))
                                     .getString("credentialId"))
            .put("model", LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL)
            .put("revision", "00000000-0000-4000-8000-000000000042");
    return LocalAgentProviderAdmission.admit(
        null, selection.toString(), get("cloud:production"),
        new JSONObject().put("userId", "3b241101-e2bb-4255-8caf-4136c566a962"));
  }
  static int valueClass() {
    String value = get(selected);
    if (value == null)
      return 0;
    JSONObject parsed = new JSONObject(value);
    if (parsed.has("value"))
      return parsed.getInt("value");
    return Integer.parseInt(parsed.getString("credentialId").substring(24));
  }
  static JSONObject observe() {
    try {
      boolean active =
          (Boolean)field("accepting") && !(Boolean)field("stopping");
      boolean admission =
          active &&
          LocalAgentProviderAdmission.currentGeneration(
              get("local-agent-provider:v1"), get("cloud:production")) != null;
      int credential = selected.equals("local-agent-provider:v1")
                           ? valueClassOfCloud()
                           : valueClass();
      JSONObject result = Trace.fields(
          "credential", credential, "providerPresent",
          get("local-agent-provider:v1") != null, "admission", admission,
          "running",
          ResidentTestPorts.serviceActive || ResidentTestPorts.socketListening,
          "committed", written, "legacyBlocked", get(LegacyCloudRecovery.JOURNAL) != null, "requestedStop",
          CredentialCoordinatorPorts.strictStops > stopBase ? 1 : 0,
          "acknowledgedStop",
          CredentialCoordinatorPorts.strictStops > stopBase &&
                  CredentialCoordinatorPorts.confirmed
              ? 1
              : 0);
      observations.put(
          new JSONObject()
              .put("projection", result)
              .put("lifecycleEpoch", field("lifecycleEpoch"))
              .put("credentialIntentEpoch", intent())
              .put("credentialMutationEpoch", field("credentialMutationEpoch"))
              .put("credentialShutdownRequest",
                   field("credentialShutdownRequest"))
              .put("accepting", field("accepting"))
              .put("stopping", field("stopping"))
              .put("strictStops", CredentialCoordinatorPorts.strictStops));
      return result;
    } catch (Exception error) {
      throw new AssertionError(error);
    }
  }
  static int valueClassOfCloud() {
    String value = get("cloud:production");
    return value == null
        ? 0
        : Integer.parseInt(
              new JSONObject(value).getString("credentialId").substring(24));
  }
  static void event(String kind, String slot, String value) {
    if (trace == null)
      return;
    if (slot != null && slot.endsWith(LegacyCloudRecovery.JOURNAL)) {
      if (kind.equals("write-committed")) trace.step("blockLegacy", observe());
      return;
    }
    if (kind.equals("strict-stop")) {
      trace.step("retire", observe());
      return;
    }
    if (kind.equals("write-start") && !prepared) {
      if (needsStop)
        trace.step("observeStop", observe(), true, true);
      trace.step("prepareCommit", observe());
      prepared = true;
    }
    if (kind.equals("write-committed") && slot.equals(key(selected))) {
      written = true;
      trace.step("commitWrite", observe());
    }
  }
  static void await(PluginCall call) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
    while (call.completions == 0 && System.nanoTime() < end)
      Thread.sleep(2);
    check(call.completions > 0, "Call did not settle");
  }
  static AlphaConnectionPlugin connection() {
    AlphaConnectionPlugin plugin = new AlphaConnectionPlugin();
    plugin.load();
    return plugin;
  }
  static void finish(PluginCall call, boolean success) {
    check((call.rejection == null) == success,
          "Unexpected public outcome: " + call.rejection);
    if (!prepared && needsStop &&
        CredentialCoordinatorPorts.strictStops > stopBase &&
        CredentialCoordinatorPorts.confirmed)
      trace.step("observeStop", observe(), true, true);
    trace.step(written ? "reportWrite" : "operationFailure", observe(),
               written ? new Object[] {success} : new Object[] {});
  }
  static void completeShutdown() { CredentialCoordinatorPorts.absent(); }
  static void automaticStop() {
    CredentialCoordinatorPorts.observer = (kind, slot, value) -> {
      event(kind, slot, value);
      if (kind.equals("strict-stop"))
        completeShutdown();
    };
  }
  static void write(String scenario) throws Exception {
    boolean clear = scenario.equals("cloud-remove"),
            same = scenario.equals("same-cloud"),
            ordinary = scenario.equals("ordinary"),
            unbound = scenario.equals("unbound"),
            other = scenario.equals("other-environment"),
            full = scenario.equals("oversize");
    if (ordinary) {
      selected = "notes-draft:v1:device";
      put(selected, new JSONObject().put("value", 1).toString());
      needsStop = false;
    }
    if (other) {
      selected = "cloud:staging";
      put(selected, credential(1));
      trace.step("otherEnvironment", observe());
      needsStop = false;
    }
    if (unbound) {
      put("local-agent-provider:v1", null);
      trace.step("unbound", observe());
      needsStop = false;
    }
    if (same)
      needsStop = false;
    String value =
        ordinary ? new JSONObject().put("value", 2).toString()
        : same   ? new JSONObject(get(selected))
                       .put("expiresAt", System.currentTimeMillis() + 7200000)
                       .toString()
                 : credential(2);
    if (full)
      value = "x".repeat(AlphaCredentialStore.retainedLimit(selected) + 1);
    if (scenario.equals("write-before"))
      CredentialCoordinatorPorts.failBeforeSlot = key(selected);
    if (scenario.equals("write-after"))
      CredentialCoordinatorPorts.failAfterSlot = key(selected);
    if (scenario.equals("strip-before"))
      CredentialCoordinatorPorts.failBeforeSlot =
          key("local-agent-provider:v1");
    if (scenario.equals("observer-refused"))
      CredentialCoordinatorPorts.failCloudObserver = true;
    trace.step("begin", observe(), ordinary ? "ordinary" : "cloud",
               clear  ? 0
               : same ? 1
                      : 2,
               full ? 4 : 1);
    automaticStop();
    AlphaConnectionPlugin plugin = connection();
    try {
      PluginCall call = new PluginCall(
          new JSObject().put("slot", selected).put("value", value));
      if (clear)
        plugin.secureRemove(call);
      else
        plugin.secureWrite(call);
      await(call);
      if (full) {
        check(call.rejection != null && !written &&
                  CredentialCoordinatorPorts.strictStops == 0,
              "Preflight mutated state");
        trace.stutter("oversized source call refused", observe());
      } else
        finish(call, !scenario.equals("write-before") &&
                         !scenario.equals("write-after") &&
                         !scenario.equals("strip-before") &&
                         !scenario.equals("observer-refused"));
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void provider(String scenario) throws Exception {
    selected = "local-agent-provider:v1";
    automaticStop();
    boolean clear = scenario.startsWith("provider-clear");
    boolean rebind =
        scenario.equals("provider-bind") || scenario.equals("bind-write-after");
    needsStop = !rebind;
    if (scenario.equals("provider-new-bind")) {
      put("local-agent-provider:v1", null);
      trace.step("unbound", observe());
    }
    if (scenario.equals("identity-refused"))
      CredentialCoordinatorPorts.failIdentity = true;
    if (scenario.equals("bind-write-after") ||
        scenario.equals("provider-clear-after"))
      CredentialCoordinatorPorts.failAfterSlot = key(selected);
    trace.step("begin", observe(), rebind ? "rebind" : "provider",
               clear ? 0 : 2, 1);
    AlphaLocalAgentPlugin plugin = new AlphaLocalAgentPlugin();
    plugin.load();
    try {
      PluginCall call = new PluginCall(
          new JSObject()
              .put("credentialId", new JSONObject(get("cloud:production"))
                                       .getString("credentialId"))
              .put("model", LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL));
      if (clear)
        plugin.clearProvider(call);
      else
        plugin.configureCloudProvider(call);
      await(call);
      check(CredentialCoordinatorPorts.identityReads == (clear ? 0 : 1),
            "Unexpected identity request count");
      finish(call, !scenario.equals("identity-refused") &&
                       !scenario.equals("bind-write-after") &&
                       !scenario.equals("provider-clear-after"));
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void destroyed(String scenario) throws Exception {
    AlphaConnectionPlugin current = connection(), retired = connection();
    AlphaLocalAgentPlugin nativeRetired = new AlphaLocalAgentPlugin(),
                          nativeLive = new AlphaLocalAgentPlugin();
    nativeRetired.load();
    nativeLive.load();
    trace.step("begin", observe(), "cloud", 2, 1);
    CredentialCoordinatorPorts.observer = CredentialCoordinatorTraces::event;
    PluginCall active = new PluginCall(
        new JSObject().put("slot", selected).put("value", credential(2)));
    try {
      current.secureWrite(active);
      check(CredentialCoordinatorPorts.stopped.await(5, TimeUnit.SECONDS),
            "Mutation did not request shutdown");
      long captured = intent();
      retired.handleOnDestroy();
      PluginCall late = new PluginCall(
          new JSObject()
              .put("slot", selected)
              .put("value", credential(2))
              .put("model", LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL)
              .put("credentialId",
                   new JSONObject(get(selected)).getString("credentialId")));
      if (scenario.equals("late-native-provider")) {
        nativeRetired.handleOnDestroy();
        late = new PluginCall(
            new JSObject()
                .put("apiKey", "synthetic-provider-key")
                .put("model",
                     LocalAgentProviderAdmission.CEREBRAS_PROVIDER_MODEL));
        nativeRetired.configureProvider(late);
      } else if (scenario.equals("late-native-clear")) {
        nativeRetired.handleOnDestroy();
        nativeRetired.clearProvider(late);
      } else if (scenario.equals("late-native-bind")) {
        nativeRetired.handleOnDestroy();
        nativeRetired.configureCloudProvider(late);
      } else if (scenario.equals("late-connection-remove"))
        retired.secureRemove(late);
      else
        retired.secureWrite(late);
      check(intent() == captured && late.rejection != null,
            "Destroyed bridge superseded a current mutation");
      trace.stutter("destroyed bridge cannot reserve an intent", observe());
      completeShutdown();
      await(active);
      finish(active, true);
    } finally {
      current.handleOnDestroy();
      retired.handleOnDestroy();
      nativeRetired.handleOnDestroy();
      nativeLive.handleOnDestroy();
    }
  }
  static JSONObject requestObservation(AlphaLocalAgentPlugin plugin, String id) throws Exception {
    Object requests = Trace.read(plugin, "providerConfigurations");
    Object lease = ((java.util.Map<?, ?>) Trace.read(requests, "requests")).get(id);
    JSONObject value = observe();
    value.put("s.ownerEpoch", intent()).put("s.requestKnown", lease != null)
        .put("s.requestBegun", lease != null && (Boolean) Trace.read(lease, "begun"));
    if (lease != null) value.put("s.requestEpoch", Trace.read(lease, "intent"));
    return value;
  }
  static void providerRequest(String scenario) throws Exception {
    AlphaLocalAgentPlugin plugin = new AlphaLocalAgentPlugin();
    plugin.load();
    try {
      PluginCall prepare = new PluginCall(new JSObject());
      plugin.prepareProviderConfiguration(prepare);
      check(prepare.rejection == null, "Request preparation failed");
      String id = prepare.result.getString("requestId");
      trace.step("reserveProviderRequest", requestObservation(plugin, id));
      if (scenario.equals("provider-request-destroy")) {
        plugin.handleOnDestroy();
        long before = intent();
        PluginCall late = new PluginCall(new JSObject());
        plugin.prepareProviderConfiguration(late);
        check(late.rejection != null && intent() == before, "Destroyed bridge reserved provider request");
        late = new PluginCall(new JSObject().put("requestId", id));
        plugin.cancelProviderConfiguration(late);
        check(late.rejection != null && intent() == before, "Destroyed bridge cancelled live request");
        trace.stutter("destroyed provider entry points preserve request ownership", requestObservation(plugin, id));
        return;
      }
      if (scenario.equals("provider-request-cancel") || scenario.equals("provider-request-unknown")) {
        boolean matching = scenario.equals("provider-request-cancel");
        PluginCall cancel = new PluginCall(new JSObject().put("requestId", matching ? id : "unknown"));
        plugin.cancelProviderConfiguration(cancel);
        check(cancel.rejection == null, "Cancellation failed");
        trace.step("cancelProviderRequest", requestObservation(plugin, id), matching);
        if (matching) {
          PluginCall clear = new PluginCall(new JSObject().put("requestId", id));
          plugin.clearProvider(clear);
          check(clear.rejection != null && CredentialCoordinatorPorts.strictStops == 0, "Cancelled request dispatched");
          trace.value.getJSONArray("steps").put(new JSONObject().put("label", "cancelled request cannot begin")
              .put("action", Trace.action("beginProviderRequest").put("reject", true)).put("expect", requestObservation(plugin, id)));
        }
        return;
      }
      selected = "local-agent-provider:v1";
      trace.step("begin", observe(), "provider", 0, 1);
      automaticStop();
      PluginCall clear = new PluginCall(new JSObject().put("requestId", id));
      synchronized (field("lifecycleLock")) {
        plugin.clearProvider(clear);
        trace.step("beginProviderRequest", requestObservation(plugin, id));
      }
      await(clear);
      finish(clear, true);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while ((Boolean)requestObservation(plugin,id).get("s.requestKnown") && System.nanoTime() < deadline) Thread.sleep(1);
      check(!(Boolean)requestObservation(plugin,id).get("s.requestKnown"), "Completed request retained");
      trace.step("finishProviderRequest", requestObservation(plugin,id), true);
    } finally { plugin.handleOnDestroy(); }
  }
  static void timeout(boolean dispatchFailure, boolean absent,
                      boolean acknowledged) throws Exception {
    trace.step("begin", observe(), "cloud", 2, 1);
    CredentialCoordinatorPorts.observer = (kind, slot, value) -> {
      event(kind, slot, value);
      if (kind.equals("strict-stop")) {
        if (absent) {
          ResidentTestPorts.state = "dead";
          ResidentTestPorts.serviceActive = false;
          ResidentTestPorts.socketListening = false;
        }
        CredentialCoordinatorPorts.confirmed = acknowledged;
      }
    };
    CredentialCoordinatorPorts.failStop = dispatchFailure;
    CredentialCoordinatorPorts.tick = 2000;
    AlphaConnectionPlugin plugin = connection();
    try {
      PluginCall call = new PluginCall(
          new JSObject().put("slot", selected).put("value", credential(2)));
      plugin.secureWrite(call);
      await(call);
      check(call.rejection != null && !written,
            "Unconfirmed shutdown committed credentials");
      trace.step("observeStop", observe(), acknowledged, absent);
      trace.step("shutdownTimeout", observe());
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void compareConflict() throws Exception {
    trace.step("begin", observe(), "cloud", 2, 1);
    boolean changed = new AlphaCredentialStore(new android.content.Context())
                          .compareExchangeCredentialSlot(
                              selected, "not-current", credential(2));
    check(!changed && CredentialCoordinatorPorts.strictStops == 0,
          "Compare conflict mutated runtime");
    trace.step("compareConflict", observe());
  }
  static void readFailure() throws Exception {
    CredentialCoordinatorPorts.failReadSlot = key(selected);
    AlphaConnectionPlugin plugin = connection();
    try {
      PluginCall call = new PluginCall(new JSObject().put("slot", selected));
      plugin.secureRead(call);
      await(call);
      check(call.rejection != null &&
                CredentialCoordinatorPorts.strictStops == 0 && !written,
            "Failed read mutated credentials");
      trace.stutter("encrypted read failed without mutation", observe());
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void retryShutdown() throws Exception {
    timeout(false, false, false);
    stopBase = CredentialCoordinatorPorts.strictStops;
    prepared = false;
    written = false;
    CredentialCoordinatorPorts.tick = 100;
    trace.step("begin", observe(), "cloud", 2, 1);
    automaticStop();
    AlphaConnectionPlugin plugin = connection();
    try {
      PluginCall retry = new PluginCall(
          new JSObject().put("slot", selected).put("value", credential(2)));
      plugin.secureWrite(retry);
      await(retry);
      finish(retry, true);
      check(CredentialCoordinatorPorts.strictStops == 2,
            "Retry did not use a fresh strict stop");
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void clearThenWrite() throws Exception {
    provider("provider-clear");
    selected = "cloud:production";
    stopBase = CredentialCoordinatorPorts.strictStops;
    prepared = false;
    written = false;
    needsStop = false;
    trace.step("begin", observe(), "cloud", 2, 1);
    automaticStop();
    AlphaConnectionPlugin plugin = connection();
    try {
      PluginCall next = new PluginCall(
          new JSObject().put("slot", selected).put("value", credential(2)));
      plugin.secureWrite(next);
      await(next);
      finish(next, true);
      check(CredentialCoordinatorPorts.strictStops == 1,
            "Unbound Cloud write requested another stop");
    } finally {
      plugin.handleOnDestroy();
    }
  }
  static void concurrentOwner() throws Exception {
    AlphaConnectionPlugin first = connection(), second = connection();
    trace.step("begin", observe(), "cloud", 2, 1);
    CredentialCoordinatorPorts.observer = CredentialCoordinatorTraces::event;
    PluginCall old = new PluginCall(
        new JSObject().put("slot", selected).put("value", credential(2)));
    try {
      first.secureWrite(old);
      check(CredentialCoordinatorPorts.stopped.await(5, TimeUnit.SECONDS),
            "First mutation did not retire");
      CredentialCoordinatorPorts.observer = (kind, slot, value) -> {};
      String winner =
          new JSONObject(credential(2)).put("winner", "second").toString();
      PluginCall current = new PluginCall(
          new JSObject().put("slot", selected).put("value", winner));
      second.secureWrite(current);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (CredentialCoordinatorPorts.strictStops < 2 &&
             System.nanoTime() < deadline)
        Thread.sleep(2);
      check(CredentialCoordinatorPorts.strictStops == 2,
            "Second owner did not obtain fresh shutdown");
      await(old);
      check(old.rejection != null && !written,
            "Superseded mutation wrote credentials");
      trace.step("ownerChanged", observe());
      trace.step("stale", observe());
      trace.macro("new owner captures current bytes and retires", observe(),
                  Trace.action("begin", "cloud", 2, 1), Trace.action("retire"));
      prepared = false;
      written = false;
      CredentialCoordinatorPorts.observer = CredentialCoordinatorTraces::event;
      completeShutdown();
      await(current);
      finish(current, true);
      check(get(selected).equals(winner),
            "Old owner overwrote current credential");
    } finally {
      first.handleOnDestroy();
      second.handleOnDestroy();
    }
  }
  static void reservationRace() throws Exception {
    AlphaConnectionPlugin current = connection(), retired = connection();
    trace.step("begin", observe(), "cloud", 2, 1);
    CredentialCoordinatorPorts.observer = CredentialCoordinatorTraces::event;
    PluginCall active = new PluginCall(
        new JSObject().put("slot", selected).put("value", credential(2)));
    PluginCall late = new PluginCall(
        new JSObject().put("slot", selected).put("value", credential(2)));
    try {
      current.secureWrite(active);
      check(CredentialCoordinatorPorts.stopped.await(5, TimeUnit.SECONDS),
            "Mutation did not request shutdown");
      long before = intent();
      Thread caller = new Thread(() -> retired.secureWrite(late));
      synchronized (field("lifecycleLock")) {
        caller.start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (caller.getState() != Thread.State.BLOCKED &&
               System.nanoTime() < deadline)
          Thread.sleep(1);
        check(caller.getState() == Thread.State.BLOCKED,
              "Reservation did not block on lifecycle ownership");
        retired.handleOnDestroy();
      }
      caller.join(5000);
      check(!caller.isAlive() && late.rejection != null,
            "Retired reservation did not reject");
      check(intent() == before,
            "Reservation admitted after its bridge was destroyed");
      trace.stutter(
          "destruction retires a reservation waiting for the lifecycle lock",
          observe());
      completeShutdown();
      await(active);
      finish(active, true);
    } finally {
      current.handleOnDestroy();
      retired.handleOnDestroy();
    }
  }
  public static void main(String[] args) throws Exception {
    if (args[1].equals("campaign")) {
      campaign(args);
      return;
    }
    ResidentTestPorts.initialize(args[0]);
    CredentialCoordinatorPorts.installNetwork();
    put("cloud:production", credential(1));
    put("local-agent-provider:v1", provider());
    ResidentTestPorts.state = "listening";
    ResidentTestPorts.serviceActive = true;
    ResidentTestPorts.socketListening = true;
    AlphaCredentialStore.observeCloudChanges(() -> {
      CredentialCoordinatorPorts.emit("cloud-authority-retirement", null, null);
      if (CredentialCoordinatorPorts.failCloudObserver)
        throw new java.io.IOException("Authority retirement was not confirmed");
    });
    trace = new Trace(args[1], observe());
    trace.value.put("sourceObservations", observations)
        .put("portEvents", CredentialCoordinatorPorts.events);
    switch (args[1]) {
    case "provider-request-cancel":
    case "provider-request-unknown":
    case "provider-request-destroy":
    case "provider-request-clear":
      providerRequest(args[1]);
      break;
    case "provider-clear":
    case "provider-bind":
    case "provider-new-bind":
    case "identity-refused":
    case "bind-write-after":
    case "provider-clear-after":
      provider(args[1]);
      break;
    case "late-native-provider":
    case "late-native-clear":
    case "late-native-bind":
    case "late-connection-remove":
    case "late-connection-write":
      destroyed(args[1]);
      break;
    case "concurrent-owner":
      concurrentOwner();
      break;
    case "reservation-race":
      reservationRace();
      break;
    case "retry-shutdown":
      retryShutdown();
      break;
    case "clear-then-cloud":
      clearThenWrite();
      break;
    case "compare-conflict":
      compareConflict();
      break;
    case "read-failed":
      readFailure();
      break;
    case "shutdown-timeout":
      timeout(false, false, false);
      break;
    case "absent-without-ack":
      timeout(false, true, false);
      break;
    case "ack-with-live-process":
      timeout(false, false, true);
      break;
    case "stop-failed":
      timeout(true, false, false);
      break;
    default:
      write(args[1]);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void campaign(String[] args) throws Exception {
    JSONArray mutations = new JSONArray(), resident = new JSONArray();
    String javaExecutable =
        java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java")
            .toString();
    for (int index = 2; index < args.length; index++) {
      String name = args[index];
      boolean runtime = name.equals("resident-retirement");
      java.nio.file.Path output =
          java.nio.file.Path.of(args[0], "campaign-" + index + ".json");
      java.nio.file.Path errors =
          java.nio.file.Path.of(args[0], "campaign-" + index + ".err");
      Process process =
          new ProcessBuilder(
              javaExecutable, "-cp", System.getProperty("java.class.path"),
              runtime ? CredentialResidentTraces.class.getName()
                      : CredentialCoordinatorTraces.class.getName(),
              args[0], name)
              .redirectOutput(output.toFile())
              .redirectError(errors.toFile())
              .start();
      if (!process.waitFor(45, TimeUnit.SECONDS)) {
        process.destroyForcibly();
        throw new AssertionError("Source scenario timed out: " + name);
      }
      check(process.exitValue() == 0,
            name + " failed: " + java.nio.file.Files.readString(errors));
      JSONArray values = new JSONArray(java.nio.file.Files.readString(output));
      for (int row = 0; row < values.length(); row++)
        (runtime ? resident : mutations).put(values.getJSONObject(row));
    }
    System.out.println(new JSONObject()
                           .put("NativeCredentialMutation", mutations)
                           .put("ResidentRuntime", resident));
  }
}
