import {addNotesFolder,editNotesFolders,findNotesFolderByName,newNotesFolderId,readNotesFolders,releaseNotesFolder,removeNotesFolder,renameNotesFolder,type NotesFolder} from '../runtime/notes-folders';
type Bag=Record<string,any>;
type Shell=any;

/**
 * Notes folders for live Notes (PLAN.md section 3, decision N1). The folder list is its own
 * encrypted slot (runtime/notes-folders); a note names its folder by `folderId` in the notes
 * collection. The list view reads `folders` from the Notes view state; model.js calls
 * api.notesFolders to create, rename or delete one; renaming keeps the id, so membership is unchanged. Deleting a folder removes it first, so nothing can be
 * moved into it, then moves its notes to no folder (specs/notes-view DeleteFolder,
 * FolderRefsValid): a reference left behind by an interrupted release reads as no folder.
 */
export function installNotesFoldersAdapter(Component:Shell,views:Record<string,Bag>){
 const notes=views.notes,render=notes.render;
 const p=Component.prototype,originalApi=p.api;
 let loading:Promise<void>|null=null;

 async function load(shell:Shell){
  try{const doc=await readNotesFolders();if(shell.live)shell.vset('notes',{folders:doc.folders,foldersLoaded:true});}
  catch{if(shell.live)shell.vset('notes',{folders:[],foldersLoaded:true});}
 }
 async function create(shell:Shell,name:string):Promise<NotesFolder|null>{
  try{
   const doc=await editNotesFolders(current=>addNotesFolder(current,{id:newNotesFolderId(),name,createdAt:Date.now()}));
   if(shell.live)shell.vset('notes',{folders:doc.folders,foldersLoaded:true});
   return findNotesFolderByName(doc,name)??null;
  }catch{shell.toast('Could not create the folder.');void load(shell);return null;}
 }
 async function rename(shell:Shell,id:string,name:string):Promise<boolean>{
  try{
   const doc=await editNotesFolders(current=>renameNotesFolder(current,id,name));
   if(shell.live)shell.vset('notes',{folders:doc.folders,foldersLoaded:true});
   return doc.folders.some(folder=>folder.id===id&&folder.name===name.replace(/\s+/g,' ').trim());
  }catch(error){shell.toast(String((error as Error)?.message)==='Folder name in use'?'A folder with that name exists.':'Could not rename the folder.');void load(shell);return false;}
 }
 async function remove(shell:Shell,id:string):Promise<boolean>{
  try{
   const doc=await editNotesFolders(current=>removeNotesFolder(current,id));
   if(shell.live)shell.vset('notes',{folders:doc.folders});
  }catch{shell.toast('Could not delete the folder.');void load(shell);return false;}
  // Agent notes keep their folderId; a reference to a deleted folder reads as no folder.
  if(shell.notesSourceMode!=='legacy')return true;
  const list=shell.vget('notes').list||[],released=releaseNotesFolder(list,id);
  if(released.some((note:Bag,i:number)=>note!==list[i]))await shell.vset('notes',{list:released});
  return true;
 }

 p.api=function(key:string){
  const api=originalApi.call(this,key);
  if(key==='notes'){const shell=this;api.notesFolders={create:(name:string)=>create(shell,name),rename:(id:string,name:string)=>rename(shell,id,name),remove:(id:string)=>remove(shell,id),reload:()=>load(shell)};}
  return api;
 };
 notes.render=(state:Bag,api:Bag)=>{
  if(!state.foldersLoaded&&!loading&&api.notesFolders)loading=Promise.resolve().then(()=>api.notesFolders.reload()).finally(()=>{loading=null;});
  const view=render(state,api);
  // A ⋯ menu action closes the menu and returns focus to ⋯ first, whichever adapter supplies the
  // action (the voice adapter replaces Delete), so a dialog it opens hands focus back to ⋯.
  for(const detail of [view.ed,view.vo,view.lk])if(detail?.menuShown)for(const key of ['pin','del','moveTo']){
   const action=detail[key];if(typeof action!=='function')continue;
   detail[key]=async(...args:unknown[])=>{
    const more=document.querySelector<HTMLElement>('button[aria-haspopup="dialog"][aria-expanded="true"]');
    if(key!=='moveTo'){await api.set({menu:null});more?.focus();}
    return action(...args);
   };
  }
  return view;
 };
}
