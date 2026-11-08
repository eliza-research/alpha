import type {NoteRecord} from '../runtime/notes-store';
import type {NamedTargetOperation} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import {openReview} from './source-review-dialog';
function button(text:string){const element=document.createElement('button');element.textContent=text;return element;}
function heading(text:string){const element=document.createElement('h2');element.textContent=text;return element;}
function paragraph(text:string){const element=document.createElement('p');element.textContent=text;return element;}
function noteSelect(candidates:NoteRecord[]){
 const select=document.createElement('select');select.style.minHeight='44px';select.style.maxWidth='100%';select.style.font='inherit';select.style.color='inherit';select.style.background='inherit';select.setAttribute('aria-label','Note');
 const empty=document.createElement('option');empty.value='';empty.textContent='Choose a note';select.append(empty);
 for(const note of candidates){const option=document.createElement('option');option.value=note.id;option.textContent=note.title||'Untitled note';select.append(option);}
 return select;
}
/** Local candidates never leave this dialog. Only an explicit record choice is returned. */
export function reviewNotesQuery(candidates:NoteRecord[],explanation:string,signal:AbortSignal,current:()=>void):Promise<string|null>{
 current();return openReview<string>('Choose a note to share','Note preview',signal,({content,footer,close})=>{
  const select=noteSelect(candidates),preview=document.createElement('pre');preview.style.whiteSpace='pre-wrap';
  const share=button('Share this note');share.disabled=true;const cancel=button('Cancel');
  select.onchange=()=>{const note=candidates.find(note=>note.id===select.value);preview.textContent=typeof note?.body==='string'?note.body:'This note has no shareable text in the current Notes read contract.';share.disabled=!note||typeof note.body!=='string';};
  share.onclick=()=>{try{current();const note=candidates.find(note=>note.id===select.value);if(!note||typeof note.body!=='string')throw Error('Choose a shareable note');close(note.id);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(heading('Choose a note to share'),paragraph(explanation),select,preview);footer.append(cancel,share);return select;
 });
}
/** Shows the exact titles that would be shared. Returns true only on explicit approval. */
export async function reviewNoteTitles(titles:string[],truncated:boolean,signal:AbortSignal,current:()=>void):Promise<boolean>{
 current();const approved=await openReview<boolean>('Review note titles to share','Note titles',signal,({content,footer,close})=>{
  const list=document.createElement('ul');for(const title of titles){const item=document.createElement('li');item.textContent=title;list.append(item);}
  const share=button(`Share ${titles.length} title${titles.length===1?'':'s'}`),cancel=button('Cancel');
  share.onclick=()=>{try{current();close(true);}catch(error){close(null,error);}};cancel.onclick=()=>close(null);
  content.append(heading('Share these note titles?'),paragraph(`Only these titles are shared with the agent. Note text stays on this phone.${truncated?' Older notes are not included.':''}`),list);footer.append(cancel,share);return share;
 });
 return approved===true;
}
/** Disambiguation and exact approval for a name-targeted Notes edit requested from Home.
 * The owner picks the exact note, sees it, and confirms the named change for that note. */
export function reviewNamedNote(candidates:NoteRecord[],operation:Extract<NamedTargetOperation,{type:'notes_named'}>,signal:AbortSignal,current:()=>void):Promise<string|null>{
 current();const remove=operation.action==='delete';
 return openReview<string>(remove?'Choose the note to delete':'Choose the note to update','Note preview',signal,({content,footer,close})=>{
  const select=noteSelect(candidates),preview=document.createElement('pre');preview.style.whiteSpace='pre-wrap';
  const confirm=button(remove?'Move to Trash':'Save changes');confirm.disabled=true;const cancel=button('Cancel');
  const change=remove?paragraph('The note moves to Trash and is erased after 3 days unless you restore it.'):paragraph(`New title: “${operation.fields.title}”\n${operation.fields.body}`);change.style.whiteSpace='pre-wrap';
  select.onchange=()=>{const note=candidates.find(note=>note.id===select.value);preview.textContent=note?(typeof note.body==='string'?note.body:''):'';confirm.disabled=!note;if(note)confirm.textContent=remove?`Move “${note.title||'Untitled note'}” to Trash`:`Update “${note.title||'Untitled note'}”`;};
  confirm.onclick=()=>{try{current();const note=candidates.find(note=>note.id===select.value);if(!note)throw Error('Choose a note');close(note.id);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(heading(remove?'Delete a note':'Update a note'),paragraph(candidates.length>1?`Several notes match “${operation.name}”. Choose the exact note.`:`Review the note matching “${operation.name}”.`),select,preview,change);footer.append(cancel,confirm);
  if(candidates.length===1){select.value=candidates[0].id;select.onchange?.(new Event('change'));}
  return select;
 });
}
