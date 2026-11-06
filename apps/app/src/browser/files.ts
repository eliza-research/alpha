import { createBrowserFiles } from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/files.ts';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { openSelectedDocumentViewer } from './selected-document-viewer';
import { runFilePicker, inputFiles } from './file-picker';
import { BrowserStorageVolume } from './storage-volume';
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
 private readonly volume=new BrowserStorageVolume(this as any,()=>this.storageChanged());
 private storageChanged(){this.notifyListeners('storageChanged',{});}
 /** Another Alpha flow saved a file here: open Files listings refresh. */
 async importFile(...args:Parameters<InstanceType<typeof SharedFiles>['importFile']>){const value=await super.importFile(...args);this.storageChanged();return value;}
 async saveWorkflowAttachment(...args:Parameters<InstanceType<typeof SharedFiles>['saveWorkflowAttachment']>){const value=await super.saveWorkflowAttachment(...args);this.storageChanged();return value;}
 storageState(){return this.volume.run('storageState',{});}
 storageRequestAccess(){return this.volume.run('storageRequestAccess',{});}
 storageList(input:{path?:string}){return this.volume.run('storageList',input);}
 storageCategory(input:{category:string}){return this.volume.run('storageCategory',input);}
 storageQuery(input:Record<string,unknown>){return this.volume.run('storageQuery',input);}
 storageTransfer(input:{paths:string[];dest:string;copy?:boolean}){return this.volume.run('storageTransfer',input);}
 storageRename(input:{path:string;name:string}){return this.volume.run('storageRename',input);}
 storageCreateFolder(input:{parent:string;name:string}){return this.volume.run('storageCreateFolder',input);}
 storageTrash(input:{paths:string[]}){return this.volume.run('storageTrash',input);}
 storageTrashList(){return this.volume.run('storageTrashList',{});}
 storageRestore(input:{ids:string[]}){return this.volume.run('storageRestore',input);}
 storageEmptyTrash(input:{ids?:string[];confirmed?:boolean}){return this.volume.run('storageEmptyTrash',input);}
 storageShare(input:{paths:string[]}){return this.volume.run('storageShare',input);}
 storageSelect(input:{path:string}){return this.volume.run('storageSelect',input);}
 storageOpen(input:{path:string}){return this.volume.run('storageOpen',input);}
 storageWatch(){return this.volume.run('storageWatch',{});}
 storageUnwatch(){return this.volume.run('storageUnwatch',{});}
}
