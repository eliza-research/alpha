import type {NotesTarget} from '../runtime/notes-contract';
import type {NotesOrganizeOperation} from '../runtime/notes-organize-contract';
import {addNotesFolder,findNotesFolderByName,newNotesFolderId,withNoteFolder,type NotesFoldersDocument} from '../runtime/notes-folders-model.ts';
import type {NotesFilter} from '../runtime/notes-view';
import {notesRecorderControl,type NotesRecordStart,type NotesRecordStop} from './notes-recorder-control.ts';

type Note={id:string;folderId?:unknown;[key:string]:unknown};
export type NotesRestoreOutcome='restored'|'live'|'gone'|'expired'|'failed'|'busy'|'missing';
/** What the executor needs from the shell; injected so the rules are testable without a UI. */
export interface NotesOrganizeHost {
 ready():boolean;
 list():readonly Note[];
 target(noteId:string):Promise<NotesTarget>;
 /** Commits the whole Notes list; true only when the save is confirmed. */
 commitList(list:Note[]):Promise<boolean>;
 readFolders():Promise<NotesFoldersDocument>;
 editFolders(update:(doc:NotesFoldersDocument)=>NotesFoldersDocument):Promise<NotesFoldersDocument>;
 showFolders(doc:NotesFoldersDocument):void;
 /** Opens the Notes list with this read-only filter and its clearable chip. */
 showFilter(filter:NotesFilter):void;
 /** Restores the newest Recently deleted copy of the note through the Trash restore path. */
 restore(noteId:string):Promise<NotesRestoreOutcome>;
 /** Starts the Notes recorder; `already` when a recording is open. */
 recordStart():Promise<NotesRecordStart>;
 /** Stops the recording; audio that needs a separate transcription choice stays in Notes. */
 recordStop():Promise<NotesRecordStop>;
}
export interface NotesOrganizeReceipt {status:'succeeded'|'failed'|'unknown';summary:string}

/**
 * Executes an approved Notes organisation proposal (runtime/notes-organize-contract). The
 * filter is read-only and returns no note content. A move applies only to the note revision the
 * owner reviewed (specs/notes-view AgentMoveOnlyReviewed): a note edited since then is refused.
 * Folders are addressed by name and must exist when the move runs.
 */
