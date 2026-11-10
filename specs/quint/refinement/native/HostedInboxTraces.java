package ai.alphacompute.alphaphone;

import java.io.IOException;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.json.JSONArray;
import org.json.JSONObject;

/** Executed product coordinator and inbox over controlled storage and resident IPC. */
public final class HostedInboxTraces {
 static final String ORIGIN = "https://device.alpha.invalid";
 static final String RUNTIME = "synthetic-runtime";
 static final String INSTALLATION = "11111111-1111-1111-1111-111111111111";
 static final long TTL = 60_000;
 static volatile long now = 1_760_000_000_000L;
 static final Map<String,String> slots = new ConcurrentHashMap<>();
 static final Map<String,Integer> posts = new ConcurrentHashMap<>();
 static final Map<Integer,String> clientIds = new ConcurrentHashMap<>();
 static final Map<Integer,JSONObject> expectedAck = new ConcurrentHashMap<>();
 static final BlockingQueue<Request> requests = new LinkedBlockingQueue<>();
 static volatile int gets, acks, receipts, writesUntilRefused;
 static volatile String refusedWrite, refusedRemove;

 static void check(boolean condition, String message) {
  if (!condition) throw new AssertionError(message);
 }

 static String owner(int number) { return "owner-" + number; }
 static String agent(int number) { return "agent-" + number; }
 static String session(int number) { return "synthetic-machine-" + number; }
 static String ui(int number) { return "screen-" + number; }
 static String run(int number) { return "result-" + number; }
 static String scope(int number) throws Exception {
  return HostedResultNotices.hash(new JSONArray().put(ORIGIN).put(owner(number)).put(agent(number)).toString());
 }
 static String slot(int number) throws Exception { return "hosted-digests:v1:" + scope(number); }
 static String notice(int number, int id) throws Exception { return HostedResultNotices.hash(scope(number) + ":" + run(id)); }

 static int tracked(String id) {
  for (int i = 1; i <= 3; i++) if (run(i).equals(id)) return i;
  return 0;
 }

 static JSONObject object(String key) {
  String value = slots.get(key);
  return value == null ? new JSONObject() : new JSONObject(value);
 }

 static void write(String key, String value) throws Exception {
  if (key.equals(refusedWrite) && --writesUntilRefused <= 0) throw new IOException("Synthetic slot write refusal");
  slots.put(key, value);
 }

 static void remove(String key) throws Exception {
  if (key.equals(refusedRemove)) throw new IOException("Synthetic slot removal refusal");
  slots.remove(key);
 }

 static void post(String key) {
  JSONObject row = object(HostedResultNotices.LEDGER).getJSONObject(key);
  check(row.getString("phase").equals("dispatching"), "Notice has a durable retained route first");
  check(!row.has("output"), "Notice is redacted");
  posts.merge(key, 1, Integer::sum);
 }

 static final class Request {
  final int owner;
  final String kind;
  final JSONObject data;
  final CountDownLatch responseReady = new CountDownLatch(1);
  volatile JSONObject response;
  boolean accepted;
  Request(int owner, String kind, JSONObject data) { this.owner = owner; this.kind = kind; this.data = data; }
  void reply(int status, JSONObject body) {
   response = envelope(status, body);
   responseReady.countDown();
  }
 }

 static JSONObject envelope(int status, JSONObject body) {
  return new JSONObject().put("status", status).put("body", body.toString());
 }

