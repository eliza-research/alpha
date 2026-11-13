package ai.alphacompute.alphaphone;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exact ledger operations over controlled storage and notification ports. */
public final class HostedResultNoticeTraces {
 private static final String SECRET = "synthetic retained result contents";
 private static final Set<String> ROUTE_FIELDS = Set.of(
  "origin", "ownerId", "agentId", "scope", "runId", "workflowId", "workflowVersionId");
 private static final Set<String> DURABLE_FIELDS = union(ROUTE_FIELDS, "key", "digest", "dispatchId", "createdAt", "phase");
 private static final Set<String> READ_FIELDS = union(ROUTE_FIELDS, "key", "token", "retained", "question");

 private static Set<String> union(Set<String> fields, String... other) {
  Set<String> result = new LinkedHashSet<>(fields);
  result.addAll(List.of(other));
  return result;
 }

 private static void check(boolean condition, String message) {
  if (!condition) throw new AssertionError(message);
 }

 private static JSONObject owner(int number) {
  if (number == 0) return null;
  return new JSONObject().put("origin", number == 3 ? "https://other.invalid" : "https://agent.invalid")
   .put("ownerId", number == 2 ? "other-owner" : "reviewed-owner")
   .put("agentId", number == 4 ? "other-agent" : "reviewed-agent");
 }

 private static JSONObject route(int key, int identity, String workflow) throws Exception {
  JSONObject tuple = owner(identity);
  String scope = HostedResultNotices.hash(new JSONArray().put(tuple.getString("origin"))
   .put(tuple.getString("ownerId")).put(tuple.getString("agentId")).toString());
  return tuple.put("scope", scope).put("runId", "run-" + key).put("workflowId", workflow)
   .put("workflowVersionId", "reviewed-version");
 }

 private static JSONObject result(JSONObject route, int revision) {
  return new JSONObject().put("runId", route.getString("runId")).put("workflowId", route.getString("workflowId"))
   .put("workflowVersionId", revision == 3 ? "foreign-version" : route.getString("workflowVersionId"))
   .put("output", SECRET).put("revision", revision);
 }

 private static String key(JSONObject route) throws Exception {
  return HostedResultNotices.hash(route.getString("scope") + ":" + route.getString("runId"));
 }

 private static final class Fault extends RuntimeException {}

 private static final class Fixture implements HostedResultNotices.Storage, HostedResultNotices.Poster {
  final Map<String, String> slots = new HashMap<>();
  final Map<String, Integer> tokens = new LinkedHashMap<>();
  final Map<String, Integer> postCount = new HashMap<>();
  final Map<String,String> active = new LinkedHashMap<>();
  final List<String> cancels = new ArrayList<>();
  final Map<Integer, JSONObject> routes = new LinkedHashMap<>();
  final Trace trace;
  HostedResultNotices ledger;
  boolean allowed = true, denyPost, refuseCancel, stopBeforePost;
  String refuseSlot, outcome = "none";
  int untilRefused;
  JSONObject observedRead;

  Fixture(String name) throws Exception {
   for (int i = 1; i <= 4; i++) routes.put(i, route(i, i == 4 ? 2 : 1, i == 3 ? "other-loop" : "daily-loop"));
   recreate();
   trace = new Trace(name, observe());
  }

  void recreate() {
   ledger = new HostedResultNotices(this, this);
  }

  @Override public String read(String slot) { return slots.get(slot); }

  @Override public void write(String slot, String value) throws Exception {
   if (slot.equals(refuseSlot) && --untilRefused == 0) {
    throw new IOException("Synthetic storage refusal");
   }
   slots.put(slot, value);
  }

  void refuse(String slot, int count) {
   refuseSlot = slot;
   untilRefused = count;
  }

  JSONObject readObject(String slot) {
   String value = slots.get(slot);
   return value == null ? new JSONObject() : new JSONObject(value);
  }

  @Override public boolean allowed() { return allowed; }
  @Override public boolean active(String tag,String dispatchId) { return dispatchId.equals(active.get(tag)); }

