/**
 * The retry facts of a Cloud speech HTTP 429 (voice-http-429), never its text: the same rules as
 * the native CloudVoiceLimit.java, for the development browser-resident route (the Vite bridge
 * reads Cloud's response; the page reads the bridge's). Cloud's plan limiter answers `Retry-After`
 * and `{error:{code,retryAfterSeconds,retryAt}}`; an allowance refusal may carry `resetAt`. Only a
 * short lower-case limit code, a bounded wait and a bounded reset instant are kept.
 *
 * Function exports only: Node contract tests and the Vite bridge evaluate this source directly.
 */
export type CloudVoiceLimitFacts = { retryAfterSeconds?: number; limitCode?: string; resetAt?: number };
const MAX_RETRY_AFTER_SECONDS = 86_400;
const MAX_RESET_MS = 400 * 86_400_000;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function waitSeconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const seconds = Math.ceil(value);
  return seconds > MAX_RETRY_AFTER_SECONDS ? undefined : Math.max(1, seconds);
}
function isoInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) return undefined;
  const at = Date.parse(value.trim());
  return Number.isFinite(at) ? at : undefined;
}

/** Reads the facts from a 429's `Retry-After` header and parsed JSON body (either may be absent). */
export function readCloudVoiceLimit(retryAfterHeader: string | null | undefined, body: unknown, now: number = Date.now()): CloudVoiceLimitFacts {
  const top = record(body), row = record(top?.error) ?? top;
  const out: CloudVoiceLimitFacts = {};
  let wait = typeof row?.retryAfterSeconds === 'number' ? waitSeconds(row.retryAfterSeconds) : undefined;
  const header = typeof retryAfterHeader === 'string' ? retryAfterHeader.trim() : '';
  if (wait === undefined && /^\d{1,9}$/.test(header)) wait = waitSeconds(Number(header));
  if (wait === undefined && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) {
    const at = Date.parse(header);
    if (Number.isFinite(at) && at > now) wait = waitSeconds((at - now) / 1000);
  }
  if (wait === undefined) {
    const at = isoInstant(row?.retryAt);
    if (at !== undefined && at > now) wait = waitSeconds((at - now) / 1000);
  }
  if (wait !== undefined) out.retryAfterSeconds = wait;
  if (typeof row?.code === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(row.code)) out.limitCode = row.code;
  const reset = isoInstant(row?.resetAt);
  if (reset !== undefined && reset > now && reset - now <= MAX_RESET_MS) out.resetAt = reset;
  return out;
}

/** The facts a voice error carries (the native plugin's reject data, or the browser route's), validated again. */
export function cloudVoiceLimitOf(error: unknown): CloudVoiceLimitFacts | null {
  const row = record(error);
  if (!row || row.code !== 'voice-http-429') return null;
  const data = record(row.data) ?? {};
  const out: CloudVoiceLimitFacts = {};
  const seconds = data.retryAfterSeconds;
  if (typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS) out.retryAfterSeconds = seconds;
  if (typeof data.limitCode === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(data.limitCode)) out.limitCode = data.limitCode;
  if (typeof data.resetAt === 'number' && Number.isSafeInteger(data.resetAt) && data.resetAt > 0) out.resetAt = data.resetAt;
  return out;
}
