/**
 * Alpha's import names for the shared voice-note origin links (elizaOS Notes client).
 * A link is identity only: note id, recording id and reviewed revision, never the title
 * or content. Validation, the series key and fail-closed resolution are upstream.
 */
import {recordingRevision} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/source-links.ts';
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
/** The revision a new voice-note link stores: SHA-256 of the note's content only (title, text,
 * transcript, summary, action texts, recording). Pinning, ticking an action or a Calendar flag
 * leaves it unchanged. Links made before this hashed the whole record ({@link recordingRevision}). */
export async function voiceNoteContentRevision(note:any):Promise<string>{
 const content=JSON.stringify(['voice-content:v1',note?.id??null,String(note?.title??''),String(note?.body??''),String(note?.audio?.transcript??''),note?.audio?.audioId??null,
  Array.isArray(note?.lines)?note.lines.map((line:any)=>String(line?.t??'')):[],note?.summary??null,
  Array.isArray(note?.actions)?note.actions.map((action:any)=>String(action?.t??'')):[]]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** True when a voice-note link's note no longer matches it: neither its content revision nor, for
 * a link made before content revisions, its whole-record revision. */
export async function voiceNoteChanged(note:any,revision:string):Promise<boolean>{
 return await voiceNoteContentRevision(note)!==revision&&await recordingRevision(note)!==revision;
}
