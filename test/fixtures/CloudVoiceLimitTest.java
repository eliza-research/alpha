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
  // Only Cloud's pre-admission cache-warming 503 is replayed, after Retry-After capped at 2 s.
  for (String code : new String[] {"auth_cache_warming", "rate_limit_cache_warming", "inference_dependency_cache_warming", "billing_cache_warming", "inference_admission_cache_warming"})
   eq(1_000L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read("1", code, null, null, null, now)));
  eq(1_000L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read(null, "auth_cache_warming", null, null, null, now)));
  eq(2_000L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read("30", "auth_cache_warming", null, null, null, now)));
  eq(2_000L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read(null, "billing_cache_warming", 600, null, null, now)));
  // A generic 503 may follow admission; it and every other code are never replayed.
  eq(-1L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read("1", "service_unavailable", 1, null, null, now)));
  eq(-1L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read("1", null, null, null, null, now)));
  eq(-1L, CloudVoiceLimit.warmingWaitMs(CloudVoiceLimit.read("1", "rate_limited", null, null, null, now)));
  eq(-1L, CloudVoiceLimit.warmingWaitMs(null));
  System.out.println("PASS Cloud voice 429 retry facts");
 }
}
