import {browserPhotoLibrary,browserPhotoFileEntries,saveBrowserMedia} from '../prototype/browser-camera';
import { createBrowserFiles } from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/files.ts';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { openSelectedDocumentViewer } from './selected-document-viewer';
import { runFilePicker, inputFiles } from './file-picker';
import { BrowserStorageVolume } from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/storage-volume.ts';
/** Keep installed data and Alpha presentation; storage behavior belongs to plugin-files. */
const SharedFiles = createBrowserFiles({
 databaseName: 'alpha.browser.files.v1',
 archiveName: 'Alpha files.zip',
 pdfWorkerUrl,
 pdfAssetsBase: '/pdfjs-assets/',
 openSelectedDocumentViewer,
 runFilePicker,
 inputFiles,
});
export class BrowserFiles extends SharedFiles {
 private readonly reviewedPhotoTrash=new Map<string,string>();
 private photoPath(path:string){return /^Photos\/(Images|Videos)\//.test(path);}
 private async photoRows(paths:string[],trashed=false){
  if(!paths.length||new Set(paths).size!==paths.length)throw Error('Select distinct media files.');
  const listed=await browserPhotoFileEntries(trashed);
  return paths.map(path=>{const row=listed.find(item=>item.path===path);if(!row)throw Error('The selected media changed. Select it again.');return row;});
 }
 private mediaId(path:string){return decodeURIComponent(path.split('/').slice(2).join('/'));}
 private readonly sourceSelections=new Map<string,string>();
 async select(input:{id:string}){const selected=await super.select(input);this.sourceSelections.set(selected.selectionId,input.id);return selected;}
 async forgetSelected(input:{selectionId:string}){this.sourceSelections.delete(input.selectionId);return super.forgetSelected(input);}
 async sourceReference(input:{selectionId:string}){await this.attachment(input);const id=this.sourceSelections.get(input.selectionId);if(!id||!/^[a-f0-9-]{36}$/.test(id))throw Error('Select the library file again.');return 'b1:'+id;}
 async selectSourceReference(reference:string){if(!/^b1:[a-f0-9-]{36}$/.test(reference))throw Error('Source belongs to another device or is unavailable.');return this.select({id:reference.slice(3)});}
 // Files browser (PLAN section 4): the same storage* surface as AlphaFilesPlugin, over this library.
 private readonly volume=new BrowserStorageVolume(this as any,{
  trashFolder: '.Trash-alpha',
  trashKey: 'alpha.files.trash.v1',
 },()=>this.storageChanged());
 private storageChanged(){this.notifyListeners('storageChanged',{});}
 /** Another Alpha flow saved a file here: open Files listings refresh. */
 async importFile(...args:Parameters<InstanceType<typeof SharedFiles>['importFile']>){const value=await super.importFile(...args);this.storageChanged();return value;}
 async saveWorkflowAttachment(...args:Parameters<InstanceType<typeof SharedFiles>['saveWorkflowAttachment']>){const value=await super.saveWorkflowAttachment(...args);this.storageChanged();return value;}
 storageState(){return this.volume.run('storageState',{});}
 storageRequestAccess(){return this.volume.run('storageRequestAccess',{});}
 async storageList(input:{path?:string}){const result=await this.volume.run('storageList',input);if(input.path==='Photos/Images'||input.path==='Photos/Videos'){const media=(await browserPhotoFileEntries()).filter(row=>row.path.startsWith(input.path+'/'));return {...result,status:'ready',entries:[...(Array.isArray(result.entries)?result.entries:[]),...media]};}return result;}
 async storageCategory(input:{category:string;countOnly?:boolean}){
  const result=await this.volume.run('storageCategory',input);
  if(result.status!=='ready'||!['images','videos'].includes(input.category))return result;
  const media=(await browserPhotoFileEntries()).filter(row=>row.mimeType.startsWith(input.category==='images'?'image/':'video/'));
  return input.countOnly?{...result,count:Number(result.count||0)+media.length}:{...result,entries:[...(Array.isArray(result.entries)?result.entries:[]),...media]};
 }
 storageQuery(input:Record<string,unknown>){return this.volume.run('storageQuery',input);}
 async storageReviewedIdentities(input:{paths:string[]}){if(input.paths.every(path=>this.photoPath(path))){const rows=await this.photoRows(input.paths);return {status:'ready',reviewed:rows.map(row=>JSON.stringify([row.path,row.revision]))};}return this.volume.run('storageReviewedIdentities',input);}
 async storageTransfer(input:{paths:string[];dest:string;copy?:boolean;reviewed?:string[]}){
  if(!input.paths.every(path=>this.photoPath(path)))return this.volume.run('storageTransfer',input);
  if(!input.copy)throw Error('Use Add to folder to keep the original in Photos.');
  const rows=await this.photoRows(input.paths);
  if(input.reviewed&&(input.reviewed.length!==rows.length||rows.some((row,i)=>input.reviewed![i]!==JSON.stringify([row.path,row.revision]))))throw Error('The selected media changed. Select it again.');
  if(input.dest.split('/').some(part=>part==='.'||part==='..'))throw Error('Choose a Files folder.');
  let folderId='root';
  for(const part of input.dest.split('/').filter(Boolean)){const folder=(await super.list({id:folderId})).entries.find(row=>row.directory&&row.name===part);if(!folder)throw Error('The destination folder is unavailable.');folderId=folder.id;}
  const outcomes:{path:string;status:string;to?:string}[]=[];
  for(const row of rows){
   if((await super.list({id:folderId})).entries.some(file=>file.name===row.name)){outcomes.push({path:row.path,status:'exists'});continue;}
   const source=await browserPhotoLibrary.read({id:this.mediaId(row.path)});if(source.trashed||source.mutationRevision!==row.revision){outcomes.push({path:row.path,status:'changed'});continue;}
   const blob=await (await fetch(source.path||source.image)).blob(),latest=await browserPhotoLibrary.read({id:source.id});
   if(latest.trashed||latest.mutationRevision!==row.revision){outcomes.push({path:row.path,status:'changed'});continue;}
   const selected=await super.importFile(new File([blob],row.name,{type:row.mimeType}),folderId);
   await this.forgetSelected({selectionId:selected.selectionId});
   const saved=(await super.list({id:folderId})).entries.find(file=>file.name===row.name);
   if(!saved||saved.size!==blob.size)throw Error('The copied file could not be confirmed. Check the folder before trying again.');
   outcomes.push({path:row.path,status:'copied',to:[input.dest,row.name].filter(Boolean).join('/')});
  }
  this.storageChanged();return {status:'ready',outcomes};
 }
 storageRename(input:{path:string;name:string}){return this.volume.run('storageRename',input);}
 storageCreateFolder(input:{parent:string;name:string}){return this.volume.run('storageCreateFolder',input);}
 async storageTrash(input:{paths:string[];reviewed?:string[]}){
  if(!input.paths.every(path=>this.photoPath(path)))return this.volume.run('storageTrash',input);
  const rows=await this.photoRows(input.paths);
  if(input.reviewed&&(input.reviewed.length!==rows.length||rows.some((row,i)=>input.reviewed![i]!==JSON.stringify([row.path,row.revision]))))throw Error('The selected media changed. Select it again.');
  const result=await browserPhotoLibrary.changeMany({operation:'trash',items:rows.map(row=>({id:this.mediaId(row.path),revision:row.revision}))});this.storageChanged();
  return {status:'ready',outcomes:result.outcomes.map(item=>({path:rows.find(row=>this.mediaId(row.path)===item.id)!.path,status:['updated','unchanged'].includes(item.status)?'trashed':'changed',to:'photo:'+item.id}))};
 }
 async storageTrashList(){const base=await this.volume.run('storageTrashList',{}),rows=await browserPhotoFileEntries(true);this.reviewedPhotoTrash.clear();for(const row of rows)this.reviewedPhotoTrash.set(this.mediaId(row.path),row.revision);return {...base,items:[...(Array.isArray(base.items)?base.items:[]),...rows.map(row=>({id:'photo:'+this.mediaId(row.path),name:row.name,origin:row.path.split('/').slice(0,-1).join('/'),directory:false,mimeType:row.mimeType,size:row.size,deletedAt:row.deletedAt}))]};}
 async storageRestore(input:{ids:string[]}){
  const mediaIds=input.ids.filter(id=>id.startsWith('photo:')),otherIds=input.ids.filter(id=>!id.startsWith('photo:'));
  const base=otherIds.length?await this.volume.run('storageRestore',{ids:otherIds}):{status:'ready',outcomes:[]};if(!mediaIds.length)return base;
  const listed=await browserPhotoFileEntries(true),rows=mediaIds.map(id=>{const row=listed.find(row=>'photo:'+this.mediaId(row.path)===id);if(!row)throw Error('The deleted media changed. Refresh Trash.');return row;});
  const result=await browserPhotoLibrary.changeMany({operation:'restore',items:rows.map(row=>({id:this.mediaId(row.path),revision:row.revision}))});this.storageChanged();return {...base,outcomes:[...(Array.isArray(base.outcomes)?base.outcomes:[]),...result.outcomes.map(item=>({path:'photo:'+item.id,status:['updated','unchanged'].includes(item.status)?'restored':'changed'}))]};
 }
 async storageEmptyTrash(input:{ids?:string[];confirmed?:boolean}){
  if(!Array.isArray(input.ids)||!input.ids.length)return {status:'invalid',message:'Review the selected deleted files first.'};
  const mediaIds=input.ids.filter(id=>id.startsWith('photo:')).map(id=>id.slice(6));
  if(!mediaIds.length)return this.volume.run('storageEmptyTrash',input);
  if(input.confirmed!==true)throw Error('Confirm permanent deletion first.');
  const items=mediaIds.map(id=>{const revision=this.reviewedPhotoTrash.get(id);if(!revision)throw Error('Review Trash again before deleting.');return {id,revision};});
  const prepared=await browserPhotoLibrary.prepareDeleteTrash({items}),result=await browserPhotoLibrary.deletePreparedTrash(prepared);this.storageChanged();
  const otherIds=input.ids.filter(id=>!id.startsWith('photo:')),base=otherIds.length?await this.volume.run('storageEmptyTrash',{...input,ids:otherIds}):{status:'ready',count:0};
  return {...base,count:Number(base.count||0)+result.deletedIds.length};
 }
 async storageShare(input:{paths:string[]}){if(!input.paths.every(path=>this.photoPath(path)))return this.volume.run('storageShare',input);const rows=await this.photoRows(input.paths);return browserPhotoLibrary.shareMany({items:rows.map(row=>({id:this.mediaId(row.path),revision:row.revision}))},()=>!document.hidden);}
 async storageSaveMedia(input:{paths:string[]}){const rows=await this.photoRows(input.paths);await saveBrowserMedia({items:rows.map(row=>({id:this.mediaId(row.path),revision:row.revision}))},()=>!document.hidden);return {status:'opened'};}
 async storageSelect(input:{path:string}){
  if(input.path.startsWith('Photos/')){const existing=await this.volume.run('storageSelect',input);if(existing.status==='selected')return existing;const id=decodeURIComponent(input.path.split('/').slice(2).join('/')),row=await browserPhotoLibrary.read({id});if(row.trashed)throw Error('Photo is in Recently deleted.');return {status:'selected',action:'photos',selectionId:'browser-photo:'+id};}
  return this.volume.run('storageSelect',input);
 }
 storageOpen(input:{path:string}){return this.volume.run('storageOpen',input);}
 storageWatch(){return this.volume.run('storageWatch',{});}
 storageUnwatch(){return this.volume.run('storageUnwatch',{});}
}
