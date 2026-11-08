import {
 editNotesTrash,notesTrashDaysLabel,readNotesTrash,savedNoteIds,savedNotes,sortedNotesTrash,withNotesDeletionLock,type NotesTrashEntry,
} from '../runtime/notes-trash';
import type {NoteRecord} from '../runtime/notes-store';
import type {NotesTarget} from '../runtime/notes-contract';
import {notesTrashPolicy,notesTrashDaysShort} from '../runtime/notes-trash-policy';
import {readNotesFolders,restoredNoteFolder} from '../runtime/notes-folders';
import {notePreview} from '../runtime/notes-view';
import {maintainNotesTrash} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-maintenance.ts';
import {createNotesTrashActions,type NotesTrashCollection} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-actions.ts';
import {scheduleNotesTrashMaintenance} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-schedule.ts';
import {DailyApps} from '../daily';
import {releaseUnusedSourceReferences} from './note-source-adapter';
type Bag=Record<string,any>;
type Shell=any;
const kindLabel:Record<string,string>={text:'Note',list:'Checklist',voice:'Voice note',link:'Link'};

/** While the shell is alive, Trash is checked at least this often, whichever view is open. */
export const NOTES_TRASH_MAINTENANCE_INTERVAL_MS=15*60*1000;

/**
 * Deleted notes go to a durable Trash, shown as the "Recently deleted" folder, and are erased
 * 30 days after deletion.
 * Maintenance (drop rows whose note is live again, purge expired rows) runs at startup,
 * whenever Notes opens, when the app returns to the foreground (visibilitychange and the
 * native appResumed event) and on a 15-minute timer while the shell is alive, so expiry
 * never depends on the user opening Notes. It is idempotent and reads authoritative
 * storage only. On Android a native WorkManager sweep is the backstop while Alpha is closed.
 */