export async function executeNotesOrganize(host:NotesOrganizeHost,operation:NotesOrganizeOperation,current:()=>void):Promise<NotesOrganizeReceipt>{
 current();
 if(operation.type==='notes_filter'){
  let folder:string|undefined;
  if(operation.folder!==undefined){
   const found=findNotesFolderByName(await host.readFolders(),operation.folder);current();
   if(!found)return {status:'failed',summary:`No folder “${operation.folder}”`};
   folder=found.id;
  }
  host.showFilter({...(operation.text!==undefined?{text:operation.text}:{}),...(operation.kind!==undefined?{kind:operation.kind}:{}),...(folder!==undefined?{folder}:{})});
  return {status:'succeeded',summary:'Filtered'};
 }
 if(!host.ready())return {status:'failed',summary:'Notes unavailable'};
 if(operation.type==='notes_record'){
  if(operation.action==='start'){
   const started=await host.recordStart().catch(():NotesRecordStart=>'failed');
   return started==='started'?{status:'succeeded',summary:'Recording'}:started==='already'?{status:'succeeded',summary:'A voice note is already recording.'}:{status:'failed',summary:'Mic failed'};
  }
  const stopped=await host.recordStop().catch(():NotesRecordStop=>'failed');
  if(stopped==='retained')return {status:'succeeded',summary:'Recording saved'};
  return stopped==='saved'?{status:'succeeded',summary:'Saved the voice note.'}:stopped==='none'?{status:'failed',summary:'No voice note is recording.'}:{status:'unknown',summary:'Not saved'};
 }
 if(operation.type==='notes_folder_create'){
  const before=await host.readFolders();current();
  if(findNotesFolderByName(before,operation.name))return {status:'succeeded',summary:`“${operation.name}” exists`};
  // The folder slot is compare-and-exchange: a lost race writes nothing.
  const doc=await host.editFolders(existing=>addNotesFolder(existing,{id:newNotesFolderId(),name:operation.name,createdAt:Date.now()})).catch(()=>null);
  if(!doc)return {status:'failed',summary:'Not created'};
  host.showFolders(doc);
  return findNotesFolderByName(doc,operation.name)?{status:'succeeded',summary:`Created “${operation.name}”`}:{status:'unknown',summary:'Unconfirmed'};
 }
 if(operation.type==='notes_move'){
  let folderId:string|null=null;
  if(operation.folder!==null){
   const found=findNotesFolderByName(await host.readFolders(),operation.folder);current();
   if(!found)return {status:'failed',summary:`No folder “${operation.folder}”`};
   folderId=found.id;
  }
  const target=await host.target(operation.target.noteId).catch(()=>null);current();
  if(!target||JSON.stringify(target)!==JSON.stringify(operation.target))return {status:'failed',summary:'Note changed'};
  const list=host.list(),index=list.findIndex(note=>note.id===operation.target.noteId);
  if(index<0)return {status:'failed',summary:'Note gone'};
  const moved=withNoteFolder(list[index],folderId);
  const where=operation.folder===null?'no folder':`“${operation.folder}”`;
  if(moved===list[index])return {status:'succeeded',summary:`The note is already in ${where}.`};
  const next=[...list];next[index]=moved;
  return await host.commitList(next).catch(()=>false)?{status:'succeeded',summary:`Moved the note to ${where}.`}:{status:'unknown',summary:'Unconfirmed'};
 }
 const outcome=await host.restore(operation.noteId).catch(():NotesRestoreOutcome=>'failed');
 const summaries:Record<NotesRestoreOutcome,NotesOrganizeReceipt>={
  restored:{status:'succeeded',summary:'Restored'},
  live:{status:'succeeded',summary:'The note is already in Notes.'},
  gone:{status:'failed',summary:'Not in trash'},
  missing:{status:'failed',summary:'The note is not in Recently deleted.'},
  expired:{status:'failed',summary:'Permanently deleted'},
  busy:{status:'failed',summary:'Trash busy'},
  failed:{status:'unknown',summary:'Unconfirmed'},
 };
 return summaries[outcome];
}

/** The live shell as an executor host: the secure Notes store, the folder slot and the Trash restore path. */
export function notesOrganizeShellHost(shell:any,folders:{read():Promise<NotesFoldersDocument>;edit(update:(doc:NotesFoldersDocument)=>NotesFoldersDocument):Promise<NotesFoldersDocument>}):NotesOrganizeHost{
 return {
  ready:()=>!!shell.live&&!!shell.notesStore&&!shell.notesStorageFailed&&!shell.notesPending,
  list:()=>shell.vget('notes').list||[],
  target:noteId=>shell.notesStore.target(noteId),
  commitList:async list=>await shell.vset('notes',{list},{exact:true})===true,
  readFolders:()=>folders.read(),
  editFolders:update=>folders.edit(update),
  showFolders:doc=>{if(shell.live)shell.vset('notes',{folders:doc.folders,foldersLoaded:true});},
  showFilter:filter=>{
   const patch={filter,folder:null,open:null,menu:null,folderSheet:null};
   if(shell.S().view==='notes')shell.vset('notes',patch);else shell.openView('notes',patch);
  },
  restore:async noteId=>{
   const trash=shell.api('notes')?.notesTrash;
   if(!trash)return 'failed';
   const entry=await trash.entryFor(noteId);
   return entry?await trash.restore(entry.id):'missing';
  },
  recordStart:async()=>{const control=notesRecorderControl();return control?control.start():'failed';},
  recordStop:async()=>{const control=notesRecorderControl();return control?control.stop():'none';},
 };
}
