/**
 * Live voice client (#423): the app process captures the microphone and runs Silero VAD (on
 * Android the shared ai.eliza.voice LiveVoiceCapture in AlphaVoiceCloudPlugin), and the resident
 * agent transcribes the stream on this device (`POST /api/asr/local-inference/live`). Nothing here
 * leaves the phone. The implementation is the shared upstream `@elizaos/voice/live-session` client,
 * authenticated and projected from the reviewed pin. Alpha keeps this module path for its
 * adapter, native transport and tests; it adds no behavior of its own.
 */
export {
  createLiveDictation,
  createLiveVoiceSession,
  encodeLiveFrame,
  LIVE_ASR_PATH,
  LIVE_ASR_STATUS_PATH,
  LIVE_SAMPLE_RATE,
  parseLiveFinal,
  liveAssistantListener,
  parseVoiceTranscriptEnvelope,
  webSocketAgentEvents,
  type LiveCaptureOpener,
  type LiveCaptureOpenOptions,
  type LiveCaptureStream,
  type LiveDictation,
  type LiveDictationClip,
  type LiveAudioFrame,
  type LiveFinal,
  type LiveMode,
  type LiveTranscriptEvent,
  type LiveVadEdge,
  type LiveVoiceLatency,
  type LiveVoiceSession,
  type LiveVoiceSessionOptions,
  type LiveVoiceTransport,
} from '../../../../.eliza/client-features/packages/voice/src/live-voice-session.ts';
