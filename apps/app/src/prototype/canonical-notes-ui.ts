import {parseNoteFormat} from '../../../../.eliza/client-features/plugins/plugin-notes/src/note-format.ts';
import {projectNoteForModel,type StickyNote} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import {noteScheduleDraft,type NoteScheduleKind} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-schedule-draft.ts';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
import {agentPendingText,agentAvailabilityNotice} from '../runtime/connection-ui';
import {DailyApps} from '../daily';
import {CanonicalNotesController,type NotesPhase} from './canonical-notes-controller';
import {CanonicalNotesEditor} from './canonical-notes-editor';
type Bag=Record<string,any>;
const UNAVAILABLE='Notes is unavailable for this agent connection. Check Settings › Agent connection.';
/** Device-local handles (a recording, a picked document, a web source) belong to Older notes adapters, never to an agent record's view. */
const LOCAL_HANDLES=['audio','documentSource','webSource'];
/** View identity and presentation fields, never authored rich metadata. */
const VIEW_FIELDS=new Set(['id','title','body','kind','canonicalRevision','createdAt','updatedAt','when','color','bodySeparator','authored']);
/** Older notes state (device recorder, playback, device Trash, recording deletions) is never read for agent Notes. */
const DEVICE_ONLY_STATE={rec:null,proc:null,record:false,playing:false,dict:false,trash:[],trashConfirm:null,trashFull:null,audioDeletionChecked:true,audioDeletionPending:[],audioDeletionRecoveryFailed:false};
const filled=(value:unknown)=>Array.isArray(value)&&value.length>0;
/** Alpha's card for a record: voice, link and checklist only when the record carries that data, otherwise text. */
function shownKind(kind:string,data:Bag):string{
 if(kind==='list')return 'list';
 if(kind==='voice'&&(filled(data.lines)||filled(data.summary)||filled(data.actions)))return 'voice';
 if(kind==='link'&&typeof data.url==='string'&&data.url)return 'link';
 return 'text';
}
function domainOf(url:string):string{try{return new URL(url).hostname;}catch{return url;}}

