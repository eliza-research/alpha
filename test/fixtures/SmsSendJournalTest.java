package ai.eliza.plugins.messages;

import java.io.File;
import java.nio.file.Files;

/**
 * Alpha's installed-journal compatibility with the shared reviewed-SMS core (#421). The behaviour is
 * tested upstream (plugin-native-messages android/src/test); this fixture checks what only Alpha's
 * identity decides: the binding hash matches the renderer contract, a journal written by earlier
 * Alpha releases loads, and Alpha's retired-ID namespace keeps compacted operation IDs refused.
 */
public final class SmsSendJournalTest {
 static void require(boolean yes, String what) { if (!yes) throw new AssertionError(what); }
 public static void main(String[] args) throws Exception {
  String expectedHash = args[0], namespace = args[1];
  String[] two = { "+15555550100", "5550101" }, one = { "+15555550100" };
  String body = "Running late \"5\" min\né😀\t\u0001";
  require(SmsSendJournal.sha256(SmsSendJournal.bindingText(two, body, 3)).equals(expectedHash), "binding hash matches JSON.stringify");

  // A journal line exactly as the pre-upstream Alpha encoder wrote it: watermark, tombstone, one dispatched record.
  String hash = SmsSendJournal.sha256(SmsSendJournal.bindingText(one, "x", 3)), bodyHash = SmsSendJournal.sha256("x");
  File dir = Files.createTempDirectory("alpha-sms-compat").toFile(), file = new File(dir, "journal");
  Files.write(file.toPath(), ("w1|900\nt1|old-op|" + hash + "\nv1|kept-op|3|" + hash + "|" + bodyHash + "|1000|7|+15555550100|-|010|1|s|u|0|0\n").getBytes("UTF-8"));
  SmsSendJournal legacy = new SmsSendJournal(new SmsSendJournal.Storage() {
   public String read() throws java.io.IOException { return new String(Files.readAllBytes(file.toPath()), "UTF-8"); }
   public void write(String value) throws java.io.IOException { Files.write(file.toPath(), value.getBytes("UTF-8")); }
  }, namespace);
  require("sent".equals(legacy.get("kept-op").status()), "installed records keep their evidence");
  boolean expired = false; try { legacy.existing("old-op", hash); } catch (SmsSendJournal.Expired refused) { expired = true; }
  require(expired, "installed tombstones are still refused");

  // Compacted IDs stay refused only under the namespace they were written with.
  final String[] memory = { null };
  SmsSendJournal.Storage storage = new SmsSendJournal.Storage() {
   public String read() { return memory[0]; }
   public void write(String value) { memory[0] = value; }
  };
  SmsSendJournal journal = new SmsSendJournal(storage, namespace);
  for (int i = 0; i <= SmsSendJournal.MAX_RECORDS + SmsSendJournal.MAX_TOMBSTONES; i++) journal.decide("id" + i, one, "x", 3, "cancelled", i + 1, 7);
  require(new SmsSendJournal(storage, namespace).isRetired("id0"), "Alpha's namespace keeps the compacted ID refused after reload");
  require(!new SmsSendJournal(storage, SmsSendJournal.DEFAULT_RETIRED_NAMESPACE).isRetired("id0"), "another namespace would forget it");
  file.delete(); dir.delete();
  System.out.println("PASS alpha sms journal compatibility");
 }
}
