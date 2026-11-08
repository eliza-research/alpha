import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { connectionController } from './connection-ui';
import { createNativeLiveVoice, type NativeLiveCapturePort, type NativeResidentBinding } from '../../../../.eliza/client-features/packages/voice/src/native-live-voice.ts';
import type { LiveVoiceLatency } from './live-voice';

/**
 * Alpha's binding of the shared native live transport (`@elizaos/voice/native-live`, projected
 * from the reviewed pin) to the AlphaVoiceCloud bridge: continuous app-process capture with
 * Silero VAD feeding the resident agent's on-device streaming ASR. The shared transport owns the
 * capture ids, owner fences, interim gating, stop reconciliation and both routes; Alpha supplies
 * only the bridge name and its resident binding (the live route of the current resident session
 * and the owner the bridge binds its native segment transport to).
 */
const plugin = registerPlugin<NativeLiveCapturePort>('AlphaVoiceCloud');
const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaVoiceCloud');
/** The resident session's live route, with its owner only while both name the same session. */
function resident(): NativeResidentBinding | null {
  const live = connectionController.getResidentLiveVoice();
  if (!live) return null;
  const owner = connectionController.getResidentReadingBinding();
  return { ...live, ...(owner && owner.sessionId === live.sessionId ? { ownerId: owner.ownerId } : {}) };
}
const voice = createNativeLiveVoice({ port: plugin, available, resident });

/** The live route is usable: the native capture with VAD is present and the agent reports a streaming loader. */
export function nativeLiveVoiceReady(signal: AbortSignal): Promise<boolean> { return voice.ready(signal); }
/** Opens one native capture and its agent live session. */
export const openNativeLiveStream = voice.open;
/** The voice assistant's listen port over the native capture (echo-cancelled; shared `liveAssistantListener`). */
export function nativeAssistantListener(options: { roomId?: string; onInterim?: (text: string) => void; onLatency?: (latency: LiveVoiceLatency) => void } = {}) {
  return voice.assistantListener(options);
}
/**
 * Transcribe (dictation) over the native live capture, the shared `createLiveDictation`: Stop
 * finalizes exactly the audio up to Stop and the text only ever becomes an editable draft.
 */
export function createNativeLiveDictation(options: { roomId?: string; onInterim?: (text: string) => void; onLatency?: (latency: LiveVoiceLatency) => void; maxDurationMs?: number } = {}) {
  return voice.dictation(options);
}
export type NativeLiveDictation = ReturnType<typeof createNativeLiveDictation>;