 static JSONObject exchange(JSONObject call) throws Exception {
  JSONObject headers = call.getJSONObject("headers");
  String token = headers.getString("Authorization");
  int number = token.equals("Bearer " + session(1)) ? 1 : token.equals("Bearer " + session(2)) ? 2 : 0;
  check(number != 0 && call.getInt("timeoutMs") <= 15_000, "Exact native resident session and finite timeout");
  String path = call.getString("path"), method = call.getString("method");
  if (path.startsWith("/api/workflow/")) {
   check(headers.getString("X-Eliza-Device-Id").equals(INSTALLATION) &&
     headers.getString("X-Eliza-Device-Key").equals("a".repeat(64)), "Bound device authority only");
  }
  switch (path) {
   case "/api/auth/me":
    return envelope(200, new JSONObject().put("identity", new JSONObject().put("kind", "owner").put("id", owner(number)))
     .put("access", new JSONObject().put("role", "OWNER").put("mode", "session"))
     .put("session", new JSONObject().put("kind", "machine").put("id", session(number)).put("expiresAt", now + TTL)));
   case "/api/agents":
    return envelope(200, new JSONObject().put("agents", new JSONArray().put(
     new JSONObject().put("id", agent(number)).put("status", "running"))));
   case "/api/workflow/status":
    return envelope(200, new JSONObject().put("hostedDigestProtocol", 1));
   default:
    break;
  }
  Request request;
  if (path.startsWith("/api/workflow/hosted/results?clientId=")) {
   String client = path.substring(path.indexOf('=') + 1);
   check(method.equals("GET") && !call.has("body"), "Read is the only results fetch");
   check(java.util.UUID.fromString(client).toString().equals(client), "Stable opaque inbox client identity");
   check(client.equals(object(slot(number)).getString("clientId")), "Client identity was written before GET");
   String prior = clientIds.putIfAbsent(number, client);
   check(prior == null || prior.equals(client), "Existing inbox never invents a new client ID");
   check(!client.equals(clientIds.get(3 - number)), "Each retained scope has a separate client identity");
   request = new Request(number, "get", new JSONObject().put("clientId", client));
   gets++;
  } else {
   check(path.equals("/api/workflow/hosted/results/ack") && method.equals("POST"), "Only exact receipt route mutates the provider");
   JSONObject body = new JSONObject(call.getString("body"));
   check(body.similar(expectedAck.get(number)), "Ack contains exact client, cursor and final run from the offered page");
   JSONObject durable = object(slot(number));
   boolean found = false;
   for (String index : List.of("ids", "pendingRemoval")) {
    JSONArray ids = durable.getJSONArray(index);
    for (int i = 0; i < ids.length(); i++) if (ids.getString(i).equals(body.getString("runId"))) found = true;
   }
   check(found && object(slot(number) + ":" + body.getString("runId")).getLong("cursor") == body.getLong("cursor"),
    "Provider ACK follows durable row and exact index");
   request = new Request(number, "ack", body);
   acks++;
  }
  requests.put(request);
  check(request.responseReady.await(10, TimeUnit.SECONDS), "Fixture explicitly resolved each synthetic request");
  return request.response;
 }

 static JSONObject row(int id, int cursor, int revision) {
  return new JSONObject().put("cursor", cursor).put("runId", run(id)).put("workflowId", "loop-" + id)
   .put("workflowVersionId", "v1").put("templateVersion", "t1")
   .put("scheduledAt", "2026-11-08T12:00:00Z").put("startedAt", "2026-11-08T12:00:01Z")
   .put("completedAt", "2026-11-08T12:00:02Z").put("source", new JSONObject()).put("status", "completed")
   .put("output", new JSONObject().put("revision", revision));
 }

 static int revision(JSONObject row) { return row.getJSONObject("output").getInt("revision"); }

 static final class Fixture {
  final HostedDelivery delivery = HostedDelivery.get(new android.content.Context());
  final Trace trace;
  final Map<String,Integer> generations = new HashMap<>();
  final Map<Integer,String> generationIds = new HashMap<>();
  FutureTask<String> worker;
  Request held;
  int runningOwner, runningGeneration, page;
  boolean background;
  String outcome = "none";

  Fixture(String name) throws Exception { trace = new Trace(name, observe()); }

  void configure(int number) throws Exception {
   JSONObject device = new JSONObject().put("installationId", INSTALLATION).put("key", "a".repeat(64)).put("enrollmentId", "enrollment");
   slots.put(NativeDeviceEnrollmentKey.local(ORIGIN, owner(number), agent(number)), device.toString());
   String attempt = "10000000-0000-0000-0000-00000000000" + (generations.size() + 1);
   delivery.begin(attempt);
   JSONObject response = delivery.configure(new JSONObject().put("attemptId", attempt).put("mode", "resident").put("origin", ORIGIN)
    .put("ownerId", owner(number)).put("agentId", agent(number)).put("sessionId", ui(number)));
   check(response.getString("scope").equals(scope(number)), "Exact retained scope");
   String generation = response.getString("generation");
   check(generation.equals(delivery.generation(ui(number))), "UI session looks up exact active generation");
   generationIds.put(generations.size() + 1, generation);
   generations.put(generation, generations.size() + 1);
   point("configure", number);
  }

