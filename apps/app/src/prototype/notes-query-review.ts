import type {NoteRecord} from '../runtime/notes-store';
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
 current();return openReview<string>('Choose a note to share','Note preview',signal,({content,footer,close})=>{
  const select=noteSelect(candidates),preview=document.createElement('pre');preview.style.whiteSpace='pre-wrap';
  const share=button('Share this note');share.disabled=true;const cancel=button('Cancel');
  select.onchange=()=>{const note=candidates.find(note=>note.id===select.value);preview.textContent=!note?'':shareable(note)?String(note.body):note.kind==='list'?'Checklists can\'t be shared yet.':'This note has no text to share.';share.disabled=!note||!shareable(note);};
  share.onclick=()=>{try{current();const note=candidates.find(note=>note.id===select.value);if(!note||!shareable(note))throw Error('Choose a shareable note');close(note.id);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(heading('Choose a note to share'),paragraph(explanation),select,preview);footer.append(cancel,share);return select;
 });
}
