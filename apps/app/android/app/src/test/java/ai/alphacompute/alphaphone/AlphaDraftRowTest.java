// spec/app/assistant/composer.md, "A write that lands clears any sending mark, and one that finds another revision stops until both texts are kept or the message it marks is checked"; spec/app/assistant/composer.md, "Story: Send what I wrote"
package ai.alphacompute.alphaphone;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class AlphaDraftRowTest {
 @Test public void theRowsAskAlphaWritesAreKeptAndNoOther() {
  for (String kept : new String[] {
   "{\"revision\":1,\"text\":\"Book the table\",\"sending\":false}",
   "{\"revision\":2,\"text\":\"Book the table\",\"sending\":true}",
   "{\"revision\":2,\"text\":\"Book the table\",\"sending\":true,\"lastSentWire\":\"Book the table\"}",
   "{\"revision\":3,\"text\":\"Book the table\",\"sending\":true,\"lastSentId\":\"c-1\",\"lastSentWire\":\"Book the table\"}",
   "{\"revision\":4,\"text\":\"Book the table\",\"sending\":true,\"lastSentId\":\"c-1\"}",
   "{\"revision\":9007199254740991,\"text\":\"\",\"sending\":false}",
  }) assertTrue(kept, AlphaDraftRow.admits(kept));
  for (String refused : new String[] {
   "{\"revision\":0,\"text\":\"a\",\"sending\":false}",
   "{\"revision\":9007199254740992,\"text\":\"a\",\"sending\":false}",
   "{\"revision\":\"1\",\"text\":\"a\",\"sending\":false}",
   "{\"revision\":1.5,\"text\":\"a\",\"sending\":false}",
   "{\"revision\":1,\"text\":\"a\"}",
   "{\"revision\":1,\"text\":\"a\",\"sending\":false,\"lastSentWire\":\"a\"}",
   "{\"revision\":1,\"text\":\"a\",\"sending\":true,\"lastSentWire\":2}",
   "{\"revision\":1,\"text\":\"a\",\"sending\":true,\"lastSentWire\":\"a\",\"owner\":\"x\"}",
   "{\"revision\":1,\"text\":\"a\",\"sending\":true,\"owner\":\"x\"}",
   "not a row",
  }) assertFalse(refused, AlphaDraftRow.admits(refused));
 }
}
