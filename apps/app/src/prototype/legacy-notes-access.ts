/** Explicit existing-record access only. Never initialize, migrate, copy or
 * clean legacy sources while introducing the canonical Notes view. */
import {DocumentNotesStore,type NotesDocumentPort} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import {SecureNotesStore,SECURE_NOTES_SLOT,SECURE_NOTES_DRAFT_SLOT,LEGACY_NOTES_SOURCE_KEYS} from '../runtime/notes-secure-store';
import type {NotesVault} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
export class LegacyNotesReviewRequired extends Error {
 constructor(){super('Needs review');}
}
/** Nothing was ever saved as previous notes on this phone: no store and no older keys to migrate. */
export class LegacyNotesAbsent extends Error {
 constructor(){super('None');}
}
export class LegacyNotesDraftOnly extends Error {
 constructor(){super('Unsaved draft');}
}
export type LegacyNotesAvailability = 'present'|'absent'|'unavailable';
const noLegacyKeys=(storage:Pick<Storage,'getItem'>)=>LEGACY_NOTES_SOURCE_KEYS.every(key=>storage.getItem(key)===null);
/** Presence reads never initialize a store or confer permission to reset it. */
export async function previousNotesAvailability(read:(check:()=>void)=>Promise<boolean>,signal:AbortSignal,current:()=>boolean):Promise<LegacyNotesAvailability>{
 const check=()=>{signal.throwIfAborted();if(!current())throw new DOMException('Notes source changed.','AbortError');};
 check();
 try{const present=await read(check);check();return present?'present':'absent';}
 catch(error){check();return 'unavailable';}
}
export function browserPreviousNotesAvailability(port:NotesDocumentPort,signal:AbortSignal,current:()=>boolean,storage?:Pick<Storage,'getItem'>){
 return previousNotesAvailability(async()=>!noLegacyKeys(storage??localStorage)||await port.read(signal)!==null,signal,current);
}
export function devicePreviousNotesAvailability(vault:{readRaw(key:string):Promise<string|null>},signal:AbortSignal,current:()=>boolean,storage?:Pick<Storage,'getItem'>){
 return previousNotesAvailability(async check=>{
  if(!noLegacyKeys(storage??localStorage))return true;
  const saved=await vault.readRaw(SECURE_NOTES_SLOT);check();
  return saved!==null||await vault.readRaw(SECURE_NOTES_DRAFT_SLOT)!==null;
 },signal,current);
}
export async function openExistingBrowserNotes(port:NotesDocumentPort,signal:AbortSignal,current:()=>boolean,storage:Pick<Storage,'getItem'>=localStorage){
 const check=()=>{signal.throwIfAborted();if(!current())throw new DOMException('Notes source changed.','AbortError');};
 return DocumentNotesStore.open({
  async initialize(_create,owned){check();const saved=await port.read(owned);check();if(!saved)throw noLegacyKeys(storage)?new LegacyNotesAbsent():new LegacyNotesReviewRequired();return saved;},
  async read(owned){check();const saved=await port.read(owned);check();return saved;},
  async compareExchange(expected,raw,owned){check();const saved=await port.compareExchange(expected,raw,owned);check();return saved;},
 },[],signal);
}
export async function openExistingDeviceNotes(vault:NotesVault,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,signal:AbortSignal,current:()=>boolean){
 let opening=true,refused=false;
 const check=()=>{signal.throwIfAborted();if(!current())throw new DOMException('Notes source changed.','AbortError');};
 const refuse=():never=>{refused=true;throw new LegacyNotesReviewRequired();};
 const guarded:NotesVault={
  async read<T>(key:string){check();const saved=await vault.read<T>(key);check();return saved;},
  async compareExchange(key,expected,value){check();if(opening)refuse();const result=await vault.compareExchange(key,expected,value);check();return result;},
 };
 try{
  check();if(await guarded.read(SECURE_NOTES_SLOT)===null&&noLegacyKeys(storage)){
   let draft:unknown;
   try{draft=await guarded.read(SECURE_NOTES_DRAFT_SLOT);}catch(error){check();throw new LegacyNotesReviewRequired();}
   if(draft!==null)throw new LegacyNotesDraftOnly();
   throw new LegacyNotesAbsent();
  }
  check();const result=await SecureNotesStore.open(guarded,{getItem:key=>{check();return storage.getItem(key);},setItem:()=>refuse(),removeItem:()=>refuse()},[]);
  check();return result;
 }catch(error){if(refused)throw new LegacyNotesReviewRequired();throw error;}
 finally{opening=false;}
}
