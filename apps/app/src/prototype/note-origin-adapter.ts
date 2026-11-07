import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from '../runtime/native-connection';
import {addNoteOrigin,removeNoteOrigin,findNoteLink,noteOriginIndex,noteLinkOf,noteOriginTitle,recordNoteRevision,resolveNoteLink,resolveNoteOrigin,type NoteLink,type NoteOrigin,type NoteOriginKind,type NoteOriginIndex} from '../runtime/note-origin';
import {recordingRevision} from './summary-source';
type Bag=Record<string,any>;
const slot='note-origins:v1:device';
let cache:NoteOriginIndex|null=null,loading:Promise<void>|null=null;
const listeners=new Set<()=>void>();
let browserDocument:Promise<{readJson<T>():Promise<T|null>;editJson<T>(update:(value:T|null)=>T|null):Promise<void>}>|null=null;
const browser=()=>browserDocument??=import('../browser/json-domain-document').then(m=>new m.BrowserJsonDomainDocument('alpha.browser.'+slot));
const native=()=>Capacitor.getPlatform()==='android';
/** The stored links, validated. */
export async function readNoteOrigins(){return noteOriginIndex(native()?await secureConnectionStore.read<NoteOriginIndex>(slot):await (await browser()).readJson<NoteOriginIndex>());}
async function change(update:(index:NoteOriginIndex)=>NoteOriginIndex){
 if(native()){
  const raw=await secureConnectionStore.read<NoteOriginIndex>(slot),index=noteOriginIndex(raw),next=update(index);
  if(next!==index&&(await secureConnectionStore.compareExchange(slot,raw,next)).status!=='saved')throw Error('Note links changed.');
 }else await (await browser()).editJson<NoteOriginIndex>(raw=>{const index=noteOriginIndex(raw),next=update(index);return next===index?raw:next;});
 cache=await readNoteOrigins();for(const listener of listeners)listener();
}
/** Reads the saved links once. A failed read shows no links; it never invents one. */
export function loadNoteOrigins(){return loading??=readNoteOrigins().then(index=>{cache=index;for(const listener of listeners)listener();},()=>{loading=null;});}
/** Reminders and in-app (browser) events are linked by their ids. Device calendar row ids are
 * provider-assigned and can be reused after a deletion, so a native event is linked by the
 * creationId Alpha saved it with, which the pinned calendar reader returns on events this app
 * created (elizaOS/eliza#35912). That id is a link, not proof of ownership: another app with
 * calendar write access can set the same fields. */
export const noteOriginSupported=(kind:NoteOriginKind)=>kind==='reminder'||kind==='event';
const CREATION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The note-origin key of a listed calendar event: its creationId on Android (absent for events
 * Alpha did not create, which then have no link), its series or event id in the browser calendar. */
export function eventNoteOriginId(event:Bag|undefined):string|undefined{
 if(!event)return undefined;
 if(Capacitor.isNativePlatform())return typeof event.creationId==='string'&&CREATION_ID.test(event.creationId)?event.creationId:undefined;
 const id=event.seriesId||event.id;return id==null||id===''?undefined:String(id);
}
/** Links a record that was just saved to the note its draft came from. Resolves false when the link
 * was not stored; the saved record itself is never affected. */
export async function rememberNoteOrigin(kind:NoteOriginKind,id:string,value:unknown):Promise<boolean>{
 const origin=noteLinkOf(value);if(!origin||!id||!noteOriginSupported(kind))return false;
 try{await change(index=>addNoteOrigin(index,kind,id,origin,Date.now()));return JSON.stringify(savedNoteOrigin(kind,id))===JSON.stringify(origin);}catch{return false;}
}
export async function forgetNoteOrigin(kind:NoteOriginKind,id:string):Promise<void>{try{await change(index=>removeNoteOrigin(index,kind,id));}catch{/* An orphaned link names no existing record. */}}
/** A recording link (Older notes, version 1) or a canonical Notes record link (version 2). */
export function savedNoteOrigin(kind:NoteOriginKind,id:string):NoteLink|undefined{return cache&&id?findNoteLink(cache,kind,id):undefined;}

