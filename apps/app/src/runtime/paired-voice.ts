import { playOwnedSpeech } from '../local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import { connectionController } from './connection-ui';
import { createNativeSpeechRequests } from '../../../../.eliza/client-features/packages/voice/src/native-speech-request.ts';
type Binding = { origin: string; ownerId: string; expiresAt: number; sessionId: string };
const native = registerPlugin<{
  pairedVoiceStatus(input: Binding & { requestId: string }): Promise<{ ready: boolean }>;
  pairedTranscriptionStatus(input: Binding & { requestId: string }): Promise<{ ready: boolean; provider: string }>;
  transcribePairedRecording(input: Binding & { recordingId: string; requestId: string }): Promise<{ text: string; local: true; provider: string }>;
  synthesizePaired(input: Binding & { text: string; requestId: string }): Promise<{ playbackId: string }>;
  synthesizeBrowserReading(input: Binding & { readingToken: string; requestId: string }): Promise<{ playbackId: string }>;
  play(input: { playbackId: string }): Promise<void>;
  stopPlayback(input:{requestId:string;playbackId?:string}): Promise<void>;
  cancel(input: { requestId: string }): Promise<void>;
  addListener(event: 'playbackEnded' | 'playbackFailed' | 'playbackStopped', callback: (value:{playbackId?:string}) => void): Promise<PluginListenerHandle>;
}>('AlphaVoiceCloud');
/** Explicit selected-agent speech operations. Native code owns credentials and audio. */
export function createPairedVoice() {
  const binding = connectionController.getPairedVoiceBinding();
  if (!binding) return null;
  const check = () => {
    if (JSON.stringify(connectionController.getPairedVoiceBinding()) !== JSON.stringify(binding) || connectionController.getSnapshot().open || document.hidden) throw new DOMException('Voice connection changed', 'AbortError');
  };
  // One owned bridge request per operation (shared `@elizaos/voice/native-speech`).
  const operation = createNativeSpeechRequests({
    check,
    watch(onChange) {
      const unsubscribe = connectionController.subscribe(onChange);
      document.addEventListener('visibilitychange', onChange);
      return () => { document.removeEventListener('visibilitychange', onChange); unsubscribe(); };
    },
    cancel: requestId => native.cancel({ requestId }),
    cancelledMessage: 'Playback cancelled',
  });
  return {
    async ready(signal: AbortSignal) { return operation(signal, async (requestId, interrupted) => { const pending = native.pairedVoiceStatus({ ...binding, requestId }); if (signal.aborted) void native.cancel({requestId}); return (await Promise.race([pending, interrupted])).ready === true; }); },
    async transcriptionReady(signal: AbortSignal) { return operation(signal, async (requestId, interrupted) => { const pending = native.pairedTranscriptionStatus({ ...binding, requestId }); if (signal.aborted) void native.cancel({requestId}); const result = await Promise.race([pending, interrupted]); return result.ready === true && result.provider === 'local-inference'; }); },
    async transcribe(recordingId: string, signal: AbortSignal) { return operation(signal, async (requestId, interrupted) => { const pending = native.transcribePairedRecording({ ...binding, recordingId, requestId }); if (signal.aborted) void native.cancel({requestId}); const result = await Promise.race([pending, interrupted]); if (result.local !== true || result.provider !== 'local-inference' || typeof result.text !== 'string' || !result.text.trim()) throw new Error('Selected agent returned no usable transcript'); return result; }); },
    async speak(text: string, signal: AbortSignal, readingToken?: string) {
      return operation(signal, async (_requestId, interrupted, ownedSignal) => {
        await Promise.race([playOwnedSpeech(native,ownedSignal,requestId=>readingToken?native.synthesizeBrowserReading({...binding,readingToken,requestId}):native.synthesizePaired({...binding,text,requestId}),check),interrupted]);
      });
    },
  };
}
