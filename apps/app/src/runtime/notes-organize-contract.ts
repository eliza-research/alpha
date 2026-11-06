import {notesTarget,type NotesTarget} from './notes-contract.ts';
import {notesFolderName} from './notes-folders-model.ts';
import {NOTES_KINDS,type NotesKind} from './notes-view.ts';

/**
 * Agent tools for Notes organisation (PLAN.md section 3). `notes_filter` only changes what the
 * Notes list shows and is read-only. Moving a note, creating a folder and restoring from Recently
 * deleted change saved data, so each is a proposal the owner approves on the phone first; a move is
 * bound to the reviewed note revision and refused if the note changed (specs/notes-view
 * AgentMoveOnlyReviewed). Folders are named, never addressed by internal id. `notes_record` starts
 * or stops (and saves) a voice note with the Notes recorder, only while Notes is open; it runs
 * directly only when the owner's own message asked for it, like `create_note`.
 */
export type NotesOrganizeOperation =
 | {type:'notes_filter';text?:string;folder?:string;kind?:NotesKind}
 | {type:'notes_move';target:NotesTarget;folder:string|null}
 | {type:'notes_folder_create';name:string}
 | {type:'notes_restore';noteId:string}
 | {type:'notes_record';action:'start'|'stop'};
/** Negotiated with the agent before any of these proposals is accepted. */
export const NOTES_ORGANIZE_CAPABILITY='notes.organize.v1';
export const NOTES_ORGANIZE_TYPES:readonly string[]=['notes_filter','notes_move','notes_folder_create','notes_restore','notes_record'];
export function isNotesOrganizeOperation(value:unknown):value is NotesOrganizeOperation{
 return !!value&&typeof value==='object'&&NOTES_ORGANIZE_TYPES.includes(String((value as {type?:unknown}).type));
}
function only(op:Record<string,unknown>,keys:string[]){for(const key of Object.keys(op))if(!keys.includes(key))throw Error('Unexpected Notes field');}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw Error('Invalid Notes text');return value.trim();}
export function validateNotesOrganizeOperation(value:unknown):NotesOrganizeOperation{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Notes operation');
 const op=value as Record<string,unknown>;
 if(op.type==='notes_filter'){
  only(op,['type','text','folder','kind']);
  if(op.kind!==undefined&&!NOTES_KINDS.includes(op.kind as NotesKind))throw Error('Invalid note kind');
  const out:NotesOrganizeOperation={type:'notes_filter',...(op.text!==undefined?{text:text(op.text,200)}:{}),...(op.folder!==undefined?{folder:notesFolderName(op.folder)}:{}),...(op.kind!==undefined?{kind:op.kind as NotesKind}:{})};
  if(out.text===undefined&&out.folder===undefined&&out.kind===undefined)throw Error('Empty Notes filter');
  return out;
 }
 if(op.type==='notes_move'){
  only(op,['type','target','folder']);
  if(!Object.hasOwn(op,'folder'))throw Error('Missing folder');
  return {type:'notes_move',target:notesTarget(op.target),folder:op.folder===null?null:notesFolderName(op.folder)};
 }
 if(op.type==='notes_folder_create'){only(op,['type','name']);return {type:'notes_folder_create',name:notesFolderName(op.name)};}
 if(op.type==='notes_restore'){
  only(op,['type','noteId']);
  const id=text(op.noteId,128);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))throw Error('Invalid note identity');
  return {type:'notes_restore',noteId:id};
 }
 if(op.type==='notes_record'){
  only(op,['type','action']);
  if(op.action!=='start'&&op.action!=='stop')throw Error('Invalid recording action');
  return {type:'notes_record',action:op.action};
 }
 throw Error('Unsupported Notes operation');
}
const quoted=(value:string)=>`“${value}”`;
/** The approval card. Short: the change itself, nothing else. */
export function describeNotesOrganizeOperation(op:NotesOrganizeOperation):{title:string;description:string}{
 if(op.type==='notes_filter')return {title:'Show notes',description:[op.text?quoted(op.text):'',op.kind?{text:'Notes',list:'Checklists',voice:'Voice notes',link:'Links'}[op.kind]:'',op.folder?`In ${op.folder}`:''].filter(Boolean).join(' · ')};
 if(op.type==='notes_move')return {title:'Move note',description:op.folder===null?'To no folder':`To ${op.folder}`};
 if(op.type==='notes_folder_create')return {title:'New folder',description:op.name};
 if(op.type==='notes_record')return op.action==='start'?{title:'Record voice note',description:'In Notes'}:{title:'Stop recording',description:'Save as a voice note'};
 return {title:'Restore note',description:'From Recently deleted'};
}
/** Where each proposal may be reviewed: the unlocked phone, on Home or in Notes; recording only in Notes. */
export function notesOrganizeContextAllowed(context:{view:string;sensitive?:boolean},type?:NotesOrganizeOperation['type']):boolean{
 return !context.sensitive&&(type==='notes_record'?context.view==='notes':['home','notes'].includes(context.view));
}