/** Alpha's own Notes template over the canonical Notes client: one controller, one editor draft. */
export class CanonicalNotesUi {
 readonly controller:CanonicalNotesController;
 readonly editor:CanonicalNotesEditor;
 private phase:NotesPhase='loading';
 private reviewPending:false|'read'|'change'=false;
 private failure:'read'|'interact'|null=null;
 private idleWaiters:(()=>void)[]=[];
 private baseRows:Bag[]=[];
 private rowsValue:Bag[]=[];
 private openValue:string|null=null;
 private blankCreationValue:string|null=null;
 private trashValue:{id:string;title:string;kind:string}[]=[];
 constructor(port:AppRecordPort,private readonly hooks:{paint():void;review():void;committed?(id:string):void}){
  this.controller=new CanonicalNotesController(port,{
   snapshot:(snapshot,reason)=>{
    this.trashValue=(snapshot.trash??[]).map(entry=>({id:entry.note.id,title:entry.note.title,kind:entry.note.format?.kind??'text'}));
    this.baseRows=snapshot.notes.map(note=>this.row(note,snapshot.revision));
    this.editor?.reconcile();
    // Only an accepted current-owner read can recover a read-only warning.
    // Draft or interaction review takes precedence and is never cleared here.
    if(reason==='read'&&this.reviewPending==='read'&&this.controller.current&&!this.controller.pending&&!this.editor?.draft?.version){
     this.reviewPending=false;this.failure=null;
    }
    this.refreshDraftView();
   },
   phase:phase=>{if(phase==='review'&&!this.reviewPending)this.reviewPending='change';this.phase=phase==='ready'&&this.reviewPending?'review':phase;if(phase!=='saving'){const waiters=this.idleWaiters;this.idleWaiters=[];for(const resume of waiters)resume();}this.hooks.paint();},
   failed:(_cause,operation)=>{
    if(operation==='interact'||this.reviewPending!=='change'){
     this.failure=operation;this.reviewPending=operation==='read'?'read':'change';
    }
   },
  });
  this.editor=new CanonicalNotesEditor(this.controller,{changed:()=>this.refreshDraftView(),review:()=>this.needsReview(),committed:target=>{this.reviewPending=false;this.failure=null;this.phase='ready';this.hooks.paint();this.hooks.committed?.(target.id);}});
  // Authenticated same-session change events (runtime/app-record-completion.ts) refresh the collection.
  if(this.controller.current)this.controller.listen(window);
 }
 private needsReview():void{this.reviewPending='change';this.phase='review';this.hooks.paint();this.hooks.review();}
 /** The record as Alpha's Notes view reads it: authored rich fields at the top level, local handles left out. */
 private row(note:StickyNote,revision:number):Bag{
  const data:Bag=structuredClone(note.format?.data??{});for(const key of LOCAL_HANDLES)delete data[key];
  const parts=projectNoteForModel(note),kind=shownKind(note.format?.kind??'text',data);
  const row:Bag={...data,id:note.id,kind,title:parts.title,body:parts.body,canonicalRevision:revision};
  if(typeof row.when!=='string'){const at=Date.parse(note.updatedAt);row.when=Number.isFinite(at)?new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';}
  if(kind==='voice'){for(const key of ['lines','summary','actions'])if(!Array.isArray(row[key]))row[key]=[];row.lines=row.lines.map((line:Bag)=>({...line,at:Number.isFinite(line?.at)?line.at:0}));}
  if(kind==='link'&&typeof row.domain!=='string')row.domain=domainOf(row.url);
  return row;
 }
 private refreshDraftView():void{
  const rows=this.baseRows.slice(),draft=this.editor?.draft;
  this.openValue=draft?draft.id??'draft-'+draft.token:null;this.blankCreationValue=draft&&!draft.id?this.openValue:null;
  if(draft){
   const base=rows.find(row=>row.id===draft.id),data:Bag=structuredClone(draft.format?.data??{});for(const key of LOCAL_HANDLES)delete data[key];
   const record={...base,...data,id:this.openValue,kind:base?.kind??shownKind(draft.format?.kind??'text',data),title:draft.title,body:draft.body,canonicalRevision:draft.baseRevision};
   if(draft.format?.kind==='list'||draft.format?.kind==='text')record.kind=draft.format.kind;
   const index=rows.findIndex(row=>row.id===draft.id);if(index<0)rows.unshift(record);else rows[index]=record;
  }
  this.rowsValue=rows;this.hooks.paint();
 }
 get current():boolean{return this.controller.current;}
 get pending():boolean{return this.controller.pending;}
 get dirty():boolean{return !!this.editor.draft?.version;}
 get editing():boolean{return !!this.editor.draft;}
 get list():Bag[]{return this.controller.current?this.rowsValue.slice():[];}
 get open():string|null{return this.controller.current?this.openValue:null;}
 /** The current canonical records, exactly as the shared controller holds them (for origin links). */
 notes():StickyNote[]{return this.controller.current?this.controller.snapshot?.notes??[]:[];}
 selection(){return this.editor.selection();}
 private status():string{
  if(this.phase==='review')return this.editor.draft?.version?'Your draft is kept here. Reload the current notes to discard it.':this.failure==='read'&&this.reviewPending==='read'?'Notes could not be opened. Check the agent connection, then reload.':'That change could not be confirmed. Reload Notes to see what was saved.';
  return this.controller.revision===null?'Opening Notes…':'';
 }
 renderState(previous:Bag):Bag{return {...previous,...DEVICE_ONLY_STATE,list:this.list,open:this.open,storageStatus:this.status(),blankCreationId:this.blankCreationValue};}
 async refresh():Promise<void>{await this.controller.refresh();}
 retire():void{this.editor.close();this.controller.retire();this.baseRows=[];this.rowsValue=[];this.openValue=null;this.trashValue=[];}
 /** Wait out an in-flight save and the follow-up it queued for edits typed meanwhile. */
 private async settle():Promise<void>{
  for(let attempt=0;attempt<8&&this.controller.pending;attempt++){await new Promise<void>(resume=>this.idleWaiters.push(resume));await new Promise(resume=>setTimeout(resume,0));}
 }
 /** Leaves the open note as Back does: its edits are saved first, an empty new note is dropped. */
 async leave(next:string|null=null):Promise<boolean>{
  await this.settle();
  const draft=this.editor.draft;
  if(draft?.version&&(draft.id||this.editor.hasAuthoredContent)&&!await this.editor.save())return false;
  // The awaited save may have been retired or replaced while pending.
  if(!this.controller.current||draft&&this.editor.draft?.token!==draft.token)return false;
  if(next===null){this.editor.close();return true;}
  if(!this.controller.hasViewNote(next))return false;
  this.editor.open(next);return true;
 }
 /** A new note's card id ('draft-'+token) names its draft; once the first save commits it names that record. */
 private resolve(id:string):string{const draft=this.editor.draft;return draft&&id==='draft-'+draft.token?draft.id??id:id;}
 /** Opens one record (or closes the editor) after the current draft is saved. */
 select(id:string|null):void{void this.leave(id).catch(()=>this.needsReview());}
 async create(kind:'text'|'list'='text'):Promise<boolean>{
  try{
   if(!await this.leave(null))return false;
   if(this.controller.revision===null)await this.controller.refresh();
   this.editor.begin(kind);if(kind==='list')this.editor.edit({format:{kind:'list',data:{items:[],pinned:false}}});return true;}
  catch{if(this.controller.current)this.needsReview();return false;}
 }
 async update(id:string,patch:Bag|((record:Bag)=>Bag)):Promise<boolean>{
  try{
   id=this.resolve(id);if(this.open!==id)this.editor.open(id);
   const original=this.list.find(row=>row.id===id);if(!original)throw Error('Current canonical note unavailable.');
   const next=typeof patch==='function'?patch(structuredClone(original)):patch;
   if(!next||typeof next!=='object'||Array.isArray(next)||next.id!==undefined&&next.id!==id)throw Error('Editor target changed.');
   const draft=this.editor.draft!,data:Bag={...structuredClone(draft.format?.data??{})};let richChanged=false;
   for(const [key,value]of Object.entries(next))if(!VIEW_FIELDS.has(key)&&!LOCAL_HANDLES.includes(key)){data[key]=value;richChanged=true;}
   const kind=next.kind??draft.format?.kind??'text';
   this.editor.edit({...(next.title===undefined?{}:{title:next.title}),...(next.body===undefined?{}:{body:next.body}),...(richChanged||next.kind!==undefined?{format:parseNoteFormat({kind,data})}:{})});
   return await this.editor.save();
  }catch{this.needsReview();return false;}
 }
 async remove(id:string,api:Bag):Promise<boolean>{
  // A delete while a save is in flight waits for it; a new note that was never saved is only closed.
  await this.settle();id=this.resolve(id);
  if(!this.controller.current)return false;
  if(this.editor.draft&&!this.editor.draft.id&&id===this.open){this.editor.close();return true;}
  const title=this.list.find(row=>row.id===id)?.title||'Note';
  const removed=await this.editor.remove(id);
  if(removed&&this.controller.current)api.toast(`${title} moved to Trash`,{undo:()=>void this.editor.restore(id)});
  return removed;
 }
 async saveCard(content:string,api:Bag):Promise<boolean>{
  try{const result=await this.controller.interact('create-note',{content});if(!this.controller.current||!result.target)return false;this.hooks.committed?.(result.target.id);return true;}
  catch{if(this.controller.current){api.toast('Could not confirm the save. Check Notes before trying again.');this.needsReview();}return false;}
 }
 async discardDraftAndReload():Promise<void>{
  const id=this.editor.draft?.id;this.reviewPending=false;this.failure=null;this.editor.close();
  try{await this.controller.refresh();if(id&&this.controller.hasViewNote(id))this.editor.open(id);}catch{this.needsReview();}
 }
 /** A reviewed Calendar event or reminder draft from the open record. Nothing is written until Save in Calendar; the saved record keeps the draft's canonical origin link. */
 private async scheduleDraft(id:string,kind:NoteScheduleKind,api:Bag):Promise<void>{
  if(this.editor.draft?.version&&!await this.leave(id))return;
  const note=this.controller.viewNote(id);if(!note||!api.isActive()||this.open!==id)return;
  const result=await noteScheduleDraft(note,kind);
  if(!this.controller.current||!api.isActive()||this.open!==id)return;
  if(result.status!=='ready'){api.toast(result.message);return;}
  const {draft}=result,shared={id:null,title:draft.title,off:1,t:9,d:1,where:'',video:false,who:[],repeat:'none',notes:draft.notes,origin:draft.origin};
  api.open('calendar',{calendarAuthority:api.get('calendar').calendarAuthority,form:kind==='event'?{...shared,creationId:crypto.randomUUID(),separateCreation:false,cal:'native:local',alert:null}:{...shared,cal:'alpha-reminders',alert:0},open:null,month:null,day:1},'hidden');
  api.toast(kind==='event'?'Review the time, then Save. Nothing is on your calendar yet.':'Review the time, then Save. Nothing scheduled yet.');
 }
 /** Speech recognition through the platform port; the transcript lands at the caret of the note it was started from. */
 private async dictate(id:string,api:Bag):Promise<void>{
  const before=this.list.find(row=>row.id===id);if(!before)return;
  if(before.kind==='list'){api.toast('Convert this checklist to text before dictating.');return;}
  const editor=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]'),caret=editor&&editor.value===before.body?editor:null,start=caret?caret.selectionStart:before.body.length,end=caret?caret.selectionEnd:before.body.length;
  try{
   const result=await DailyApps.perform({action:'voice'});
   // A new note's first save (a title typed while listening) names its record by now.
   id=this.resolve(id);
   if(!this.controller.current||this.open!==id)return;
   if(typeof result.transcript!=='string'||!result.transcript){api.toast(result.message||'Speech recognition is unavailable.');return;}
   const current=this.list.find(row=>row.id===id);if(!current)return;
   const body=current.body===before.body?current.body.slice(0,start)+result.transcript+current.body.slice(end):[current.body,result.transcript].filter(Boolean).join('\n');
   await this.update(id,{body});
  }catch{api.toast('Speech recognition is unavailable.');}
 }
 /** The header waveform: a new note, then the editor's dictation into its body. It saves like typing after +
  * (create, then expectedRevision updates), so it is an ordinary agent note; no audio is kept. */
 private async dictateNew(api:Bag):Promise<void>{
  if(!await this.create('text'))return;
  const id=this.open;if(id)await this.dictate(id,api);
 }
 /** Canonical behaviour on top of Alpha's Notes view: restore-only Trash under the list, review and reload, dictation instead of device recording. */
 decorate(view:Bag,api:Bag,state:Bag):Bag{
  const rows=this.controller.current?this.trashValue:[],ready=this.controller.revision!==null,busy=this.controller.pending,open=this.open,saved=!!open&&this.controller.hasViewNote(open);
  const out:Bag={...view,none:ready&&this.phase!=='review'&&view.none,canRecord:false,canDictateNew:true,dictateNew:()=>void this.dictateNew(api),canImportText:false,browserRecovery:false,audioDeletionUnknown:false,createDisabled:!ready,
   canonicalReview:this.phase==='review',canonicalReviewLabel:this.editor.draft?.version?'Discard draft and reload':'Reload Notes',canonicalReviewAction:()=>void this.discardDraftAndReload(),
   trashAvailable:false,trashInList:true,trashOpen:!!state.trashOpen,trashCanErase:false,trashRetentionText:'Deleted notes are kept here for recovery.',trashLabel:rows.length?`Trash, ${rows.length} item${rows.length===1?'':'s'}`:'Trash',trashNone:ready&&this.phase!=='review'&&rows.length===0,trashError:'',trashBusy:busy,trashEmptyDisabled:true,trashConfirmOpen:false,trashFullOpen:false,
   trashRows:rows.map(row=>({id:row.id,title:row.title||'Untitled',kind:row.kind==='list'?'Checklist':row.kind==='voice'?'Voice note':row.kind==='link'?'Link':'Note',left:'Recoverable',restoreLabel:`Restore ${row.title||'note'}`,disabled:busy,restore:()=>void this.editor.restore(row.id)})),
   openTrash:()=>{void this.leave(null).then(left=>{if(left&&this.controller.current){api.set({trashOpen:true,sheet:null,q:null});void this.controller.refresh().catch(()=>{});}});},
   closeTrash:()=>api.set({trashOpen:false}),emptyTrash:()=>{},trashConfirmGo:()=>{},trashCancel:()=>api.set({trashConfirm:null,trashFull:null})};
  if(out.ed&&open){out.ed={...out.ed,dictate:()=>void this.dictate(open,api),...(saved?{draftReminder:()=>void this.scheduleDraft(open,'reminder',api),draftEvent:()=>void this.scheduleDraft(open,'event',api)}:{})};}
  if(out.vo&&open){out.vo={...out.vo,hasPlayback:false,play:()=>api.toast('No audio is available for this note.'),
   toCal:()=>void this.scheduleDraft(open,'reminder',api),calLabel:'Review reminder draft',calText:'Review reminder',calIcon:api.ic?.cal??out.vo.calIcon,
   toEvent:()=>void this.scheduleDraft(open,'event',api),eventLabel:'Review calendar event draft',eventText:'Review event'};}
  return out;
 }
 /** Decorate this view's API only. No global client or shared NotesStore swap. */
 api(original:Bag):Bag{
  return {...original,canonicalNotes:this,notesSourceMode:'canonical',notesTrash:undefined,moveNoteToTrash:undefined,storageReady:()=>this.controller.current&&this.controller.revision!==null&&!this.controller.pending,
   set:(patch:Bag)=>{
    if(patch.record===true||patch.rec){original.toast('Recording is not available in agent Notes. Nothing was recorded.');return false;}
    const rest={...patch};
    if(Object.hasOwn(rest,'open')){this.select(rest.open??null);delete rest.open;}
    if(rest.compose){void this.create('text');rest.compose=false;}
    return Object.keys(rest).length?original.set(rest):true;
   }};
 }
}

