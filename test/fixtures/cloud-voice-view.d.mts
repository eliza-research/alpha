import type { NoteRecorderDriver, NoteRecordingBinding, NoteRecordingStatus, NoteRecorderSession, SavedNoteAudio } from '../../apps/app/src/prototype/note-recorder.ts';
import type { NotesRecorderControl } from '../../apps/app/src/prototype/notes-recorder-control.ts';
import type { createCloudVoice } from '../../apps/app/src/runtime/cloud-voice.ts';
import type { createNoteRecorderDriver, noteSegmentTranscriber } from '../../apps/app/src/runtime/note-recorder-driver.ts';
import type { voiceFakeClock } from './shared-batch-voice.mjs';

interface RecordingPort {
  startNoteRecording(binding: NoteRecordingBinding): Promise<NoteRecordingStatus>;
  noteRecordingStatus(): Promise<NoteRecordingStatus>;
  stopNoteRecording(input: {recordingId: string}): Promise<NoteRecordingStatus>;
  setNoteSegmentText(input: {recordingId: string; segmentId: string; text: string}): Promise<void>;
  saveNoteRecording: NoteRecorderDriver['save'];
  discardNoteRecording(): Promise<NoteRecordingStatus>;
}
interface FakeNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  audio?: SavedNoteAudio;
}
interface PlaybackEvent { playbackId: string | null }
interface PlaybackInput { playbackId?: string; requestId?: string }

export function cloudVoiceViewFixture(options?: {
  cloudProfile?: boolean;
  clock?: ReturnType<typeof voiceFakeClock>;
  holdPlayback?: boolean;
  noteRecording?: (driver: {saveRecording: NoteRecorderDriver['save']}) => RecordingPort;
}): {
  box: {
    testMocksEnabled: boolean;
    React?: {createElement: () => unknown};
    VoiceActivity?: () => unknown;
    pendingAudioDeletions?: () => Promise<object>;
    createCloudVoice: typeof createCloudVoice;
    NoteRecorderSession: typeof NoteRecorderSession;
    createNoteRecorderDriver: typeof createNoteRecorderDriver;
    noteSegmentTranscriber: typeof noteSegmentTranscriber;
  };
  shell: {
    failPersistence?: boolean;
    notes: {list: FakeNote[]; open?: string};
    openView(view: string): void;
    startVoice(): Promise<void>;
  };
  driver: {
    addListener(name: string, callback: (event: PlaybackEvent) => void): Promise<{remove(): Promise<void>}>;
    synthesize(input: {requestId: string}): Promise<{playbackId: string}>;
  };
  events: Map<string, Set<(event: PlaybackEvent) => void>>;
  render(): {
    record(): void;
    noteRecorder?: {phase: string; doneLabel: string; done(): void; transcribe?: unknown};
    ed: {readAloud(): void; stopReading(): void; cloudSpeechDisclosure: string};
  };
  renderChat(): {primaryLabel: string; discard(): void};
  notesRecorderControl?: NotesRecorderControl;
  account: string;
  credential: string;
  starts: number;
  uploads: number;
  cloudSpeech: number;
  localFactories: number;
  pairedFactories: number;
  sends: number;
  speechInputs: {requestId: string}[];
  stopPlaybackInputs: PlaybackInput[];
  activePlayback: string | null;
  holdPlaybackCleanup?: boolean;
  releasePlaybackCleanup?: () => void;
  transcribeInput?: {recordingId: string; credentialId: string};
  changed(): void;
  close(): void;
};
