import {createInlineModal} from '../runtime/inline-modal';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { DailyApps, type NativeResult } from '../daily';
import { filesIndex, compareFilesEntries, matchesFileQuery, sortLabel, typeLabel, type RecentFile, type SortMode } from './files-index';
import { reviewContentQuestion } from '../browser/content-question';
import { sensitiveReadingText } from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import { FOLDER_CONTEXT_EVENT, createFolderRevisions, folderExcerpt, folderScope, folderScopeCurrent } from './context-selection';
type Bag=Record<string,any>;
type Entry={id:string;parentId?:string;name:string;mimeType:string;directory:boolean;size:number;modified?:number;modifiedAt?:number;revision:string;canCreate:boolean;canRename:boolean;canDelete:boolean;canMove:boolean};
type Outcome={id:string;status:string;message:string};
type Listing={status:string;message:string;folder?:Entry;entries?:Entry[];rootId?:string;entry?:Entry;cursor?:string;total?:number;truncated?:boolean;outcomes?:Outcome[]};
/** Category tiles open the system picker narrowed to a type; the provider decides. */
const CATEGORIES:Record<string,{mime?:string[];hint:string}>={
 Documents:{mime:['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.oasis.opendocument.text','text/plain','application/rtf'],hint:'Choose a document · PDF or Office'},
 Recordings:{mime:['audio/*'],hint:'Choose an audio recording'},
 Downloads:{hint:'Choose any file · open the Downloads folder in the picker'},
 Receipts:{hint:'Choose any file · receipts are not detected automatically'},
};
const modifiedOf=(e:Entry)=>Number.isFinite(e.modified)&&e.modified!>0?e.modified!:Number.isFinite(e.modifiedAt)&&e.modifiedAt!>0?e.modifiedAt!:undefined;
function relative(time:number){const minutes=Math.round((Date.now()-time)/60000);if(minutes<1)return 'Just now';if(minutes<60)return minutes+' min ago';const hours=Math.round(minutes/60);if(hours<24)return hours+' h ago';return new Date(time).toLocaleDateString(undefined,{month:'short',day:'numeric'});}
const tree=registerPlugin<{
 importFolder():Promise<Listing>;choose():Promise<Listing>;list(input:{id?:string;cursor?:string}):Promise<Listing>;
 createFolder(input:{id:string;name:string}):Promise<Listing>;
 rename(input:{id:string;name:string;expectedRevision:string}):Promise<Listing>;
 delete(input:{id:string;expectedRevision:string;confirmPermanent:true}):Promise<Listing>;
 move(input:{id:string;destinationId:string;expectedRevision:string}):Promise<Listing>;
 changeMany(input:{items:{id:string;expectedRevision:string}[];action:'move'|'delete';destinationId?:string;confirmPermanent?:boolean}):Promise<Listing>;
 shareMany(input:{items:{id:string;expectedRevision:string}[]}):Promise<Listing>;
 saveMany(input:{items:{id:string;expectedRevision:string}[]}):Promise<Listing>;
 select(input:{id:string}):Promise<NativeResult>;forget():Promise<Listing>;
}>('AlphaFiles');
const FILE='M6 3h8l4 4v14H6zM14 3v5h4';
/** Exact existing Files rows/menu/preview; tree mutations require explicit UI. */
export function installFilesTreeAdapter(views:Bag,accept:(module:string,result:NativeResult,api:Bag,recent?:{kind:'selected'}|{kind:'tree';treeId:string}|false)=>Promise<void>,clearSelected:()=>void){
 const module=views.files,render=module.render,back=module.back,leave=module.onLeave;
 let selectionEpoch=0;
 let listing:Listing|undefined,api:Bag|undefined,busy=false,status='',generation=0,selected:Entry|undefined,selectedCapability:string|undefined;
 // Native tree IDs are session capabilities; a new process cannot reopen them.
 if(Capacitor.isNativePlatform())filesIndex.revokeTree();
 let selecting=false,picked=new Set<string>();
 const resetSelection=()=>{selecting=false;picked.clear();};
 let dialog:{entries?:Entry[];kind:'create'|'rename'|'delete'|'move';entry?:Entry;name:string;folder?:Entry;rows?:Entry[];error?:string}|undefined;
 const repaint=()=>{folderContext();api?.set({nativeTreeRevision:++generation});};
 let dialogTrigger:HTMLElement|null=null;
 const dialogModal=createInlineModal(()=>{if(!busy){dialog=undefined;repaint();}},()=>dialogTrigger?.isConnected?dialogTrigger:document.querySelector<HTMLElement>('button[aria-label="View and sort"]'));
 const visible=()=>api?.get('files').folder==='__native_tree';
 /** journeys-14: the folder being browsed is an agent-selectable object. Only the
  * opaque tree ID and a session-local listing counter are shared, never a path, name,
  * provider URI or the provider's own revision string (which embeds the name). The
  * shell shares it only while this folder is the visible Files subview. */
 const folderRevisions=createFolderRevisions();
 function folderContext(){window.dispatchEvent(new CustomEvent(FOLDER_CONTEXT_EVENT,{detail:folderRevisions(folderScope(listing))??null}));}
 let closeFolderQuestion:(()=>void)|undefined;
 /** Review exactly this folder's loaded entry names before any of them reach the
  * conversation draft. Nothing inside a file or subfolder is read. The folder is read
  * again when the owner continues: a changed, replaced or revoked folder adds nothing. */
 function askFolder(owner:Bag){
  if(busy)return;
  const reviewed=listing,scope=folderScope(reviewed);
  if(!scope){owner.toast('This folder cannot be reviewed right now. Refresh it and try again.');return;}
  closeFolderQuestion?.();
  const live=()=>listing===reviewed&&visible()&&!owner.get('files').open&&owner.isActive()&&!document.hidden;
  closeFolderQuestion=reviewContentQuestion({name:'folder '+scope.folder.name,text:folderExcerpt(scope,typeLabel),question:'What is in this folder?',current:live,validate:text=>!sensitiveReadingText(text),closed:()=>{closeFolderQuestion=undefined;},compose:draft=>{void (async()=>{
   if(busy||!live()){owner.toast('The folder view changed. Nothing was added to your conversation.');return;}
   busy=true;repaint();
   try{
    const fresh=await tree.list({id:scope.folder.id});
    if(!live()){owner.toast('The folder view changed. Nothing was added to your conversation.');return;}
    if(folderScopeCurrent(scope,fresh)){owner.composeContentQuestion(draft);return;}
    // Show the folder as it is now (or leave it when access ended) before any new review.
    apply(fresh);owner.toast(fresh.status==='ready'?'This folder changed while you were reviewing it. Nothing was added to your conversation. Review it again.':(fresh.message||'Folder access ended.')+' Nothing was added to your conversation.');
   }catch{owner.toast('This folder could not be checked. Nothing was added to your conversation.');}
   finally{busy=false;repaint();}
  })();}});
 }
 const apply=(value:Listing)=>{if(value.status==='ready'){listing=value;resetSelection();status=value.cursor||value.truncated||value.message.includes('250')?value.message:'';folderContext();}else{status=value.message;if(value.status==='revoked'||value.status==='unavailable'){listing=undefined;selected=undefined;selectedCapability=undefined;folderContext();clearSelected();api?.set({open:null});if(value.status==='revoked')filesIndex.revokeTree();}}repaint();};
 async function loadMore(){
  const current=listing;if(busy||!current?.cursor||!current.folder)return;busy=true;repaint();
  try{const value=await tree.list({id:current.folder.id,cursor:current.cursor});
   if(listing!==current)return;
   if(value.status==='ready'&&value.folder?.id===current.folder.id){const seen=new Set((current.entries||[]).map(e=>e.id));listing={...value,entries:[...(current.entries||[]),...(value.entries||[]).filter(e=>!seen.has(e.id))]};status=value.cursor||value.truncated?value.message:'';}
   else{status=value.message||'Refresh this folder before loading more.';if(value.status==='revoked')apply(value);}
  }catch{status='More entries could not load. Refresh the folder.';}
  finally{busy=false;repaint();}
 }
 async function load(id?:string){if(busy)return;busy=true;status='Loading folder…';repaint();try{apply(await tree.list({id}));}catch{status='Folder provider unavailable. Choose the folder again.';}finally{busy=false;repaint();}}
 async function choose(importFolder=false){if(busy)return;busy=true;try{const value=await (importFolder ? tree.importFolder() : tree.choose());if(value.status==='ready'){clearSelected();selected=undefined;selectedCapability=undefined;apply(value);api?.set({folder:'__native_tree',open:null,menu:false});}else if(value.status!=='cancelled')api?.toast(value.message);}catch{api?.toast('Folder selection unavailable.');}finally{busy=false;repaint();}}
 async function openEntry(entry:Entry){if(busy)return;if(entry.directory){void load(entry.id);return;}busy=true;try{const value=await tree.select({id:entry.id});if(value.status==='selected'){if(!api?.isActive()){if(value.selectionId)await DailyApps.forgetSelected({selectionId:value.selectionId});return;}selected=entry;selectedCapability=value.selectionId;await accept('files',value,api!,{kind:'tree',treeId:entry.id});}else api?.toast(value.message||'File unavailable. Refresh this folder.');}catch{api?.toast('This file could not open. Refresh the folder.');}finally{busy=false;repaint();}}
 // The picker itself hides the page, so only a view switch (epoch) or inactive owner fences its result, never document.hidden.
 async function pick(owner:Bag,mime?:string[]){
  if(busy)return;busy=true;const ticket=selectionEpoch;
  try{const value=await DailyApps.perform({action:'files',...(mime?{mime}:{})});if(value.status==='selected'){if(ticket!==selectionEpoch||!owner.isActive()){if(value.selectionId)await DailyApps.forgetSelected({selectionId:value.selectionId}).catch(()=>{});return;}await accept('files',value,owner);}else if(value.status!=='cancelled')owner.toast(value.message||'No file was selected.');}
  catch{owner.toast('The file picker is unavailable. Try again.');}
  finally{busy=false;repaint();}
 }
 async function openRecent(row:RecentFile,owner:Bag){
  if(busy)return;
  if(row.kind==='scan-pdf'){owner.toast('This PDF was saved to the place you chose. Select it to open it here.');void pick(owner,['application/pdf']);return;}
  if(row.status==='revoked'||!row.selectionId){filesIndex.remove(row.key);void pick(owner,row.mimeType&&row.mimeType!=='application/octet-stream'?[row.mimeType]:undefined);return;}
  busy=true;
  try{
   let value:NativeResult;
   if(row.kind==='tree'&&row.treeId&&!Capacitor.isNativePlatform()){value=await tree.select({id:row.treeId});if(value.status==='selected'&&row.selectionId!==value.selectionId){const old=row.selectionId;filesIndex.remove(row.key);void DailyApps.forgetSelected({selectionId:old}).catch(()=>{});}}
   else if(Capacitor.isNativePlatform())value=await DailyApps.describeSelected({selectionId:row.selectionId});
   else{const read=await DailyApps.readSelected({selectionId:row.selectionId});value={status:read.status==='unavailable'?'unavailable':'selected',action:'files',selectionId:row.selectionId,name:row.name,mimeType:row.mimeType};}
   if(value.status!=='selected'||!value.selectionId){filesIndex.revoke(row.key);owner.toast('Access to '+row.name+' ended. Select it again.');return;}
   await accept('files',value,owner,row.kind==='tree'&&row.treeId?{kind:'tree',treeId:row.treeId}:{kind:'selected'});
  }catch{filesIndex.revoke(row.key);owner.toast('Access to '+row.name+' ended. Select it again.');}
  finally{busy=false;repaint();}
 }
 const beginDialog=(kind:'create'|'rename'|'delete'|'move',entry?:Entry,trigger?:EventTarget|null)=>{
  if(busy)return;dialogTrigger=trigger instanceof HTMLElement?trigger:document.querySelector<HTMLElement>('button[aria-label="View and sort"]');dialog={kind,entry,name:kind==='rename'?entry?.name||'':'',folder:listing?.folder,rows:listing?.entries?.filter(e=>e.directory)};api?.set({menu:false});repaint();
 };
 async function mutation(){
  const request=dialog,folder=listing?.folder;if(!request||!folder||busy)return;
  if(request.kind==='move'&&(!request.folder?.canCreate||request.folder.id===request.entry?.parentId||request.entries?.every(e=>e.parentId===request.folder?.id)))return;
  if(['create','rename'].includes(request.kind)&&!request.name.trim()){api?.toast('Enter a name.');return;}
  busy=true;repaint();
  try{
   const entry=request.entry;
   const value=request.entries&&['move','delete'].includes(request.kind)?await tree.changeMany({items:request.entries.map(e=>({id:e.id,expectedRevision:e.revision})),action:request.kind as 'move'|'delete',destinationId:request.folder?.id,confirmPermanent:request.kind==='delete'}):request.kind==='create'?await tree.createFolder({id:folder.id,name:request.name}):request.kind==='rename'&&entry?await tree.rename({id:entry.id,name:request.name,expectedRevision:entry.revision}):request.kind==='delete'&&entry?await tree.delete({id:entry.id,expectedRevision:entry.revision,confirmPermanent:true}):request.kind==='move'&&entry&&request.folder?await tree.move({id:entry.id,destinationId:request.folder.id,expectedRevision:entry.revision}):{status:'unsupported',message:'Choose a supported action.'};
   if(value.status==='partial'){dialog=undefined;api?.toast(value.message);if(selected&&request.entries?.some(e=>e.id===selected?.id&&value.outcomes?.some(o=>o.id===e.id&&['moved','deleted'].includes(o.status)))){clearSelected();selected=undefined;api?.set({open:null});}apply(await tree.list({id:folder.id}));return;}
   // Folder access ended (possibly mid-batch with nothing changed): leave the folder, never keep stale rows.
   if(value.status==='revoked'){dialog=undefined;api?.toast(value.message);apply(value);return;}
   if(!['created','renamed','deleted','moved'].includes(value.status)){request.error=value.message;api?.toast(value.message);return;}
   dialog=undefined;if(value.status==='deleted'||value.status==='moved')api?.toast(value.message);
   const wasPreview=selected?.id===entry?.id;
   if(wasPreview){clearSelected();selected=undefined;api?.set({open:null});}
   let target=folder.id;
   if(request.kind==='delete'&&entry?.id===folder.id)target=folder.parentId!;
   const refreshed=await tree.list({id:target});
   if(value.status==='renamed'&&entry&&refreshed.status==='ready'){
    const changed=[refreshed.folder,...(refreshed.entries||[])].find(row=>row?.id===entry.id);
    if(changed)filesIndex.renameTree(changed.id,changed.name);
   }
   apply(refreshed);
  }catch(error){request.error=error instanceof Error?error.message:'Refresh the folder and try again.';api?.toast(request.error);}
  finally{busy=false;repaint();}
 }
 async function moveFolder(id?:string){if(!dialog||dialog.kind!=='move'||busy)return;busy=true;dialog={...dialog,folder:undefined,rows:[],error:undefined};repaint();try{const value=await tree.list({id});if(value.status==='ready'&&dialog?.kind==='move'){dialog={...dialog,folder:value.folder,rows:value.entries?.filter(e=>e.directory)};}else api?.toast(value.message);}catch{api?.toast('Destination folder unavailable.');}finally{busy=false;repaint();}}
 module.render=(state:Bag,currentApi:Bag)=>{
  const FOLDER=currentApi.ic.folder;
  api=currentApi;const out=render(state,currentApi);
  // Category tiles: real pickers with honest hints instead of fixture counts. nativeTree keeps
  // the data adapter's generic 'Choose a document' copy from replacing the category hint.
  if(Array.isArray(out.locs))out.locs=out.locs.map((loc:Bag)=>{const category=CATEGORIES[loc?.name];return category&&!loc.nativeTree?{...loc,nativeTree:true,sub:category.hint,go:()=>void pick(currentApi,category.mime)}:loc;});
  // Recent: documents opened here (selected or from a chosen folder) and saved scan PDFs.
  const recentRows=filesIndex.list();
  const recentRow=(row:RecentFile)=>({id:'recent:'+row.key,name:row.name,chip:'',d:FILE,isFile:true,isFolder:false,selOn:false,selOff:false,rowCss:row.status==='revoked'?'opacity:.6':'',
   sub:row.status==='revoked'?'Access ended · Select again':row.kind==='scan-pdf'?'Saved scan PDF · '+relative(row.openedAt):typeLabel(row.mimeType)+' · '+(row.kind==='tree'?'from your folder':'selected on this device')+' · '+relative(row.openedAt),
   label:(row.status==='revoked'?'Select again ':row.kind==='scan-pdf'?'Find saved PDF ':'Open ')+row.name,tap:()=>void openRecent(row,currentApi)});
  if(recentRows.length){out.recent=[...recentRows.map(recentRow),...(out.recent||[])].slice(0,12);out.noRecent=false;}
  // Search: model rows plus Recent and the loaded entries of the chosen folder.
  const query=typeof state.q==='string'?state.q.trim():'';
  if(query){
   const recentHits=recentRows.filter(row=>matchesFileQuery(row,query)).map(recentRow);
   const treeHits=(listing?.entries||[]).filter(e=>matchesFileQuery(e,query)&&!recentRows.some(row=>row.kind==='tree'&&row.treeId===e.id)).map(e=>({id:'tree:'+e.id,name:e.name,chip:'',d:e.directory?FOLDER:FILE,isFile:!e.directory,isFolder:e.directory,selOn:false,selOff:false,rowCss:'',sub:(e.directory?'Folder':typeLabel(e.mimeType))+' · in '+(listing?.folder?.name||'your folder'),label:'Open '+e.name,tap:()=>{if(e.directory){currentApi.set({folder:'__native_tree',q:null});void load(e.id);}else void openEntry(e);}}));
   out.results=[...(out.results||[]),...recentHits,...treeHits];out.hasQuery=true;out.noQuery=false;out.noResults=out.results.length===0;
  }
  out.locs=[...(out.locs||[]),{nativeTree:true,name:Capacitor.isNativePlatform()?'Choose folder':'App files',d:FOLDER,sub:Capacitor.isNativePlatform()?'Android folder access':'App files',go:()=>choose()}];
  if(!Capacitor.isNativePlatform())out.locs.push({nativeTree:true,name:'Import folder',d:FOLDER,sub:'Import copies into app files',go:()=>choose(true)});
  if(!listing&&Capacitor.isNativePlatform())out.locs.push({nativeTree:true,name:'Saved folder',d:FOLDER,sub:'Restore selected access',go:()=>{currentApi.set({folder:'__native_tree'});void load();}});
  else if(listing&&(Capacitor.isNativePlatform()||listing.folder?.parentId))out.locs.push({nativeTree:true,name:listing.folder?.name||'Selected folder',d:FOLDER,sub:'Browse selected folder',go:()=>{currentApi.set({folder:'__native_tree'});void load(listing?.folder?.id);}});
  if(state.folder==='__native_tree'){
   const folder=listing?.folder,rows=listing?.entries||[];
   const mode:SortMode=state.sort==='name'?'name':'recent';
   out.top=false;out.inFolder=true;out.notSel=!selecting;out.isSel=selecting;out.isList=!state.grid;out.isGrid=!!state.grid;out.nativeTreeStatus=status;
   const pickedRows=()=>rows.filter(e=>picked.has(e.id));
   const batchDialog=(kind:'move'|'delete',event:Event)=>{const entries=pickedRows();if(!entries.length||busy)return;beginDialog(kind,undefined,event.currentTarget);if(dialog)dialog.entries=entries;repaint();};
   out.selectionBusy=busy;out.selectionDisabled=busy||picked.size===0;out.selCount=String(picked.size);out.selOp=picked.size?'1':'.4';out.exitSel=()=>{if(busy)return;resetSelection();repaint();};out.selAll=()=>{if(busy)return;picked=new Set(picked.size===rows.length?[]:rows.map(e=>e.id));repaint();};out.selMove=(event:Event)=>batchDialog('move',event);out.selDel=(event:Event)=>batchDialog('delete',event);const selectionAction=async(method:'shareMany'|'saveMany')=>{if(busy||!picked.size||!currentApi.isActive()||document.hidden)return;const reviewed=listing;busy=true;repaint();try{const value=await tree[method]({items:pickedRows().map(e=>({id:e.id,expectedRevision:e.revision}))});if(typeof value.message==='string'&&value.message.trim()&&listing===reviewed&&visible()&&currentApi.isActive()&&!document.hidden)currentApi.toast(value.message);}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError')&&listing===reviewed&&visible()&&currentApi.isActive()&&!document.hidden)currentApi.toast(error instanceof Error?error.message:method==='saveMany'?'Selection could not be saved.':'Selection could not be shared.');}finally{busy=false;repaint();}};
   out.selShare=()=>selectionAction('shareMany');if(!Capacitor.isNativePlatform())out.selSaveLocally=()=>selectionAction('saveMany');
   const close=()=>{if(busy)return;if(folder?.parentId)void load(folder.parentId);else{dialog=undefined;folderContext();currentApi.set({folder:null,open:null,menu:false});}};
   const sortRow=(next:SortMode,label:string)=>({label,on:mode===next,go:()=>{currentApi.set({menu:false,sort:next});}});
   const menu=[sortRow('recent','Newest first'),sortRow('name','Name'),{label:'Refresh folder',go:()=>{currentApi.set({menu:false});void load(folder?.id);}},...(folder?[{label:'Ask Alpha about this folder',go:()=>{currentApi.set({menu:false});askFolder(currentApi);}}]:[]),...(folder?.canCreate?[{label:'New folder',go:()=>beginDialog('create')}]:[]),...(folder?.canRename?[{label:'Rename folder',go:()=>beginDialog('rename',folder)}]:[]),...(folder?.canDelete?[{label:'Delete empty folder',go:()=>beginDialog('delete',folder)}]:[]),{label:'Choose another folder',go:()=>choose()},{label:'Forget folder access',go:async()=>{if(busy)return;busy=true;try{const value=await tree.forget();if(value.status==='forgotten'){clearSelected();selected=undefined;listing=undefined;dialog=undefined;folderContext();filesIndex.revokeTree();currentApi.set({folder:null,open:null,menu:false});}currentApi.toast(value.message);}catch{currentApi.toast('Folder access could not be released. Try again.');}finally{busy=false;repaint();}}}];
   const more=listing?.cursor?[{id:'__more',name:busy?'Loading…':'Load more',sub:status||'More entries are available',d:FOLDER,isFile:false,isFolder:false,selOn:false,selOff:false,rowCss:'',label:'Load more entries',tap:()=>void loadMore()}]:[];
   out.fd={name:folder?.name||'Selected folder',empty:!!folder&&!busy&&!listing?.cursor&&rows.length===0,emptyText:'This folder is empty.',selectDisabled:busy||rows.length===0,close,viewIcon:FILE,openMenu:()=>currentApi.set({menu:true}),toggleView:()=>currentApi.set({grid:!state.grid}),viewLabel:state.grid?'Show as list':'Show as grid',sortLabel:sortLabel(mode),sortCss:mode==='name'?'color: var(--acct)':'',toggleSort:()=>{const next:SortMode=mode==='name'?'recent':'name';currentApi.set({sort:next});},select:()=>{if(busy||!rows.length)return;selecting=true;picked.clear();repaint();},
    items:[...[...rows].sort((a,b)=>compareFilesEntries(mode)({name:a.name,directory:a.directory,modified:modifiedOf(a)},{name:b.name,directory:b.directory,modified:modifiedOf(b)})).map(e=>({id:e.id,name:e.name,sub:e.directory?'Folder':typeLabel(e.mimeType)+(e.size>=0?` · ${e.size} bytes`:'')+(modifiedOf(e)?' · '+relative(modifiedOf(e)!):''),d:e.directory?FOLDER:FILE,isFile:!e.directory,isFolder:e.directory,selOn:selecting&&picked.has(e.id),selOff:selecting&&!picked.has(e.id),rowCss:'',label:(selecting?(picked.has(e.id)?'Deselect ':'Select '):'Open ')+e.name,tap:()=>{if(busy)return;if(selecting){picked.has(e.id)?picked.delete(e.id):picked.add(e.id);repaint();}else void openEntry(e);}})),...(selecting?[]:more)],menuRows:menu.map(m=>({on:false,...m,d:FOLDER}))};
   out.menuOpen=!!state.menu;out.closeMenu=()=>currentApi.set({menu:false});
  }
  if(selected&&selectedCapability===out.pv?.nativeSelectionId&&out.isPreview&&state.open==='__native_selected_document'){
   out.pv.move=(event:Event)=>selected?.canMove?beginDialog('move',selected,event.currentTarget):currentApi.toast('This provider does not support moving this file.');
   out.pv.del=(event:Event)=>selected?.canDelete?beginDialog('delete',selected,event.currentTarget):currentApi.toast('This provider does not support deleting this file.');
   out.pv.startRename=(event:Event)=>selected?.canRename?beginDialog('rename',selected,event.currentTarget):currentApi.toast('This provider does not support renaming this file.');
  }
  if(dialog){const d=dialog;out.nativeTreeDialog={modalRef:dialogModal.ref,busy,confirmDisabled:busy||(d.kind==='move'&&(!d.folder?.canCreate||d.folder.id===d.entry?.parentId||d.entries?.every(e=>e.parentId===d.folder?.id))),title:d.kind==='delete'?'Permanently delete?':d.kind==='move'?'Move file':d.kind==='rename'?'Rename':'New folder',message:d.error||(d.kind==='delete'?`${d.entries?d.entries.length+' selected items':d.entry?.name}. This cannot be undone. There is no integrated trash. Only empty folders can be deleted here.`:d.kind==='move'?`Destination: ${d.folder?.name||'Choose folder'}`:''),hasName:d.kind==='create'||d.kind==='rename',name:d.name,onName:(e:Event)=>{if(dialog)dialog.name=(e.target as HTMLInputElement).value;repaint();},moving:d.kind==='move',destinations:d.rows?.map(e=>({name:e.name,go:()=>moveFolder(e.id)}))||[],canUp:!!d.folder?.parentId,up:()=>moveFolder(d.folder?.parentId),canRoot:d.kind==='move',root:()=>moveFolder(),confirmLabel:busy?'Working…':d.kind==='delete'?'Delete permanently':d.kind==='move'?'Move here':d.kind==='rename'?'Rename':'Create folder',confirm:mutation,cancel:()=>{if(!busy){dialog=undefined;repaint();}}};}
  else out.nativeTreeDialog=null;
  return out;
 };
 module.back=(state:Bag,currentApi:Bag)=>{if(dialog){if(!busy){dialog=undefined;repaint();}return true;}if(selecting){resetSelection();repaint();return true;}if(state.open)return back?.(state,currentApi);if(visible()){if(busy)return true;if(state.menu){currentApi.set({menu:false});return true;}if(listing?.folder?.parentId)void load(listing.folder.parentId);else{folderContext();currentApi.set({folder:null});}return true;}return back?.(state,currentApi);};
 module.onLeave=(...args:any[])=>{selectionEpoch++;closeFolderQuestion?.();dialog=undefined;resetSelection();folderContext();return leave?.(...args);};
}
