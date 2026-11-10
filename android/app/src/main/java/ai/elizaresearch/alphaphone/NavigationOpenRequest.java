package ai.elizaresearch.alphaphone;

/** One notification tap waits briefly for a renderer; consuming or HOME retires it. */
final class NavigationOpenRequest {
 private static final long LIFETIME_MS = 30_000;
 private long expiresAt = -1;
 synchronized void offer(long now) { expiresAt = now + LIFETIME_MS; }
 synchronized void clear() { expiresAt = -1; }
 synchronized boolean consume(long now) {
  boolean open = expiresAt >= 0 && now < expiresAt;
  clear();
  return open;
 }
}
