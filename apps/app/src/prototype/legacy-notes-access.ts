/** Explicit existing-record access only. Never initialize, migrate, copy or
 * clean legacy sources while introducing the canonical Notes view. */
import {DocumentNotesStore,type NotesDocumentPort} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import {SecureNotesStore} from '../runtime/notes-secure-store';
import type {NotesVault} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
export class LegacyNotesReviewRequired extends Error {
 constructor(){super('Previous notes need a recovery review. Nothing was moved or changed.');}
}
export async function openExistingBrowserNotes(port:NotesDocumentPort,signal:AbortSignal,current:()=>boolean){
 const check=()=>{signal.throwIfAborted();if(!current())throw new DOMException('Notes source changed.','AbortError');};
 return DocumentNotesStore.open({
  async initialize(_create,owned){check();const saved=await port.read(owned);check();if(!saved)throw new LegacyNotesReviewRequired();return saved;},
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
  check();const result=await SecureNotesStore.open(guarded,{getItem:key=>{check();return storage.getItem(key);},setItem:()=>refuse(),removeItem:()=>refuse()},[]);
  check();return result;
 }catch(error){if(refused)throw new LegacyNotesReviewRequired();throw error;}
 finally{opening=false;}
}
