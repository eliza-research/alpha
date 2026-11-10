import { testMocksEnabled } from '../build-flags';
import { connectionController } from './connection-ui';

/** One build ships the on-device speech models; the speech route is chosen at run time.
 * `speechRoute()` is the single source: the owner's Cartesia key, Cloud speech for a signed-in
 * account with no active plan limit, otherwise this phone. A Cloud or direct attempt that fails
 * before audio flows falls back to on-device speech for that turn (owner decision 2026-11-10). */
// Plain constants and function exports only: Node contract tests evaluate this source directly.
const voiceRouteKey = 'alphaphone:voice-route:v1';
const voicePreferencesEvent = 'alpha:voice-preferences';
/** Storage keys and the change event, for Settings and diagnostics. */
export function voicePreferenceKeys() { return { route: voiceRouteKey, event: voicePreferencesEvent }; }
export type VoicePreference = 'default' | 'device' | 'agent' | 'manual';
/**
 * When a spoken turn is sent. 'auto-send' (today's behaviour) sends each finished Cloud
 * conversation transcript as it is; 'review' shows it for editing and an explicit Send first.
 * P-39 (MVP-01) decided the split: the voice assistant submits automatically, while Transcribe
 * only inserts editable text the user sends. This constant is the one switch for the former.
 */
export type VoiceSendPolicy = 'auto-send' | 'review';
const VOICE_SEND_POLICY: VoiceSendPolicy = 'auto-send';
let voiceSendPolicyForTests: VoiceSendPolicy | undefined;
export function voiceSendPolicy(): VoiceSendPolicy { return testMocksEnabled && voiceSendPolicyForTests ? voiceSendPolicyForTests : VOICE_SEND_POLICY; }
/** Test-mocks builds only: exercise either policy. A flag-off build always uses the constant. */
export function setVoiceSendPolicyForTests(policy?: VoiceSendPolicy): boolean {
  if (!testMocksEnabled) return false;
  voiceSendPolicyForTests = policy === 'auto-send' || policy === 'review' ? policy : undefined;
  return true;
}

/**
 * The Clef end-of-turn stage (P-39 names Clef for semantic turn completion; #663 / H-18 holds the
 * owner decision). Off: the local fused scorer and the long gap decide, and no transcript text
 * leaves the phone for endpointing. Turning it on also needs a Cloud Clef client, which the
 * renderer does not hold (native code owns the Cloud credential), so the stage stays out until
 * the owner admits a model and that client exists. This constant is the one switch.
 */
const CLEF_ENDPOINT_ENABLED = false;
/** The Clef stage for `createEndpointChain`: built only with the switch on AND a client. */
export function clefEndpointStage(): { enabled: boolean; client: null } { return { enabled: CLEF_ENDPOINT_ENABLED, client: null }; }

export type SpeechRoute = 'device' | 'cloud' | 'direct';
/** How long a stored limit with no stated wait keeps speech off Cloud. */
const UNTIMED_RATE_LIMIT_MS = 60_000;
/**
 * A stored Cloud plan or rate limit (connectionController lastServiceLimit) that is still in
 * force. A rate limit lapses after its stated wait; an allowance, plan or billing refusal holds
 * until its reset, or until the account's limit record is cleared by a successful request.
 */
export function cloudSpeechLimited(now: number = Date.now()): boolean {
  const limit = connectionController.getSnapshot().lastServiceLimit;
  if (!limit) return false;
  if (typeof limit.resetsAt === 'number' && limit.resetsAt > now) return true;
  const observedAt = typeof limit.observedAt === 'number' ? limit.observedAt : now;
  if (typeof limit.retryAfterMs === 'number') return observedAt + limit.retryAfterMs > now;
  if (limit.kind === 'rate-limited') return observedAt + UNTIMED_RATE_LIMIT_MS > now;
  // No stated wait: a lapsed reset means the allowance is back; a plan or billing refusal stands.
  return limit.resetsAt == null;
}
/** The account or key a network speech hold belongs to; a different one is not held. */
function networkSpeechKey(): string | null {
  const current = connectionController.getSnapshot();
  if (current.residentInference === 'direct') return current.providerStatus?.voiceConfigured === true ? `direct:${String(current.providerStatus?.revision ?? '')}` : null;
  const credentialId = connectionController.getCloudClient()?.credentialId;
  return connectionController.getCloudEnvironment() !== null && credentialId ? `cloud:${credentialId}` : null;
}
let networkSpeechHold: { key: string; until: number } | undefined;
const HOLD_BRIEF_MS = 60_000, HOLD_ACCOUNT_MS = 600_000, HOLD_MAX_MS = 3_600_000;
/**
 * How long a failed Cloud or direct speech request keeps speech on this phone, or null when the
 * failure is not the network route's (cancelled, unconfirmed cleanup, no speech, a refused
 * request body): offline and 5xx briefly, sign-in, billing, plan and missing-route refusals
 * longer, a 429 for its stated wait. Codes only; no provider text is read.
 */