  void retire(int number) throws Exception {
   String before = object(HostedDelivery.ACTIVE).optString("generation");
   delivery.disableSession(ui(number));
   String after = object(HostedDelivery.ACTIVE).optString("generation");
   if (!before.equals(after)) {
    check(!slots.containsKey("resident-results:v1:credential"), "Retirement removes only active resident credentials");
    generationIds.put(generations.size() + 1, after);
    generations.put(after, generations.size() + 1);
   }
   point("retire", number);
  }

  void polling(boolean on) throws Exception { delivery.polling(on); point("polling", on); }

  void stop(int generation) throws Exception {
   delivery.stop(generationIds.getOrDefault(generation, "stale-generation"));
   point("stop", generation);
  }

  String sync(int generation, boolean background) throws Exception {
   try {
    JSONArray result = background ? delivery.syncBackground(generationIds.get(generation)) : delivery.sync(generationIds.get(generation));
    JSONArray history = delivery.history(ui(runningOwner));
    check(result.similar(history), "Result returned from the exact same durable history");
    return "current";
   } catch (HostedDeliveryCancelled cancelled) { return "cancelled"; }
   catch (HostedStorageFault storage) { return "storage-error"; }
   catch (SecurityException revoked) { return "reconnect-required"; }
   catch (Exception retry) { return "retry"; }
  }

  void start(int generation, boolean background, boolean noticeOk) throws Exception {
   runningOwner = activeOwner();
   runningGeneration = generation;
   this.background = background;
   if (!noticeOk) refuse(HostedResultNotices.LEDGER, 1);
   worker = new FutureTask<>(() -> sync(generation, background));
   new Thread(worker, "synthetic-hosted-poll").start();
   next("get");
   refusedWrite = null;
   outcome = "started";
   point("start", generation, background, noticeOk);
  }

  void next(String kind) throws Exception {
   held = requests.poll(10, TimeUnit.SECONDS);
   if (held == null && worker.isDone()) throw new AssertionError("Expected " + kind + ", worker returned " + worker.get());
   check(held != null && held.kind.equals(kind) && held.owner == runningOwner, "One exact owner reaches " + kind);
   if (kind.equals("get")) page++;
  }

  void terminal() throws Exception {
   outcome = worker.get(10, TimeUnit.SECONDS);
   runningOwner = 0; runningGeneration = 0; background = false; page = 0;
   held = null;
   refusedWrite = null;
   refusedRemove = null;
  }

  void busy(int generation) throws Exception {
   try {delivery.sync(generationIds.get(generation));throw new AssertionError("Concurrent poll admitted");}
   catch (IOException rejected) {check(rejected.getMessage().equals("Delivery already active"), "Held operation owns provider channel");}
   stutter("a second foreground sync cannot use the held operation or provider");
  }

  void rejectedStart(int generation, boolean background) throws Exception {
   try {
    if (background) delivery.syncBackground(generationIds.get(generation)); else delivery.sync(generationIds.get(generation));
    throw new AssertionError("Stale or paused poll admitted");
   } catch (HostedDeliveryCancelled expected) {}
   stutter("retired or paused generation refuses poll before provider access");
  }

  void failStart(int generation, boolean background, String kind) throws Exception {
   runningOwner = activeOwner();
   worker = new FutureTask<>(() -> sync(generation, background));
   new Thread(worker, "synthetic-hosted-rejection").start();
   terminal();
   check(outcome.equals(kind), "Exact pre-GET fault classification");
   point("startFailed", generation, background, kind);
  }

  static void refuse(String slot, int after) { refusedWrite = slot; writesUntilRefused = after; }

