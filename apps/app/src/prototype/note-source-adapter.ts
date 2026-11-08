import {anyAbortSignal} from '../runtime/abort-signal';
import {Capacitor} from '@capacitor/core';
import {runFilePicker,inputFiles} from '../browser/file-picker';
import {DailyApps} from '../daily';
import {registerPlugin} from '../platform-plugins';
import {reviewMailAttachment,type MailAttachment} from '../runtime/inbox-attachment';
import {documentSourceOf,retainedSourceReferences,type DocumentSourceLink} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/source-links.ts';
type Bag=Record<string,any>;
/** A note's linked source document (shared plugin-files source-link rules, J03). */
export type Source=DocumentSourceLink;
const attachments=registerPlugin<{
 readSelected(input:{selectionId:string}):Promise<MailAttachment & {sha256:string;size:number;sourceReferenceVersion?:1}>;
 openReviewed(input:MailAttachment & {sha256:string;reviewed:boolean}):Promise<{message:string}>;
 retainSourceReference(input:{selectionId:string;sha256:string}):Promise<{reference?:string}>;
 openSourceReference(input:{reference:string;sha256:string;size:number;mimeType:string}):Promise<{message:string}>;
 releaseSourceReferences(input:{keep:string[]}):Promise<{removed:number;released:number;remaining:number}>;
 cancel():Promise<void>;
}>('AlphaMailAttachments');
/**
 * Android keeps a linked source's read grant while a note names its a1: reference (J03, option a),
 * also after the picker selection that granted it is forgotten or evicted. Notes therefore tell
 * the native side which references a saved or restorable (Trash) note still names; the others
 * are removed once they were last retained more than three days ago (a content question's link
 * may be saved in a summary note well after it was asked) and their grants released, so the bounded
 * reference map never fills with links of deleted notes. A trashed note keeps its link until its
 * Trash copy is purged, so a restored note still opens its source.
 */
export async function releaseUnusedSourceReferences(notes:readonly unknown[]):Promise<void>{
 if(Capacitor.getPlatform()!=='android')return;
 const keep=retainedSourceReferences(notes);
 await attachments.releaseSourceReferences({keep});
}
export const sourceOf=documentSourceOf;
/** Alpha's cross-app source review. Notes owns persistence; existing file ports
 * own picker grants and exact-byte validation. Never persist temporary grants. */
