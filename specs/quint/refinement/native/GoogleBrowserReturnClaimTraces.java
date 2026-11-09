package ai.eliza.auth.cloud;

import ai.elizaresearch.alphaphone.Trace;
import java.util.IdentityHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Reads the chain fixture's actual attempt and port state, with exact patched Java methods. */
public final class GoogleBrowserReturnClaimTraces extends CloudSignInChainTest {
 private final Map<Runnable, JSONObject> workLabels = new IdentityHashMap<>();
 private final Map<Runnable, String> graceLabels = new IdentityHashMap<>();
 private final CloudSignInFlow.Pending original;
 private final CloudSignInFlow.Pending replacement;
 private final Attempt owner;
 private final PluginCall waiter;
 private final long capturedIntent;
 private boolean exchanged;
 private String lastCapture = "none";

 GoogleBrowserReturnClaimTraces(boolean live, boolean expired) {
  slots.clear(); events.clear(); notifications.clear(); revoked.clear();
  defer = true;
  original = CloudSignInFlow.Pending.create(TestRegistration.PRODUCTION,
    System.currentTimeMillis() - (expired ? 86400000 : 0));
  replacement = CloudSignInFlow.Pending.create(TestRegistration.PRODUCTION, System.currentTimeMillis());
  slots.put(config().pendingSlot, original.serialize());
  owner = live ? new Attempt(REQUEST) : null;
  waiter = live ? new PluginCall() : null;
  if (live) {
   owner.google = owner.browserLaunched = true;
   owner.browserState = original.state;
   owner.pendingRecord = original.serialize();
   owner.credentialGuard = reserveCredentialCommit();
   owner.waiting = waiter;
   attempt = owner;
  }
  capturedIntent = intent;
 }

 private void labelWork(String kind, boolean claim, Runnable task) {
  workLabels.put(task, new JSONObject().put("kind", kind).put("claim", claim));
 }

 @Override void observeCallbackWork(CloudSignInFlow.Callback received, Attempt claimed, Runnable task) {
  String kind = switch (received.kind) {
   case RETURN -> "hint";
   case SUCCESS -> original.state.equals(received.state) ? "success" : "foreign";
   case ERROR -> switch (received.error) {
    case "app_link_unverified" -> "link-error";
    case "mfa_required" -> "mfa-error";
    default -> "error";
   };
  };
  labelWork(kind, claimed != null, task);
  super.observeCallbackWork(received, claimed, task);
 }
 @Override void observeBurnWork(Runnable task) {
  labelWork("burn", false, task);
  super.observeBurnWork(task);
 }
 @Override void observeCancelWork(Runnable task) {
  labelWork("cancel", false, task);
  super.observeCancelWork(task);
 }
 @Override void observeGrace(String kind, Runnable task, long delay) {
  check(delay == 1500, "actual browser grace interval");
  graceLabels.put(task, kind);
  super.observeGrace(kind, task, delay);
 }
 @Override Response post(Attempt current, String path, JSONObject body, String bearer) throws Exception {
  if ("/steward/auth/oauth/exchange".equals(path)) {
   check(!exchanged, "browser result exchanges at most once");
   exchanged = true;
  }
  return super.post(current, path, body, bearer);
 }

 private JSONObject observe() {
  String raw = slots.get(config().pendingSlot);
  CloudSignInFlow.Pending pending = CloudSignInFlow.Pending.parse(raw, config());
  String pendingClass = raw == null ? "missing" : pending == null ? "unreadable"
   : !original.serialize().equals(raw) ? "replacement"
   : pending.expired(System.currentTimeMillis()) ? "expired" : "matching";
  String outcome = waiter == null ? "none" : waiter.error != null ? waiter.error
   : waiter.result == null ? "waiting" : waiter.result.optString("status");
  JSONArray work = new JSONArray(), grace = new JSONArray();
  for (Runnable task : queued) {
   JSONObject label = workLabels.get(task);
   check(label != null, "every actual worker is labeled");
   work.put(label);
  }
  for (Runnable task : main.queue) {
   String label = graceLabels.get(task);
   check(label != null, "every actual grace timer is labeled");
   grace.put(label);
  }
  return Trace.fields("live", owner != null && attempt == owner, "paused", owner != null && owner.browserPaused,
   "hint", owner != null && owner.returnHint, "hintElapsed", owner != null && owner.returnHintElapsed,
   "claimed", owner != null && owner.returnClaimed, "received", owner != null && owner.callbackReceived,
   "cancelled", owner != null && owner.cancelled, "pending", pendingClass,
   "credentialCurrent", capturedIntent == intent, "retirementFence", pendingRetirementUnconfirmed,
   "outcome", outcome, "exchanged", exchanged, "retainedNotice",
   events.contains("signInIncomplete"), "lastCapture", lastCapture, "work", work, "grace", grace);
 }

