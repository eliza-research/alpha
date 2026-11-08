import { SecureNotesStore as SharedSecureNotesStore, readLegacyDailyNotes as readLegacy, type NotesVault, type NotesOpenStage } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
import { capacityAwareNotesVault, NotesStorageFull } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
import { createNotesDraftSlot, type NotesDraft, type NotesDraftSaveInput } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
import { notesStorageKeys, type NoteRecord } from './notes-store';
export type { NotesVault, NotesOpenStage } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
/** Unsaved-edit recovery and its conflict merge are shared; Alpha keeps its installed slot names. */
export { NotesStorageFull };
export { applyNotesDraft, mergeNotesDrafts, notesDraftBase, notesDraftChanges, notesDraftConflicts, type NotesDraft, type NotesDraftReason } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
export const SECURE_NOTES_SLOT = 'notes-records:v1:device';
/** Encrypted Keystore slot for edits whose collection commit failed or is uncertain. */
export const SECURE_NOTES_DRAFT_SLOT = 'notes-draft:v1:device';
const config = {...notesStorageKeys,secureSlot:SECURE_NOTES_SLOT,daily:'alphaphone:daily:v1'};
type LegacyStorage = {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
export function readLegacyDailyNotes(storage:Pick<LegacyStorage,'getItem'>){return readLegacy(config,storage);}

export type SecureNotesStore = SharedSecureNotesStore;
export const SecureNotesStore = {
 open(vault:NotesVault,legacy:LegacyStorage,initial:NoteRecord[]|(()=>NoteRecord[])=[],onStage:(stage:NotesOpenStage)=>void=()=>{}){
  return SharedSecureNotesStore.open(config,capacityAwareNotesVault(vault),legacy,initial,onStage);
 },
 /** Read the encrypted unsaved draft. Throws for an unreadable or invalid slot (recovery). */
 readDraft(vault:NotesVault):Promise<NotesDraft|null>{return createNotesDraftSlot(vault,SECURE_NOTES_DRAFT_SLOT).read();},
 /** Persist a failed or uncertain commit's change set, merged with any draft still kept. A
  * storage-full refusal of the draft itself propagates: the caller keeps the text on screen. */
 saveDraft(vault:NotesVault,input:NotesDraftSaveInput):Promise<NotesDraft>{return createNotesDraftSlot(vault,SECURE_NOTES_DRAFT_SLOT).save(input);},
 /** Remove the exact draft that was reviewed or applied. */
 clearDraft(vault:NotesVault,expected:NotesDraft):Promise<boolean>{return createNotesDraftSlot(vault,SECURE_NOTES_DRAFT_SLOT).clear(expected);},
};
