package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.CloudSignInFlow;
import ai.eliza.auth.cloud.CloudSignInReadiness;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.*;
import java.util.concurrent.*;
import org.json.*;

public final class SignInCoordinatorTraces {
  private static final java.util.List<AlphaCloudSignInPlugin> plugins=new java.util.ArrayList<>();
  private static AlphaCloudSignInPlugin plugin() {
    AlphaCloudSignInPlugin value=new AlphaCloudSignInPlugin();plugins.add(value);return value;
  }
  public static void main(String[] args)throws Exception {
    try { run(args); }
    finally { for(AlphaCloudSignInPlugin plugin:plugins)plugin.handleOnDestroy(); }
  }
  static JSONObject observed(int target) {
    return Trace.fields("key", SignInTestPorts.targetStored(target), "receipt",
        SignInTestPorts.values.containsKey(SignInTestPorts.ACK), "owner", SignInTestPorts.owner());
  }
  static void release(SignInTestPorts.Event event) {
    event.release.countDown();
  }
  static void drain(AlphaCloudSignInPlugin plugin) throws Exception {
    Future<?> done = ((ExecutorService) Trace.read(plugin, "worker")).submit(() -> {});
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
    while (!done.isDone() && System.nanoTime() < deadline) {
      SignInTestPorts.Event event = SignInTestPorts.events.poll(100, TimeUnit.MILLISECONDS);
      if (event != null)
        release(event);
    }
    done.get(1, TimeUnit.SECONDS);
  }
  static AlphaCloudSignInPlugin start(Trace trace, int target) throws Exception {
    AlphaCloudSignInPlugin plugin = plugin();
    plugin.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
    SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
    trace.step("begin",
        observed(target).put("s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)),
        "google");
    release(stored);
    drain(plugin);
    CloudSignInFlow.Pending pending =
        CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
    plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
        Uri.parse(pending.environment.callback() + "#code=fixture&state=" + CloudSignInFlow.newState())));
    drain(plugin);
    trace.step(
        "callback", Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), 0);
    plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
        Uri.parse(pending.environment.callback() + "#code=fixture&state=" + pending.state)));
    SignInTestPorts.Event exchange = SignInTestPorts.next("http:/steward/auth/oauth/exchange");
    Object attempt = Trace.read(plugin, "attempt");
    trace.step("callback",
        Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING),
            "callbackAccepted", Trace.read(attempt, "callbackReceived")),
        target);
    release(exchange);
    return plugin;
  }
  static void finishSuccessful(
      AlphaCloudSignInPlugin plugin, Trace trace, int target, boolean cancelAfterCommit) throws Exception {
    long completedBefore=SignInTestPorts.outcomes.stream().filter(value->"authenticated".equals(value.optString("status"))).count();
    SignInTestPorts.Event receipt = SignInTestPorts.next("write:" + SignInTestPorts.ACK);
    trace.macro("native receipt committed before replacing key", observed(target), Trace.action("exchanged"),
        Trace.action("writeReceipt"));
    release(receipt);
    SignInTestPorts.Event key = SignInTestPorts.next("write:" + SignInTestPorts.CREDENTIAL);
    trace.step("writeKey", observed(target));
    if (cancelAfterCommit) {
      plugin.cancel(new PluginCall(new JSObject()));
      trace.step("cancel", observed(target).put("s.cancelRequested", true));
    }
    release(key);
    SignInTestPorts.Event ack = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
    release(ack);
    if (SignInTestPorts.scenario.equals("retry") && target == 2) {
      ack = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
      trace.step(
          "ack", observed(target).put("s.ackTries", SignInTestPorts.acknowledgements.get(target) - 1), false);
      release(ack);
    }
    if(cancelAfterCommit) {
      trace.step("ackWithReceipt",observed(target).put("s.ackTries",SignInTestPorts.acknowledgements.get(target)),true,true);
    } else {
      SignInTestPorts.Event removed = SignInTestPorts.next("remove:" + SignInTestPorts.ACK);
      trace.step("ack", observed(target).put("s.ackTries", SignInTestPorts.acknowledgements.get(target)), true);
      release(removed);
    }
    if (target > 1) {
      SignInTestPorts.Event revoked = SignInTestPorts.next("http:/api/v1/api-keys/current");
      release(revoked);
    }
    SignInTestPorts.Event logout = SignInTestPorts.next("http:/steward/auth/logout");
    if (target > 1)
      trace.step("revokePrevious", observed(target).put("s.revoked", SignInTestPorts.revocations == 1), true);
    long completed=SignInTestPorts.outcomes.stream().filter(value->"authenticated".equals(value.optString("status"))).count();
    if(cancelAfterCommit) {
      if(completed!=completedBefore||!SignInTestPorts.values.containsKey(SignInTestPorts.ACK)||!SignInTestPorts.targetStored(target))
        throw new AssertionError("Retired interaction published or lost committed recovery state");
    } else if(completed<=completedBefore) {
      throw new AssertionError("No authentication outcome before logout");
    }
    release(logout);
    drain(plugin);
    trace.step("releaseSteward", observed(target));
    plugin.handleOnDestroy();
  }
  static void coldReturnRefused() throws Exception {
    Trace trace=new Trace("cold callback retains pending bytes without live authority",observed(1));
    AlphaCloudSignInPlugin active=startPending(trace);
    String saved=SignInTestPorts.values.get(SignInTestPorts.PENDING);
    CloudSignInFlow.Pending pending=CloudSignInFlow.Pending.parse(saved,AlphaCloudSignInPlugin.REGISTRATION);
    active.handleOnDestroy();
    AlphaCloudSignInPlugin restored=plugin();
    trace.step("restart",Trace.fields("pending",true));
    restored.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
      Uri.parse(pending.environment.callback()+"#code=fixture&state="+pending.state)));
    drain(restored);
    if(!saved.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING))||SignInTestPorts.exchanges!=0
      ||SignInTestPorts.outcomes.stream().noneMatch(value->"app-link-unverified".equals(value.optString("code"))))
      throw new AssertionError("Cold return acquired credential authority or lost pending bytes");
    trace.step("callback",Trace.fields("pending",true,"callbackAccepted",false),1);
    System.out.println(new JSONArray().put(trace.value));
  }
  static void burnFailure() throws Exception {
    SignInTestPorts.failRemoveSlot = SignInTestPorts.PENDING;
    Trace trace = new Trace("failed pending removal refuses exchange", observed(1));
    AlphaCloudSignInPlugin plugin = plugin();
    PluginCall starting = new PluginCall(new JSObject().put("environment", "production"));
    try {
      plugin.startGoogle(starting);
      SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      trace.step("begin",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), "google");
      release(stored);
      drain(plugin);
      CloudSignInFlow.Pending pending =
          CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(pending.environment.callback() + "#code=fixture&state=" + pending.state)));
      SignInTestPorts.Event rejected = SignInTestPorts.next("failed-remove:" + SignInTestPorts.PENDING);
      release(rejected);
      drain(plugin);
      trace.step("callbackBurnFailed",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING),
              "callbackAccepted", SignInTestPorts.exchanges > 0));
      if (SignInTestPorts.exchanges != 0)
        throw new AssertionError("Exchange after failed durable removal");
      if (!"storage".equals(starting.rejection))
        throw new AssertionError("Missing waiting storage failure");
    } finally {
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      plugin.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void cancellationFailure() throws Exception {
    Trace trace =
        new Trace("unconfirmed cancellation blocks current process and survives as uncertainty", observed(1));
    AlphaCloudSignInPlugin plugin = plugin();
    try {
      plugin.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      trace.step("begin",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), "google");
      release(stored);
      drain(plugin);
      CloudSignInFlow.Pending pending =
          CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
      SignInTestPorts.failRemoveSlot = SignInTestPorts.PENDING;
      PluginCall cancelled = new PluginCall(new JSObject());
      plugin.cancel(cancelled);
      SignInTestPorts.Event failed = SignInTestPorts.next("failed-remove:" + SignInTestPorts.PENDING);
      release(failed);
      drain(plugin);
      trace.step("cancelBurnFailed",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING),
              "cancelRequested", "storage".equals(cancelled.rejection)));
      Intent callback = new Intent(Intent.ACTION_VIEW,
          Uri.parse(pending.environment.callback() + "#code=fixture&state=" + pending.state));
      plugin.handleOnNewIntent(callback);
      drain(plugin);
      JSONObject refused = Trace.action("callback", 1).put("reject", true);
      trace.macro("cancelled process refuses retained callback",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), refused);
      if (SignInTestPorts.exchanges != 0)
        throw new AssertionError("Unconfirmed cancellation exchanged in same process");
      plugin.handleOnDestroy();
      plugin = plugin();
      SignInTestPorts.failRemoveSlot = null;
      trace.step("restart",Trace.fields("pending",true));
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(pending.environment.callback()+"#code=fixture&state="+pending.state)));
      drain(plugin);
      if(SignInTestPorts.exchanges!=0||!SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)
        ||SignInTestPorts.outcomes.stream().noneMatch(value->"app-link-unverified".equals(value.optString("code"))))
        throw new AssertionError("Restart recovered a credential intent from retained pending bytes");
      trace.step("callback",Trace.fields("pending",true,"callbackAccepted",false),1);
    } finally {
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      plugin.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void cancellationReplacement() throws Exception {
    Trace trace = new Trace("cancel retires only its own pending record", observed(1));
    AlphaCloudSignInPlugin first = plugin();
    AlphaCloudSignInPlugin replacement = plugin();
    try {
      first.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event firstStored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      trace.step("begin", Trace.fields("pending", true), "google");
      release(firstStored);
      drain(first);
      String firstRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      CloudSignInFlow.Pending firstPending = CloudSignInFlow.Pending.parse(firstRaw, AlphaCloudSignInPlugin.REGISTRATION);

      PluginCall cancelled = new PluginCall(new JSObject());
      first.cancel(cancelled);
      SignInTestPorts.Event oldCas = SignInTestPorts.next("cas:" + SignInTestPorts.PENDING);
      replacement.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event replacementStored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      String replacementRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      if (firstRaw.equals(replacementRaw))
        throw new AssertionError("Fresh attempt reused old pending record");
      release(oldCas);
      drain(first);
      if (cancelled.result == null || cancelled.rejection != null)
        throw new AssertionError("Retired old attempt was not acknowledged");
      if (!replacementRaw.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING)))
        throw new AssertionError("Old cancellation removed replacement pending record");
      trace.macro("old cancellation preserves independently replaced pending record",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)),
          Trace.action("cancel"), Trace.action("begin", "google"));
      release(replacementStored);
      drain(replacement);

      first.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(firstPending.environment.callback() + "#code=fixture&state=" + firstPending.state)));
      drain(first);
      trace.step("callback",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), 1);
      if (SignInTestPorts.exchanges != 0
          || !replacementRaw.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING)))
        throw new AssertionError("Stale callback consumed replacement attempt");
    } finally {
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      first.handleOnDestroy();
      replacement.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void unownedCancellationReplacement() throws Exception {
    Trace trace = new Trace("unowned cancellation cannot adopt a later pending record", observed(1));
    AlphaCloudSignInPlugin idle = plugin();
    AlphaCloudSignInPlugin replacement = plugin();
    CountDownLatch workerEntered = new CountDownLatch(1);
    CountDownLatch releaseWorker = new CountDownLatch(1);
    try {
      ExecutorService executor = (ExecutorService) Trace.read(idle, "worker");
      executor.submit(() -> {
        workerEntered.countDown();
        try {
          releaseWorker.await();
        } catch (InterruptedException stopped) {
          Thread.currentThread().interrupt();
        }
      });
      if (!workerEntered.await(5, TimeUnit.SECONDS))
        throw new AssertionError("Idle worker did not pause");
      PluginCall cancelled = new PluginCall(new JSObject());
      idle.cancel(cancelled);
      replacement.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      String replacementRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      trace.step("begin", Trace.fields("pending", replacementRaw != null), "google");
      release(stored);
      drain(replacement);
      releaseWorker.countDown();
      drain(idle);
      if (cancelled.result == null || cancelled.rejection != null)
        throw new AssertionError("Empty cancellation was not acknowledged");
      if (!replacementRaw.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING)))
        throw new AssertionError("Unowned cancellation removed an attempt admitted after it");
      trace.stutter("cancel admitted before the replacement does not retire its bytes",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)));
    } finally {
      releaseWorker.countDown();
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      idle.handleOnDestroy();
      replacement.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void cancellationDuringCallbackRead() throws Exception {
    Trace trace = new Trace("cancelled waiting callback cannot acquire cold-return ownership", observed(1));
    AlphaCloudSignInPlugin plugin = plugin();
    try {
      plugin.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      trace.step("begin", Trace.fields("pending", true), "google");
      release(stored);
      drain(plugin);
      CloudSignInFlow.Pending pending =
          CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
      // Alpha first checks whether this callback supersedes legacy recovery. Pause the shared worker read.
      SignInTestPorts.readsBeforePause = 1;
      SignInTestPorts.pauseReadSlot = SignInTestPorts.PENDING;
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(pending.environment.callback() + "#code=fixture&state=" + pending.state)));
      SignInTestPorts.Event read = SignInTestPorts.next("read:" + SignInTestPorts.PENDING);
      PluginCall cancelled = new PluginCall(new JSObject());
      plugin.cancel(cancelled);
      release(read);
      drain(plugin);
      if (SignInTestPorts.exchanges != 0)
        throw new AssertionError("Cancelled return became a cold exchange");
      if (cancelled.result == null || cancelled.rejection != null)
        throw new AssertionError("Cancellation did not finish");
      trace.step("cancel",
          observed(1).put("s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)));
    } finally {
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      plugin.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static AlphaCloudSignInPlugin startPending(Trace trace) throws Exception {
    AlphaCloudSignInPlugin plugin = plugin();
    plugin.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
    SignInTestPorts.Event stored = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
    trace.step("begin", Trace.fields("pending", true), "google");
    release(stored);
    drain(plugin);
    return plugin;
  }
  static void staleReadThenReplacement() throws Exception {
    Trace trace = new Trace("a held old callback cannot adopt the new Google attempt", observed(1));
    AlphaCloudSignInPlugin plugin = startPending(trace);
    SignInTestPorts.Event exchange = null;
    try {
      String oldRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      CloudSignInFlow.Pending oldPending = CloudSignInFlow.Pending.parse(oldRaw, AlphaCloudSignInPlugin.REGISTRATION);
      // Alpha first checks whether this callback supersedes legacy recovery. Pause the shared worker read.
      SignInTestPorts.readsBeforePause = 1;
      SignInTestPorts.pauseReadSlot = SignInTestPorts.PENDING;
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(oldPending.environment.callback() + "#code=fixture&state=" + oldPending.state)));
      SignInTestPorts.Event read = SignInTestPorts.next("read:" + SignInTestPorts.PENDING);
      PluginCall cancelled = new PluginCall(new JSObject());
      plugin.cancel(cancelled);
      PluginCall nextCall = new PluginCall(new JSObject().put("environment", "production"));
      plugin.startGoogle(nextCall);
      Object replacement = Trace.read(plugin, "attempt");
      String newRaw = (String) Trace.read(replacement, "pendingRecord");
      if (oldRaw.equals(newRaw))
        throw new AssertionError("Replacement did not get its own record");
      release(read);
      drain(plugin);
      if (SignInTestPorts.exchanges != 0 || Trace.read(plugin, "attempt") != replacement
          || Boolean.TRUE.equals(Trace.read(replacement, "callbackReceived"))
          || Boolean.TRUE.equals(Trace.read(replacement, "cancelled")))
        throw new AssertionError("Old callback was accepted as the replacement");
      if (!newRaw.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING)) || cancelled.result == null
          || nextCall.rejection != null)
        throw new AssertionError("Replacement persistence or old cancellation failed");
      trace.macro("cancelled old callback is fenced from the newly admitted attempt",
          Trace.fields("pending", true), Trace.action("cancel"), Trace.action("begin", "google"));
      trace.step("callback", Trace.fields("pending", true), 1);
      CloudSignInFlow.Pending current = CloudSignInFlow.Pending.parse(newRaw, AlphaCloudSignInPlugin.REGISTRATION);
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(current.environment.callback() + "#code=fixture&state=" + current.state)));
      exchange = SignInTestPorts.next("http:/steward/auth/oauth/exchange");
      if (SignInTestPorts.exchanges != 1 || Trace.read(plugin, "attempt") != replacement)
        throw new AssertionError("Current replacement callback did not progress");
      trace.step("callback",
          Trace.fields("pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)), 2);
    } finally {
      plugin.handleOnDestroy();
      if (exchange != null)
        release(exchange);
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void cancelThenCodeAttempt(boolean phone) throws Exception {
    Trace trace =
        new Trace("queued cancellation retires its Google record before a new code attempt", observed(1));
    AlphaCloudSignInPlugin plugin = startPending(trace);
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch resume = new CountDownLatch(1);
    try {
      String oldRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      CloudSignInFlow.Pending oldPending = CloudSignInFlow.Pending.parse(oldRaw, AlphaCloudSignInPlugin.REGISTRATION);
      ((ExecutorService) Trace.read(plugin, "worker")).submit(() -> {
        entered.countDown();
        try {
          resume.await();
        } catch (InterruptedException stopped) {
          Thread.currentThread().interrupt();
        }
      });
      if (!entered.await(5, TimeUnit.SECONDS))
        throw new AssertionError("Worker did not pause");
      PluginCall cancelled = new PluginCall(new JSObject());
      plugin.cancel(cancelled);
      PluginCall codeCall = new PluginCall(new JSObject()
              .put("environment", "production")
              .put(phone ? "phone" : "email", phone ? "+12025550123" : "fixture@example.test"));
      if (phone)
        plugin.startPhone(codeCall);
      else
        plugin.startEmail(codeCall);
      Object replacement = Trace.read(plugin, "attempt");
      resume.countDown();
      drain(plugin);
      if (cancelled.result == null || cancelled.rejection != null
          || SignInTestPorts.values.containsKey(SignInTestPorts.PENDING))
        throw new AssertionError("Reported cancellation left the old Google record durable");
      if (codeCall.result == null || codeCall.rejection != null || SignInTestPorts.codeSends != 1
          || Trace.read(plugin, "attempt") != replacement
          || Boolean.TRUE.equals(Trace.read(replacement, "cancelled")))
        throw new AssertionError("New code attempt did not survive old cancellation");
      trace.macro("retirement is not skipped when a later code attempt is active",
          Trace.fields("pending", false), Trace.action("cancel"),
          Trace.action("begin", phone ? "phone" : "email"));
      plugin.handleOnDestroy();
      plugin = plugin();
      plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(oldPending.environment.callback() + "#code=fixture&state=" + oldPending.state)));
      drain(plugin);
      if (SignInTestPorts.exchanges != 0)
        throw new AssertionError("Old Google return survived confirmed cancellation and restart");
      trace.stutter(
          "restart does not recover an already retired Google record", Trace.fields("pending", false));
    } finally {
      resume.countDown();
      plugin.handleOnDestroy();
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void lostCallbackCas() throws Exception {
    Trace trace = new Trace(
        "callback CAS conflict preserves the foreign record without a storage failure", observed(1));
    AlphaCloudSignInPlugin first = startPending(trace);
    AlphaCloudSignInPlugin replacement = plugin();
    try {
      CloudSignInFlow.Pending oldPending =
          CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
      first.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(oldPending.environment.callback() + "#code=fixture&state=" + oldPending.state)));
      SignInTestPorts.Event compare = SignInTestPorts.next("cas:" + SignInTestPorts.PENDING);
      replacement.startGoogle(new PluginCall(new JSObject().put("environment", "production")));
      SignInTestPorts.Event newWrite = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      String newRaw = SignInTestPorts.values.get(SignInTestPorts.PENDING);
      release(newWrite);
      drain(replacement);
      release(compare);
      drain(first);
      // An old active Attempt must also reject the replacement's matching callback.
      CloudSignInFlow.Pending newPending = CloudSignInFlow.Pending.parse(newRaw, AlphaCloudSignInPlugin.REGISTRATION);
      first.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
          Uri.parse(newPending.environment.callback() + "#code=fixture&state=" + newPending.state)));
      drain(first);
      if (!newRaw.equals(SignInTestPorts.values.get(SignInTestPorts.PENDING))
          || SignInTestPorts.exchanges != 0
          || Boolean.TRUE.equals(Trace.read(first, "pendingRetirementUnconfirmed"))
          || SignInTestPorts.outcomes.stream().anyMatch(value -> "storage".equals(value.optString("code"))))
        throw new AssertionError(
            "Ownership loss was treated as storage failure or consumed the foreign record");
      trace.stutter("ownership conflict leaves the pending record and exchanges nothing",
          Trace.fields("pending", true));
    } finally {
      first.handleOnDestroy();
      replacement.handleOnDestroy();
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static boolean receiptFor(int issued) {
    String raw = SignInTestPorts.values.get(SignInTestPorts.ACK);
    return raw != null
        && new JSONObject(raw)
               .getString("credentialId")
               .equals(String.format("00000000-0000-4000-8000-%012d", issued));
  }
  static JSONObject currentObservation(int current) {
    return Trace.fields("owner", SignInTestPorts.owner(), "key", SignInTestPorts.targetStored(current),
        "receipt", receiptFor(current));
  }
  static void activationOverlap(boolean cancelAfterReceipt) throws Exception {
    Trace trace = new Trace(
        "held old ACK and replacement " + (cancelAfterReceipt ? "receipt" : "pending") + " cancellation",
        observed(1));
    AlphaCloudSignInPlugin plugin = start(trace, 1);
    try {
      SignInTestPorts.Event receipt = SignInTestPorts.next("write:" + SignInTestPorts.ACK);
      trace.macro(
          "first receipt persisted", observed(1), Trace.action("exchanged"), Trace.action("writeReceipt"));
      release(receipt);
      SignInTestPorts.Event key = SignInTestPorts.next("write:" + SignInTestPorts.CREDENTIAL);
      trace.step("writeKey", observed(1));
      release(key);
      SignInTestPorts.Event heldAck = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
      Object previous = Trace.read(plugin, "attempt");
      plugin.cancel(new PluginCall(new JSObject()));
      trace.step("cancel", observed(1));
      PluginCall nextCall = new PluginCall(new JSObject().put("environment", "production"));
      plugin.startGoogle(nextCall);
      Object replacement = Trace.read(plugin, "attempt");
      if (replacement == null || replacement == previous || nextCall.rejection != null)
        throw new AssertionError("Replacement was not admitted while previous ACK was held");
      trace.step("begin",
          currentObservation(2)
              .put("s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING))
              .put("s.pendingWrite", Trace.read(replacement, "pendingRecord") != null)
              .put("s.activation.owner", SignInTestPorts.owner())
              .put("s.activation.receipt", receiptFor(1)),
          "google");
      release(heldAck);
      SignInTestPorts.Event logout = SignInTestPorts.next("http:/steward/auth/logout");
      trace.step("ackWithReceipt",currentObservation(2).put("s.activation.receipt",receiptFor(1)),true,true);
      if (Trace.read(plugin, "attempt") != replacement || nextCall.result != null)
        throw new AssertionError("Old activation overwrote the new interactive attempt");
      if(SignInTestPorts.outcomes.stream().anyMatch(value->"authenticated".equals(value.optString("status"))))
        throw new AssertionError("Retired activation published to the replacement");
      trace.stutter("old completion preserves the replacement",currentObservation(2));
      release(logout);
      SignInTestPorts.Event pending = SignInTestPorts.next("write:" + SignInTestPorts.PENDING);
      trace.macro("queued pending write starts after old worker cleanup",
          currentObservation(2)
              .put("s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING))
              .put("s.activation.receipt", receiptFor(1)),
          Trace.action("releaseSteward"), Trace.action("beginWork"));
      release(pending);
      drain(plugin);
      if (cancelAfterReceipt) {
        CloudSignInFlow.Pending saved =
            CloudSignInFlow.Pending.parse(SignInTestPorts.values.get(SignInTestPorts.PENDING), AlphaCloudSignInPlugin.REGISTRATION);
        plugin.handleOnNewIntent(new Intent(Intent.ACTION_VIEW,
            Uri.parse(saved.environment.callback() + "#code=fixture&state=" + saved.state)));
        SignInTestPorts.Event exchange = SignInTestPorts.next("http:/steward/auth/oauth/exchange");
        trace.step("callback",
            currentObservation(2).put(
                "s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)),
            2);
        release(exchange);
        SignInTestPorts.Event secondReceipt = SignInTestPorts.next("write:" + SignInTestPorts.ACK);
        trace.macro("replacement receipt survives prior activation cleanup",
            currentObservation(2).put("s.activation.receipt", receiptFor(1)), Trace.action("exchanged"),
            Trace.action("writeReceipt"));
        plugin.cancel(new PluginCall(new JSObject()));
        trace.step("cancel", currentObservation(2));
        release(secondReceipt);
        SignInTestPorts.Event secondLogout = SignInTestPorts.next("http:/steward/auth/logout");
        release(secondLogout);
        drain(plugin);
        trace.step("releaseSteward", currentObservation(2));
      } else {
        plugin.handleOnDestroy();
        plugin = plugin();
        plugin.load();
        SignInTestPorts.Event recoveredAck=SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
        trace.step("restart",currentObservation(2).put("s.pending",true).put("s.activation.receipt",true));
        release(recoveredAck);
        SignInTestPorts.Event recoveredRemoval=SignInTestPorts.next("remove:"+SignInTestPorts.ACK);
        trace.step("ack",currentObservation(2).put("s.activation.receipt",false),true);
        release(recoveredRemoval);
        drain(plugin);
        plugin.cancel(new PluginCall(new JSObject()));
        SignInTestPorts.Event cancelledPending = SignInTestPorts.next("remove:" + SignInTestPorts.PENDING);
        trace.step("cancel",
            currentObservation(2).put(
                "s.pending", SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)));
        release(cancelledPending);
        drain(plugin);
      }
      plugin.handleOnDestroy();
      plugin = plugin();
      plugin.load();
      drain(plugin);
      if (SignInTestPorts.owner() != 1 || SignInTestPorts.values.containsKey(SignInTestPorts.PENDING)
          || SignInTestPorts.values.containsKey(SignInTestPorts.ACK))
        throw new AssertionError("Restart did not preserve the original activated credential");
      trace.step("restart", observed(1).put("s.pending", false));
    } finally {
      plugin.handleOnDestroy();
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  static void receiptFailure() throws Exception {
    Trace trace = new Trace("failed receipt write preserves previous credential", observed(1));
    AlphaCloudSignInPlugin first = start(trace, 1);
    finishSuccessful(first, trace, 1, false);
    SignInTestPorts.failSlot = SignInTestPorts.ACK;
    AlphaCloudSignInPlugin replacement = start(trace, 2);
    try {
      SignInTestPorts.Event failed = SignInTestPorts.next("failed-write:" + SignInTestPorts.ACK);
      trace.step("exchanged", observed(2));
      release(failed);
      SignInTestPorts.Event logout = SignInTestPorts.next("http:/steward/auth/logout");
      release(logout);
      drain(replacement);
      trace.macro("receipt failure stops before new credential commit", observed(2),
          Trace.action("storageFailure"), Trace.action("releaseSteward"));
      if (SignInTestPorts.owner() != 1 || SignInTestPorts.revocations != 0
          || SignInTestPorts.acknowledgements.containsKey(2))
        throw new AssertionError("Receipt failure replaced or revoked the old credential");
    } finally {
      for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
      replacement.handleOnDestroy();
    }
    System.out.println(new JSONArray().put(trace.value));
  }
  private static void run(String[] args) throws Exception {
    String scenario = args[0];
    SignInTestPorts.install(scenario);
    if (scenario.equals("cold-burn-failure")) {
      coldReturnRefused();
      return;
    }
    if (scenario.equals("burn-failure")) {
      burnFailure();
      return;
    }
    if (scenario.equals("cancel-burn-failure")) {
      cancellationFailure();
      return;
    }
    if (scenario.equals("cancel-replacement")) {
      cancellationReplacement();
      return;
    }
    if (scenario.equals("unowned-cancel-replacement")) {
      unownedCancellationReplacement();
      return;
    }
    if (scenario.equals("cancel-during-callback-read")) {
      cancellationDuringCallbackRead();
      return;
    }
    if (scenario.equals("stale-read-replacement")) {
      staleReadThenReplacement();
      return;
    }
    if (scenario.equals("cancel-then-email") || scenario.equals("cancel-then-phone")) {
      cancelThenCodeAttempt(scenario.equals("cancel-then-phone"));
      return;
    }
    if (scenario.equals("callback-cas-lost")) {
      lostCallbackCas();
      return;
    }
    if (scenario.equals("activation-overlap-pending") || scenario.equals("activation-overlap-receipt")) {
      activationOverlap(scenario.endsWith("receipt"));
      return;
    }
    if (scenario.equals("receipt-failure")) {
      receiptFailure();
      return;
    }
    Trace trace = new Trace("actual-native-sign-in-" + scenario, observed(1));
    AlphaCloudSignInPlugin first = start(trace, 1);
    finishSuccessful(first, trace, 1, false);
    AlphaCloudSignInPlugin second = null;
    try {
      second = start(trace, 2);
      if (scenario.equals("retry") || scenario.equals("postcommit-cancel"))
        finishSuccessful(second, trace, 2, scenario.equals("postcommit-cancel"));
      else if (scenario.equals("precommit-cancel")) {
        SignInTestPorts.Event receipt = SignInTestPorts.next("write:" + SignInTestPorts.ACK);
        trace.macro("receipt commit retains previous key", observed(2), Trace.action("exchanged"),
            Trace.action("writeReceipt"));
        second.cancel(new PluginCall(new JSObject()));
        trace.step("cancel", observed(2));
        release(receipt);
        SignInTestPorts.Event logout = SignInTestPorts.next("http:/steward/auth/logout");
        release(logout);
        drain(second);
        trace.step("releaseSteward", observed(2));
        if (SignInTestPorts.owner() != 1 || SignInTestPorts.revocations != 0)
          throw new AssertionError("Precommit cancellation retired old credential");
      } else if (scenario.equals("ack-restart")) {
        SignInTestPorts.Event receipt = SignInTestPorts.next("write:" + SignInTestPorts.ACK);
        trace.macro("receipt commit", observed(2), Trace.action("exchanged"), Trace.action("writeReceipt"));
        release(receipt);
        SignInTestPorts.Event key = SignInTestPorts.next("write:" + SignInTestPorts.CREDENTIAL);
        trace.step("writeKey", observed(2));
        release(key);
        for (int round = 0; round < 3; round++) {
          SignInTestPorts.Event ack = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
          release(ack);
          if (round < 2) {
            SignInTestPorts.Event next = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
            trace.step("ack", observed(2).put("s.ackTries", round + 1), false);
            SignInTestPorts.events.add(next);
          }
        }
        SignInTestPorts.Event logout = SignInTestPorts.next("http:/steward/auth/logout");
        trace.step("ack", observed(2).put("s.ackTries", 3), false);
        release(logout);
        drain(second);
        trace.step("releaseSteward", observed(2));
        second.handleOnDestroy();
        second = plugin();
        second.load();
        SignInTestPorts.Event resumed = SignInTestPorts.next("http:/api/v1/app-auth/mobile/ack");
        trace.step("restart", observed(2));
        release(resumed);
        SignInTestPorts.Event removed = SignInTestPorts.next("remove:" + SignInTestPorts.ACK);
        trace.step("ack",
            observed(2)
                .put("s.phase",
                    SignInTestPorts.targetStored(2)
                            && !SignInTestPorts.values.containsKey(SignInTestPorts.ACK)
                        ? "authenticated"
                        : "activation-pending")
                .put("s.revoked", SignInTestPorts.revocations > 0),
            true);
        release(removed);
        drain(second);
      } else
        throw new AssertionError("Unknown scenario");
    } finally {
      if (second != null) {
        for (SignInTestPorts.Event event : SignInTestPorts.events) release(event);
        second.handleOnDestroy();
      }
    }
    System.out.println(new JSONArray().put(trace.value));
  }
}