export function installNotesTrashAdapter(Component:Shell,views:Record<string,Bag>){
 const notes=views.notes,render=notes.render,back=notes.back;
 const p=Component.prototype,originalApi=p.api,originalMount=p.componentDidMount,originalUnmount=p.componentWillUnmount;
 let busy=false,maintaining:Promise<unknown>|null=null;
 /** The exact reviewed note a full Trash refused. Held in memory only; a restart simply asks again. */
 let refused:{note:Bag;snapshot:string;index:number}|null=null;
 const noteTitle=(note:Bag)=>note.title||kindLabel[note.kind]||'Note';

 const ready=(shell:Shell)=>shell.live&&shell.notesStore&&!shell.notesStorageFailed&&!shell.notesPending;
 const voice=(shell:Shell)=>shell.api('notes') as Bag;
 async function purge(shell:Shell,entry:NotesTrashEntry){
  // Caller holds the deletion-effects lock. A recording is erased before its row disappears.
  if(!entry.audio)return true;
  const hook=voice(shell).purgeTrashedVoice;
  return typeof hook==='function'?!!await hook(entry):false;
 }
 async function load(shell:Shell){
  if(shell.notesSourceMode==='canonical')return;
  try{const doc=await readNotesTrash();if(shell.live)shell.vset('notes',{trash:sortedNotesTrash(doc),trashError:''});}
  catch{if(shell.live)shell.vset('notes',{trash:[],trashError:'Recently deleted could not be read.'});}
 }
 /** Idempotent: a second run with the same clock finds nothing to do. */
 async function maintain(shell:Shell,background:boolean,now=Date.now()){
  if(shell.notesSourceMode==='canonical')return;
  // Interrupted voice deletions are settled with every pass (startup, resume, timer, Notes open), so
  // a permanent deletion cut short by process death never waits for the person to open Notes. Not
  // awaited: it queues for the deletion-effects lock on its own and never delays Trash upkeep.
  try{const recover=voice(shell).recoverVoiceDeletions;if(typeof recover==='function')void Promise.resolve(recover()).catch(()=>{/* The row stays under review. */});}catch{/* Unavailable. */}
  const result=await maintainNotesTrash({policy:notesTrashPolicy,read:readNotesTrash,edit:editNotesTrash,liveNoteIds:savedNoteIds,withLock:work=>withNotesDeletionLock(work),purge:entry=>purge(shell,entry)},now);
  // Source links of notes that are neither saved nor restorable from Trash give up their grants.
  // Best effort: a failure keeps every reference and retries on the next pass.
  try{await withNotesDeletionLock(async()=>releaseUnusedSourceReferences([...await savedNotes(),...(await readNotesTrash()).entries.map(entry=>entry.note)]));}catch{/* Retried. */}
  // A background pass repaints only when it changed Trash; an open Notes view re-reads every time.
  if(!background||result.removed.length)await load(shell);
 }
 function runMaintenance(shell:Shell,background=false){
  // A foreground caller joining a background pass still re-reads Trash afterwards.
  if(maintaining)return background?maintaining:maintaining.then(()=>load(shell));
  maintaining=maintain(shell,background).catch(()=>load(shell)).finally(()=>{maintaining=null;});
  return maintaining;
 }
 /** Foreground, resume and timer passes. They wait for saved Notes and never run on failed storage. */
 function scheduleMaintenance(shell:Shell){
  return scheduleNotesTrashMaintenance({
   intervalMs:NOTES_TRASH_MAINTENANCE_INTERVAL_MS,visibility:document,
   run:()=>{if(!shell.live)return;void Promise.resolve(shell.notesReady).then(()=>{if(shell.live&&!shell.notesStorageFailed)return runMaintenance(shell,true);}).catch(()=>{});},
   onResume:listener=>{const handle=DailyApps.addListener('appResumed',listener).catch(()=>null);return ()=>void handle.then(value=>value?.remove()).catch(()=>{});},
  });
 }

 /** Shared write-ahead Trash actions; this adapter keeps storage bindings and presentation. */
 const actionsFor=(shell:Shell)=>createNotesTrashActions<NoteRecord,NotesTarget>({
  policy:notesTrashPolicy,read:readNotesTrash,edit:editNotesTrash,
  savedNotes:async()=>await savedNotes() as NoteRecord[],
  withLock:work=>withNotesDeletionLock(work),
  purge:entry=>purge(shell,entry),
  // A voice note's recording is deleted only through the reviewed voice path.
  ownsContent:note=>!!note.audio,
 });
 function collection(shell:Shell):NotesTrashCollection<NoteRecord>{
  return {
   ready:()=>!!ready(shell),
   stored:()=>shell.notesStore.list,
   visible:()=>shell.vget('notes').list,
   async commit(list,reason){
    // A restored note returns to its folder, or to no folder when that folder was deleted meanwhile.
    // An unreadable folder list keeps the stored reference, which then reads as no folder.
    if(reason==='restore'){const folders=await readNotesFolders().then(doc=>doc.folders,()=>null);if(folders)list=list.map(note=>restoredNoteFolder(note,folders));}
    return reason==='restore'?await shell.vset('notes',{list},{exact:true})===true:await shell.vset('notes',{list,open:null,sheet:null,playing:false,dict:false})===true;
   },
  };
 }
 const unavailableMessage=(shell:Shell)=>shell.notesPending&&!shell.notesStorageFailed?'Still saving. Try again in a moment. Nothing was deleted.':'Notes storage needs recovery. Nothing was deleted.';

 async function moveToTrash(shell:Shell,note:Bag,index:number){
  const outcome=await actionsFor(shell).moveToTrash(collection(shell),note as NoteRecord,index,()=>shell.notesStore.target(note.id));
  if(outcome.status==='unavailable'){shell.toast(unavailableMessage(shell));return false;}
  if(outcome.status==='full'){
   // A full Trash never silently drops this note or any other: nothing was written, and the
   // person chooses between making room and a separately confirmed permanent deletion.
   if(shell.live){refused={note,snapshot:JSON.stringify(note),index};shell.vset('notes',{trashFull:{id:note.id,title:noteTitle(note)},trashConfirm:null});}
   return false;
  }
  // An unconfirmed list save is reported by the Notes save path; maintenance drops the copy if the note stays saved.
  if(outcome.status==='unconfirmed')return false;
  if(outcome.status!=='moved'){shell.toast(outcome.status==='changed'?'This note changed in another view. Nothing was deleted.':'Could not move this note to Recently deleted. Nothing was deleted.');return false;}
  void load(shell);
  shell.toast('Moved to Recently deleted',{undo:()=>void restore(shell,outcome.entry.id)});
  return true;
 }

 type RestoreOutcome='restored'|'live'|'gone'|'expired'|'failed'|'busy';
 async function restore(shell:Shell,id:string):Promise<RestoreOutcome>{
  if(busy)return 'busy';busy=true;shell.vset('notes',{trashBusy:true});
  try{
   await runMaintenance(shell);
   const entry=(await readNotesTrash().catch(()=>null))?.entries.find(x=>x.id===id);
   const outcome=await actionsFor(shell).restore(collection(shell),id);
   if(outcome==='owned-content'&&entry){
    // The recording follows its note through the reviewed voice restore path.
    const hook=voice(shell).restoreTrashedVoice;
    if(typeof hook==='function')return await hook(entry)?'restored':'failed';
    shell.toast('Voice restore is unavailable.');return 'failed';
   }
   const title=entry?.note.title||kindLabel[entry?.note.kind as string]||'Note';
   shell.toast(outcome==='restored'?`${title} restored`:outcome==='live'?'This note is already in Notes.':outcome==='gone'?'This note is no longer in Recently deleted.'
    :outcome==='expired'?'This note has expired and cannot be restored. Permanent deletion will be retried.'
    :'Restore is unconfirmed. Reopen Notes to check Recently deleted. No newer note was replaced.');
   return outcome==='restored'||outcome==='live'||outcome==='gone'||outcome==='expired'?outcome:'failed';
  }catch{shell.toast('Restore is unconfirmed. Reopen Notes to check Recently deleted. No newer note was replaced.');return 'failed';}
  finally{busy=false;if(shell.live)shell.vset('notes',{trashBusy:false});await load(shell);}
 }

 async function erase(shell:Shell,ids:'all'|string){
  if(busy)return;busy=true;shell.vset('notes',{trashBusy:true,trashConfirm:null});
  try{
   const outcome=await actionsFor(shell).erase(ids);
   shell.toast(outcome.status==='unconfirmed'?'Permanent deletion is unconfirmed. Reopen Recently deleted to check.':outcome.failed?`${outcome.failed} item(s) could not be deleted yet. They stay in Recently deleted.`:ids==='all'?'Recently deleted emptied':outcome.erased?'Deleted':'This note is no longer in Recently deleted.');
  }finally{busy=false;if(shell.live)shell.vset('notes',{trashBusy:false});await load(shell);}
 }

 /**
  * Permanent deletion without a Trash copy, offered only after a full Trash refused this
  * exact note and confirmed separately. A note that changed since the refusal, or that owns
  * a recording, is left untouched.
  */
 async function deleteForever(shell:Shell,id:string){
  const candidate=refused;
  if(busy||!candidate||candidate.note.id!==id)return;
  busy=true;shell.vset('notes',{trashBusy:true});
  let outcome:'deleted'|'changed'|'unconfirmed'|'unavailable'='unconfirmed';
  try{const result=await actionsFor(shell).deleteForever(collection(shell),id,candidate.snapshot);outcome=result==='owned-content'?'changed':result;}
  finally{
   busy=false;
   const settled=outcome==='deleted'||outcome==='changed';
   if(settled)refused=null;
   if(shell.live)shell.vset('notes',{trashBusy:false,...(settled?{trashFull:null}:{})});
   await load(shell);
  }
  shell.toast(outcome==='deleted'?`${noteTitle(candidate.note)} deleted forever`:outcome==='changed'?'This note changed. Nothing was deleted.'
   :outcome==='unavailable'?unavailableMessage(shell)
   :'Permanent deletion is unconfirmed. Reopen Notes to check. Nothing else was deleted.');
 }

 p.api=function(key:string){
  const api=originalApi.call(this,key);
  // Installed only for live Notes (never fixtures), so deletion never falls back to an in-memory remove.
  if(key==='notes'){
   const shell=this;
   api.moveNoteToTrash=(note:Bag,index:number)=>moveToTrash(shell,note,index);
   api.notesTrash={restore:(id:string)=>restore(shell,id),
    // The newest Recently deleted entry of a note, for the agent's reviewed notes_restore.
    entryFor:async(noteId:string)=>(await readNotesTrash()).entries.filter(entry=>entry.note.id===noteId).sort((a,b)=>b.deletedAt-a.deletedAt)[0]??null,erase:(ids:'all'|string)=>erase(shell,ids),maintain:()=>runMaintenance(shell),
    deleteForever:(id:string)=>deleteForever(shell,id),forget:()=>{refused=null;}};
  }
  return api;
 };
 p.componentDidMount=function(...args:unknown[]){
  const result=originalMount?.apply(this,args);
  // Startup purge, once saved Notes are open. Restarts simply repeat it.
  void Promise.resolve(this.notesReady).then(()=>{if(this.live&&!this.notesStorageFailed)return runMaintenance(this);}).catch(()=>{});
  this.notesTrashChanged=()=>{if(this.live)void load(this);};
  window.addEventListener('alpha:notes-trash-changed',this.notesTrashChanged);
  this.notesTrashSchedule=scheduleMaintenance(this);
  return result;
 };
 p.componentWillUnmount=function(...args:unknown[]){
  window.removeEventListener('alpha:notes-trash-changed',this.notesTrashChanged);
  this.notesTrashSchedule?.();this.notesTrashSchedule=undefined;
  return originalUnmount?.apply(this,args);
 };

 notes.back=(state:Bag,api:Bag)=>{
  if(state.trashFull){(api.notesTrash as Bag|undefined)?.forget();api.set({trashFull:null});return true;}
  if(state.trashConfirm){api.set({trashConfirm:null});return true;}
  if(state.trashAsk){api.set({trashAsk:null});return true;}
  if(state.folder==='deleted'){api.set({folder:null});return true;}
  return back(state,api);
 };
 notes.render=(state:Bag,api:Bag)=>{
  const view=render(state,api),trash=api.notesTrash as Bag|undefined;
  view.trashAvailable=!!trash;view.trashCanErase=true;
  if(!trash)return view;
  // Notes opened: purge due entries. Navigation resets this flag, so every open checks again.
  if(!state.trashChecked){queueMicrotask(()=>{api.set({trashChecked:true});void trash.maintain();});}
  const rows:NotesTrashEntry[]=state.trash||[],now=Date.now(),disabled=!!state.trashBusy;
  // Recently deleted is the last folder of the list (state.folder 'deleted'), shown while it has notes.
  view.openTrash=()=>{trash.forget();api.set({folder:'deleted',open:null,sheet:null,q:null,trashConfirm:null,trashFull:null});void trash.maintain();};
  view.closeTrash=()=>api.set({folder:null,trashConfirm:null,trashAsk:null});
  view.trashOpen=state.folder==='deleted';
  if(view.trashOpen&&Array.isArray(state.trash)&&!rows.length&&!disabled&&!state.trashFull)queueMicrotask(()=>{const latest=api.get('notes');if(latest.folder==='deleted'&&Array.isArray(latest.trash)&&!latest.trash.length)api.set({folder:null,trashConfirm:null});});
  view.trashCount=rows.length;
  view.hasDeleted=rows.length>0;
  view.trashRows=rows.map(entry=>{
   const title=entry.note.title||kindLabel[entry.note.kind]||'Untitled';
   return {id:entry.id,title,kind:kindLabel[entry.note.kind]||'Note',preview:notePreview(entry.note),left:notesTrashDaysShort(entry,now),label:`${title}, ${notesTrashDaysLabel(entry,now)}`,
    restoreLabel:`Recover ${title}`,deleteLabel:`Delete ${title} now`,disabled,
    restore:()=>void trash.restore(entry.id),
    erase:()=>api.set({trashConfirm:{id:entry.id,title}}),
    ask:()=>api.set({trashAsk:{id:entry.id,title}})};
  });
  // Tapping a row offers Recover or Delete now; Delete now asks again before erasing.
  const ask=state.trashAsk as Bag|null,asked=ask&&view.trashOpen?rows.find(entry=>entry.id===ask.id):undefined;
  view.trashAskOpen=!!asked;
  view.trashAskTitle=asked?ask!.title:'';
  view.trashAskClose=()=>api.set({trashAsk:null});
  view.trashAskRecover=()=>{if(!asked)return;api.set({trashAsk:null});void trash.restore(asked.id);};
  view.trashAskDelete=()=>{if(!asked)return;api.set({trashAsk:null,trashConfirm:{id:asked.id,title:ask!.title}});};
  view.trashNone=!rows.length;
  view.trashError=state.trashError||'';
  view.trashEmptyDisabled=disabled||!rows.length;
  view.trashBusy=disabled;
  view.emptyTrash=()=>api.set({trashConfirm:{id:'all'}});
  const confirm=state.trashConfirm as Bag|null;
  // Full Trash: the refused note stays open and saved until one of three explicit choices.
  const full=(state.trashFull as Bag|null)&&(state.list||[]).some((n:Bag)=>n.id===state.trashFull.id&&n.id===state.open)?state.trashFull as Bag:null;
  if(state.trashFull&&!full)queueMicrotask(()=>{trash.forget();api.set({trashFull:null});});
  view.trashFullOpen=!!full;
  view.trashConfirmOpen=!!full||(!!confirm&&view.trashOpen);
  view.trashConfirmTitle=full?'Recently deleted is full':confirm?.id==='all'?'Delete all recently deleted notes?':`Delete “${confirm?.title||'this note'}”?`;
  view.trashConfirmText=full?'':'This can’t be undone.';
  view.trashConfirmLabel=full?'Delete permanently':confirm?.id==='all'?'Delete all':'Delete';
  view.trashConfirmText2=full?'Delete permanently':confirm?.id==='all'?'Delete all':'Delete';
  view.trashCancel=()=>{if(full)trash.forget();api.set({trashConfirm:null,trashFull:null});};
  view.trashFullReview=()=>view.openTrash();
  view.trashConfirmGo=()=>{
   if(full){
    // A voice note is erased together with its recording by the reviewed voice path.
    if(full.voice){const hook=api.deleteVoiceNoteForever;if(typeof hook==='function')void hook(full.id);else api.toast('Permanent voice deletion is unavailable. Nothing was deleted.');}
    else void trash.deleteForever(full.id);
    return;
   }
   if(confirm)void trash.erase(confirm.id);
  };
  return view;
 };
}
