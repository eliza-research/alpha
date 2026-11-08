package ai.elizaresearch.alphaphone;
public final class CloudVoiceLimitTest {
 static void eq(Object expected, Object actual) { if (expected == null ? actual != null : !expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual); }
 public static void main(String[] args) {
  long now = java.time.Instant.parse("2026-10-28T12:00:00Z").toEpochMilli();
  CloudVoiceLimit body = CloudVoiceLimit.read("17", "rate_limited", 12, null, null, now);
  eq(12, body.retryAfterSeconds); eq("rate_limited", body.limitCode); eq(null, body.resetAt);
  eq(17, CloudVoiceLimit.read("17", null, null, null, null, now).retryAfterSeconds);
  eq(91, CloudVoiceLimit.read("Wed, 28 Oct 2026 12:01:30 GMT", null, null, null, null, now - 500).retryAfterSeconds);
  eq(4, CloudVoiceLimit.read(null, null, null, "2026-10-28T12:00:04Z", null, now).retryAfterSeconds);
  CloudVoiceLimit allowance = CloudVoiceLimit.read(null, "allowance_exhausted", null, null, "2026-10-29T12:00:00Z", now);
  eq(now + 86_400_000L, allowance.resetAt); eq("allowance_exhausted", allowance.limitCode);
  // Out-of-bounds waits, malformed codes and stale or distant resets are dropped.
  eq(null, CloudVoiceLimit.read("999999", null, null, null, null, now).retryAfterSeconds);
  eq(null, CloudVoiceLimit.read("soon", "Rate Limited!", -1, "tomorrow", "2026-10-28T11:00:00Z", now).retryAfterSeconds);
  eq(null, CloudVoiceLimit.read(null, "PRIVATE_PROVIDER_BODY_SENTINEL", null, null, null, now).limitCode);
  eq(null, CloudVoiceLimit.read(null, null, null, null, "2028-10-28T12:00:00Z", now).resetAt);
  eq(null, CloudVoiceLimit.read(null, null, null, null, "2026-10-28T11:00:00Z", now).resetAt);
  System.out.println("PASS Cloud voice 429 retry facts");
 }
}
