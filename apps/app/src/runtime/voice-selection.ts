import { cloudRuntimeEnabled, testMocksEnabled } from '../build-flags';
import { connectionController } from './connection-ui';

/** The native profile stays on-device; the explicit Cloud profile requires Cloud sign-in.
 * Neither deployment silently falls back to the other speech route. */
// Plain constants and function exports only: Node contract tests evaluate this source directly.
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

/** Explicit local/manual routes are available only in test-mocks builds. */
export function selectVoiceRoute(preference: VoicePreference = 'default'): 'device' | 'cloud' | 'agent' | 'manual' {
  if(connectionController.getSnapshot().residentInference==='direct'&&(preference==='default'||preference==='agent'))return 'cloud';
  if (cloudRuntimeEnabled) return 'cloud';
  if (!testMocksEnabled) return 'device';
  if (testMocksEnabled && (preference === 'device' || preference === 'manual')) return preference;
  return 'cloud';
}
