import {holdPhoneInert} from '../runtime/modal-inert';
/** One modal review over an inert phone: focus returns on close, and Cancel, Back, abort,
 * background and page hide all resolve null, so leaving the review never counts as a choice. */
export function openReview<T>(label:string,region:string,signal:AbortSignal,build:(parts:{content:HTMLElement;footer:HTMLElement;close:(value:unknown,error?:unknown)=>void})=>HTMLElement|null):Promise<T|null>{
 return new Promise((resolve,reject)=>{
  const previous=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');dialog.className='note-source-dialog';dialog.setAttribute('aria-label',label);
  const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
  const content=document.createElement('div');content.className='note-source-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label',region);
  const footer=document.createElement('footer');
  let done=false;const release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));
  const close=(value:unknown,error?:unknown)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',abort);window.removeEventListener('alpha-back',back,true);dialog.remove();release();if(previous?.isConnected)previous.focus();error?reject(error):resolve(value as T|null);};
  const abort=()=>close(null),visibility=()=>{if(document.hidden)close(null);},back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close(null);};
  dialog.oncancel=event=>{event.preventDefault();close(null);};dialog.onclose=()=>close(null);
  signal.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',abort);window.addEventListener('alpha-back',back,true);
  try{const focus=build({content,footer,close});dialog.append(content,footer);document.body.append(dialog);dialog.showModal();(focus??content).focus();if(signal.aborted)close(null);}catch(error){close(null,error);}
 });
}