/** Shows "From note" on a saved reminder or event and opens that exact note, or nothing. */
export function installNoteOriginAdapter(Component:Bag,views:Bag){
 const p=Component.prototype,mount=p.componentDidMount,unmount=p.componentWillUnmount,render=views.calendar.render;
 p.componentDidMount=function(){mount.call(this);shell=this;this.noteOriginChanged=()=>{if(this.live!==false)this.vset('calendar',{});};listeners.add(this.noteOriginChanged);void loadNoteOrigins();};
 p.componentWillUnmount=function(){listeners.delete(this.noteOriginChanged);unmount.call(this);};
 let opening=false,shell:Bag|undefined;
 /** Links point at recordings in Older notes. While that source is not the open, loaded list, a
  * missing note proves nothing: say where the note lives and resolve it only after opening it. */
 const olderNotesOpen=()=>!shell||shell.notesSourceMode==='legacy'&&!!shell.notesLegacySource&&!shell.notesStorageFailed;
 const openOlderNotes=async()=>{
  if(olderNotesOpen())return true;
  const legacy=shell?.api?.('notes')?.notesSourceOptions?.find((source:Bag)=>source.id==='legacy');
  if(!legacy)return false;legacy.choose();await Promise.resolve(shell?.notesReady).catch(()=>{});
  return olderNotesOpen();
 };
 /** The open Older notes list; the store's copy is current before the view state catches up. */
 const olderNotes=(api:Bag)=>(shell&&olderNotesOpen()?shell.notesStore?.list:undefined)??api.get('notes')?.list;
 views.calendar.render=(state:Bag,api:Bag)=>{
  const out=render(state,api),selected=out.ev&&state.open?(state.events||[]).find((e:Bag)=>e.id===state.open):undefined;
  const origin=selected?.alphaReminderId?savedNoteOrigin('reminder',selected.alphaReminderId):selected?.alphaCalendarId?savedNoteOrigin('event',eventNoteOriginId(selected.nativeEvent)||''):undefined;
  if(!origin||!out.ev)return out;
  const openId=state.open;
  if(origin.version===2)return canonicalOrigin(out,origin,api,openId);
  // The title is the note's current one. A link whose note is gone names no note at all.
  const known=olderNotesOpen(),live=known?resolveNoteOrigin(origin as NoteOrigin,olderNotes(api)):undefined,name=live?.status==='found'?noteOriginTitle(live.note):'';
  out.ev.hasOrigin=true;out.ev.originLabel=!known?'From a voice note in Older notes':name?`From note: ${name}`:'From a note that is no longer in Notes';out.ev.originOpenLabel=name?`Open note ${name}`:'Open note';
  out.ev.openOrigin=async()=>{
   if(opening)return;opening=true;
   try{
    const gone=()=>api.toast('The note this came from was deleted or replaced. Nothing was opened.');
    if(!await openOlderNotes()){if(api.isActive()&&!document.hidden)api.toast('Older notes could not be opened. Nothing was changed.');return;}
    if(!api.isActive()||document.hidden||api.get('calendar').open!==openId)return;
    const found=resolveNoteOrigin(origin as NoteOrigin,olderNotes(api));
    if(found.status!=='found'){gone();return;}
    const changed=await recordingRevision(found.note)!==origin.revision;
    if(!api.isActive()||document.hidden||api.get('calendar').open!==openId)return;
    // The note may have been deleted while its revision was computed.
    if(resolveNoteOrigin(origin as NoteOrigin,olderNotes(api)).status!=='found'){gone();return;}
    api.open('notes',{open:origin.noteId});
    if(changed)api.toast('This note was edited after this was created from it.');
   }finally{opening=false;}
  };
  return out;
 };
 /** A canonical Notes record link: resolved against the open agent Notes collection only. */
 const canonicalNotes=()=>shell?.canonicalNotesUi?.current?shell.canonicalNotesUi:undefined;
 const canonicalOrigin=(out:Bag,origin:NoteLink,api:Bag,openId:unknown)=>{
  const ui=canonicalNotes(),live=ui?resolveNoteLink(origin,ui.notes()):undefined,name=live?.status==='found'?noteOriginTitle(live.note,'Note'):'';
  out.ev.hasOrigin=true;out.ev.originLabel=!ui?'From a note in Notes':name?`From note: ${name}`:'From a note that is no longer in Notes';out.ev.originOpenLabel=name?`Open note ${name}`:'Open note';
  out.ev.openOrigin=async()=>{
   if(opening)return;opening=true;
   try{
    const notes=canonicalNotes(),found=notes?resolveNoteLink(origin,notes.notes()):undefined;
    if(!notes){if(api.isActive()&&!document.hidden)api.toast('Notes is unavailable for this agent connection. Nothing was opened.');return;}
    if(found?.status!=='found'){api.toast('The note this came from was deleted or replaced. Nothing was opened.');return;}
    const changed=await recordNoteRevision(found.note as {id:string})!==origin.revision;
    if(!api.isActive()||document.hidden||api.get('calendar').open!==openId||canonicalNotes()!==notes)return;
    if(resolveNoteLink(origin,notes.notes()).status!=='found'){api.toast('The note this came from was deleted or replaced. Nothing was opened.');return;}
    api.open('notes',{});notes.select(origin.noteId);
    if(changed)api.toast('This note was edited after this was created from it.');
   }finally{opening=false;}
  };
  return out;
 };
}