export function networkSpeechFailureHoldMs(error: unknown): number | null {
  const row = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; data?: unknown } : null;
  if (!row || row.name === 'AbortError' || row.code === 'speech-cleanup-unconfirmed' || row.code === 'no-speech') return null;
  const code = typeof row.code === 'string' ? row.code : '';
  const http = /^(?:voice|cloud)-http-([1-5][0-9]{2})$/.exec(code);
  if (http) {
    const status = Number(http[1]);
    if (status === 429) {
      const wait = row.data && typeof row.data === 'object' ? (row.data as { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined;
      return typeof wait === 'number' && Number.isFinite(wait) && wait > 0 ? Math.min(HOLD_MAX_MS, Math.ceil(wait) * 1000) : HOLD_BRIEF_MS;
    }
    if (status === 401 || status === 402 || status === 403 || status === 404) return HOLD_ACCOUNT_MS;
    if (status === 408 || status >= 500) return HOLD_BRIEF_MS;
    return null;
  }
  if (code === 'sign-in') return 0;
  // Batch connect and upload failures, and the streaming bridge's failures before or between turns.
  if (['voice-stt-connect', 'voice-tts-connect', 'voice-stt-upload', 'connect', 'connection-lost', 'startup-timeout', 'unavailable'].includes(code)) return HOLD_BRIEF_MS;
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return HOLD_BRIEF_MS; } catch { /* No navigator. */ }
  return error instanceof TypeError ? HOLD_BRIEF_MS : null;
}
/**
 * Records a failed network speech request. True when the turn should use on-device speech
 * instead; the next turns then skip the network until the hold lapses or the account changes.
 */
export function noteNetworkSpeechFailure(error: unknown, now: number = Date.now()): boolean {
  const hold = networkSpeechFailureHoldMs(error);
  if (hold === null) return false;
  const key = networkSpeechKey();
  if (key && hold > 0) networkSpeechHold = { key, until: now + hold };
  return true;
}
/** On-device speech turned out to be unavailable: the network route is all there is, so it is not held. */
export function clearNetworkSpeechHold() { networkSpeechHold = undefined; }
/**
 * The speech route now. `direct`: the owner's own provider with a Cartesia key. `cloud`: a
 * signed-in Cloud account with a usable credential and no limit in force. Otherwise `device`
 * (on-device Paradee TTS and Phonon-2 ASR). Own keys without a Cartesia key stay on this phone:
 * the owner chose not to use Cloud.
 */
export function speechRoute(now: number = Date.now()): SpeechRoute {
  const key = networkSpeechKey();
  if (!key) return 'device';
  if (networkSpeechHold && networkSpeechHold.key === key && networkSpeechHold.until > now) return 'device';
  if (key.startsWith('direct:')) return 'direct';
  return cloudSpeechLimited(now) ? 'device' : 'cloud';
}

/**
 * The recorder's shape of the route: network speech ('cloud', Cloud or the owner's key) or this
 * phone. Test-mocks builds keep their explicit device/manual routes and default to network speech.
 */
export function selectVoiceRoute(preference: VoicePreference = 'default'): 'device' | 'cloud' | 'agent' | 'manual' {
  if (testMocksEnabled && (preference === 'device' || preference === 'manual')) return preference;
  const route = speechRoute();
  // Dictation on own keys asks for the phone and keeps it.
  if (route === 'direct') return preference === 'device' ? 'device' : 'cloud';
  if (route === 'cloud' || testMocksEnabled) return 'cloud';
  return 'device';
}
