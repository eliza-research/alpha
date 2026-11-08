import './scan-dialog.css';
import {openScanDocument} from './scan-document';
import {createScanEventReview} from './scan-event-review';
import type {ScanEventDraft} from './scan-event';
import {createScanLinkReview} from './scan-link-review';
import {exportScanPdf,scanPdfFailure,scanPdfRetryable,systemPickerActive} from './scan-pdf';
import {Capacitor} from '@capacitor/core';
import {recognizeLocalText} from './local-ocr';

/** A scan is draft text until the user reviews it and receives a Notes commit. */
/** 'unsaved' is a scan-mode capture that was not published to Photos. It stays
 * in memory unless the user explicitly chooses Keep photo. */
export type ScanSource='captured'|'selected'|'unsaved';
/** A Keep photo outcome other than saved. `retry` is set only when keeping again cannot duplicate
 * the photo: the host kept nothing, or it resolves a retry against the same operation identity. */
export class ScanKeepError extends Error {constructor(message:string,readonly retry:boolean){super(message);}}
export function openScanReview(image:Blob,save:(text:string,id:string)=>Promise<boolean>,reviewEvent?:(draft:ScanEventDraft)=>boolean,source:ScanSource='captured',keep?:(image:Blob,signal:AbortSignal)=>Promise<string>):()=>void {
  const controller=new AbortController();const previous=document.activeElement;
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Review scanned text');
  dialog.className='scan-dialog scan-text-review';
  const heading=document.createElement('h2');heading.textContent='Scan text';
  const disclosure=document.createElement('p');disclosure.textContent='English text recognition runs on this device. Check the result before saving. '+(source==='captured'?'The captured photo remains in Photos.':source==='unsaved'?'This photo is not saved to Photos unless you choose Keep photo.':'The selected file stays unchanged and is not copied to Photos.');
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-label','Scan status');status.textContent='Starting local scan…';
  const field=document.createElement('textarea');field.setAttribute('aria-label','Scanned text');field.rows=9;field.maxLength=100000;field.disabled=true;field.className='scan-dialog-text';
  const actions=document.createElement('div');actions.className='scan-dialog-actions';
  const button=(label:string)=>{const value=document.createElement('button');value.type='button';value.textContent=label;actions.append(value);return value;};
  const tools=document.createElement('div');tools.className='scan-dialog-tools';
  let closeDocument:(()=>void)|undefined;
  {const document=button('Build multi-page PDF');document.onclick=()=>{closeDocument?.();closeDocument=openScanDocument(image);};tools.append(document);}
  if(source==='unsaved'&&keep){const kept=button('Keep photo');let keeping=false;kept.onclick=()=>{if(keeping||closed)return;keeping=true;kept.disabled=true;status.textContent='Saving photo to Photos…';void keep(image,controller.signal).then(message=>{if(!closed){status.textContent=message;kept.textContent='Photo kept';}},error=>{if(closed)return;
    // A host that keeps under one operation identity (or kept nothing) marks the failure retryable:
    // trying again resolves the same save. Otherwise Keep stays off so a retry cannot duplicate it.
    const retry=error instanceof ScanKeepError&&error.retry;
    status.textContent=error instanceof ScanKeepError&&error.message?error.message:'Keep photo unconfirmed. Check Photos before keeping it again.';
    if(retry){keeping=false;kept.disabled=false;kept.textContent='Try keeping again';}});};tools.append(kept);}
  const pdf=button(Capacitor.isNativePlatform()?'Save photo PDF':'Download photo PDF');
  const copy=button('Copy text'),commit=button('Save to Notes'),close=button('Cancel scan');copy.disabled=true;commit.disabled=true;commit.className='primary';
  const pdfStatus=document.createElement('p');pdfStatus.setAttribute('role','status');pdfStatus.setAttribute('aria-label','PDF export status');
  let pdfAttempted=false;
  const previewUrl=URL.createObjectURL(image),preview=document.createElement('img');preview.src=previewUrl;preview.alt=source==='selected'?'Selected image for PDF export':'Captured page for PDF export';preview.style.cssText='display:block;width:100%;max-height:160px;object-fit:contain;background:var(--s2,#eee);border-radius:8px';
  const pdfDisclosure=document.createElement('p');pdfDisclosure.textContent='Photo PDF exports this image. Text corrections are saved separately to Notes.';
  let closed=false,attempted=false;const noteId='scan-'+crypto.randomUUID();
  const dispose=()=>{if(closed)return;closed=true;closeDocument?.();controller.abort();URL.revokeObjectURL(previewUrl);dialog.remove();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',dispose);document.removeEventListener('visibilitychange',visibility);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  const back=(event:Event)=>{if(document.querySelector('dialog[aria-label="Review scan document"]'))return;event.preventDefault();event.stopImmediatePropagation();dispose();};
  const visibility=()=>{if(document.hidden&&!systemPickerActive())dispose();};
  close.onclick=dispose;dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
  window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',dispose);document.addEventListener('visibilitychange',visibility);
  const eventReview=reviewEvent?createScanEventReview(()=>field.value,()=>!closed&&!field.disabled&&!document.hidden,draft=>{if(!reviewEvent(draft))return false;dispose();return true;}):undefined;
  if(eventReview)eventReview.hidden=true;
  const links=createScanLinkReview(()=>field.value,()=>!closed&&!document.hidden);
  field.oninput=()=>{links.update();copy.disabled=!field.value.trim();commit.disabled=attempted||!field.value.trim();};
  copy.onclick=()=>{void navigator.clipboard.writeText(field.value).then(()=>{if(!closed)status.textContent='Text copied.';},()=>{if(!closed)status.textContent='Copy unavailable. Select and copy the text manually.';});};
  pdf.onclick=()=>{if(pdfAttempted)return;pdfAttempted=true;pdf.disabled=true;pdfStatus.textContent='Preparing photo PDF…';void exportScanPdf(image,controller.signal,'Alpha scan '+new Date().toISOString().replace(/[:.]/g,'-')).then(result=>{if(closed)return;pdfStatus.textContent=result.message;if(scanPdfRetryable(result.status)){pdfAttempted=false;pdf.disabled=false;}},error=>{if(closed)return;const failure=scanPdfFailure(error);pdfStatus.textContent=failure.message;if(failure.retry){pdfAttempted=false;pdf.disabled=false;}});};
  commit.onclick=()=>{if(attempted||!field.value.trim())return;attempted=true;commit.disabled=true;field.readOnly=true;status.textContent='Saving to Notes…';void save(field.value.trim(),noteId).then(saved=>{if(!closed){status.textContent=saved?'Saved to Notes.':'Save unconfirmed. Keep or copy this text and inspect Notes before saving again.';commit.textContent=saved?'Saved':'Save unconfirmed';}},()=>{if(!closed)status.textContent='Save unconfirmed. Keep or copy this text and inspect Notes before saving again.';});};
  const content=document.createElement('div');content.className='scan-dialog-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Review details');content.append(disclosure,preview,pdfDisclosure,status,field,tools,links.element,pdfStatus);
  if(eventReview)content.append(eventReview);
  dialog.append(heading,content,actions);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();close.focus();
  void recognizeLocalText(image,controller.signal,value=>{if(!closed)status.textContent=`Scanning locally · ${Math.round(value.progress*100)}% · ${value.status}`;}).then(result=>{
    if(closed)return;field.disabled=false;if(eventReview)eventReview.hidden=false;field.value=result.text;links.update();copy.disabled=!result.text;commit.disabled=!result.text;close.textContent='Close scan';status.textContent=result.text?'Review and correct the recognized text.':'No text recognized. You can type a correction or close and try a clearer photo.';field.focus();
  },error=>{if(closed)return;close.textContent='Close scan';status.textContent=error instanceof Error?error.message:'Local scan failed. Try a clearer photo.';});
  return dispose;
}
