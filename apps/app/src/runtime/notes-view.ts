import {noteFolderOf,type NotesFolder} from './notes-folders-model.ts';

/**
 * Pure Notes list helpers (PLAN.md section 3): one-column rows with title, date and a two-line
 * preview, pinned notes first, folder chips and the agent's read-only filter. Dependency-free so
 * test/notes-view.test.mjs exercises it directly.
 */
type Note={id:string;kind?:unknown;title?:unknown;body?:unknown;items?:unknown;lines?:unknown;summary?:unknown;actions?:unknown;domain?:unknown;clips?:unknown;audio?:unknown;pinned?:unknown;folderId?:unknown;modifiedAt?:unknown;updatedAt?:unknown;createdAt?:unknown};
export type NotesKind='text'|'list'|'voice'|'link';
export const NOTES_KINDS:readonly NotesKind[]=['text','list','voice','link'];
/** A read-only list filter set by the agent and cleared from its chip. `folder` is a folder id. */
export interface NotesFilter {text?:string;folder?:string;kind?:NotesKind}

const strings=(value:unknown,key?:string):string[]=>!Array.isArray(value)?[]:value.flatMap(item=>typeof item==='string'?[item]:key&&item&&typeof item==='object'&&typeof (item as Record<string,unknown>)[key]==='string'?[(item as Record<string,string>)[key]]:[]);
const fold=(value:string)=>value.normalize('NFKC').toLowerCase();
/** A saved recording's transcript (voice notes keep it beside the audio reference). */
const transcript=(note:Note):string=>{const audio=note.audio as {transcript?:unknown}|null|undefined;return audio&&typeof audio==='object'&&typeof audio.transcript==='string'?audio.transcript:'';};
/** Every piece of text a note holds: title, body, checklist items, voice transcript lines, summary and to-dos. */
export function noteSearchText(note:Note):string{
 return [typeof note.title==='string'?note.title:'',typeof note.body==='string'?note.body:'',...strings(note.items,'t'),...strings(note.lines,'t'),transcript(note),...strings(note.summary),...strings(note.actions,'t'),typeof note.domain==='string'?note.domain:'',...strings(note.clips)].filter(Boolean).join('\n');
}
/** True when the note's text contains `text` (case and Unicode-form insensitive). An empty text matches. */
export function noteMatchesText(note:Note,text:string):boolean{
 const needle=fold(text).trim();
 return !needle||fold(noteSearchText(note)).includes(needle);
}
export function filterNotes<N extends Note>(list:readonly N[],filter:NotesFilter|null|undefined,folders:readonly Pick<NotesFolder,'id'>[]):N[]{
 if(!filter)return [...list];
 return list.filter(note=>(!filter.kind||note.kind===filter.kind)&&(filter.folder===undefined||noteFolderOf(note,folders)===filter.folder)&&(!filter.text||noteMatchesText(note,filter.text)));
}
const KIND_LABEL:Record<NotesKind,string>={text:'Notes',list:'Checklists',voice:'Voice notes',link:'Links'};
/** The chip text for an active filter, e.g. “term sheet” · Voice notes · Work. */
export function notesFilterLabel(filter:NotesFilter,folders:readonly Pick<NotesFolder,'id'|'name'>[]):string{
 const folder=filter.folder===undefined?undefined:folders.find(f=>f.id===filter.folder)?.name;
 return [filter.text?`“${filter.text}”`:'',filter.kind?KIND_LABEL[filter.kind]:'',folder??''].filter(Boolean).join(' · ')||'All notes';
}
export function noteInstant(note:Note):number{
 const value=note.modifiedAt??note.updatedAt??note.createdAt;
 const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
 return Number.isFinite(at)?at:-1;
}
/**
 * Pinned notes first, then newest first; ties keep their stored order. A note with no time (an
 * older device note) is placed by its stored position, which is newest first: it counts as at
 * least as new as every note stored after it.
 */
export function sortNotes<N extends Note>(list:readonly N[]):N[]{
 const at=list.map(noteInstant);
 for(let i=at.length-2;i>=0;i--)if(at[i]<0)at[i]=Math.max(at[i],at[i+1]);
 return list.map((note,index)=>({note,index,at:at[index]})).sort((a,b)=>Number(!!b.note.pinned)-Number(!!a.note.pinned)||b.at-a.at||a.index-b.index).map(x=>x.note);
}
/** The two-line preview: body text, checklist items with their state, a voice transcript or a link's domain. */
export function notePreview(note:Note):string{
 let text='';
 if(note.kind==='list')text=(Array.isArray(note.items)?note.items:[]).map(item=>{const it=item as {t?:unknown;done?:unknown};return typeof it?.t==='string'?(it.done?'☑ ':'☐ ')+it.t:'';}).filter(Boolean).join('\n');
 else if(note.kind==='link')text=typeof note.domain==='string'?note.domain:'';
 else text=typeof note.body==='string'&&note.body.trim()?note.body:strings(note.lines,'t').join(' ')||transcript(note);
 return text.replace(/[ \t]+/g,' ').trim().slice(0,240);
}
/** Short list date: the time today, the weekday within a week, otherwise the date. Empty when unknown. */
export function noteDateLabel(note:Note,now:number,locale?:string,timeZone?:string):string{
 const at=noteInstant(note);if(at<0)return '';
 const day=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
 if(day(at)===day(now))return new Intl.DateTimeFormat(locale,{timeZone,hour:'numeric',minute:'2-digit'}).format(at);
 if(at<now&&now-at<6*24*60*60*1000)return new Intl.DateTimeFormat(locale,{timeZone,weekday:'short'}).format(at);
 const sameYear=new Intl.DateTimeFormat('en',{timeZone,year:'numeric'}).format(at)===new Intl.DateTimeFormat('en',{timeZone,year:'numeric'}).format(now);
 return new Intl.DateTimeFormat(locale,sameYear?{timeZone,month:'short',day:'numeric'}:{timeZone,year:'numeric',month:'short',day:'numeric'}).format(at);
}
