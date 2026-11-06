import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { createOnDeviceVoice } from './local-voice';
import { createPairedVoice } from './paired-voice';
import { createCloudVoice } from './cloud-voice';
import { selectVoiceRoute } from './voice-selection';
import { browserDevProfile } from '../browser/dev-profile';
import { developmentCloudVoiceEnabled } from './development-cloud-voice';
import type { NoteRecorderDriver, NoteRecordingStatus, SavedNoteAudio, SegmentTranscriber } from '../prototype/note-recorder';
import type { TranscriptProvenance } from './voice-states';

/**
 * The Notes recorder (native AlphaNoteRecorder, or the browser's MediaRecorder) behind the
 * AlphaVoiceCloud plugin. No length limit: Stop, Discard, low storage or an error end it.
 */
const native = registerPlugin<{
  startNoteRecording(): Promise<NoteRecordingStatus>;
  noteRecordingStatus(): Promise<NoteRecordingStatus>;
  pauseNoteRecording(input: { recordingId: string }): Promise<NoteRecordingStatus>;
  resumeNoteRecording(input: { recordingId: string }): Promise<NoteRecordingStatus>;
  stopNoteRecording(input: { recordingId: string }): Promise<NoteRecordingStatus>;
  discardNoteRecording(input: { recordingId: string }): Promise<NoteRecordingStatus>;
  setNoteSegmentText(input: { recordingId: string; segmentId: string; text: string }): Promise<void>;
  saveNoteRecording(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedNoteAudio>;
  addListener(event: 'noteRecordingChanged', callback: (status: NoteRecordingStatus) => void): Promise<{ remove(): Promise<void> }>;
}>('AlphaVoiceCloud');

export function createNoteRecorderDriver(): NoteRecorderDriver {
  return {
    start: () => native.startNoteRecording(),
    status: () => native.noteRecordingStatus(),
    pause: recordingId => native.pauseNoteRecording({ recordingId }),
    resume: recordingId => native.resumeNoteRecording({ recordingId }),
    stop: recordingId => native.stopNoteRecording({ recordingId }),
    discard: recordingId => native.discardNoteRecording({ recordingId }),
    setText: (recordingId, segmentId, text) => native.setNoteSegmentText({ recordingId, segmentId, text }),
    save: input => native.saveNoteRecording(input),
    listen: callback => native.addListener('noteRecordingChanged', callback),
  };
}

/** An empty result is a quiet segment, not a failure of the route. */
const silence = (error: unknown) => (error as { code?: string })?.code === 'no-speech' || /no usable|heard no speech/i.test(String((error as Error)?.message || ''));

/**
 * The transcription route for Notes segments, chosen as the recorder's voice route is: on-device,
 * the paired agent or Cloud. Every segment is under 30 s, inside each route's request bound.
 * Null when no route is ready: the recording is then saved with its audio only. Throws
 * `sign-in` when the Cloud route has no signed-in account.
 */
export async function noteSegmentTranscriber(signal: AbortSignal): Promise<{ transcribe: SegmentTranscriber; provenance: TranscriptProvenance } | null> {
  const selected = selectVoiceRoute('default');
  const wrap = (run: (segmentId: string, signal: AbortSignal) => Promise<{ text: string }>): SegmentTranscriber => async (segmentId, owned) => {
    try { return (await run(segmentId, owned)).text; } catch (error) { if (silence(error)) return ''; throw error; }
  };
  if (selected === 'cloud') {
    let cloud: ReturnType<typeof createCloudVoice>;
    try { cloud = createCloudVoice(); } catch (error) { throw Object.assign(new Error('Cloud transcription needs sign-in'), { code: 'sign-in', cause: error }); }
    return {
      provenance: { route: developmentCloudVoiceEnabled ? 'development-agent' : 'eliza-cloud' },
      transcribe: wrap(async (recordingId, owned) => {
        const requestId = crypto.randomUUID(), cancel = () => { void cloud.cancel({ requestId }).catch(() => {}); };
        owned.addEventListener('abort', cancel, { once: true });
        try { return await cloud.transcribeRecording({ recordingId, requestId }); } finally { owned.removeEventListener('abort', cancel); }
      }),
    };
  }
  if (selected === 'device' || (browserDevProfile && selected === 'agent')) {
    const local = createOnDeviceVoice();
    if (!local || !await local.ready(signal).catch(() => false)) return null;
    return { provenance: { route: Capacitor.isNativePlatform() ? 'on-device' : 'browser' }, transcribe: wrap((id, owned) => local.transcribe(id, owned)) };
  }
  if (selected === 'agent') {
    const paired = createPairedVoice();
    if (!paired || !await paired.transcriptionReady(signal).catch(() => false)) return null;
    return { provenance: { route: 'paired-agent' }, transcribe: wrap((id, owned) => paired.transcribe(id, owned)) };
  }
  return null;
}
