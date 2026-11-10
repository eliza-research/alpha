package ai.elizaresearch.alphaphone;
public final class NativeReadEpochTest {
 static void require(boolean yes) { if (!yes) throw new AssertionError(); }
 public static void main(String[] args) {
  NativeReadEpoch epoch = new NativeReadEpoch();
  long delayedThumbnail = epoch.get();
  require(epoch.current(delayedThumbnail, "full", "full", true));
  // A provider completes after lock and unlock, even with the same grant: no publication.
  epoch.incrementAndGet();
  require(!epoch.current(delayedThumbnail, "full", "full", true));
  long delayedContacts = epoch.get();
  require(!epoch.current(delayedContacts, "contacts", "contacts", false));
  require(!epoch.current(epoch.get(), "full", "selected", true));
  epoch.incrementAndGet();
  require(!epoch.current(delayedContacts, "contacts", "contacts", true));
  require(epoch.current(epoch.get(), "selected", "selected", true));
  System.out.println("PASS native read publication fences");
 }
}
