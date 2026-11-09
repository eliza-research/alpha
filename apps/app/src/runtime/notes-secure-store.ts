import { SecureNotesStore as SharedSecureNotesStore, readLegacyDailyNotes as readLegacy, type NotesVault, type NotesOpenStage } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
import { mergeNotesDrafts, notesDraftChanges, validateNotesDraft, type NotesDraft, type NotesDraftReason } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
import { NotesDocumentConflict } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import { notesStorageKeys, isStorageFull, STORAGE_FULL_CODE, type NoteRecord } from './notes-store';
export type { NotesVault, NotesOpenStage } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
export const SECURE_NOTES_SLOT = 'notes-records:v1:device';
/** Encrypted Keystore slot for edits whose collection commit failed or is uncertain. */
export const SECURE_NOTES_DRAFT_SLOT = 'notes-draft:v1:device';
const config = {...notesStorageKeys,secureSlot:SECURE_NOTES_SLOT,daily:'alphaphone:daily:v1'};
type LegacyStorage = {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
export function readLegacyDailyNotes(storage:Pick<LegacyStorage,'getItem'>){return readLegacy(config,storage);}

/** Definite, not-applied capacity refusal. A NotesDocumentConflict subclass, so the shared
 * document store reports it as a non-applied failure instead of an uncertain commit. */
export class NotesStorageFull extends NotesDocumentConflict {
 readonly code = STORAGE_FULL_CODE;
 constructor(){super('Notes storage is full. Nothing was written.');}
}
/** The shared store turns unexpected port errors into uncertain commits; keep capacity distinct. */
function capacityAware(vault:NotesVault):NotesVault{
 return {
  read:key=>vault.read(key),
  async compareExchange(key,expected,value){
   try{return await vault.compareExchange(key,expected,value);}
   catch(error){if(isStorageFull(error))throw new NotesStorageFull();throw error;}
  },
 };
}

export { applyNotesDraft, notesDraftBase, notesDraftConflicts, type NotesDraft, type NotesDraftReason } from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';

export type SecureNotesStore = SharedSecureNotesStore;
export const SecureNotesStore = {
 open(vault:NotesVault,legacy:LegacyStorage,initial:NoteRecord[]|(()=>NoteRecord[])=[],onStage:(stage:NotesOpenStage)=>void=()=>{}){
  return SharedSecureNotesStore.open(config,capacityAware(vault),legacy,initial,onStage);
 },
 /** Read the encrypted unsaved draft. Throws for an unreadable or invalid slot (recovery). */
 async readDraft(vault:NotesVault):Promise<NotesDraft|null>{
  const value=await vault.read<unknown>(SECURE_NOTES_DRAFT_SLOT);
  return value===null?null:validateNotesDraft(value);
 },
 /** Persist the change set of a failed or uncertain commit, merged with any draft still kept.
  * A storage-full refusal of the draft itself propagates: the caller keeps the text on screen
  * and says so. `own` is the draft this editor last saved (its edits are all in `list`), and
  * `kept` an earlier session's draft the editor never showed. */
 async saveDraft(vault:NotesVault,input:{base:string;reason:NotesDraftReason;list:NoteRecord[];saved:NoteRecord[];own?:NotesDraft|null;kept?:NotesDraft|null}):Promise<NotesDraft>{
  const changes=notesDraftChanges(input.list,input.saved);
  for(let attempt=0;attempt<3;attempt++){
   const expected=await vault.read<unknown>(SECURE_NOTES_DRAFT_SLOT);
   // This editor's own draft is replaced, so a reverted edit is not resurrected. Any other kept
   // draft is merged, never replaced; an invalid one is retained without overwriting it.
   const prior=expected===null?null:input.own&&JSON.stringify(expected)===JSON.stringify(input.own)?input.kept??null:validateNotesDraft(expected);
   const merged=prior?mergeNotesDrafts(prior,changes):changes;
   const draft:NotesDraft={version:1,savedAt:Date.now(),base:input.base,reason:input.reason,...merged};
   if((await vault.compareExchange(SECURE_NOTES_DRAFT_SLOT,expected,draft)).status==='saved')return draft;
  }
  throw Error('Notes draft changed in another view');
 },
 /** Remove the exact draft that was reviewed or applied. */
 async clearDraft(vault:NotesVault,expected:NotesDraft):Promise<boolean>{
  return (await vault.compareExchange(SECURE_NOTES_DRAFT_SLOT,expected,null)).status==='saved';
 },
};
