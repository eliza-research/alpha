import {browserPhotoLibrary,browserPhotoFileEntries} from '../prototype/browser-camera';
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
 storageReviewedIdentities(input:{paths:string[]}){return this.volume.run('storageReviewedIdentities',input);}
 storageTransfer(input:{paths:string[];dest:string;copy?:boolean;reviewed?:string[]}){return this.volume.run('storageTransfer',input);}
 storageRename(input:{path:string;name:string}){return this.volume.run('storageRename',input);}
 storageCreateFolder(input:{parent:string;name:string}){return this.volume.run('storageCreateFolder',input);}
 storageTrash(input:{paths:string[];reviewed?:string[]}){return this.volume.run('storageTrash',input);}
 storageTrashList(){return this.volume.run('storageTrashList',{});}
 storageRestore(input:{ids:string[]}){return this.volume.run('storageRestore',input);}
 storageEmptyTrash(input:{ids?:string[];confirmed?:boolean}){return this.volume.run('storageEmptyTrash',input);}
 storageShare(input:{paths:string[]}){return this.volume.run('storageShare',input);}
 async storageSelect(input:{path:string}){
  if(input.path.startsWith('Photos/')){const existing=await this.volume.run('storageSelect',input);if(existing.status==='selected')return existing;const id=decodeURIComponent(input.path.split('/').slice(2).join('/')),row=await browserPhotoLibrary.read({id});if(row.trashed)throw Error('Photo is in Recently deleted.');return {status:'selected',action:'photos',selectionId:'browser-photo:'+id};}
  return this.volume.run('storageSelect',input);
 }
 storageOpen(input:{path:string}){return this.volume.run('storageOpen',input);}
 storageWatch(){return this.volume.run('storageWatch',{});}
 storageUnwatch(){return this.volume.run('storageUnwatch',{});}
}