/** Live Notes render through Alpha's own template (model.js); a bound connection decorates it with the canonical client, else it waits for one. */
export function installCanonicalNotesView(Component:any,views:Record<string,Bag>):void{
 const prototype=Component.prototype,get=prototype.vget,api=prototype.api;
 prototype.vget=function(key:string){const state=get.call(this,key);return key==='notes'&&this.canonicalNotesUi?this.canonicalNotesUi.renderState(state):state;};
 prototype.api=function(key:string){
  const value=api.call(this,key);if(key!=='notes')return value;
  if(this.canonicalNotesUi)return this.canonicalNotesUi.api(value);
  // Agent Notes are the default source (agent-adapter.ts); Older notes is an explicit choice.
  if(this.notesSourceMode==='legacy')return value;
  // Waiting for a connection: an attempted action explains why, nothing is drafted.
  return {...value,notesSourceMode:'canonical',notesTrash:undefined,moveNoteToTrash:()=>false,set:(patch:Bag)=>{if(patch.compose||patch.record===true){value.toast(this.vget('notes').storageStatus||agentPendingText(undefined,UNAVAILABLE));return false;}return value.set(patch);}};
 };
 const notes=views.notes,render=notes.render;
 notes.render=(state:Bag,value:Bag)=>{
  const ui:CanonicalNotesUi|undefined=value.canonicalNotes,sources=value.notesSourceOptions??[],older=sources.find((source:Bag)=>source.id==='legacy'),main=sources.find((source:Bag)=>source.id==='canonical');
  if(value.notesSourceMode!=='canonical')return {...render(state,value),notesTitle:'Older notes',primaryNotes:false,returnToNotesAction:main?.choose};
  const olderNotesAction=older&&!older.selected?older.choose:null;
  if(ui)return {...ui.decorate(render(state,value),value,state),olderNotesAction,listActions:true};
  // A pending New note request waits for the binding instead of drafting into no collection.
  const waiting={...state,...DEVICE_ONLY_STATE,list:[],open:null,compose:false,trashOpen:false,storageStatus:state.storageStatus||agentAvailabilityNotice(undefined,UNAVAILABLE)};
  return {...render(waiting,value),storageStatus:waiting.storageStatus,none:false,canCreate:false,browserRecovery:false,audioDeletionUnknown:false,trashAvailable:false,canRecord:false,canImportText:false,olderNotesAction,listActions:!!olderNotesAction};
 };
}
