import { cloudRuntimeEnabled, testMocksEnabled } from '../build-flags';
import { browserDevProfile } from '../browser/dev-profile';
import { connectionController } from './connection-ui';

/** The native profile stays on-device; the explicit Cloud profile requires Cloud sign-in.
 * Neither deployment silently falls back to the other speech route. */
// Plain constants and function exports only: Node contract tests evaluate this source directly.
const voiceRouteKey = 'alphaphone:voice-route:v1';
const voicePreferencesEvent = 'alpha:voice-preferences';
/** Storage keys and the change event, for Settings and diagnostics. */
export function voicePreferenceKeys() { return { route: voiceRouteKey, event: voicePreferencesEvent }; }
export type VoiceRouteChoice = 'device' | 'cloud';
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

function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function read(key: string): unknown { try { const raw = storage()?.getItem(key); return raw == null ? null : JSON.parse(raw); } catch { return null; } }
function write(key: string, value: object): boolean {
  const text = JSON.stringify(value);
  try { const store = storage(); if (!store) return false; store.setItem(key, text); if (store.getItem(key) !== text) return false; }
  catch { return false; }
  try { if (typeof window !== 'undefined' && typeof Event === 'function') window.dispatchEvent(new Event(voicePreferencesEvent)); } catch { /* Notification is advisory. */ }
  return true;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** The persisted route. Anything but a complete, disclosed Cloud record reads as on-device. */
export function voiceRoutePreference(): VoiceRouteChoice {
  if (cloudRuntimeEnabled) return 'cloud';
  if (!testMocksEnabled) return 'device';
  const value = record(read(voiceRouteKey));
  // 'cloud-speech-uses-credits' is the disclosure id earlier builds stored; it reads as the same choice.
  return value && value.version === 1 && value.route === 'cloud' && (value.disclosed === 'cloud-speech-uses-plan' || value.disclosed === 'cloud-speech-uses-credits') && Number.isFinite(value.chosenAt) ? 'cloud' : 'device';
}
/**
 * Persist an explicit route choice. Cloud requires the caller to have shown the Cloud speech
 * disclosure. Returns false when the choice could not be confirmed in storage; the
 * route then stays on-device.
 */
export function chooseVoiceRoute(route: VoiceRouteChoice, disclosure?: { disclosed: 'cloud-speech-uses-plan' }): boolean {
  if (cloudRuntimeEnabled) return route === 'cloud' && disclosure?.disclosed === 'cloud-speech-uses-plan';
  if (!testMocksEnabled && route !== 'device') return false;
  if (route === 'cloud' && disclosure?.disclosed !== 'cloud-speech-uses-plan') return false;
  return write(voiceRouteKey, route === 'cloud' ? { version: 1, route, disclosed: disclosure!.disclosed, chosenAt: Date.now() } : { version: 1, route: 'device', chosenAt: Date.now() });
}
/** Disclosure shown wherever Cloud speech can be chosen. */
export function cloudSpeechDisclosure(serviceName = 'Cloud') { return `${serviceName} speech uploads recordings and reply text to your Cloud account and counts toward your plan allowance.`; }

/** A usable Cloud speech account is signed in for this renderer. */
export function cloudVoiceAvailable(): boolean {
  return (cloudRuntimeEnabled || testMocksEnabled) && !browserDevProfile && connectionController.getCloudEnvironment() !== null && connectionController.getCloudClient() !== null;
}

/** Explicit local/manual routes are available only in test-mocks builds. */
export function selectVoiceRoute(preference: VoicePreference = 'default'): 'device' | 'cloud' | 'agent' | 'manual' {
  if (cloudRuntimeEnabled) return 'cloud';
  if (!testMocksEnabled) return 'device';
  if (testMocksEnabled && (preference === 'device' || preference === 'manual')) return preference;
  return 'cloud';
}