 private void capture(String kind) {
  String suffix = switch (kind) {
   case "hint" -> "";
   case "success" -> "#code=fixture-code&state=" + original.state;
   case "foreign" -> "#code=fixture-code&state=" + replacement.state;
   case "error" -> "?error=oauth_provider_unavailable&state=" + original.state;
   case "mfa-error" -> "?error=mfa_required&state=" + original.state;
   case "link-error" -> "?error=app_link_unverified&state=" + original.state;
   case "query-code" -> "?code=forbidden-query-code&state=" + original.state;
   case "invalid" -> "#code=fixture-code&state=" + original.state;
   default -> throw new AssertionError(kind);
  };
  String callback = kind.equals("invalid") ? "https://example.invalid/"
   : TestRegistration.PRODUCTION.callback();
  Intent delivery = new Intent(callback + suffix);
  boolean accepted = captureCallback(delivery);
  check(accepted == (delivery.getData() == null), "consumption scrubs the exact Android intent");
  lastCapture = accepted ? "accepted" : "rejected";
 }

 private Trace schedule(String name, boolean live, boolean expired, String... steps) {
  Trace trace = new Trace(name, observe());
  trace.value.put("init", Trace.action("initWith", live, expired));
  for (String step : steps) {
   String[] words = step.split(" ", 2);
   String action = words[0], arg = words.length > 1 ? words[1] : null;
   Object[] modelArgs = arg == null ? new Object[0] : new Object[]{arg};
   switch (action) {
    case "pause" -> handleOnPause();
    case "resume" -> handleOnResume();
    case "runWorker" -> queued.remove().run();
    case "runGrace" -> main.queue.remove().run();
    case "receive" -> capture(arg);
    case "cancelScope" -> {
     boolean matching = Boolean.parseBoolean(arg);
     PluginCall cancel = new PluginCall();
     cancel.input.put("requestId", matching ? REQUEST : ID);
     cancel(cancel);
     modelArgs = new Object[]{matching};
    }
    case "supersedeCredential" -> intent++;
    case "changePending" -> {
     switch (arg) {
      case "missing" -> slots.remove(config().pendingSlot);
      case "unreadable" -> slots.put(config().pendingSlot, "not-a-pending-record");
      case "replacement" -> slots.put(config().pendingSlot, replacement.serialize());
      default -> throw new AssertionError(arg);
     }
    }
    default -> throw new AssertionError(action);
   }
   trace.step(action, observe(), modelArgs);
  }
  return trace;
 }

 private static void add(JSONArray out, String name, boolean live, boolean expired, String... steps) {
  out.put(new GoogleBrowserReturnClaimTraces(live, expired).schedule(name, live, expired, steps).value);
 }

 public static void main(String[] args) {
  JSONArray out = new JSONArray();
  add(out, "own-result-before-resume-grace", true, false, "pause", "resume", "receive success", "runWorker", "runGrace");
  add(out, "own-result-queued-across-resume-grace", true, false, "pause", "resume", "receive success", "runGrace", "runWorker");
  add(out, "foreign-state-cannot-claim", true, false, "pause", "resume", "receive foreign", "runGrace", "runWorker", "runWorker");
  add(out, "invalid-callback-does-not-consume", true, false, "pause", "resume", "receive invalid", "runGrace", "runWorker");
  add(out, "resume-grace-without-callback", true, false, "pause", "resume", "runGrace", "runWorker");
  add(out, "claim-releases-unreadable-resume", true, false, "pause", "resume", "receive success", "changePending unreadable", "runGrace", "runWorker", "runWorker");
  add(out, "claim-cannot-burn-replacement-record", true, false, "pause", "resume", "receive success", "changePending replacement", "runGrace", "runWorker", "runWorker");
  add(out, "hint-only-does-not-consume", true, false, "receive hint", "runWorker", "runGrace");
  add(out, "query-code-is-only-a-return-hint", true, false, "receive query-code", "runWorker", "runGrace");
  add(out, "matching-result-survives-both-graces", true, false, "pause", "resume", "receive hint", "runWorker", "receive success", "runGrace", "runGrace", "runWorker");
  add(out, "unreadable-result-releases-elapsed-hint", true, false, "receive hint", "runWorker", "receive success", "changePending unreadable", "runGrace", "runWorker");
  add(out, "unreadable-result-before-hint-deadline", true, false, "receive hint", "runWorker", "receive success", "changePending missing", "runWorker", "runGrace");
  add(out, "duplicate-result-queues-without-second-claim", true, false, "receive success", "receive success", "runWorker", "runWorker");
  add(out, "owner-cancel-fences-a-queued-claim", true, false, "pause", "resume", "receive success", "cancelScope true", "runGrace", "runWorker", "runWorker");
  add(out, "foreign-cancel-keeps-the-live-claim", true, false, "receive success", "cancelScope false", "runWorker");
  add(out, "cold-result-notifies-without-credential-intent", false, false, "receive success", "runWorker");
  add(out, "cold-hint-notifies-without-burning", false, false, "receive hint", "runWorker");
  add(out, "expired-result-burns-without-exchange", true, true, "receive success", "runWorker");
  add(out, "expired-hint-does-not-schedule", true, true, "receive hint", "runWorker");
  add(out, "retired-credential-intent-cannot-consume", true, false, "receive success", "supersedeCredential", "runWorker", "receive success", "runWorker");
  for (String error : new String[]{"error", "mfa-error", "link-error"})
   add(out, "classified-provider-result-" + error, true, false, "receive " + error, "runWorker");
  System.out.println(out);
 }
}
