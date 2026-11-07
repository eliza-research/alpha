import {
 editNotesTrash,notesTrashDaysLabel,readNotesTrash,savedNoteIds,savedNotes,sortedNotesTrash,withNotesDeletionLock,type NotesTrashEntry,
} from '../runtime/notes-trash';
import type {NoteRecord} from '../runtime/notes-store';
import type {NotesTarget} from '../runtime/notes-contract';
import {notesTrashPolicy} from '../runtime/notes-trash-policy';
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
 * Deleted notes go to a durable Trash and are erased three days after deletion.
 * Maintenance (drop rows whose note is live again, purge expired rows) is scheduled at
 * startup, whenever Notes opens, when the app returns to the foreground (visibilitychange
 * and the native appResumed event) and on a 15-minute timer while the shell is alive, but
 * each pass returns at once in the default canonical source mode: it does work only after
 * Previous/Older notes (the legacy source) has been opened in this session. It is
 * idempotent and reads authoritative storage only. On Android the native WorkManager sweep
 * (AlphaNoteAudioPlugin.sweepExpiredTrash) bounds expiry and recordings regardless; in a
 * browser, legacy Trash rows can outlive three days until that source is opened.
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
  catch{if(shell.live)shell.vset('notes',{trash:[],trashError:'Trash could not be read. Nothing in it was deleted.'});}
 }
 /** Idempotent: a second run with the same clock finds nothing to do. */
 async function maintain(shell:Shell,background:boolean,now=Date.now()){
  if(shell.notesSourceMode==='canonical')return;
  // Interrupted voice deletions are settled with every pass that gets past the canonical check above,
  // so only once the legacy source is selected in this session; until then a deletion cut short by
  // process death stays under review. Not awaited: it queues for the deletion-effects lock on its
  // own and never delays Trash upkeep.
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
  if(outcome.status!=='moved'){shell.toast(outcome.status==='changed'?'This note changed in another view. Nothing was deleted.':'Could not move this note to Trash. Nothing was deleted.');return false;}
  void load(shell);
  shell.toast(`${note.title||kindLabel[note.kind]||'Note'} moved to Trash`,{undo:()=>void restore(shell,outcome.entry.id)});
  return true;
 }

 async function restore(shell:Shell,id:string){
  if(busy)return;busy=true;shell.vset('notes',{trashBusy:true});
  try{
   await runMaintenance(shell);
   const entry=(await readNotesTrash().catch(()=>null))?.entries.find(x=>x.id===id);
   const outcome=await actionsFor(shell).restore(collection(shell),id);
   if(outcome==='owned-content'&&entry){
    // The recording follows its note through the reviewed voice restore path.
    const hook=voice(shell).restoreTrashedVoice;
    if(typeof hook==='function')await hook(entry);else shell.toast('Voice restore is unavailable. The note stays in Trash.');
    return;
   }
   const title=entry?.note.title||kindLabel[entry?.note.kind as string]||'Note';
   shell.toast(outcome==='restored'?`${title} restored`:outcome==='live'?'This note is already in Notes.':outcome==='gone'?'This note is no longer in Trash.'
    :outcome==='expired'?'This note has expired and cannot be restored. Permanent deletion will be retried.'
    :'Restore is unconfirmed. Reopen Notes to check Trash. No newer note was replaced.');
  }catch{shell.toast('Restore is unconfirmed. Reopen Notes to check Trash. No newer note was replaced.');}
  finally{busy=false;if(shell.live)shell.vset('notes',{trashBusy:false});await load(shell);}
 }

 async function erase(shell:Shell,ids:'all'|string){
  if(busy)return;busy=true;shell.vset('notes',{trashBusy:true,trashConfirm:null});
  try{
   const outcome=await actionsFor(shell).erase(ids);
   shell.toast(outcome.status==='unconfirmed'?'Permanent deletion is unconfirmed. Reopen Trash to check.':outcome.failed?`${outcome.failed} item(s) could not be deleted yet. They stay in Trash.`:ids==='all'?'Trash emptied':outcome.erased?'Deleted forever':'This note is no longer in Trash.');
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
   api.notesTrash={restore:(id:string)=>restore(shell,id),erase:(ids:'all'|string)=>erase(shell,ids),maintain:()=>runMaintenance(shell),
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
  if(state.trashOpen){api.set({trashOpen:false});return true;}
  return back(state,api);
 };
 notes.render=(state:Bag,api:Bag)=>{
  const view=render(state,api),trash=api.notesTrash as Bag|undefined;
  view.trashAvailable=!!trash;view.trashCanErase=true;view.trashRetentionText='Deleted notes stay here for 3 days, then they are deleted permanently.';
  if(!trash)return view;
  // Notes opened: purge due entries. Navigation resets this flag, so every open checks again.
  if(!state.trashChecked){queueMicrotask(()=>{api.set({trashChecked:true});void trash.maintain();});}
  const rows:NotesTrashEntry[]=state.trash||[],now=Date.now(),disabled=!!state.trashBusy;
  view.openTrash=()=>{trash.forget();api.set({trashOpen:true,open:null,sheet:null,q:null,trashConfirm:null,trashFull:null});void trash.maintain();};
  view.closeTrash=()=>api.set({trashOpen:false,trashConfirm:null});
  view.trashOpen=!!state.trashOpen;
  view.trashLabel=rows.length?`Trash, ${rows.length} item${rows.length===1?'':'s'}`:'Trash';
  view.trashRows=rows.map(entry=>{
   const title=entry.note.title||kindLabel[entry.note.kind]||'Untitled';
   return {id:entry.id,title,kind:kindLabel[entry.note.kind]||'Note',left:notesTrashDaysLabel(entry,now),
    restoreLabel:`Restore ${title}`,deleteLabel:`Delete ${title} forever`,disabled,
    restore:()=>void trash.restore(entry.id),
    erase:()=>api.set({trashConfirm:{id:entry.id,title}})};
  });
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
  view.trashConfirmOpen=!!full||(!!confirm&&!!state.trashOpen);
  view.trashConfirmTitle=full?'Trash is full':confirm?.id==='all'?'Empty Trash?':'Delete forever?';
  view.trashConfirmText=full?`“${full.title}” was not deleted because Trash has no room for a restorable copy. Empty Trash to make room, or delete this ${full.voice?'voice note and its recording':'note'} permanently now. Permanent deletion skips Trash and cannot be undone.`
   :confirm?.id==='all'?`${rows.length} item${rows.length===1?'':'s'} will be deleted permanently. This cannot be undone.`:`“${confirm?.title||'This note'}” will be deleted permanently. This cannot be undone.`;
  view.trashConfirmLabel=full?'Delete forever without Trash':confirm?.id==='all'?'Confirm empty Trash':'Confirm delete forever';
  view.trashConfirmText2=confirm?.id==='all'&&!full?'Empty Trash':'Delete forever';
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
