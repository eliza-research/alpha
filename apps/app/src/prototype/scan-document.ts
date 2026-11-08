import {anyAbortSignal} from '../runtime/abort-signal';
import {mediaToolIcon} from './media-review-controls';
import './scan-dialog.css';
import type {ScanTextLine} from './scan-text-layer';
import {reviewSearchableScan} from './scan-searchable-review';
import {reviewScanCorrection} from './scan-correction-review';
import {readScanDraft,saveScanDraft,deleteScanDraft} from '../browser/scan-draft';
import {captureScanPage} from './scan-page-camera';
import {inputFiles,runFilePicker} from '../browser/file-picker';
import {exportScanPdf,ScanPdfExportError,duringSystemPicker,systemPickerActive} from './scan-pdf';
// The document state (page rules, order, one operation at a time, export snapshots, compare-and-set
// autosave) is the shared camera plugin's; this file presents it in Alpha's dialog.
import {admitScanDimensions,admitScanImage,createScanDocument,SCAN_IMAGE_TYPES,SCAN_LIMITS} from '../../../../.eliza/client-features/plugins/plugin-native-camera/src/scan-document.ts';
import {Capacitor} from '@capacitor/core';
import {DailyApps} from '../daily';
const native=Capacitor.isNativePlatform();
const IMAGE_TYPES:readonly string[]=SCAN_IMAGE_TYPES;
/** Android: one image through the system document picker. The bytes are read
 * once through the granted content URI and the grant is released; nothing is
 * copied to Photos. Resolves undefined when the user cancels. */
