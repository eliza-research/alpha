/**
 * Notes folders (PLAN.md section 3, decision N1): one folder per note, as in Apple Notes. A note
 * names its folder by `folderId`; the folder list lives in its own encrypted device slot beside
 * the notes collection. A note whose folder no longer exists is shown under "no folder", so
 * deleting a folder never hides or trashes a note (specs/notes-view FolderRefsValid).
 */
export const NOTES_FOLDERS_SLOT='notes-folders:v1:device';
export const browserNotesFoldersKey='alpha.browser.'+NOTES_FOLDERS_SLOT;
export const NOTES_FOLDER_LIMIT=100;
export const NOTES_FOLDER_NAME_MAX=40;
export interface NotesFolder {id:string;name:string;createdAt:number}
export interface NotesFoldersDocument {version:1;folders:NotesFolder[]}
const FOLDER_ID=/^f-[A-Za-z0-9_-]{1,64}$/;

export function emptyNotesFolders():NotesFoldersDocument{return {version:1,folders:[]};}
/** A folder name as stored: trimmed, single-spaced, at most 40 characters. Throws when empty. */
export function notesFolderName(value:unknown):string{
 if(typeof value!=='string'||value.includes('\0'))throw Error('Invalid folder name');
 const name=value.replace(/\s+/g,' ').trim();
 if(!name||name.length>NOTES_FOLDER_NAME_MAX)throw Error('Invalid folder name');
 return name;
}
const key=(name:string)=>name.normalize('NFKC').toLowerCase();
export function validateNotesFolders(value:unknown):NotesFoldersDocument{
 if(value===null||value===undefined)return emptyNotesFolders();
 const doc=value as Partial<NotesFoldersDocument>;
 if(typeof value!=='object'||Array.isArray(value)||doc.version!==1||!Array.isArray(doc.folders)||doc.folders.length>NOTES_FOLDER_LIMIT||Object.keys(value).some(k=>k!=='version'&&k!=='folders'))throw Error('Invalid Notes folders');
 const ids=new Set<string>(),names=new Set<string>();
 const folders=doc.folders.map(entry=>{
  const row=entry as Partial<NotesFolder>;
  if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['id','name','createdAt'].includes(k))||typeof row.id!=='string'||!FOLDER_ID.test(row.id)||ids.has(row.id)||!Number.isSafeInteger(row.createdAt)||(row.createdAt as number)<0)throw Error('Invalid Notes folder');
  const name=notesFolderName(row.name);if(name!==row.name||names.has(key(name)))throw Error('Invalid Notes folder');
  ids.add(row.id);names.add(key(name));
  return {id:row.id,name,createdAt:row.createdAt as number};
 });
 return {version:1,folders};
}
export function findNotesFolderByName(doc:NotesFoldersDocument,name:string):NotesFolder|undefined{
 const wanted=key(name.replace(/\s+/g,' ').trim());return doc.folders.find(folder=>key(folder.name)===wanted);
}
/** Adds a folder, or returns the document unchanged when one with that name exists. */
export function addNotesFolder(doc:NotesFoldersDocument,folder:NotesFolder):NotesFoldersDocument{
 const current=validateNotesFolders(doc),name=notesFolderName(folder.name);
 if(findNotesFolderByName(current,name))return current;
 if(current.folders.length>=NOTES_FOLDER_LIMIT)throw Error('Folder limit reached');
 return validateNotesFolders({version:1,folders:[...current.folders,{id:folder.id,name,createdAt:folder.createdAt}]});
}
/**
 * Renames a folder in place. The id is kept, so every note in the folder stays in it
 * (specs/notes-view RenameFolder). A name another folder already uses is refused.
 */
export function renameNotesFolder(doc:NotesFoldersDocument,id:string,name:string):NotesFoldersDocument{
 const current=validateNotesFolders(doc),next=notesFolderName(name);
 if(!current.folders.some(folder=>folder.id===id))throw Error('Folder not found');
 const other=findNotesFolderByName(current,next);
 if(other&&other.id!==id)throw Error('Folder name in use');
 return validateNotesFolders({version:1,folders:current.folders.map(folder=>folder.id===id?{...folder,name:next}:folder)});
}
export function removeNotesFolder(doc:NotesFoldersDocument,id:string):NotesFoldersDocument{
 const current=validateNotesFolders(doc);return {version:1,folders:current.folders.filter(folder=>folder.id!==id)};
}
export function newNotesFolderId():string{return 'f-'+crypto.randomUUID();}

type FolderNote={id:string;folderId?:unknown};
/** The folder a note is shown in: its folderId when that folder exists, otherwise none. */
export function noteFolderOf(note:FolderNote,folders:readonly Pick<NotesFolder,'id'>[]):string|null{
 return typeof note.folderId==='string'&&folders.some(folder=>folder.id===note.folderId)?note.folderId:null;
}
/** The record moved to a folder (or to no folder when null). Unchanged records are returned as is. */
export function withNoteFolder<N extends FolderNote>(note:N,folderId:string|null):N{
 if(folderId===null){if(!Object.hasOwn(note,'folderId'))return note;const {folderId:_,...rest}=note;return rest as N;}
 return note.folderId===folderId?note:{...note,folderId};
}
/** Deleting a folder moves its notes to no folder; it never removes or trashes a note. */
export function releaseNotesFolder<N extends FolderNote>(list:readonly N[],folderId:string):N[]{
 return list.map(note=>note.folderId===folderId?withNoteFolder(note,null):note);
}
/** A restored note returns to its folder, or to no folder when that folder was deleted meanwhile. */
export function restoredNoteFolder<N extends FolderNote>(note:N,folders:readonly Pick<NotesFolder,'id'>[]):N{
 return note.folderId===undefined||noteFolderOf(note,folders)!==null?note:withNoteFolder(note,null);
}