  void receive(String mode, boolean noticeOk, boolean nextAck, JSONObject... entries) throws Exception {
   check(held.kind.equals("get"), "A GET is waiting");
   JSONArray payload = new JSONArray(entries), modelRows = new JSONArray();
   if (entries.length > 0) {
    JSONObject last = entries[entries.length - 1];
    expectedAck.put(held.owner, new JSONObject().put("clientId", held.data.getString("clientId"))
     .put("cursor", last.getLong("cursor")).put("runId", last.getString("runId")));
   }
   for (JSONObject item : entries)
    modelRows.put(new JSONObject().put("id", tracked(item.getString("runId"))).put("cursor", item.getInt("cursor")).put("revision", revision(item)));
   if (!noticeOk) refuse(HostedResultNotices.LEDGER, 1);
   if (mode.equals("first-row")) refuse(slot(held.owner) + ":" + entries[0].getString("runId"), 1);
   if (mode.equals("second-row")) refuse(slot(held.owner) + ":" + entries[1].getString("runId"), 1);
   if (mode.equals("index")) refuse(slot(held.owner), 1);
   if (mode.equals("notice-index")) refuse(slot(held.owner), 2);
   if (mode.equals("invalid")) payload = new JSONArray().put(new JSONObject().put("runId", "../synthetic-invalid"));
   if (mode.equals("oversized")) for (int id = 1; id <= 51; id++) payload.put(row(id, id, 1));
   held.reply(mode.equals("transport") ? 503 : 200, new JSONObject().put("entries", payload));
   if (nextAck) next("ack"); else terminal();
   refusedWrite = null;
   point("receive", modelRows, mode, noticeOk);
  }

  void ackEffect() throws Exception {
   check(held.kind.equals("ack") && !held.accepted, "One external effect for the exact submitted request");
   held.accepted = true;
   receipts++;
   point("ackEffect");
  }

  void ackReply(String mode, boolean nextGet) throws Exception {
   check(held.kind.equals("ack"), "An ACK is waiting");
   if (mode.equals("remove-refused")) refusedRemove = slot(held.owner) + ":" + run(1);
   held.reply(mode.equals("lost") ? 503 : 200, new JSONObject());
   if (nextGet) next("get"); else terminal();
   point("ackReply", mode);
  }

  void seedFull(int number) throws Exception {
   JSONObject index = object(slot(number));
   JSONArray ids = index.getJSONArray("ids");
   check(ids.length() == 1 && ids.getString(0).equals(run(1)), "The tracked oldest row is first");
   for (int i = 10; i < 109; i++) {
    JSONObject filler = row(i, i, 1);
    ids.put(filler.getString("runId"));
    slots.put(slot(number) + ":" + filler.getString("runId"), HostedInbox.parse(filler.toString()).toString());
   }
   slots.put(slot(number), index.toString());
   check(delivery.history(ui(number)).length() == 100, "Exact product historical cache cap");
   point("seedFull", number);
  }

  static JSONArray trackedIds(JSONArray values) {
   JSONArray output = new JSONArray();
   if (values != null) for (int i = 0; i < values.length(); i++) {
    int id = tracked(values.getString(i));
    if (id != 0) output.put(id);
   }
   return output;
  }

  JSONObject bucket(int owner) throws Exception {
   JSONObject index = object(slot(owner));
   JSONArray entries = index.optJSONArray("ids"), rows = new JSONArray(), posted = new JSONArray();
   for (int id = 1; id <= 3; id++) {
    JSONObject row = object(slot(owner) + ":" + run(id));
    if (!row.isEmpty()) check(row.getString("runId").equals(run(id)), "Physical row identity");
    rows.put(new JSONArray().put(id).put(new JSONObject().put("cursor", row.optLong("cursor"))
     .put("revision", row.isEmpty() ? 0 : revision(row))));
    int count = posts.getOrDefault(notice(owner,id), 0);
    check(count <= 1, "Notice never re-posts for an equivalent replay");
    if (count > 0) posted.put(id);
   }
   boolean packed = entries != null && entries.length() == 100;
   return new JSONObject().put("client", index.has("clientId")).put("rows", rows).put("retained", trackedIds(entries))
    .put("removal", trackedIds(index.optJSONArray("pendingRemoval"))).put("pendingNotices", trackedIds(index.optJSONArray("pendingNotices")))
    .put("posted", posted).put("packed", packed).put("head", packed ? tracked(entries.getString(0)) : 0);
  }

  int activeOwner() {
   String id = object(HostedDelivery.ACTIVE).optString("ownerId");
   return id.equals(owner(1)) ? 1 : id.equals(owner(2)) ? 2 : 0;
  }

