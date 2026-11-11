import type {SummarySource as Source} from '../prototype/summary-source';
import {recognizeLocalText} from '../prototype/local-ocr';
/** A source that cannot be linked for a known reason; its message tells the user what to do. */
export class SourceUnavailableError extends Error{}
/** Review local source text before placing it in the conversation composer. */
export function reviewContentQuestion(input:{sourceDescription?:string;sourceLabel?:string;question?:string;signal?:AbortSignal;closed?:(dismissed:boolean)=>void;validate?:(text:string)=>boolean;name:string;text:string;current:()=>boolean;compose:(text:string,source?:Source)=>void;source?:()=>Promise<Source>;image?:(signal:AbortSignal)=>Promise<Blob>}) {
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Ask about selected content');
 dialog.className='note-source-dialog content-question-dialog';
 const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg','mut','line','s2','acc'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
 const content=document.createElement('div');content.className='note-source-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Content question review');
 const footer=document.createElement('footer');
 const heading=document.createElement('h2');heading.textContent='Ask Alpha';heading.style.overflowWrap='anywhere';
 const sourceName=document.createElement('p');sourceName.setAttribute('role','note');sourceName.setAttribute('aria-label','Selected source');sourceName.textContent=input.name;sourceName.className='content-question-source';
 const description=document.createElement('p');description.hidden=true;description.className='content-question-help';
 const report=(message:string)=>{status.textContent=message;status.scrollIntoView({block:'nearest'});};
 const controller=new AbortController();let previewUrl:string|undefined;
 const question=document.createElement('textarea');question.setAttribute('aria-label','Question about content');question.value=input.question||(input.image?'What does this mean?':'Summarize this excerpt.');question.maxLength=2000;question.rows=2;
 const excerpt=document.createElement('textarea');excerpt.setAttribute('aria-label','Content excerpt');excerpt.value=input.text.slice(0,12000);excerpt.maxLength=12000;excerpt.rows=input.image?2:5;excerpt.placeholder=input.image?'Describe or extract':'Text to discuss';
 for(const field of [question,excerpt])field.style.cssText='box-sizing:border-box;width:100%;font:inherit;padding:12px;margin:6px 0 16px';
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent=input.text.length>12000?'Truncated':'';
 const linkSource=document.createElement('input');linkSource.type='checkbox';linkSource.checked=true;const sourceLabel=document.createElement('label');sourceLabel.style.cssText='display:flex;align-items:center;gap:8px;min-height:44px;margin:12px 0';linkSource.style.cssText='width:24px;height:24px;flex-shrink:0';sourceLabel.append(linkSource,document.createTextNode(' '+(input.sourceLabel||'Link source')));
 let verifying=false;
 const proceed=document.createElement('button');proceed.textContent='Add to chat';proceed.setAttribute('aria-label','Use in conversation');
 const cancel=document.createElement('button');cancel.textContent='Cancel';proceed.className='content-question-primary';
 for(const button of [proceed,cancel]){button.type='button';button.style.cssText='min-height:44px;font:inherit';}
 let closed=false,dismissed=false;const previous=document.activeElement;
 const close=()=>{if(closed)return;closed=true;controller.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);dialog.remove();window.removeEventListener('pagehide',close);window.removeEventListener('alpha-back',back,true);document.removeEventListener('visibilitychange',visibility);input.signal?.removeEventListener('abort',close);input.closed?.(dismissed);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 // Explicit dismissal (Cancel, Escape, Back) is the user's decision; hiding or page exit is not.
 const dismiss=()=>{if(!closed)dismissed=true;close();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dismiss();};
 const visibility=()=>{if(document.hidden)close();};
 const update=()=>{proceed.disabled=excerpt.disabled||!question.value.trim()||!excerpt.value.trim();};question.oninput=update;excerpt.oninput=update;linkSource.onchange=()=>{if(verifying)return;question.disabled=excerpt.disabled=false;update();};update();
 proceed.onclick=async()=>{if(closed||proceed.disabled)return;if(!input.current()){report('Selection changed');proceed.disabled=true;return;}if(input.validate&&!input.validate(excerpt.value)){report('Remove secrets first');return;}const draft=question.value.trim()+'\n\nSource: '+input.name+'\n\n'+excerpt.value.trim();verifying=true;linkSource.disabled=true;proceed.disabled=true;question.disabled=excerpt.disabled=true;for(const button of dialog.querySelectorAll('button'))if(button!==cancel)button.disabled=true;let source:Source|undefined;try{if(input.source&&linkSource.checked){status.textContent='Verifying source…';source=await input.source();}if(closed)return;if(!input.current()){report('Selection changed');return;}close();input.compose(draft,source);}catch(error){if(!closed){verifying=false;linkSource.disabled=false;report(error instanceof SourceUnavailableError?error.message:'Source unverified');proceed.disabled=true;}}};
 cancel.onclick=dismiss;dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});window.addEventListener('pagehide',close);window.addEventListener('alpha-back',back,true);document.addEventListener('visibilitychange',visibility);
 content.append(heading,sourceName,description);
 if(input.image){
  const preview=document.createElement('img');preview.alt='Image for question review';preview.style.cssText='width:100%;max-height:112px;object-fit:contain;border-radius:12px;margin:0 0 12px';preview.hidden=true;
  const extract=document.createElement('button');extract.type='button';extract.textContent='Read text';extract.setAttribute('aria-label','Extract text locally');extract.disabled=true;extract.style.cssText='min-height:44px;margin:0 0 16px;padding:8px 16px;font:inherit;display:block';
  const explanation=document.createElement('p');explanation.textContent='Sends text only';explanation.className='content-question-help';
  content.append(preview,explanation,extract);let image:Blob|undefined;
  status.textContent='Preparing image…';
  void input.image(controller.signal).then(blob=>{if(closed)return;if(!input.current()){close();return;}image=blob;previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;preview.hidden=false;preview.style.display='block';extract.disabled=false;status.textContent='';},()=>{if(!closed)status.textContent='Couldn’t load image';});
  extract.onclick=()=>{if(!image||closed||extract.disabled||!input.current())return;extract.disabled=true;excerpt.disabled=true;proceed.disabled=true;status.textContent='Reading…';void recognizeLocalText(image,controller.signal,progress=>{if(!closed)status.textContent=`Reading locally · ${Math.round(progress.progress*100)}%`;}).then(result=>{if(closed)return;if(!input.current()){close();return;}excerpt.value=result.text.slice(0,12000);status.textContent=result.text?'':'No text found';},()=>{if(!closed)status.textContent='Couldn’t read';}).finally(()=>{if(!closed){extract.disabled=false;excerpt.disabled=false;update();}});};
 }
 input.signal?.addEventListener('abort',close,{once:true});if(input.signal?.aborted){close();return close;}for(const [text,field] of [['Question',question],['Content excerpt',excerpt]] as const){const label=document.createElement('label');label.textContent=text==='Content excerpt'&&input.image?'Text or description':text;label.style.display='block';label.append(field);content.append(label);}if(input.source){content.append(sourceLabel);if(input.sourceDescription){const detail=document.createElement('details'),summary=document.createElement('summary'),copy=document.createElement('p');summary.textContent='About this source';copy.textContent=input.sourceDescription;detail.append(summary,copy);content.append(detail);}}content.append(status);footer.append(proceed,cancel);dialog.append(content,footer);
 // A dialog that cannot open is taken down again (listeners, element, closed callback) before the caller hears of it.
 try{(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();}catch(error){close();throw error;}
 if(input.image)content.focus();else question.focus();return close;
}
