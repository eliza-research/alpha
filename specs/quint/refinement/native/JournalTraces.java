package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.*;
import ai.eliza.voice.BufferedStreamExchange;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

public final class JournalTraces {
 static final class Store implements DeferredDeletionJournal.Store {
  String bytes; int writes; int failWrite = -1;
  public String read() { return bytes; }
  public void save(String value) throws Exception { if (++writes == failWrite) throw new IOException("injected write failure"); bytes = value; }
 }
 static JSONObject deletion(DeferredDeletionJournal journal, int dispatches) throws Exception {
  JSONArray rows = journal.list("boot:0", 10000);
  return Trace.fields("phase", rows.isEmpty() ? "absent" : rows.getJSONObject(0).getString("phase"), "dispatches", dispatches);
 }
 static JSONArray deletions() throws Exception {
  JSONArray result = new JSONArray();
  for (String outcome : new String[]{"deleted", "conflict", "permission-required", "unknown"})
   for (boolean loseReceipt : new boolean[]{false, true}) for (boolean staleOwner : new boolean[]{false, true}) {
    Store store = new Store(); DeferredDeletionJournal journal = new DeferredDeletionJournal(store);
    Trace trace = new Trace("delete-" + outcome + loseReceipt + staleOwner, deletion(journal, 0));
    JSONObject owner = new JSONObject().put("owner", 0), target = new JSONObject().put("revision", 0);
    journal.stage("delete", owner, target, new DeletionDeadline("boot:0", 0, 0));
    trace.step("stage", Trace.fields("phase", "queued"));
    if (staleOwner) trace.step("ownerChanges", Trace.fields("currentOwner", 1));
    trace.step("expireWindow", Trace.fields("phase", "queued"));
    if (loseReceipt) store.failWrite = 3;
    int[] calls = {0};
    try {
     journal.expire("delete", "boot:0", 10000, (o, t) -> staleOwner ? "owner-unavailable" : null,
       t -> { calls[0]++; return new JSONObject().put("status", outcome); });
    } catch (IOException failure) { if (!loseReceipt || staleOwner) throw failure; }
    if (staleOwner) trace.step("claim", deletion(journal, calls[0]));
    else {
     java.util.ArrayList<JSONObject> actions = new java.util.ArrayList<>();
     actions.add(Trace.action("claim")); actions.add(Trace.action("providerResult", outcome, !loseReceipt));
     if (loseReceipt) actions.add(Trace.action("observeReceipt"));
     trace.macro("expire provider boundary", deletion(journal, calls[0]), actions.toArray(new JSONObject[0]));
    }
    journal = new DeferredDeletionJournal(store);
    trace.stutter("reload durable bytes", deletion(journal, calls[0]));
    journal.stage("delete", owner, target, new DeletionDeadline("boot:0", 0, 0));
    trace.step("repeatStage", deletion(journal, calls[0]), 0, 0);
    if (deletion(journal, calls[0]).getString("s.phase").equals("unknown")) {
     store.failWrite = -1; journal.acknowledge("calendar", "delete");
     trace.step("dismissUnknown", deletion(journal, calls[0]).put("s.acknowledged", journal.acknowledged("calendar", "delete")));
    }
    result.put(trace.value);
   }
  for (boolean reboot : new boolean[]{false, true}) {
   Store store = new Store(); DeferredDeletionJournal journal = new DeferredDeletionJournal(store);
   Trace trace = new Trace("undo-" + reboot, deletion(journal, 0));
   JSONObject owner = new JSONObject().put("owner", 0);
   journal.stage("delete", owner, new JSONObject().put("revision", 0), new DeletionDeadline("boot:0", 0, 0));
   trace.step("stage", Trace.fields("phase", "queued"));
   if (reboot) trace.step("reboot", Trace.fields("phase", "queued"));
   JSONObject row = journal.undo("delete", owner, reboot ? "boot:1" : "boot:0", 1);
   trace.step("undo", Trace.fields("phase", row.getString("phase"), "dispatches", 0));
   result.put(trace.value);
  }
  return result;
 }
 static JSONArray ipc() throws Exception {
  JSONArray result = new JSONArray();
  for (String mode : new String[]{"success", "no-complete", "transport", "malformed", "bounds", "occupied", "guard", "replacement", "deadline", "schedule-rejected"}) {
   int[] dispatches = {0}, guardChecks = {0}; boolean[] current = {true}, cancelled = {false};
   java.util.concurrent.CountDownLatch deadlineCancelled = new java.util.concurrent.CountDownLatch(1);
   BufferedStreamExchange.Handle mine = () -> { cancelled[0] = true; deadlineCancelled.countDown(); }, foreign = () -> {};
   AtomicReference<BufferedStreamExchange.Handle> active = new AtomicReference<>(mode.equals("occupied") ? foreign : null);
   Trace trace = new Trace("ipc-" + mode, Trace.fields("active", mode.equals("occupied") ? 2 : 0, "dispatches", 0));
   trace.value.put("init", Trace.action("initFor", mode.equals("occupied")));
   BufferedStreamExchange.Port port = new BufferedStreamExchange.Port() {
    public BufferedStreamExchange.Handle open() { return mine; }
    public void request(JSONObject input, java.util.function.Consumer<String> event, BufferedStreamExchange.Handle handle) {
     dispatches[0]++;
     if (mode.equals("replacement")) { active.set(foreign); current[0] = false; }
     event.accept(new JSONObject().put("type", "response").put("status", 200).toString());
     if (mode.equals("guard")) current[0] = false;
     if (mode.equals("malformed")) event.accept("not-json");
     else if (mode.equals("bounds")) event.accept(new JSONObject().put("type", "chunk").put("dataBase64", java.util.Base64.getEncoder().encodeToString(new byte[128 * 1024 + 1])).toString());
     else event.accept(new JSONObject().put("type", "chunk").put("dataBase64", "e30=").toString());
     if (!mode.equals("no-complete")) {
      JSONObject complete = new JSONObject().put("type", "complete");
      if (mode.equals("transport")) complete.put("error", "fixture");
      event.accept(complete.toString());
     }
    }
   };
   if (mode.equals("schedule-rejected")) {
    java.lang.reflect.Field field = BufferedStreamExchange.class.getDeclaredField("DEADLINES");
    field.setAccessible(true);
    java.util.concurrent.ScheduledThreadPoolExecutor scheduler = (java.util.concurrent.ScheduledThreadPoolExecutor)field.get(null);
    scheduler.shutdownNow();
   }
   JSONObject reply = null; String failure = "none";
   try { reply = BufferedStreamExchange.exchange(port, new JSONObject(), active, () -> {
    if (++guardChecks[0] == 2 && mode.equals("deadline") && !deadlineCancelled.await(5, java.util.concurrent.TimeUnit.SECONDS))
      throw new AssertionError("Deadline did not cancel");
    if (!current[0]) throw new SecurityException("retired");
   }, mode.equals("deadline") ? 0 : 60000); }
   catch (Exception expected) {
    if (mode.equals("success")) throw expected;
    String message = expected.getMessage();
    if (expected instanceof java.util.concurrent.RejectedExecutionException) failure = "schedule";
    else if (expected instanceof org.json.JSONException) failure = "event";
    else if ("Concurrent voice IPC".equals(message)) failure = "concurrent";
    else if ("Voice IPC deadline".equals(message)) failure = "deadline";
    else if ("Voice response incomplete".equals(message)) failure = "incomplete";
    else if ("Voice transport interrupted".equals(message)) failure = "transport";
    else if ("Voice response too large".equals(message)) failure = "bounds";
    else if ("retired".equals(message)) failure = "guard";
    else throw new AssertionError("Unexpected failure class", expected);
   }
   java.util.ArrayList<JSONObject> actions = new java.util.ArrayList<>();
   actions.add(Trace.action("open")); actions.add(Trace.action("claim"));
   if (mode.equals("schedule-rejected")) actions.add(Trace.action("schedule", false));
   else if (mode.equals("deadline")) {
    actions.add(Trace.action("schedule", true)); actions.add(Trace.action("deadlineFires")); actions.add(Trace.action("refuseDispatch"));
   } else if (!mode.equals("occupied")) {
    actions.add(Trace.action("schedule", true)); actions.add(Trace.action("dispatch"));
    if (mode.equals("replacement")) { actions.add(Trace.action("replaceHandle")); actions.add(Trace.action("staleEvent")); }
    else {
     actions.add(Trace.action("response", 200));
     if (mode.equals("guard")) { actions.add(Trace.action("guardChanges")); actions.add(Trace.action("staleEvent")); }
     else if (mode.equals("malformed")) actions.add(Trace.action("malformed"));
     else if (mode.equals("bounds")) { actions.add(Trace.action("chunk", 2)); actions.add(Trace.action("chunk", 1)); }
     else actions.add(Trace.action("chunk", 1));
     if (!mode.equals("no-complete") && !mode.equals("guard")) actions.add(Trace.action("completion", mode.equals("transport")));
    }
    actions.add(Trace.action("requestReturns"));
   }
   actions.add(Trace.action("cleanup"));
   JSONObject observed = Trace.fields("active", active.get() == null ? 0 : active.get() == mine ? 1 : 2,
     "cancelled", cancelled[0], "dispatches", dispatches[0], "returned", reply != null,
     "resultStatus", reply == null ? 0 : reply.getInt("status"), "failure", failure, "foreignActive", active.get() == foreign, "guardCurrent", current[0]);
   trace.macro("actual exchange return and finally", observed, actions.toArray(new JSONObject[0]));
   result.put(trace.value);
  }
  return result;
 }
 public static void main(String[] args) throws Exception {
  System.out.println(new JSONObject().put("DeletionJournal", deletions()).put("VoiceIpcAssembly", ipc()));
 }
}