export function installNoteSourceAdapter(views:Bag){
 const notes=views.notes,render=notes.render,leave=notes.onLeave;
 let closeCurrent:(()=>void)|undefined;
 notes.onLeave=(...args:any[])=>{closeCurrent?.();leave?.(...args);};
 notes.render=(state:Bag,api:Bag)=>{
  const out=render(state,api),selected=state.list?.find((n:Bag)=>n.id===state.open);
  out.canLinkSource=selected?.kind==='text'&&!!sourceOf(selected.documentSource);
  out.sourceLabel='Attachment';
  out.sourceDocument=()=>{
   closeCurrent?.();
   const note=api.get('notes').list.find((n:Bag)=>n.id===api.get('notes').open);
   if(!note||note.kind!=='text')return;
   let expected=JSON.stringify(note),source=sourceOf(note.documentSource),closed=false,busy=false,opened=false;const pickerAbort=new AbortController();
   const previous=document.activeElement;
   const dialog=document.createElement('dialog');dialog.className='note-source-dialog note-source-document-dialog';dialog.setAttribute('aria-label','Note source document');const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));dialog.style.colorScheme=style.getPropertyValue('--bg').trim().toUpperCase()==='#000000'?'dark':'light';}
   const heading=document.createElement('h2');heading.textContent='Source document';
   const content=document.createElement('div');content.className='note-source-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Source details');
   const name=document.createElement('p'),detail=document.createElement('p');
   const description=document.createElement('p');description.textContent='Link a PDF, image or text file (up to 5 MiB). Saved library links can reopen directly while access remains available. Otherwise choose the file again. Its bytes must match the linked source. Opening shares only that selected copy with the viewer.';
   const status=document.createElement('p');status.setAttribute('role','status');
   const actions=document.createElement('div');actions.className='note-source-options';const footer=document.createElement('footer');
   const button=(label:string)=>{const el=document.createElement('button');el.type='button';el.textContent=label;return el;};
   const linked=button('Open linked source'),link=button('Link file'),open=button('Choose source file to open'),remove=button('Remove source link'),done=button('Done');actions.append(linked,link,open,remove);footer.append(done);
   const current=()=>!closed&&api.isActive()&&api.get('notes').open===note.id&&JSON.stringify(api.get('notes').list.find((n:Bag)=>n.id===note.id))===expected;
   const close=()=>{if(closed)return;closed=true;pickerAbort.abort();if(opened)void attachments.cancel().catch(()=>{});dialog.remove();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',close);if(closeCurrent===close)closeCurrent=undefined;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
   const back=(event:Event)=>{if([...document.querySelectorAll('dialog[open]')].at(-1)!==dialog)return;event.preventDefault();event.stopImmediatePropagation();close();};
   const paint=()=>{linked.hidden=!source?.reference;name.textContent=source?.name||'No source linked';detail.textContent=source?`${source.mimeType} · ${source.size} bytes · SHA-256 ${source.sha256}`:'';link.textContent=source?'Replace source file':'Link file';open.hidden=remove.hidden=!source;for(const el of [linked,link,open,remove])el.disabled=busy;};
   const save=async(next:Source|undefined)=>{
    if(!current())throw Error('Note changed. Close this review and reopen the note.');
    const state=api.get('notes'),record={...state.list.find((n:Bag)=>n.id===note.id)};
    if(next)record.documentSource=next;else delete record.documentSource;
    const saved=await api.saveImportedNote({list:state.list.map((n:Bag)=>n.id===note.id?record:n)});
    if(!saved)throw Error('Source link save is unconfirmed. Reopen Notes before trying again.');
    expected=JSON.stringify(api.get('notes').list.find((n:Bag)=>n.id===note.id));
    // A replaced or removed link may have been the last one to its document.
    if(source?.reference&&source.reference!==next?.reference)void api.notesTrash?.maintain?.();
    source=next;
   };
   const choose=async(mode:'link'|'open')=>{
    if(busy||!current())return;busy=true;status.textContent='Choose a file…';paint();let selectionId:string|undefined;
    try{
     let file:MailAttachment & {sha256:string;size:number;sourceReferenceVersion?:1};
     if(Capacitor.isNativePlatform()){
      const choice=await DailyApps.perform({action:'files'});selectionId=choice.selectionId;
      if(!current())return;if(choice.status==='cancelled'){status.textContent='Selection cancelled. Source unchanged.';return;}
      if(choice.status!=='selected'||!selectionId)throw Error('Choose a supported file.');
      file=await attachments.readSelected({selectionId});
     }else{
      const selected=await runFilePicker(async signal=>{
       const owned=anyAbortSignal([signal,pickerAbort.signal]),files=await inputFiles(owned);owned.throwIfAborted();
       if(!files.length)return null;const chosen=files[0];if(chosen.size>5*1024*1024)throw Error('Choose a source up to 5 MiB.');
       const bytes=new Uint8Array(await chosen.arrayBuffer());owned.throwIfAborted();let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
       const value={name:chosen.name,mimeType:chosen.type,dataBase64:btoa(binary)};return {...value,...await reviewMailAttachment(value)};
      },null);
      if(!current())return;if(!selected){status.textContent='Selection cancelled. Source unchanged.';return;}file=selected;
     }
     const checked=await reviewMailAttachment(file);
     if(!current())return;
     if(checked.sha256!==file.sha256||checked.size!==file.size)throw Error('Selected file changed. Choose it again.');
     if(mode==='link'){
      const reference=selectionId&&file.sourceReferenceVersion===1?(await attachments.retainSourceReference({selectionId,sha256:checked.sha256})).reference:undefined;if(!current())return;const next=sourceOf({version:1,name:file.name,mimeType:file.mimeType,sha256:checked.sha256,size:checked.size,...(reference?{reference}:{})});if(!next)throw Error('This file cannot be linked.');
      await save(next);if(!closed)status.textContent='Source linked. File contents were not added to the note or sent to an agent.';
     }else{
      if(!source||checked.sha256!==source.sha256||checked.size!==source.size||file.mimeType!==source.mimeType)throw Error('This file does not match the linked source. Nothing opened; the source link is unchanged.');
      opened=true;await attachments.openReviewed({...file,reviewed:true});if(!closed)status.textContent='Matching source opened.';
     }
    }catch(error){if(!closed)status.textContent=error instanceof Error?error.message:'Source unavailable.';}
    finally{if(selectionId)await DailyApps.forgetSelected({selectionId}).catch(()=>{if(!closed)status.textContent='File access could not be released. Close and reopen Files.';});busy=false;if(!closed)paint();}
   };
   linked.onclick=async()=>{if(busy||!current()||!source?.reference)return;busy=true;opened=true;paint();status.textContent='Opening verified source…';try{const result=await attachments.openSourceReference({reference:source.reference,sha256:source.sha256,size:source.size,mimeType:source.mimeType});if(!closed)status.textContent=result.message;}catch{if(!closed)status.textContent='Linked source changed or access is unavailable. Choose the matching source file again.';}finally{busy=false;if(!closed)paint();}};
   link.onclick=()=>void choose('link');open.onclick=()=>void choose('open');remove.onclick=async()=>{if(busy||!current())return;busy=true;paint();try{await save(undefined);if(!closed)status.textContent='Source link removed. The file was not deleted.';}catch(error){if(!closed)status.textContent=(error as Error).message;}finally{busy=false;if(!closed)paint();}};
   done.onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};
   content.append(name,detail,description,status,actions);dialog.append(heading,content,footer);document.body.append(dialog);closeCurrent=close;window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',close);paint();dialog.showModal();done.focus();
  };
  return out;
 };
}
