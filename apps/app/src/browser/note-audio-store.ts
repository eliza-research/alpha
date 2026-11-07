/**
 * Alpha's browser voice-note recordings on the shared elizaOS Notes audio store.
 * Ownership, two-phase deletion receipts, purge and expiry are upstream; Alpha keeps its
 * installed IndexedDB database name and the orphan-recording backstop: twice the 30-day Notes
 * Recently deleted retention, so the Trash rules (live references, review) always decide first.
 */
import {createNotesAudioStore,notesAudioMetadata,type NotesAudioRow} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-audio-store.ts';
export type AudioRow=NotesAudioRow;
export const NOTES_AUDIO_BACKSTOP_MS=60*24*60*60*1000;
export const alphaAudioDatabase='alpha.browser.audio.v1';
const store=createNotesAudioStore({databaseName:alphaAudioDatabase,retentionMs:NOTES_AUDIO_BACKSTOP_MS});
export const audioMetadata=notesAudioMetadata;
export const {retainAudio,audioRecord,audioDeletionStatus,changeAudioDeleted,purgeAudio,migrateAudio}=store;
