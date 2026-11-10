package ai.elizaresearch.alphaphone;

/** Invalidates queued native results across lock, lifecycle and permission changes. */
final class NativeReadEpoch {
 private final java.util.concurrent.atomic.AtomicLong value = new java.util.concurrent.atomic.AtomicLong();
 long get() { return value.get(); }
 void incrementAndGet() { value.incrementAndGet(); }
 boolean current(long captured, String priorScope, String currentScope, boolean allowed) {
  return allowed && captured == value.get() && priorScope.equals(currentScope);
 }
}
