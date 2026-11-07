import {NotesStore as SharedNotesStore,type StoragePort,type NoteRecord} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-store.ts';
export { NotesCommitUncertain, type NoteRecord } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-store.ts';
export const LEGACY_NOTES_KEY = 'alphaphone:prototype:notes:v1';
export const NOTES_KEY = 'alphaphone:notes:v2';
export const notesStorageKeys = {current:NOTES_KEY,legacy:LEGACY_NOTES_KEY};
/** Preserve installed data; revision/migration behavior belongs to plugin-notes. */
export class NotesStore extends SharedNotesStore {
 constructor(storage:StoragePort,initial:NoteRecord[]|(()=>NoteRecord[])=[]){super(notesStorageKeys,storage,initial);}
}
/** AlphaConnectionPlugin's definite refusal above a slot's byte cap uses the shared Notes
 * storage-full code; true only for that refusal, when nothing was written. */
export {NOTES_STORAGE_FULL_CODE as STORAGE_FULL_CODE} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts';
export {isNotesStorageFull as isStorageFull} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
