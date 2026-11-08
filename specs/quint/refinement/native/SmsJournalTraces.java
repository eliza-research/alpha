package ai.eliza.plugins.messages;

import ai.elizaresearch.alphaphone.Trace;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Executes package-owned SMS journal entrypoints without changing their visibility. */
public final class SmsJournalTraces {
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
 public static void main(String[] args)throws Exception {System.out.println(new JSONObject().put("DeviceActions",smsTraces()));}
}
