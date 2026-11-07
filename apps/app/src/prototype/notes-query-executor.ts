import type {NativeNotesQueryOperation} from '../../../../.eliza/client-features/packages/contracts/src/native-notes-query.ts';
import {validateNotesQueryResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts';
import {queryLocalNotes} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-query.ts';
import type {SecureNotesStore} from '../runtime/notes-secure-store';
import {reviewNotesQuery,shareable} from './notes-query-review';
type Store=Pick<SecureNotesStore,'raw'|'list'|'assertCurrent'|'target'|'execute'>;
/** Resolve locally, confirm one record, then reuse the existing exact selected read. */
export async function executeNotesQuery(store:Store,operation:NativeNotesQueryOperation,operationId:string,signal:AbortSignal,current:()=>void,choose=reviewNotesQuery){
 current();await store.assertCurrent();current();const raw=store.raw;
 const stable=()=>{signal.throwIfAborted();current();if(store.raw!==raw)throw Error('Notes changed. Review the query again.');};
 const selection=queryLocalNotes(store.list,operation.query);
 if(!selection.candidates.length){await store.assertCurrent();stable();return {status:'succeeded' as const,summary:'No saved note matches this request.',notesResult:validateNotesQueryResult(operation,{version:1,kind:'notes_query',query:operation.query,basis:'no-match'})};}
 const selected=await choose(selection.candidates,selection.explanation,signal,stable);
 if(!selected)return {status:'failed' as const,summary:'Notes sharing cancelled. Nothing was shared.'};
 const chosen=selection.candidates.find(note=>note.id===selected);if(!chosen)throw Error('The chosen note did not match this query');if(!shareable(chosen))throw Error('This note has no text to share.');
 stable();await store.assertCurrent();stable();const target=await store.target(selected);stable();
 const record=await store.execute({type:'notes_read_selected',target},operationId,signal,stable);await store.assertCurrent();stable();
 return {status:'succeeded' as const,summary:selection.basis==='owner-choice-uncertain'?'Shared the note you chose. Its latest status could not be verified.':'Shared the note you confirmed.',notesResult:validateNotesQueryResult(operation,{version:1,kind:'notes_query',query:operation.query,basis:selection.basis,target,record})};
}
