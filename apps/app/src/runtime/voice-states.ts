/** Pure recorder state helpers: failure classification and transcript provenance. */
export type VoiceFailure = 'denied' | 'no-microphone' | 'no-speech' | 'local-agent' | 'recognition';
export type TranscriptProvenance = { route: string; engine?: string; model?: string; modelRevision?: string; runtime?: string; language?: string };
type Reason = { name?: unknown; code?: unknown } | null | undefined;

/**
 * Failures with their own state and guidance. Anything else keeps the caller's generic,
 * route-specific message. Cancellation is never reported as a failure here.
 */
export function voiceFailure(reason: unknown, context: { transcribing: boolean; browser: boolean; cloud?: boolean; serviceName?: string }): { kind: VoiceFailure; message: string } | null {
  const value = (reason && typeof reason === 'object' ? reason : undefined) as Reason;
  const name = typeof value?.name === 'string' ? value.name : '', code = typeof value?.code === 'string' ? value.code : '';
  if (name === 'AbortError') return null;
  // Android's AlphaVoiceCloud rejects a refused RECORD_AUDIO request with code 'permission-denied'.
  if (!context.transcribing && (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' || code === 'permission-denied'))
    return { kind: 'denied', message: context.browser
      ? 'Microphone access is blocked. Allow the microphone for this site in your browser’s site settings, then choose Start recording again, or use the keyboard instead. Nothing was recorded.'
      : 'Microphone access is off. Choose Open app settings and allow the microphone for Alpha in Android settings, then choose Start recording again, or use the keyboard instead. Nothing was recorded.' };
  if (!context.transcribing && (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError'))
    return { kind: 'no-microphone', message: 'No usable microphone was found. Connect or enable a microphone, then choose Start recording again.' };
  // The Cloud route renders no typing choice (P-39 keeps the conversation spoken; the keyboard stays a separate entry), so its
  // wording offers only what is on screen: the kept clip, Transcribe again and Record again.
  if (code === 'no-speech' && context.cloud)
    return { kind: 'no-speech', message: `${context.serviceName ?? 'Cloud'} heard no speech in this recording. Your recording is kept. Choose Transcribe with ${context.serviceName ?? 'Cloud'} to try again, or Record again.` };
  if (code === 'no-speech')
    return { kind: 'no-speech', message: 'No speech was detected in this recording. Record again, or type the transcript instead.' };
  // The web build has no in-browser recognizer; local speech needs the local agent (libelizainference).
  if (code === 'local-agent-required')
    return { kind: 'local-agent', message: 'Local transcription needs the local agent on this computer. Connect it and choose Transcribe again, or type the transcript instead. Your recording is kept.' };
  if (code === 'local-agent-starting')
    return { kind: 'local-agent', message: 'Your agent is starting. Speech is available once it is running; choose Transcribe again then, or type the transcript instead. Your recording is kept.' };
  if (code === 'recognition-failed')
    return { kind: 'recognition', message: 'Speech recognition failed for this recording. Choose Transcribe again, or type the transcript instead. Your recording is kept.' };
  return null;
}

/**
 * The recorder's recovery control for a refused microphone. On the phone the denied message tells
 * the owner to choose "Open app settings", so that control must exist; a browser's message names
 * the browser's own site settings and gets none.
 */
export const DENIED_SETTINGS_LABEL = 'Open app settings';
export function deniedSettingsChoice(input: { failure: string; stage: string; busy: boolean; native: boolean }): boolean {
  return input.native && input.failure === 'denied' && input.stage === 'ready' && !input.busy;
}

const field = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
/** Where a transcript came from. Only fields reported by the engine are recorded, never guessed. */
export function transcriptProvenance(result: Record<string, unknown>, route: { onDevice: boolean; native: boolean; paired: boolean; cloud: boolean }): TranscriptProvenance {
  const reported = field(result.route);
  const name = route.cloud ? 'eliza-cloud' : route.paired ? 'paired-agent' : route.onDevice ? (route.native ? 'on-device' : reported || 'browser') : 'development-agent';
  const provenance: TranscriptProvenance = { route: name };
  for (const key of ['engine', 'model', 'modelRevision', 'runtime', 'language'] as const) { const value = field(result[key]); if (value) provenance[key] = value; }
  return provenance;
}
