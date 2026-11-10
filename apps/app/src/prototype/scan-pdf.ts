import { createScanPdf as createPdf } from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts';
import type { ScanTextLine } from './scan-text-layer';
import {registerPlugin} from '../platform-plugins';
import {filesIndex} from './files-index';
const documents=registerPlugin<{exportPdf(input:{title:string;dataBase64:string}):Promise<{status:string;message:string}>}>('AlphaNoteDocuments',{
 web:()=>import('../runtime/browser-note-documents').then(module=>new module.BrowserNoteDocuments()),
});
/** A readable local date, without filename separators or an internal operation timestamp. */
export function scanExportTitle(kind='scan',date=new Date()){
 return `Alpha ${kind} ${new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date).replaceAll(':','.')}`;
}
export function createScanPdf(input:Blob|Blob[],signal:AbortSignal,textLayers?:ScanTextLine[][]) {
 return createPdf({title:'Alpha scan',creator:'Alpha Phone'},input,signal,textLayers);
}
export class ScanPdfExportError extends Error {}
/** Conversion failures happened before any export request, so the real reason is
 * shown and retry stays available. Only a failed or unknown export call is
 * uncertain: a document may already exist, so retry stays locked. */
export function scanPdfFailure(error:unknown):{message:string;retry:boolean}{
 if(error instanceof ScanPdfExportError)return {message:'PDF export unconfirmed. Inspect the destination before trying again.',retry:false};
 if(error instanceof DOMException&&error.name==='AbortError')return {message:'PDF export cancelled. Nothing was saved.',retry:true};
 const reason=error instanceof Error&&error.message.trim()?error.message.trim().slice(0,300):'The PDF could not be prepared.';
 return {message:reason+(/[.!?]$/.test(reason)?'':'.')+' Nothing was saved. Try again.',retry:true};
}
/** Resolved provider outcomes that wrote nothing confirmed: the user may retry.
 * 'unverified', 'exported' and 'requested' keep retry locked. */
let systemPickers=0;
/** Android covers the WebView while a system picker or document chooser is open,
 * which reports the page hidden. Review dialogs that started that picker stay
 * open; every other hidden-page rule still applies. */
export function systemPickerActive(){return systemPickers>0;}
export async function duringSystemPicker<T>(task:()=>Promise<T>):Promise<T>{systemPickers++;try{return await task();}finally{systemPickers--;}}
export function scanPdfRetryable(status:string){return ['cancelled','failed','unavailable','too-large'].includes(status);}
/** `onRequest` runs just before the export request is made; until then nothing can have been written. */
export async function exportScanPdf(image:Blob|Blob[],signal:AbortSignal,title:string,textLayers?:ScanTextLine[][],onRequest?:()=>void){
 const bytes=await createScanPdf(image,signal,textLayers);let raw='';for(let index=0;index<bytes.length;index+=16384)raw+=String.fromCharCode(...bytes.subarray(index,index+16384));
 signal.throwIfAborted();onRequest?.();let result:{status:string;message:string};try{result=await duringSystemPicker(()=>documents.exportPdf({title,dataBase64:btoa(raw)}));}catch(error){throw new ScanPdfExportError('PDF export unconfirmed.',{cause:error});}
 if(['exported','requested'].includes(result.status))filesIndex.record({kind:'scan-pdf',name:title.slice(0,200)+'.pdf',mimeType:'application/pdf'});
 return result;
}
