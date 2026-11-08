/**
 * Alpha's import names for the shared voice-note origin links (elizaOS Notes client).
 * A link is identity only: note id, recording id and reviewed revision, never the title
 * or content. Validation, the series key and fail-closed resolution are upstream.
 */
export {
 NOTE_ORIGIN_LIMIT as noteOriginLimit,
 addNoteOrigin,
 findNoteLink,
 findNoteOrigin,
 noteOriginFor,
 noteOriginIndex,
 noteOriginKey,
 noteOriginOf,
 noteOriginTitle,
 noteLinkOf,
 recordNoteOriginOf,
 recordNoteRevision,
 removeNoteOrigin,
 resolveNoteLink,
 resolveNoteOrigin,
} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-origin.ts';
export type {NoteLink,NoteOrigin,NoteOriginIndex,NoteOriginKind,RecordNoteOrigin} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-origin.ts';
