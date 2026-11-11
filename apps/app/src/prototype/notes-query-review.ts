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
/** Only a note's body is read for sharing. A checklist keeps its items outside the body (one
 * converted from text has an empty body), so it is never offered as an empty note. */
export const shareable=(note:NoteRecord)=>note.kind!=='list'&&typeof note.body==='string'&&note.body.trim()!=='';
/** Local candidates never leave this dialog. Only an explicit record choice is returned. */
export function reviewNotesQuery(candidates:NoteRecord[],explanation:string,signal:AbortSignal,current:()=>void):Promise<string|null>{
 current();return openReview<string>('Share note','Note preview',signal,({content,footer,close})=>{
  const select=noteSelect(candidates),preview=document.createElement('pre');preview.style.whiteSpace='pre-wrap';
  const share=button('Share this note');share.disabled=true;const cancel=button('Cancel');
  select.onchange=()=>{const note=candidates.find(note=>note.id===select.value);preview.textContent=!note?'':shareable(note)?String(note.body):note.kind==='list'?'Not yet':'Empty';share.disabled=!note||!shareable(note);};
  share.onclick=()=>{try{current();const note=candidates.find(note=>note.id===select.value);if(!note||!shareable(note))throw Error('Choose a shareable note');close(note.id);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(heading('Share note'),paragraph(explanation),select,preview);footer.append(cancel,share);return select;
 });
}

/** Shows the exact titles that would be shared. Returns true only on explicit approval. */
export async function reviewNoteTitles(titles:string[],truncated:boolean,signal:AbortSignal,current:()=>void):Promise<boolean>{
 current();const approved=await openReview<boolean>('Share titles?','Note titles',signal,({content,footer,close})=>{
  const list=document.createElement('ul');for(const title of titles){const item=document.createElement('li');item.textContent=title;list.append(item);}
  const share=button(`Share ${titles.length}`),cancel=button('Cancel');
  share.onclick=()=>{try{current();close(true);}catch(error){close(null,error);}};cancel.onclick=()=>close(null);
  content.append(heading('Share titles?'),paragraph(`Titles only${truncated?' · Older omitted':''}`),list);footer.append(cancel,share);return share;
 });
 return approved===true;
}
/** Disambiguation and exact approval for a name-targeted Notes edit requested from Home.
 * The owner picks the exact note, sees it, and confirms the named change for that note. */
export function reviewNamedNote(candidates:NoteRecord[],operation:Extract<NamedTargetOperation,{type:'notes_named'}>,signal:AbortSignal,current:()=>void):Promise<string|null>{
 current();const remove=operation.action==='delete';
 return openReview<string>(remove?'Delete which?':'Update which?','Note preview',signal,({content,footer,close})=>{
  const select=noteSelect(candidates),preview=document.createElement('pre');preview.style.whiteSpace='pre-wrap';
  const confirm=button(remove?'Delete':'Save changes');confirm.disabled=true;const cancel=button('Cancel');
  const change=remove?paragraph('Trash · 3 days'):paragraph(`New title: “${operation.fields.title}”\n${operation.fields.body}`);change.style.whiteSpace='pre-wrap';
  select.onchange=()=>{const note=candidates.find(note=>note.id===select.value);preview.textContent=note?(typeof note.body==='string'?note.body:''):'';confirm.disabled=!note;if(note)confirm.textContent=remove?'Delete':`Update “${note.title||'Untitled note'}”`;};
  confirm.onclick=()=>{try{current();const note=candidates.find(note=>note.id===select.value);if(!note)throw Error('Choose a note');close(note.id);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(heading(remove?'Delete a note':'Update a note'),...(candidates.length>1?[paragraph(`${candidates.length} matches`)]:[]),select,preview,change);footer.append(cancel,confirm);
  if(candidates.length===1){select.value=candidates[0].id;select.onchange?.(new Event('change'));}
  return select;
 });
}
