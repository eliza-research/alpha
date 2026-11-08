package ai.elizaresearch.alphaphone;
import ai.eliza.voice.LiveVadGate;

import org.json.JSONArray;
import org.json.JSONObject;

/** Reachable-state prefixes execute the original classes, including boundary inputs. */
public final class FinitePolicyTraces {
 static JSONObject vad(LiveVadGate gate) throws Exception {
  return Trace.fields("speaking", gate.speaking(), "above", Trace.read(gate, "above"), "below", Trace.read(gate, "below"));
 }
 static void window(Trace trace, LiveVadGate gate, int code) throws Exception {
  float input = code == -1001 ? Float.NaN : code == -1000 ? Float.POSITIVE_INFINITY
    : code == -999 ? Float.NEGATIVE_INFINITY : code / 1000f;
  LiveVadGate.Edge edge = gate.accept(input);
  trace.step("accept", vad(gate).put("s.edge", edge.name()), code);
 }
 static JSONArray vadTraces() throws Exception {
  JSONArray result = new JSONArray();
  int[] inputs = {-1001, -1000, -999, -1, 0, 349, 350, 499, 500, 1000, 1001};
  // Every reachable counter state: closed above=0/1, open below=0..15.
  for (int state = 0; state < 18; state++) for (int choice = 0; choice <= inputs.length; choice++) {
   LiveVadGate gate = new LiveVadGate();
   Trace trace = new Trace("vad-state-" + state + "-input-" + choice, vad(gate));
   if (state == 1) window(trace, gate, 500);
   if (state >= 2) {
    window(trace, gate, 500); window(trace, gate, 500);
    for (int i = 0; i < state - 2; i++) window(trace, gate, 349);
   }
   if (choice == inputs.length) {
    boolean wasSpeaking = gate.close();
    trace.step("close", vad(gate).put("s.closeReturned", wasSpeaking));
   } else window(trace, gate, inputs[choice]);
   result.put(trace.value);
  }
  return result;
 }
 static JSONObject budget(RendererRecoveryBudget budget) throws Exception {
  return Trace.fields("started", Trace.read(budget, "started"), "windowStart", Trace.read(budget, "windowStart"),
    "losses", Math.min(4, (Integer) Trace.read(budget, "lossesInWindow")));
 }
 static void loss(Trace trace, RendererRecoveryBudget budget, int now, boolean home) throws Exception {
  RendererRecoveryBudget.Action outcome = budget.onLoss(now, home);
  trace.step("rendererGone", budget(budget).put("s.decision", outcome.name()).put("s.delay", RendererRecoveryBudget.delay(outcome)), now, true);
 }
 static JSONArray rendererTraces() throws Exception {
  JSONArray result = new JSONArray();
  for (int start : new int[]{0, 1, 60000}) for (int count = 0; count <= 5; count++)
   for (boolean home : new boolean[]{false, true}) for (int next : new int[]{0, start, start + 59999, start + 60000, start + 60001, 120002}) {
    RendererRecoveryBudget budget = new RendererRecoveryBudget();
    Trace trace = new Trace("budget-" + start + "-" + count + "-" + home + "-" + next, budget(budget));
    trace.step("setHome", budget(budget), home);
    int activity = 0;
    for (int n = 0; n < count; n++) {
     loss(trace, budget, start, home);
     // The projection covers the policy helper. Activity recreation is an environment step.
     if (n >= 3 && home) trace.step("reload", budget(budget));
     else {
      if (n >= 3) trace.step("delayElapsed", budget(budget));
      trace.step("recreateCallback", budget(budget), activity);
     }
     activity++;
    }
    loss(trace, budget, next, home);
    result.put(trace.value);
   }
  // Reachable saturation and defensive overflow regression execute the actual source.
  RendererRecoveryBudget budget = new RendererRecoveryBudget();
  for (int i = 0; i < 10000; i++) budget.onLoss(0, false);
  if (!Trace.read(budget, "lossesInWindow").equals(4)) throw new AssertionError("budget did not saturate");
  java.lang.reflect.Field counter = RendererRecoveryBudget.class.getDeclaredField("lossesInWindow");
  counter.setAccessible(true); counter.setInt(budget, Integer.MAX_VALUE);
  if (budget.onLoss(0, false) != RendererRecoveryBudget.Action.RECREATE_AFTER_BACKOFF)
   throw new AssertionError("overflow revived immediate recreation");
  return result;
 }
 static JSONArray schedulingTraces() {
  JSONArray result = new JSONArray();
  String[] events = {"boot", "update", "time", "zone", "other"};
  String[] nativeEvents = {ResidentScheduleRearm.BOOT_COMPLETED, ResidentScheduleRearm.PACKAGE_REPLACED,
    ResidentScheduleRearm.TIME_SET, ResidentScheduleRearm.TIMEZONE_CHANGED, "unknown"};
  for (boolean unlocked : new boolean[]{false, true}) for (boolean packaged : new boolean[]{false, true})
   for (boolean enabled : new boolean[]{false, true}) for (String lifecycle : new String[]{"idle", "stopping", "provider-change"})
    for (int e = 0; e < events.length; e++) {
     Trace trace = new Trace("schedule-" + unlocked + packaged + enabled + lifecycle + events[e], Trace.fields("lastDecision", "IGNORE"));
     if (!unlocked) trace.step("boot", Trace.fields("unlocked", false));
     trace.step("packagePresent", Trace.fields("packaged", packaged), packaged);
     trace.step("ownerEnabled", Trace.fields("enabled", enabled), enabled);
     if (!lifecycle.equals("idle")) trace.step("beginLifecycle", Trace.fields("lifecycle", lifecycle), lifecycle);
     Object lock = new Object(); int[] starts = {0};
     ResidentScheduleRearm.Decision decision = ResidentScheduleRearm.admitAndStart(lock, nativeEvents[e], unlocked, packaged, enabled,
       () -> { if (!Thread.holdsLock(lock)) throw new AssertionError("admission lock"); return lifecycle.equals("idle"); },
       () -> { if (!Thread.holdsLock(lock)) throw new AssertionError("start lock"); starts[0]++; });
     if (decision != ResidentScheduleRearm.decide(nativeEvents[e], unlocked, packaged, enabled, lifecycle.equals("idle")))
      throw new AssertionError("admit/decide disagreement");
     trace.step("broadcast", Trace.fields("lastDecision", decision.name(), "starts", starts[0], "running", starts[0] == 1), events[e]);
     result.put(trace.value);
    }
  return result;
 }
 public static void main(String[] args) throws Exception {
  JSONObject result = new JSONObject().put("VadSegmentation", vadTraces()).put("RendererRecovery", rendererTraces()).put("ResidentScheduling", schedulingTraces());
  System.out.println(result);
 }
}
