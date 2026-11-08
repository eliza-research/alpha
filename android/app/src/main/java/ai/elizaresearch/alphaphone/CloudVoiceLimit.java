package ai.elizaresearch.alphaphone;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;

/**
 * The retry facts of a Cloud speech HTTP 429, never its text. Cloud's plan limiter answers
 * `Retry-After` and a JSON body `{error:{code,retryAfterSeconds,retryAt,...}}`; an allowance
 * refusal may carry `resetAt`. Only a short lower-case limit code, a bounded wait and a bounded
 * reset instant cross to the renderer; messages, plan ids and provider bodies stay here.
 */
final class CloudVoiceLimit {
 /** Longest wait shown as a countdown (a day); longer hints are dropped. */
 static final int MAX_RETRY_AFTER_SECONDS = 86_400;
 /** Longest reset a billing-period allowance can name (a period plus slack). */
 static final long MAX_RESET_MS = 400L * 86_400_000L;
 private static final Pattern CODE = Pattern.compile("[a-z][a-z0-9_]{0,39}");
 private static final Pattern SECONDS = Pattern.compile("\\d{1,9}");
 private static final Pattern HTTP_DATE = Pattern.compile("[A-Z][a-z]{2}, \\d{2} [A-Z][a-z]{2} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT");

 final Integer retryAfterSeconds;
 final String limitCode;
 final Long resetAt;

 private CloudVoiceLimit(Integer retryAfterSeconds, String limitCode, Long resetAt) {
  this.retryAfterSeconds = retryAfterSeconds;
  this.limitCode = limitCode;
  this.resetAt = resetAt;
 }

 /**
  * @param retryAfterHeader the raw `Retry-After` header (seconds or an IMF-fixdate), or null
  * @param code the body's `error.code` (or top-level `code`), or null
  * @param bodySeconds the body's `error.retryAfterSeconds`, or null
  * @param retryAt the body's `error.retryAt` (ISO 8601), or null
  * @param reset the body's `error.resetAt` (ISO 8601), or null
  */
 static CloudVoiceLimit read(String retryAfterHeader, String code, Number bodySeconds, String retryAt, String reset, long now) {
  Integer wait = seconds(bodySeconds);
  if (wait == null) wait = headerSeconds(retryAfterHeader, now);
  if (wait == null) {
   Long at = instant(retryAt);
   if (at != null && at > now) wait = clampSeconds((at - now + 999) / 1000);
  }
  Long resetInstant = instant(reset);
  if (resetInstant != null && (resetInstant <= now || resetInstant - now > MAX_RESET_MS)) resetInstant = null;
  String limitCode = code != null && CODE.matcher(code).matches() ? code : null;
  return new CloudVoiceLimit(wait, limitCode, resetInstant);
 }

 private static Integer seconds(Number value) {
  if (value == null) return null;
  double d = value.doubleValue();
  if (!Double.isFinite(d) || d < 0) return null;
  return clampSeconds((long) Math.ceil(d));
 }

 private static Integer clampSeconds(long value) {
  if (value < 0 || value > MAX_RETRY_AFTER_SECONDS) return null;
  return (int) Math.max(1, value);
 }

 private static Integer headerSeconds(String header, long now) {
  if (header == null) return null;
  String value = header.trim();
  if (SECONDS.matcher(value).matches()) return clampSeconds(Long.parseLong(value));
  if (!HTTP_DATE.matcher(value).matches()) return null;
  try {
   long at = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();
   return at > now ? clampSeconds((at - now + 999) / 1000) : null;
  } catch (RuntimeException invalid) {
   return null;
  }
 }

 private static Long instant(String value) {
  if (value == null || value.length() > 64) return null;
  try {
   return Instant.parse(value.trim()).toEpochMilli();
  } catch (RuntimeException invalid) {
   return null;
  }
 }
}