  JSONObject observe() throws Exception {
   JSONObject active = object(HostedDelivery.ACTIVE);
   ReentrantLock operation = (ReentrantLock) Trace.read(delivery, "operation");
   check(operation.isLocked() == (held != null), "Actual process single-flight lock custody");
   Object transport = Trace.read(delivery, "transport");
   check((transport != null) == (held != null), "Exact transport custody");
   boolean closed = transport != null && (boolean) Trace.read(transport, "closed");
   boolean ack = held != null && held.kind.equals("ack");
   return Trace.fields("owner", activeOwner(), "generation", generations.getOrDefault(active.optString("generation"), 0),
    "enabled", active.optBoolean("enabled"), "polling", active.optBoolean("polling"),
    "preference", object("hosted-background:v1:preference").optBoolean("enabled", true), "status", active.optString("status", "none"),
    "runningOwner", runningOwner, "runningGeneration", runningGeneration, "background", background, "closed", closed,
    "stage", held == null ? "idle" : held.kind, "page", page, "ackRun", ack ? tracked(held.data.getString("runId")) : 0,
    "ackCursor", ack ? held.data.getInt("cursor") : 0, "ackAccepted", ack && held.accepted, "gets", gets, "acks", acks,
    "receipts", receipts, "outcome", outcome, "buckets", new JSONArray().put(new JSONArray().put(1).put(bucket(1)))
     .put(new JSONArray().put(2).put(bucket(2))));
  }

  void point(String action, Object... args) throws Exception { trace.step(action, observe(), args); }
  void stutter(String label) throws Exception { trace.stutter(label, observe()); }
 }