  @Override public void post(String tag,String dispatchId,String title,boolean silent) {
   JSONObject durable = readObject(HostedResultNotices.LEDGER).getJSONObject(tag);
   check(durable.keySet().equals(DURABLE_FIELDS), "Only redacted route metadata reaches durable dispatch");
   check(tag.equals(durable.getString("key")) && tag.matches("[a-f0-9]{64}"), "Opaque exact notification tag");
   check(durable.getString("phase").equals("dispatching"), "Durable dispatch marker precedes OS effect");
   check(dispatchId.equals(durable.getString("dispatchId")) && !dispatchId.equals(durable.getString("digest")),
    "OS readback binds an opaque marker rather than retained contents");
   if (stopBeforePost) throw new Fault();
   if (denyPost) throw new SecurityException("Synthetic Android denial");
   postCount.merge(tag, 1, Integer::sum);
   active.put(tag,dispatchId);
  }

  @Override public void cancel(String tag) {
   if (refuseCancel) throw new Fault();
   cancels.add(tag);
   active.remove(tag);
  }

  void retainRow(JSONObject row, int revision) {
   String slot = "hosted-digests:v1:" + row.getString("scope"), run = row.getString("runId");
   JSONArray index = readObject(slot).optJSONArray("ids"), entries = new JSONArray();
   if (index != null) for (int i = 0; i < index.length(); i++)
    if (!run.equals(index.getString(i))) entries.put(index.getString(i));
   if (revision == 0) slots.remove(slot + ":" + run);
   else {
    entries.put(run);
    slots.put(slot + ":" + run, result(row, revision).toString());
   }
   slots.put(slot, new JSONObject().put("ids", entries).toString());
  }

  void retain(int id, int revision) throws Exception {
   retainRow(routes.get(id), revision);
   point("retain", id, revision);
  }

  void publish(int id, String mode) throws Exception {
   if (mode.equals("before-write") || mode.equals("repair-write")) refuse(HostedResultNotices.LEDGER, 1);
   if (mode.equals("after-post")) refuse(HostedResultNotices.LEDGER, 2);
   allowed = !mode.equals("permission");
   denyPost = mode.equals("security");
   stopBeforePost = mode.equals("before-post");
   try { outcome = ledger.publish(routes.get(id)); }
   catch (IOException | Fault | IllegalArgumentException | IllegalStateException rejected) { outcome = "rejected"; }
   finally { refuseSlot = null; allowed = true; denyPost = false; stopBeforePost = false; }
   point("publish", id, mode);
  }

  void withdraw(int id, String mode) throws Exception {
   if (mode.equals("owner")) refuse(HostedResultNotices.OWNER, 1);
   if (mode.equals("ledger")) refuse(HostedResultNotices.LEDGER, 1);
   if (mode.equals("pending")) refuse(HostedResultNotices.PENDING, 1);
   refuseCancel = mode.equals("cancel");
   try { ledger.withdrawOtherOwners(owner(id)); outcome = "withdrawn"; }
   catch (IOException | Fault rejected) { outcome = "rejected"; }
   finally { refuseSlot = null; refuseCancel = false; }
   point("withdraw", id, mode);
  }

  void capture(int id, boolean question, boolean written) throws Exception {
   if (!written) refuse(HostedResultNotices.PENDING, 1);
   try { ledger.capture(id == 0 ? "malformed-tag" : key(routes.get(id)), question); outcome = "captured"; }
   catch (IOException rejected) { outcome = "rejected"; }
   finally { refuseSlot = null; }
   point("capture", id, question, written);
  }

  void consume(int token, String mode) throws Exception {
   if (mode.equals("ledger")) refuse(HostedResultNotices.LEDGER, 1);
   if (mode.equals("pending")) refuse(HostedResultNotices.PENDING, 1);
   refuseCancel = mode.equals("cancel");
   try { ledger.consume(token(token)); outcome = "consumed"; }
   catch (IOException | Fault | IllegalStateException rejected) { outcome = "rejected"; }
   finally { refuseSlot = null; refuseCancel = false; }
   point("consume", token, mode);
  }

  void release(int token, boolean written) throws Exception {
   if (!written) refuse(HostedResultNotices.PENDING, 1);
   try { ledger.releaseQuestion(token(token)); outcome = "released"; }
   catch (IOException | IllegalStateException rejected) { outcome = "rejected"; }
   finally { refuseSlot = null; }
   point("release", token, written);
  }

  void expire(int id) throws Exception {
   active.remove(key(routes.get(id)));
   point("expire", id);
  }