export async function pickNativeScanImage():Promise<Blob|undefined>{
 const result=await duringSystemPicker(()=>DailyApps.perform({action:'photos'}));
 try{
  if(result.status==='cancelled')return undefined;
  if(result.status!=='selected'||!result.uri?.startsWith('content://'))throw Error(result.message||'No image was selected.');
  const response=await fetch(Capacitor.convertFileSrc(result.uri));if(!response.ok)throw Error('The selected image could not be read.');
  const blob=await response.blob(),type=IMAGE_TYPES.includes(result.mimeType||'')?result.mimeType!:blob.type;
  if(!IMAGE_TYPES.includes(type))throw Error('Choose a JPEG, PNG or WebP image up to 16 MB.');admitScanImage({type,size:blob.size});
  return blob.type===type?blob:new Blob([blob],{type});
 }finally{if(result.selectionId)void DailyApps.forgetSelected({selectionId:result.selectionId}).catch(()=>{});}
}
/** Ordered image-only document review. Every export uses an immutable page snapshot. */
export function openScanDocument(first?:Blob):()=>void{
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Review scan document');dialog.className='scan-dialog';
 const previous=document.activeElement,heading=document.createElement('h2');heading.textContent='Scan document';const description=document.createElement('p');description.textContent='Capture or add pages, then save a PDF.';
 const list=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;return b;};
 /** Previews by page id; released when a page leaves the document. */
 const urls=new Map<number,string>();
 const url=(page:{id:number;image:Blob})=>{let value=urls.get(page.id);if(!value){value=URL.createObjectURL(page.image);urls.set(page.id,value);}return value;};
 const release=()=>{const live=new Set(doc.pages().map(page=>page.id));for(const [id,value] of urls)if(!live.has(id)){URL.revokeObjectURL(value);urls.delete(id);}};
 let closed=false;
 /** Android may end Alpha while a system picker covers it, so on native every page change is
  * written to the device draft (compare-and-set: an older draft is never replaced silently). */
 const doc=createScanDocument<Blob,ScanTextLine[]>({
  drafts:{save:saveScanDraft,read:readScanDraft,remove:deleteScanDraft},autosave:native,
  changed:()=>{if(!closed)render();},
  autosaveFailed:error=>{if(!closed)status.textContent=(error instanceof Error?error.message:'This change was not saved to the device draft.')+' Pages stay open here.';},
 });
 const render=()=>{
  if(closed)return;release();list.replaceChildren();
  const {pages,controls,draftRevision}=doc.snapshot();
  pages.forEach((page,index)=>{const section=document.createElement('section'),label=document.createElement('h3'),image=document.createElement('img');label.textContent=`Page ${index+1}`;image.src=url(page);image.alt=`Document page ${index+1}`;image.style.cssText='display:block;width:100%;height:130px;object-fit:contain';
   const up=button(`Move page ${index+1} earlier`,()=>doc.move(index,-1)),down=button(`Move page ${index+1} later`,()=>doc.move(index,1)),correct=button(`Correct page ${index+1}`,()=>void correctPage(index)),replace=button(`Replace page ${index+1}`,()=>void pick(index)),retake=button(`Retake page ${index+1}`,()=>void pick(index,true)),remove=button(`Remove page ${index+1}`,()=>{doc.remove(index);});
   const page_=controls.pages[index];up.disabled=!page_.earlier;down.disabled=!page_.later;correct.disabled=retake.disabled=replace.disabled=remove.disabled=!page_.edit;
   const tools=document.createElement('div');tools.className='scan-dialog-tools';
   [[up,'arrow-up'],[down,'arrow-down'],[correct,'crop'],[replace,'image'],[retake,'camera'],[remove,'trash-2']].forEach(([control,icon])=>mediaToolIcon(control as HTMLButtonElement,icon as string));
   tools.append(up,down,correct,replace,...(native?[]:[retake]),remove);section.append(label,image,tools);list.append(section);
  });
  capture.disabled=add.disabled=!controls.addPage;searchable.disabled=save.disabled=!controls.export;saveDraft.disabled=!controls.saveDraft;loadDraft.disabled=!controls.loadDraft;removeDraft.disabled=!controls.deleteDraft;removeDraft.hidden=!draftRevision;saveDraft.hidden=!pages.length;actions.hidden=!pages.length;empty.hidden=!!pages.length;capture.classList.toggle('primary',!pages.length);
  description.textContent=pages.length?`${pages.length} of ${SCAN_LIMITS.pages} pages · Review the order before saving.`:'Capture or add pages, then save a PDF.';
 };
 const failed=(error:unknown,fallback:string)=>{if(!closed)status.textContent=error instanceof Error?error.message:fallback;};
 const correctPage=(index:number)=>doc.run(async signal=>{
  try{const page=doc.pages()[index];const corrected=await reviewScanCorrection(page.image,signal);signal.throwIfAborted();if(!corrected)return;
   if(doc.pages().reduce((total,p,i)=>total+(i===index?0:p.image.size),0)+corrected.size>SCAN_LIMITS.documentBytes)throw Error('Corrected document exceeds 64 MB.');
   doc.put(corrected,index);status.textContent=native?'Corrected page applied.':'Corrected page applied. Save the document draft to keep this change.';
  }catch(error){failed(error,'Could not correct page.');}
 });
 const search=()=>{if(!doc.pages().length)return;void doc.run(async signal=>{
  const result=await reviewSearchableScan(doc.pages().map(p=>p.image),signal,doc.pages().map(p=>p.textLayer??null));if(closed||!result)return;
  if(result.textLayers)doc.setTextLayers(result.textLayers);
  doc.exportFinished(result.status,value=>['cancelled','reviewed'].includes(value));status.textContent=result.message;
 });};
 const pick=(index?:number,camera=false)=>doc.run(async signal=>{
  try{const image=camera?await captureScanPage(signal):native?await pickNativeScanImage():(await runFilePicker(picker=>inputFiles(anyAbortSignal([picker,signal]),{photos:true}),[]))[0];signal.throwIfAborted();if(!image)return;
   admitScanImage(image);const bitmap=await createImageBitmap(image);try{signal.throwIfAborted();admitScanDimensions(bitmap.width,bitmap.height);}finally{bitmap.close();}
   doc.put(image,index);status.textContent='';
  }catch(error){failed(error,'Could not add page.');}
 });
 const draftAction=async(action:()=>Promise<unknown>)=>{try{await action();}catch(error){failed(error,'Draft action failed.');}};
 const saveDraft=button('Save document draft',()=>void draftAction(async()=>{if(await doc.saveDraft()&&!closed)status.textContent=native?'Document draft saved on this device. It is restored after Alpha restarts.':'Document draft saved in this app.';}));
 const loadDraft=button('Load saved draft',()=>void draftAction(async()=>{const outcome=await doc.loadDraft(()=>window.confirm('Replace the current review with the saved draft?'));if(closed)return;if(outcome==='none')status.textContent='No saved document draft.';else if(outcome==='loaded')status.textContent='Saved document draft loaded.';}));
 const removeDraft=button('Delete saved draft',()=>void draftAction(async()=>{if(await doc.deleteDraft(()=>window.confirm('Delete the saved draft? The current reviewed pages will remain open.'))&&!closed)status.textContent='Saved draft deleted. Reviewed pages remain open.';}));
 const dispose=()=>{if(closed)return;closed=true;doc.close();for(const value of urls.values())URL.revokeObjectURL(value);urls.clear();dialog.remove();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',dispose);document.removeEventListener('visibilitychange',visibility);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 const back=(event:Event)=>{if(document.querySelector('dialog[aria-label="Capture document page"],dialog[aria-label="Correct document page"],dialog[aria-label="Review searchable PDF"]'))return;event.preventDefault();event.stopImmediatePropagation();dispose();},visibility=()=>{if(document.hidden&&!systemPickerActive())dispose();};
 const searchable=button(native?'Save searchable PDF':'Download searchable PDF',()=>search());
 const add=button('Add page',()=>void pick()),capture=button('Capture new page',()=>void pick(undefined,true)),save=button(native?'Save document PDF':'Download document PDF',()=>{
  if(!doc.snapshot().controls.export)return;status.textContent='Preparing document…';
  void doc.exportPages((pages,_layers,signal)=>exportScanPdf(pages,signal,'Alpha document '+new Date().toISOString().replace(/[:.]/g,'-')),error=>error instanceof ScanPdfExportError).then(result=>{if(!closed&&result)status.textContent=result.message;},error=>{if(closed)return;status.textContent=error instanceof ScanPdfExportError?(native?'Export unconfirmed. Inspect the chosen destination before exporting again.':'Export unconfirmed. Check Downloads before exporting again.'):error instanceof Error?error.message:'Could not prepare the PDF. Try again.';});
 }),close=button('Close document',dispose);
 capture.setAttribute('aria-label','Capture new page');capture.textContent='Capture page';add.setAttribute('aria-label','Add page');add.textContent='Add image';
 save.setAttribute('aria-label',native?'Save document PDF':'Download document PDF');save.textContent=native?'Save PDF':'Download PDF';save.className='primary';
 searchable.setAttribute('aria-label',native?'Save searchable PDF':'Download searchable PDF');searchable.textContent='Searchable PDF';
 saveDraft.setAttribute('aria-label','Save document draft');saveDraft.textContent='Save draft';loadDraft.setAttribute('aria-label','Load saved draft');loadDraft.textContent='Resume draft';removeDraft.setAttribute('aria-label','Delete saved draft');removeDraft.textContent='Delete draft';
 mediaToolIcon(close,'x');close.classList.add('scan-dialog-close');const header=document.createElement('div');header.className='scan-dialog-header';header.append(heading,close);
 const content=document.createElement('div');content.className='scan-dialog-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Review details');
 const tools=document.createElement('div');tools.className='scan-dialog-tools';tools.append(...(native?[]:[capture]),add);
 const empty=document.createElement('div');empty.className='scan-empty';empty.textContent='No pages yet';
 const draftOptions=document.createElement('details');draftOptions.className='scan-draft-options';const draftSummary=document.createElement('summary');draftSummary.textContent='Draft options';const draftTools=document.createElement('div');draftTools.className='scan-dialog-tools';draftTools.append(saveDraft,loadDraft,removeDraft);draftOptions.append(draftSummary,draftTools);
 const actions=document.createElement('div');actions.className='scan-dialog-actions';actions.append(save,searchable);
 content.append(description,tools,empty,list,status,draftOptions);dialog.append(header,content,actions);
 dialog.oncancel=event=>{event.preventDefault();dispose();};
 window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',dispose);document.addEventListener('visibilitychange',visibility);
 (document.querySelector('.os')||document.body).append(dialog);
 // The first page is admitted like any other; with autosave it is written to the device draft.
 if(first)try{doc.put(first);}catch(error){failed(error,'Could not add page.');}
 render();dialog.showModal();(native?add:capture).focus();
 return dispose;
}