 public static void main(String[] args) throws Exception {
  URL.setURLStreamHandlerFactory(scheme -> {
   if (!scheme.equals("http") && !scheme.equals("https")) return null;
   return new URLStreamHandler() {
    @Override protected URLConnection openConnection(URL url) {
     throw new AssertionError("Fixture permits only synthetic resident IPC");
    }
   };
  });
  Fixture f = new Fixture(args[0]);
  f.configure(1);
  switch (args[0]) {
   case "two-pages-and-exact-ack":
    f.start(1, true, true);
    f.busy(1);
    f.receive("complete", true, true, row(1, 1, 1), row(2, 2, 1));
    f.ackEffect(); f.ackReply("complete", true);
    f.receive("complete", true, true, row(3, 3, 1));
    f.ackEffect(); f.ackReply("complete", false);
    check(gets == 2 && f.delivery.history(ui(1)).length() == 3, "Exactly two pages and complete history");
    break;
   case "ack-reply-loss-and-equivalent-replay":
    f.start(1, false, true);
    f.receive("complete", true, true, row(1, 1, 1));
    f.ackEffect(); f.ackReply("lost", false);
    String original = slots.get(slot(1) + ":" + run(1));
    f.start(1, false, true);
    JSONObject replay = row(1, 1, 1);
    replay.getJSONObject("output").put("revision", new java.math.BigDecimal("1.0"));
    f.receive("complete", true, true, replay);
    check(original.equals(slots.get(slot(1) + ":" + run(1))), "Equivalent replay keeps original durable bytes");
    f.ackEffect(); f.ackReply("lost", false);
    f.start(1, false, true);
    f.receive("complete", true, false, row(1, 1, 2));
    check(original.equals(slots.get(slot(1) + ":" + run(1))) && acks == 2, "Changed result cannot replace or advance receipt");
    break;
   case "replacement-during-fetch":
    f.start(1, true, true);
    f.configure(2);
    f.busy(2);
    f.receive("complete", true, false, row(1, 1, 1));
    f.rejectedStart(1, true);
    f.retire(1);
    f.start(2, false, true);
    f.receive("complete", true, true, row(1, 1, 2));
    f.ackEffect(); f.ackReply("complete", true); f.receive("complete", true, false);
    check(!slots.containsKey(slot(1) + ":" + run(1)), "Late old fetch never writes into either scope");
    try {f.delivery.history(ui(1));throw new AssertionError("Old account reads new history");}
    catch (SecurityException expected) {}
    f.stutter("retired UI session cannot read a successor's inbox");
    break;
   case "accepted-receipt-before-generation-retire":
    f.start(1, false, true);
    f.receive("complete", true, true, row(1, 1, 1));
    f.ackEffect(); f.retire(1); f.ackReply("complete", false);
    f.rejectedStart(1, false);
    f.configure(2);
    f.start(3, false, true); f.receive("complete", true, false);
    f.configure(1);
    f.start(4, false, true); f.receive("complete", true, false);
    check(f.delivery.history(ui(1)).length() == 1 && receipts == 1, "Retained cache survives exact owner reopen");
    break;
   case "background-pause-and-owner-stop":
    f.start(1, true, true);
    f.polling(false);
    f.receive("complete", true, false, row(1, 1, 1));
    f.rejectedStart(1, true);
    f.start(1, false, true);
    f.stop(0); f.stop(1);
    f.receive("complete", true, false, row(1, 1, 1));
    f.polling(true);
    f.start(1, true, true); f.receive("complete", true, false);
    break;
   case "row-and-index-partial-writes":
    f.start(1, false, true);
    f.receive("second-row", true, false, row(1, 1, 1), row(2, 2, 1));
    f.configure(1);
    f.start(2, false, true);
    f.receive("index", true, false, row(1, 1, 1), row(2, 2, 1));
    f.configure(1);
    f.start(3, false, true);
    f.receive("complete", true, true, row(1, 1, 1), row(2, 2, 1));
    f.ackEffect(); f.ackReply("complete", true); f.receive("complete", true, false);
    break;
   case "notice-failure-retries-without-provider-replay":
    f.start(1, false, true);
    f.receive("complete", false, true, row(1, 1, 1));
    f.ackEffect(); f.ackReply("lost", false);
    f.start(1, false, false); f.receive("complete", true, false);
    f.start(1, false, true); f.receive("complete", true, false);
    break;
   case "notice-effect-before-index-clear-refusal":
    f.start(1, false, true);
    f.receive("notice-index", true, false, row(1, 1, 1));
    check(acks == 0 && posts.getOrDefault(notice(1,1), 0) == 1 &&
     f.bucket(1).getJSONArray("pendingNotices").getInt(0) == 1, "Pending notice survives its already-visible post");
    f.configure(1);
    f.start(2, false, true); f.receive("complete", true, false);
    check(posts.getOrDefault(notice(1,1), 0) == 1, "Recovery clears the journal without another post");
    break;
   case "packed-cache-removal-journal":
    f.start(1, false, true);
    f.receive("complete", true, true, row(1, 1, 1));
    f.ackEffect(); f.ackReply("lost", false); f.seedFull(1);
    f.start(1, false, true);
    f.receive("complete", true, true, row(2, 2, 1));
    check(f.delivery.history(ui(1)).length() == 100 && slots.containsKey(slot(1) + ":" + run(1)),
     "Eviction makes row unlisted before physically removing it");
    f.ackEffect(); f.ackReply("remove-refused", false);
    f.configure(1);
    f.start(2, false, true); f.receive("complete", true, false);
    check(!slots.containsKey(slot(1) + ":" + run(1)), "Recovery deletes the exact retired row");
    break;
   case "packed-replay-acknowledges-journaled-last-row":
    f.start(1, false, true); f.receive("complete", true, true, row(1, 3, 1));
    f.ackReply("lost", false); f.seedFull(1);
    f.start(1, false, true); f.receive("complete", true, true, row(2, 2, 1), row(1, 3, 1));
    check(f.held.data.getString("runId").equals(run(1)) && f.bucket(1).getJSONArray("removal").getInt(0) == 1,
     "ACK for replay's final row can refer to a durable, newly unlisted row");
    f.ackEffect(); f.ackReply("complete", true); f.receive("complete", true, false);
    break;
   case "resident-credential-expiry":
    now += TTL;
    f.failStart(1, true, "reconnect-required");
    check(gets == 0 && acks == 0, "Expired authority never reaches results IPC");
    break;
   case "invalid-unordered-and-unavailable-pages":
    f.start(1, false, true); f.receive("invalid", true, false);
    f.start(1, false, true); f.receive("oversized", true, false);
    f.start(1, false, true); f.receive("complete", true, false, row(2, 2, 1), row(1, 1, 1));
    f.start(1, false, true); f.receive("transport", true, false);
    f.start(1, false, true); f.receive("first-row", true, false, row(1, 1, 1));
    check(acks == 0 && f.delivery.history(ui(1)).isEmpty(), "Invalid and refused pages never reach provider receipt");
    break;
   default:
    throw new AssertionError("Unknown fixture " + args[0]);
  }
  check(requests.isEmpty(), "No extra provider calls");
  java.lang.System.out.println(f.trace.value);
 }
}
