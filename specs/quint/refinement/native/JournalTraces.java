package ai.eliza.plugins.messages;
import ai.elizaresearch.alphaphone.Trace;

import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;
import ai.eliza.plugins.actionjournal.deletion.DeletionDeadline;
import ai.eliza.plugins.messages.SmsSendJournal;
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
 static final class SmsStore implements SmsSendJournal.Storage {
  String bytes; boolean fail;
  public String read() { return bytes; }
  public void write(String value) throws IOException { if (fail) throw new IOException("injected SMS store failure"); bytes = value; }
 }
 static JSONObject sms(SmsSendJournal journal, int dispatches) {
  SmsSendJournal.Record record = journal.get("sms");
  return Trace.fields("phase", record == null ? "reviewed" : record.dispatching ? "dispatching" : record.status(),
    "journaled", record != null, "dispatches", dispatches);
 }
 static JSONArray smsTraces() throws Exception {
  JSONArray result = new JSONArray();
  for (int parts : new int[]{1, 2}) for (boolean returned : new boolean[]{false, true})
   for (boolean success : new boolean[]{false, true}) for (boolean failStore : new boolean[]{false, true}) {
    SmsStore store = new SmsStore(); SmsSendJournal journal = new SmsSendJournal(store);
    Trace trace = new Trace("sms-" + parts + returned + success + failStore, Trace.fields("journaled", false, "dispatches", 0));
    trace.step("admitImage", Trace.fields("journaled", false));
    trace.step("review", sms(journal, 0), parts);
    store.fail = failStore;
    try { journal.beginDispatch("sms", new String[]{"+15555550100"}, "fixture", 0, new int[]{parts}, 1000, 0); }
    catch (IOException expected) { if (!failStore) throw expected; }
    trace.step("dispatch", sms(journal, failStore ? 0 : 1), !failStore);
    if (!failStore) {
     journal.endDispatch("sms", returned); trace.step("dispatchReturns", sms(journal, 1), returned);
     for (int part = 0; part < parts; part++) {
      journal.sentResult("sms", part, success); trace.step("sentCallback", sms(journal, 1), part, success);
      if (!success) break;
     }
     if (success && parts == 1) {
      journal.deliveryReported("sms", 0); journal.providerStatus("sms", 0, SmsSendJournal.STATUS_COMPLETE);
      trace.step("reportDelivery", sms(journal, 1), true);
     }
     journal = new SmsSendJournal(store);
     trace.stutter("reload SMS journal", sms(journal, 1));
     String binding = SmsSendJournal.sha256(SmsSendJournal.bindingText(new String[]{"+15555550100"}, "fixture", 0));
     if (journal.existing("sms", binding) == null) throw new AssertionError("lost operation");
     trace.step("repeatOperation", sms(journal, 1));
    }
    result.put(trace.value);
   }
  return result;
 }
 static JSONArray ipc() throws Exception {
  JSONArray result = new JSONArray();
  for (String mode : new String[]{"success", "no-complete", "transport", "malformed", "bounds", "occupied", "guard", "replacement"}) {
   int[] dispatches = {0}; boolean[] current = {true}, cancelled = {false};
   BufferedStreamExchange.Handle mine = () -> cancelled[0] = true, foreign = () -> {};
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
   JSONObject reply = null;
   try { reply = BufferedStreamExchange.exchange(port, new JSONObject(), active, () -> { if (!current[0]) throw new SecurityException("retired"); }, 60000); }
   catch (Exception expected) { if (mode.equals("success")) throw expected; }
   java.util.ArrayList<JSONObject> actions = new java.util.ArrayList<>();
   actions.add(Trace.action("open")); actions.add(Trace.action("claim"));
   if (!mode.equals("occupied")) {
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
     "resultStatus", reply == null ? 0 : reply.getInt("status"));
   trace.macro("actual exchange return and finally", observed, actions.toArray(new JSONObject[0]));
   result.put(trace.value);
  }
  return result;
 }
 public static void main(String[] args) throws Exception {
  System.out.println(new JSONObject().put("DeletionJournal", deletions()).put("DeviceActions", smsTraces()).put("VoiceIpcAssembly", ipc()));
 }
}