  String token(int index) {
   return tokens.entrySet().stream().filter(entry -> entry.getValue() == index)
    .map(Map.Entry::getKey).findFirst().orElse("synthetic-foreign-token");
  }

  int tokenClass(JSONObject value) {
   if (!value.has("token")) return 0;
   String raw = value.getString("token");
   check(java.util.UUID.fromString(raw).toString().equals(raw), "Opaque UUID tap token");
   return tokens.computeIfAbsent(raw, ignored -> tokens.size() + 1);
  }

  int routeClass(JSONObject value) throws Exception {
   if (!value.has("key")) return 0;
   for (var entry : routes.entrySet()) if (key(entry.getValue()).equals(value.getString("key"))) return entry.getKey();
   throw new AssertionError("Unexpected route tag");
  }

  int ownerClass() throws Exception {
   if (!slots.containsKey(HostedResultNotices.OWNER)) return -1;
   JSONObject durable = readObject(HostedResultNotices.OWNER);
   if (durable.isNull("owner")) return 0;
   for (int id = 1; id <= 4; id++) if (durable.getJSONObject("owner").similar(owner(id))) return id;
   throw new AssertionError("Unexpected owner tuple");
  }

  JSONObject observe() throws Exception {
   JSONObject entries = readObject(HostedResultNotices.LEDGER);
   JSONObject pending = readObject(HostedResultNotices.PENDING);
   check(pending.isEmpty() || pending.keySet().equals(Set.of("key", "question", "token")), "No result content in pending slot");
   int pendingToken = tokenClass(pending);
   JSONArray retained = new JSONArray(), phases = new JSONArray(), digests = new JSONArray(), posted = new JSONArray(), counts = new JSONArray();
   for (var entry : routes.entrySet()) {
    int id = entry.getKey();
    JSONObject route = entry.getValue();
    String key = key(route), stored = read("hosted-digests:v1:" + route.getString("scope") + ":" + route.getString("runId"));
    retained.put(new JSONArray().put(id).put(stored == null ? 0 : new JSONObject(stored).getInt("revision")));
    counts.put(new JSONArray().put(id).put(postCount.getOrDefault(key, 0)));
    if (active.containsKey(key)) posted.put(id);
    JSONObject row = entries.optJSONObject(key);
    phases.put(new JSONArray().put(id).put(row == null ? "none" : row.getString("phase")));
    int digest = 0;
    if (row != null) {
     check(row.keySet().equals(DURABLE_FIELDS), "Ledger contains route metadata only");
     for (String field : ROUTE_FIELDS) check(route.getString(field).equals(row.getString(field)), "Exact route field " + field);
     for (int revision = 1; revision <= 2; revision++)
      if (HostedResultNotices.hash(result(route, revision).toString()).equals(row.getString("digest"))) digest = revision;
     check(digest != 0, "Digest is the exact retained payload admitted for publication");
    }
    digests.put(new JSONArray().put(id).put(digest));
   }
   observedRead = ledger.peek();
   int read = routeClass(observedRead), readToken = tokenClass(observedRead);
   if (read != 0) {
    check(observedRead.keySet().equals(READ_FIELDS), "Readback is redacted");
    for (String field : ROUTE_FIELDS)
     check(routes.get(read).getString(field).equals(observedRead.getString(field)), "Readback retains exact route field " + field);
   } else check(observedRead.isEmpty(), "Hidden readback has no metadata");
   return Trace.fields("owner", ownerClass(), "retained", retained, "phases", phases, "digests", digests,
    "posted", posted, "postCount", counts, "pending", routeClass(pending), "question", pending.optBoolean("question"),
    "token", pendingToken, "issued", tokens.size(), "outcome", outcome)
    .put("readKey", read).put("readToken", readToken)
    .put("readQuestion", observedRead.optBoolean("question")).put("readRetained", observedRead.optBoolean("retained"));
  }

  void point(String action, Object... args) throws Exception { trace.step(action, observe(), args); }
  void stutter(String message) throws Exception { trace.stutter(message, observe()); }

  void postFirst() throws Exception { withdraw(1, "complete"); retain(1, 1); publish(1, "complete"); }
 }

 private static PluginCall bridgeCall(AlphaHostedResultsPlugin bridge, JSONObject input,
    java.util.function.Consumer<PluginCall> call) throws Exception {
  PluginCall reply = new PluginCall(input);
  call.accept(reply);
  drain(bridge);
  check(reply.answered, "Bridge returned exactly one answer");
  return reply;
 }

