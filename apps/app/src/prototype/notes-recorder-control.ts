/**
 * The open Notes recorder as the agent's `notes_record` sees it. The voice adapter owns the
 * recorder (note-recorder.ts) and registers these controls; nothing else starts or saves a recording.
 */
export type NotesRecordStart = 'started' | 'already' | 'failed';
export type NotesRecordStop = 'saved' | 'none' | 'failed';
export interface NotesRecorderControl { start(): Promise<NotesRecordStart>; stop(): Promise<NotesRecordStop> }
let control: NotesRecorderControl | null = null;
export function setNotesRecorderControl(next: NotesRecorderControl | null) { control = next; }
export function notesRecorderControl(): NotesRecorderControl | null { return control; }
