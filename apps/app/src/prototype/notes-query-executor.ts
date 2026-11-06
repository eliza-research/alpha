import type {NativeNotesQueryOperation} from '../../../../.eliza/client-features/packages/contracts/src/native-notes-query.ts';
import {validateNotesQueryResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts';
import {queryLocalNotes} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-query.ts';
import {resolveNamedTarget,type NamedTargetOperation,type NotesSearchOperation} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import type {NotesOperation,NotesResult} from '../runtime/notes-contract';
import {namedTargetValidators,validateForegroundReviewResult,type ForegroundReviewResult} from '../runtime/device-actions';
import type {SecureNotesStore} from '../runtime/notes-secure-store';
import type {NoteRecord} from '../runtime/notes-store';
import {reviewNamedNote,reviewNoteTitles,reviewNotesQuery} from './notes-query-review';
import {noteMatchesText} from '../runtime/notes-view';
type Store=Pick<SecureNotesStore,'raw'|'list'|'assertCurrent'|'target'|'execute'>;
/** Resolve locally, confirm one record, then reuse the existing exact selected read. */
export async function executeNotesQuery(store:Store,operation:NativeNotesQueryOperation,operationId:string,signal:AbortSignal,current:()=>void,choose=reviewNotesQuery){
 current();await store.assertCurrent();current();const raw=store.raw;
 const stable=()=>{signal.throwIfAborted();current();if(store.raw!==raw)throw Error('Notes changed. Review the query again.');};
 const selection=queryLocalNotes(store.list,operation.query);
 if(!selection.candidates.length){await store.assertCurrent();stable();return {status:'succeeded' as const,summary:'No saved note matches this request.',notesResult:validateNotesQueryResult(operation,{version:1,kind:'notes_query',query:operation.query,basis:'no-match'})};}
 const selected=await choose(selection.candidates,selection.explanation,signal,stable);
 if(!selected)return {status:'failed' as const,summary:'Notes sharing cancelled. Nothing was shared.'};
 if(!selection.candidates.some(note=>note.id===selected))throw Error('The chosen note did not match this query');
 stable();await store.assertCurrent();stable();const target=await store.target(selected);stable();
 const record=await store.execute({type:'notes_read_selected',target},operationId,signal,stable);await store.assertCurrent();stable();
 return {status:'succeeded' as const,summary:selection.basis==='owner-choice-uncertain'?'Shared the note you chose. Its latest status could not be verified.':'Shared the note you confirmed.',notesResult:validateNotesQueryResult(operation,{version:1,kind:'notes_query',query:operation.query,basis:selection.basis,target,record})};
}
const fold=(value:string)=>value.normalize('NFKC').toLowerCase();
const instant=(note:NoteRecord)=>{const value=note.modifiedAt??note.updatedAt??note.createdAt;const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)?at:-1;};
/** Local content matches: the title, body, checklist items or voice transcript contains the search
 * text (runtime/notes-view noteSearchText). Note text stays on the phone. */
export function matchNotesContent(records:readonly NoteRecord[],text:string):NoteRecord[]{
 return records.filter(note=>noteMatchesText(note,text));
}
/** Name matches for a name-targeted edit: titles containing the spoken name. */
export function matchNotesName(records:readonly NoteRecord[],name:string):NoteRecord[]{
 const needle=fold(name).trim();
 return records.filter(note=>fold(note.title).includes(needle));
}
type ReviewResult={status:'succeeded'|'failed'|'unknown';summary:string;foregroundResult?:ForegroundReviewResult};
/** Content search shares only the one note the owner chooses; the titles listing shares
 * only the exact titles the owner reviewed, never any text. */
