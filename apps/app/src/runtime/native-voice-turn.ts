import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { setNativeVoiceStageSink } from './voice-timing';
import { nativeVoiceStageSink, readNativeVoiceTiming as readBridgeTiming, type NativeVoiceTimingPort } from '../../../../.eliza/client-features/packages/voice/src/native-live-voice.ts';

/**
 * Issue #395: Alpha's binding of the shared native voice-turn sink (`@elizaos/voice/native-live`)
 * to the AlphaVoiceCloud bridge's latency collector (LocalSpeechBridgePlugin.markVoiceTurn,
 * VoiceLatencyTrials). The renderer reports only a stage name and the native turn id it was given;
 * the native side stamps the monotonic time on arrival. No text, account or conversation id is sent.
 */
const plugin = () => registerPlugin<NativeVoiceTimingPort>('AlphaVoiceCloud');
const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaVoiceCloud');
let installed = false;

/** On the phone, forward conversation stage marks to the native collector. Idempotent. */
export function installNativeVoiceTurnMarks() {
  if (installed || !available()) return;
  installed = true;
  setNativeVoiceStageSink(nativeVoiceStageSink(plugin()));
}

/**
 * The native timing export (alpha-native-voice-timing-v3) for diagnostics, or null when it is not
 * available within the time limit. buildDiagnostics copies timing fields only.
 */
export async function readNativeVoiceTiming(timeoutMs = 10_000): Promise<unknown> {
  if (!available()) return null;
  return readBridgeTiming(plugin(), timeoutMs);
}
