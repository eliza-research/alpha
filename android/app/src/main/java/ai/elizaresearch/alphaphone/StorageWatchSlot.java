package ai.elizaresearch.alphaphone;

import java.util.function.Supplier;

/** The Files browser's one storage watch. A watch is requested on the plugin thread and its
 * observers are registered later on the storage worker; an unwatch, a newer watch or teardown
 * that lands in between makes that registration a no-op, so no observer outlives its request.
 * Plain Java, checked on the host JVM. */
final class StorageWatchSlot {
 interface Watch { void stop(); }
 private long generation;
 private Watch current;
 /** A new watch request; it supersedes every earlier one. */
 synchronized long request(){return ++generation;}
 /** Registers through {@code start} only while {@code ticket} is the latest request; the
  * previous watch stops first. Returns whether it registered. */
 synchronized boolean install(long ticket,Supplier<Watch> start){
  if(ticket!=generation)return false;
  stopCurrent();current=start.get();return true;
 }
 /** Stops the current watch and voids every request not yet installed. */
 synchronized void clear(){generation++;stopCurrent();}
 synchronized boolean active(){return current!=null;}
 private void stopCurrent(){Watch old=current;current=null;if(old!=null)old.stop();}
}