export async function executeNotesSearch(store:Store,operation:NotesSearchOperation,operationId:string,signal:AbortSignal,current:()=>void,choose=reviewNotesQuery,reviewTitles=reviewNoteTitles):Promise<ReviewResult>{
 current();await store.assertCurrent();current();const raw=store.raw;
 const stable=()=>{signal.throwIfAborted();current();if(store.raw!==raw)throw Error('Notes changed. Review the search again.');};
 const noMatch=()=>({status:'succeeded' as const,summary:'No saved note matches this request.',foregroundResult:validateForegroundReviewResult(operation,{version:1,kind:'notes_search',query:operation.query,basis:'no-match'})});
 if(operation.query.kind==='titles'){
  const ordered=[...store.list].sort((a,b)=>instant(b)-instant(a)||a.id.localeCompare(b.id));
  // The owner reviews exactly the bounded labels the shared contract accepts (at most 500 characters).
  const titles=ordered.slice(0,operation.query.limit).map(note=>String(note.title??'').replaceAll('\0','').slice(0,500)||'Untitled note');
  if(!titles.length){await store.assertCurrent();stable();return noMatch();}
  const approved=await reviewTitles(titles,ordered.length>titles.length,signal,stable);
  if(!approved)return {status:'failed',summary:'Notes listing cancelled. Nothing was shared.'};
  stable();await store.assertCurrent();stable();
  return {status:'succeeded',summary:`Shared ${titles.length} note title${titles.length===1?'':'s'} you reviewed.`,foregroundResult:validateForegroundReviewResult(operation,{version:1,kind:'notes_search',query:operation.query,basis:'titles-reviewed',titles,truncated:ordered.length>titles.length})};
 }
 const candidates=matchNotesContent(store.list,operation.query.text);
 if(!candidates.length){await store.assertCurrent();stable();return noMatch();}
 const selected=await choose(candidates,candidates.length>1?'Several notes match. Choose the one to share.':'Review the matching note before sharing it.',signal,stable);
 if(!selected)return {status:'failed',summary:'Notes sharing cancelled. Nothing was shared.'};
 if(!candidates.some(note=>note.id===selected))throw Error('The chosen note did not match this search');
 stable();await store.assertCurrent();stable();const target=await store.target(selected);stable();
 const record=await store.execute({type:'notes_read_selected',target},operationId,signal,stable);await store.assertCurrent();stable();
 return {status:'succeeded',summary:'Shared the note you confirmed.',foregroundResult:validateForegroundReviewResult(operation,{version:1,kind:'notes_search',query:operation.query,basis:'content-match',target,record})};
}
/** Applies one exact, owner-approved notes_update or notes_delete. The host supplies the effect (for
 * example moving a deleted note to Trash) under the same operation identity. */
export type ApplyExactNotes=(operation:NotesOperation,operationId:string,signal:AbortSignal,current:()=>void)=>Promise<NotesResult>;
/** Name-targeted Notes edit from Home: local matches, owner disambiguation and exact
 * approval in one review, then the existing selected-record effect. */
export async function executeNamedNotes(store:Store,operation:Extract<NamedTargetOperation,{type:'notes_named'}>,operationId:string,signal:AbortSignal,current:()=>void,apply:ApplyExactNotes,choose=reviewNamedNote):Promise<ReviewResult>{
 current();await store.assertCurrent();current();const raw=store.raw;
 const stable=()=>{signal.throwIfAborted();current();if(store.raw!==raw)throw Error('Notes changed. Review the request again.');};
 const candidates=matchNotesName(store.list,operation.name);
 if(!candidates.length){await store.assertCurrent();stable();return {status:'succeeded',summary:`No saved note matches “${operation.name}”. Nothing was changed.`,foregroundResult:validateForegroundReviewResult(operation,{version:1,kind:operation.type,action:operation.action,name:operation.name,basis:'no-match'})};}
 const selected=await choose(candidates,operation,signal,stable);
 if(!selected)return {status:'failed',summary:'Cancelled. Nothing was changed.'};
 if(!candidates.some(note=>note.id===selected))throw Error('The chosen note did not match this name');
 stable();await store.assertCurrent();stable();const target=await store.target(selected);stable();
 const exact=resolveNamedTarget(operation,target,namedTargetValidators);
 if(exact.type!=='notes_update'&&exact.type!=='notes_delete')throw Error('Unexpected exact Notes operation');
 // The effect changes the store; from here only cancellation and the host's context bind it.
 const record=await apply(exact,operationId,signal,()=>{signal.throwIfAborted();current();});
 return {status:'succeeded',summary:exact.type==='notes_delete'?'Moved the note you chose to Trash.':'Updated the note you chose.',foregroundResult:validateForegroundReviewResult(operation,{version:1,kind:operation.type,action:operation.action,name:operation.name,basis:'owner-chosen',operation:exact,record})};
}