 private static void drain(AlphaHostedResultsPlugin bridge) throws Exception {
  var worker = (java.util.concurrent.ExecutorService) Trace.read(bridge, "io");
  if (worker.isShutdown()) check(worker.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS), "Retired worker ended");
  else worker.submit(() -> {}).get(5, java.util.concurrent.TimeUnit.SECONDS);
 }

 private static void routeThroughBridge(Fixture f, AlphaHostedResultsPlugin bridge, boolean question) throws Exception {
  String action = question ? AlphaHostedResultsPlugin.ASK_ACTION : AlphaHostedResultsPlugin.ACTION;
  String data = AlphaHostedResultsPlugin.PREFIX + key(f.routes.get(1));
  for (Intent invalid : List.of(new Intent("foreign-action", data), new Intent(action, "bad-prefix:" + data))) {
   int before = bridge.wakeups;
   bridge.handleOnNewIntent(invalid);
   drain(bridge);
   check(invalid.getData() != null && bridge.wakeups == before, "Unrecognized intent is not handled");
   f.stutter("foreign Intent action or scheme leaves durable custody unchanged");
  }
  Intent tap = new Intent(action, data);
  f.refuse(HostedResultNotices.PENDING, 1);
  int before = bridge.wakeups;
  bridge.handleOnNewIntent(tap);
  drain(bridge);
  f.refuseSlot = null;
  check(tap.getData().equals(data) && bridge.wakeups == before, "Failed pending write retains Intent for later retry");
  f.outcome = "rejected";
  f.point("capture", 1, question, false);
  bridge.handleOnNewIntent(tap);
  drain(bridge);
  check(tap.getData() == null && bridge.wakeups == before + 1, "Successful capture clears Intent and wakes renderer");
  f.outcome = "captured";
  f.point("capture", 1, question, true);
 }

 private static Fixture priorTokenThroughBridge(boolean question, int nextOwner) throws Exception {
  String settlement = question ? "question-release" : "tap-consume";
  Fixture f = new Fixture("bridge-prior-" + settlement + (nextOwner == 0 ? "-after-signout" : "-after-rebind"));
  f.postFirst();
  HostedDelivery.INSTANCE.notices = f.ledger;
  AlphaHostedResultsPlugin bridge = new AlphaHostedResultsPlugin();
  try {
   routeThroughBridge(f, bridge, question);
   PluginCall initial = bridgeCall(bridge, new JSONObject(), bridge::pendingResult);
   check(initial.result.similar(f.observedRead), "Unlocked bridge returns exact redacted readback");
   String token = initial.result.getString("token");
   JSONObject tokenInput = new JSONObject().put("token", token);
   bridge.keyguard.locked = true;
   check(bridgeCall(bridge, new JSONObject(), bridge::pendingResult).rejected, "Locked readback rejected");
   check(bridgeCall(bridge, tokenInput, question ? bridge::releaseResultQuestion : bridge::consumeResult).rejected,
    "Locked settlement rejected");
   f.stutter("locked bridge rejects reads and exact-token mutations without touching the slot");
   bridge.keyguard.locked = false;

   f.refuseCancel = true;
   Object requestedOwner = nextOwner == 0 ? JSONObject.NULL : owner(nextOwner);
   PluginCall switchOwner = bridgeCall(bridge, new JSONObject().put("owner", requestedOwner), bridge::withdrawOtherOwnerApprovalNotices);
   f.refuseCancel = false;
   check(switchOwner.rejected, "Cancellation refusal surfaced after durable owner and ledger writes");
   f.outcome = "rejected";
   f.point("withdraw", nextOwner, "cancel");
   PluginCall hidden = bridgeCall(bridge, new JSONObject(), bridge::pendingResult);
   check(hidden.result.isEmpty(), "Prior owner's route hidden through product bridge");
   check(f.active.containsKey(key(f.routes.get(1))), "Synthetic prior notification still visible after refused cancel");
   check(f.readObject(HostedResultNotices.PENDING).getString("token").equals(token), "Old pending token durable");
   f.stutter("unlocked bridge readback is empty even while old token and notification survive");

   JSONObject beforeLedger = f.readObject(HostedResultNotices.LEDGER);
   JSONObject beforePending = f.readObject(HostedResultNotices.PENDING);
   List<String> beforeCancels = List.copyOf(f.cancels);
   PluginCall settle = bridgeCall(bridge, tokenInput, question ? bridge::releaseResultQuestion : bridge::consumeResult);
   check(settle.rejected, "A foreign exact token cannot settle through an unlocked current bridge");
   check(beforeLedger.similar(f.readObject(HostedResultNotices.LEDGER)) &&
    beforePending.similar(f.readObject(HostedResultNotices.PENDING)) && beforeCancels.equals(f.cancels) &&
    f.active.containsKey(key(f.routes.get(1))), "Foreign settlement changes neither durable state nor visible notice");
   f.outcome = "rejected";
   if (question) f.point("release", 1, true);
   else f.point("consume", 1, "complete");

   PluginCall retry = bridgeCall(bridge, new JSONObject().put("owner", requestedOwner), bridge::withdrawOtherOwnerApprovalNotices);
   check(!retry.rejected && f.readObject(HostedResultNotices.PENDING).isEmpty() && !f.active.containsKey(key(f.routes.get(1))),
    "The existing withdrawal retry owns cleanup");
   f.outcome = "withdrawn";
   f.point("withdraw", nextOwner, "complete");
   bridge.handleOnDestroy();
   check(bridgeCall(bridge, tokenInput, question ? bridge::releaseResultQuestion : bridge::consumeResult).rejected,
    "Closed worker rejects queued bridge entry");
   f.stutter("retired bridge cannot admit another settlement");
   return f;
  } finally {
   bridge.handleOnDestroy();
   drain(bridge);
  }
 }

 private static JSONObject capacity() throws Exception {
  Fixture f = new Fixture("source-capacity");
  // Seed durable historical rows at strictly different times; Android clock ties
  // are unrelated to which record the fixture expects the source to evict.
  JSONObject rows = new JSONObject();
  String first = "", second = "";
  for (int i = 1; i <= 200; i++) {
   JSONObject route = route(i, 1, "historical-loop-" + i);
   String tag = key(route);
   JSONObject row = new JSONObject(route.toString()).put("key", tag).put("createdAt", i).put("phase", "posted")
    .put("digest", HostedResultNotices.hash(result(route, 1).toString()));
   rows.put(tag, row);
   f.active.put(tag,row.getString("digest"));
   if (i == 1) first = tag;
   if (i == 2) second = tag;
  }
  f.slots.put(HostedResultNotices.LEDGER, rows.toString());
  f.ledger.capture(first);
  JSONObject offered = route(201, 1, "historical-loop-201");
  f.retainRow(offered, 1);
  check("posted".equals(f.ledger.publish(offered)), "Exact source publishes row 201");
  JSONObject retained = f.readObject(HostedResultNotices.LEDGER);
  return new JSONObject().put("rows", retained.length())
   .put("pendingKept", retained.has(first) && first.equals(f.ledger.peek().getString("key")))
   .put("oldestUnclaimedRemoved", !retained.has(second) && f.cancels.equals(List.of(second)) && !f.active.containsKey(second));
 }

 public static void main(String[] args) throws Exception {
  JSONArray traces = new JSONArray();
  Fixture same = new Fixture("loop-supersession-same-owner-history");
  same.postFirst(); same.retain(3, 1); same.publish(3, "complete");
  same.retain(2, 1); same.publish(2, "complete"); same.capture(1, false, true); same.publish(1, "complete");
  same.capture(2, true, true); same.capture(2, true, true);
  same.recreate(); same.stutter("recreated ledger reads the same durable question");
  same.release(1, false); same.release(1, true); same.capture(2, false, true);
  same.consume(1, "complete"); same.release(2, true); same.consume(2, "complete"); same.consume(2, "complete");
  traces.put(same.trace.value);

  Fixture pending = new Fixture("pending-route-protects-prior-loop-result");
  pending.postFirst(); pending.capture(1, false, true); pending.retain(2, 1); pending.publish(2, "complete");
  pending.capture(2, true, true); pending.release(1, true); pending.consume(1, "complete"); pending.release(2, true);
  traces.put(pending.trace.value);

  Fixture scope = new Fixture("exact-owner-agent-origin-and-explicit-signout");
  scope.postFirst(); scope.retain(4, 1); scope.publish(4, "complete"); scope.capture(1, true, true);
  scope.withdraw(3, "owner"); scope.withdraw(3, "complete"); scope.capture(1, false, true);
  scope.withdraw(1, "complete"); scope.publish(1, "complete"); scope.withdraw(2, "complete"); scope.publish(4, "complete");
  scope.capture(4, false, true); scope.withdraw(4, "complete"); scope.publish(4, "complete");
  scope.withdraw(0, "complete"); scope.publish(1, "complete");
  traces.put(scope.trace.value);

  Fixture digest = new Fixture("retention-scope-digest-and-expiry");
  digest.publish(1, "complete"); digest.retain(1, 3); digest.publish(1, "complete");
  digest.retain(1, 1);
  JSONObject forged = new JSONObject(digest.routes.get(1).toString()).put("origin", "https://different.invalid");
  try {digest.ledger.publish(forged);throw new AssertionError("Forged scope accepted");}
  catch (IllegalArgumentException expected) {}
  digest.stutter("altered origin cannot publish a route under a forged scope");
  digest.publish(1, "complete"); digest.expire(1); digest.capture(0, false, true); digest.capture(1, true, true);
  digest.retain(1, 2); digest.publish(1, "complete"); digest.retain(1, 0); digest.retain(1, 3); digest.retain(1, 1);
  digest.release(1, true); digest.capture(1, false, true); digest.consume(2, "complete");
  traces.put(digest.trace.value);

  Fixture priorWrite = new Fixture("supersession-cancel-precedes-refused-ledger-write");
  priorWrite.postFirst(); priorWrite.retain(2, 1); priorWrite.publish(2, "before-write");
  priorWrite.publish(1, "complete"); priorWrite.publish(2, "permission"); priorWrite.publish(2, "complete");
  priorWrite.capture(2, false, true);
  traces.put(priorWrite.trace.value);

  Fixture uncertain = new Fixture("interrupted-dispatch-repairs-without-repost");
  uncertain.retain(1, 1); uncertain.publish(1, "before-post"); uncertain.capture(1, false, true);
  uncertain.recreate(); uncertain.publish(1, "repair-write"); uncertain.publish(1, "complete");
  uncertain.publish(1, "complete"); uncertain.retain(2, 1); uncertain.publish(2, "after-post");
  uncertain.recreate(); uncertain.publish(2, "complete"); uncertain.retain(3, 1); uncertain.publish(3, "security");
  uncertain.publish(3, "complete"); uncertain.capture(3, false, true);
  traces.put(uncertain.trace.value);

  Fixture replacement = new Fixture("interrupted-replacement-cannot-adopt-the-older-post");
  replacement.postFirst(); replacement.capture(1, true, true); replacement.retain(1, 2);
  replacement.publish(1, "before-write"); replacement.publish(1, "before-post");
  replacement.recreate(); replacement.publish(1, "complete");
  traces.put(replacement.trace.value);

  Fixture consume = new Fixture("consume-partial-writes-and-cancel-failure");
  consume.postFirst(); consume.capture(1, false, true); consume.consume(1, "ledger");
  consume.consume(1, "pending"); consume.recreate(); consume.stutter("opened phase can retain readable pending tap after failed clear");
  consume.consume(1, "cancel"); consume.consume(1, "complete");
  traces.put(consume.trace.value);

  Fixture ownerFailure = new Fixture("durable-owner-fence-before-ledger-and-pending-failures");
  ownerFailure.postFirst(); ownerFailure.capture(1, true, true); ownerFailure.withdraw(2, "ledger");
  ownerFailure.publish(1, "complete"); ownerFailure.capture(1, false, true);
  ownerFailure.withdraw(2, "pending"); ownerFailure.withdraw(2, "complete");
  ownerFailure.withdraw(1, "complete"); ownerFailure.publish(1, "complete");
  traces.put(ownerFailure.trace.value);

  for (int nextOwner : List.of(0, 2)) {
   traces.put(priorTokenThroughBridge(false, nextOwner).trace.value);
   traces.put(priorTokenThroughBridge(true, nextOwner).trace.value);
  }
  java.lang.System.out.println(new JSONObject().put("traces", traces).put("capacity", capacity()));
 }
}
