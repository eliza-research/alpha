import './mail-attachments.css';
import { WebPlugin } from '@capacitor/core';
import { reviewMailAttachment, type MailAttachment } from '../runtime/inbox-attachment';
import { reviewOpaqueAttachment } from '../runtime/inbox-operation';
import { BrowserFiles } from './files';
/** Same byte/type/hash validation as the provider review; no uploads. */
export class BrowserMailAttachments extends WebPlugin {
 private generation=0;
 private saveController?:AbortController;
 private dialog?:HTMLDialogElement;
 private url?:string;
 private cleanup?:()=>void;
 constructor(private files:BrowserFiles){super();window.addEventListener('pagehide',()=>this.clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});}
 /** Rejects with code `too-large` past 5 MiB, as the native plugin does. */
 async readSelected(input:{selectionId:string}){const generation=this.generation,file=await this.files.attachment(input).catch(error=>{throw String(error?.message)==='Choose a file up to 5 MiB.'?Object.assign(error,{code:'too-large'}):error;}),review=await reviewMailAttachment(file);if(generation!==this.generation)throw new DOMException('Cancelled','AbortError');return {...file,...review,sourceReferenceVersion:1 as const};}
 async retainSourceReference(input:{selectionId:string;sha256:string}){const file=await this.readSelected(input);if(file.sha256!==input.sha256)throw Error('Source changed.');return {reference:await this.files.sourceReference(input)};}
 async openSourceReference(input:{reference:string;sha256:string;size:number;mimeType:string}){
  const generation=this.generation,selected=await this.files.selectSourceReference(input.reference);
  try{const file=await this.readSelected(selected);if(generation!==this.generation||file.sha256!==input.sha256||file.size!==input.size||file.mimeType!==input.mimeType)throw Error('Source changed or is unavailable. Choose the matching source again.');return await this.openReviewed({...file,reviewed:true});}
  finally{await this.files.forgetSelected(selected);}
 }
 private clear(){++this.generation;this.saveController?.abort();const cleanup=this.cleanup;this.cleanup=undefined;cleanup?.();this.dialog?.close();this.dialog?.remove();this.dialog=undefined;if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;}
 async cancel(){this.clear();}
 /**
  * Exact-copy save. A previewable type passes the same type check as the review. An opaque save
  * (any other type, offered as "No preview · Save to Files") checks only the name, size and
  * SHA-256: the bytes are stored as they are and are never decoded, rendered or opened here.
  */
 async saveReviewed(input:MailAttachment&{reviewed:boolean;sha256:string;opaque?:boolean}){
  if(this.saveController)throw Error('An attachment save is already pending.');
  input={...input};const controller=new AbortController(),generation=this.generation;this.saveController=controller;let selectionId:string|undefined,started=false;
  try{
   const check=input.opaque===true?reviewOpaqueAttachment:reviewMailAttachment;
   const review=await check(input);if(!input.reviewed||review.sha256!==input.sha256||generation!==this.generation)throw Error('Review this attachment again.');controller.signal.throwIfAborted();
   const bytes=Uint8Array.from(atob(input.dataBase64),c=>c.charCodeAt(0));started=true;
   const selected=await this.files.importFile(new File([bytes],input.name,{type:input.mimeType}),'root',controller.signal);selectionId=selected.selectionId;
   const retained=await this.files.attachment({selectionId}),checked=await check(retained);controller.signal.throwIfAborted();if(checked.sha256!==review.sha256||checked.size!==review.size)throw Error("The saved copy didn't match.");
   return {status:'saved',message:'Saved in Files.'};
  }catch(error){if(!started)throw error;return {status:'unverified',message:'Unconfirmed'};}
  finally{if(selectionId)await this.files.forgetSelected({selectionId}).catch(()=>{});if(this.saveController===controller)this.saveController=undefined;}
 }
 async openReviewed(input:MailAttachment&{reviewed:boolean;sha256:string;offerSave?:boolean}){
  const offerSave=input.offerSave===true;input={...input};delete input.offerSave;
  const generation=this.generation,review=await reviewMailAttachment(input);if(!input.reviewed||review.sha256!==input.sha256||generation!==this.generation)throw Error('Review this attachment again.');this.clear();
  const bytes=Uint8Array.from(atob(input.dataBase64),c=>c.charCodeAt(0)),url=this.url=URL.createObjectURL(new Blob([bytes],{type:input.mimeType})),dialog=this.dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Reviewed attachment');dialog.className='alpha-mail-attachment';const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg','s2','line'])dialog.style.setProperty('--attachment-'+token,style.getPropertyValue('--'+token));dialog.style.colorScheme=style.getPropertyValue('--bg').trim().toUpperCase()==='#000000'?'dark':'light';};const heading=document.createElement('h2');heading.textContent=input.name;heading.tabIndex=0;const close=document.createElement('button');close.textContent='Done';close.onclick=()=>void this.cancel();dialog.append(heading);
  if(review.text!==undefined){const text=document.createElement('pre');text.textContent=review.text;text.tabIndex=0;dialog.append(text);}else{const frame=document.createElement('iframe');frame.title=input.name;frame.setAttribute('sandbox','');frame.src=url;dialog.append(frame);}
  const download=document.createElement('a');download.href=url;download.download=input.name;download.textContent='Download';const footer=document.createElement('footer');footer.append(close,download);dialog.append(footer);
  // Local development mail offers the same exact-copy save as provider mail review.
  if(offerSave){const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='flex-shrink:0;margin:0;padding:0 16px 8px';const save=document.createElement('button');save.textContent='Save';save.setAttribute('aria-label','Save to Files');save.onclick=()=>{if(save.disabled)return;save.disabled=true;status.textContent='Saving exact copy…';void this.saveReviewed(input).then(result=>{if(this.dialog===dialog)status.textContent=result.message;},()=>{if(this.dialog===dialog)status.textContent='Save not confirmed. Inspect Files before trying again.';});};footer.append(save);dialog.insertBefore(status,footer);}
  const previous=document.activeElement as HTMLElement|null;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();this.clear();};window.addEventListener('alpha-back',back,true);this.cleanup=()=>{window.removeEventListener('alpha-back',back,true);queueMicrotask(()=>{if(previous?.isConnected&&!this.dialog)previous.focus();});};dialog.onclose=()=>{if(this.dialog===dialog)this.clear();};dialog.oncancel=()=>{if(this.dialog===dialog)this.clear();};document.body.append(dialog);dialog.showModal();close.focus();return {status:'opened',message:'Attachment opened.'};
}

}
