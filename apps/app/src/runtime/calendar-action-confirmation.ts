import {createInlineModal} from './inline-modal';

let dismiss:(()=>void)|undefined;
/** Reuse the app modal's focus, Back and inert handling for Calendar writes. */
export function confirmCalendarAction(title:string,message:string,label:string,destructive=false):Promise<boolean>{
 dismiss?.();
 const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const phone=trigger?.closest<HTMLElement>('.os')??document.querySelector<HTMLElement>('.os');
 if(!phone)return Promise.resolve(false);
 return new Promise(resolve=>{
  const container=document.createElement('div');container.className='calendar-confirmation';container.dataset.alphaPopup='calendar-confirmation';
  const dialog=document.createElement('section');dialog.className='calendar-confirmation-panel';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
  const heading=document.createElement('h2');heading.textContent=title;
  const text=document.createElement('p');text.textContent=message;
  const actions=document.createElement('div');actions.className='calendar-confirmation-actions';
  const back=document.createElement('button');back.type='button';back.textContent='Cancel';
  const approve=document.createElement('button');approve.type='button';approve.textContent=label;approve.className=destructive?'destructive':'primary';
  let settled=false;
  const finish=(confirmed:boolean)=>{if(settled)return;settled=true;modal.ref(null);container.remove();window.removeEventListener('pagehide',cancel);document.removeEventListener('visibilitychange',hidden);if(dismiss===cancel)dismiss=undefined;resolve(confirmed);};
  const cancel=()=>finish(false),hidden=()=>{if(document.hidden)cancel();};
  const modal=createInlineModal(cancel,()=>trigger,{coverAssistant:true});
  back.onclick=cancel;approve.onclick=()=>finish(true);container.onclick=event=>{if(event.target===container)cancel();};
  actions.append(back,approve);dialog.append(heading,text,actions);container.append(dialog);phone.append(container);modal.ref(container);dismiss=cancel;
  window.addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',hidden);
 });
}
