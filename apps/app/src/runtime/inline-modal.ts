import {holdPhoneInert} from './modal-inert';

/** Focus ownership for a phone-positioned modal and its pointer-only backdrop. */
export function createInlineModal(close:()=>void,returnFocus?:()=>HTMLElement|null) {
 let mounted:HTMLElement|null=null, dispose:(()=>void)|undefined;
 const ref=(container:HTMLElement|null):void=>{
  if(container===mounted)return;
  dispose?.();dispose=undefined;mounted=container;
  if(!container)return;
  const dialog=container.matches('[role="dialog"]')?container:container.querySelector<HTMLElement>('[role="dialog"]');
  if(!dialog)return;
  const previous=returnFocus?.()||(document.activeElement instanceof HTMLElement?document.activeElement:null);
  const releases:Array<()=>void>=[],backgrounds:HTMLElement[]=[];
  let branch:HTMLElement=container;
  const phone=container.closest<HTMLElement>('.os');
  while(branch!==phone&&branch.parentElement){
   // The toast region stays live: a status message raised from inside the modal must still be announced.
   for(const sibling of branch.parentElement.children)if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.inert&&!sibling.matches('[data-alpha-toast]'))backgrounds.push(sibling);
   branch=branch.parentElement;
  }
  const ownsFocus=()=>container.isConnected&&!container.closest('[inert]')&&!document.querySelector('dialog[open]');
  const controls=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')).filter(element=>!element.matches(':disabled,[tabindex="-1"]')&&!element.closest('[inert],[hidden]')&&element.getClientRects().length>0);
  const focus=()=>{(controls()[0]||dialog).focus({preventScroll:true});};
  dialog.tabIndex=-1;
  const key=(event:KeyboardEvent)=>{
   if(!ownsFocus())return;
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
   if(event.key!=='Tab')return;
   const items=controls(),first=items[0],last=items.at(-1),active=document.activeElement;
   if(!first){event.preventDefault();dialog.focus();}
   else if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last!.focus();}
   else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus();}
  };
  const back=(event:Event)=>{if(!ownsFocus())return;event.preventDefault();event.stopImmediatePropagation();close();};
  const contain=()=>{if(ownsFocus()&&!dialog.contains(document.activeElement))focus();};
  window.addEventListener('alpha-back',back,true);
  // The shell routes Back to the topmost inline dialog through a cancel event.
  dialog.addEventListener('cancel',back);
  document.addEventListener('keydown',key,true);
  document.addEventListener('focusin',contain);
  const observer=new MutationObserver(contain);
  observer.observe(dialog,{childList:true,subtree:true});
  focus();
  for(const sibling of backgrounds){
   const hidden=sibling.getAttribute('aria-hidden'),release=holdPhoneInert(sibling);
   sibling.setAttribute('aria-hidden','true');
   releases.push(()=>{release();if(sibling.getAttribute('aria-hidden')==='true'){if(hidden===null)sibling.removeAttribute('aria-hidden');else sibling.setAttribute('aria-hidden',hidden);}});
  }
  dispose=()=>{
   observer.disconnect();window.removeEventListener('alpha-back',back,true);dialog.removeEventListener('cancel',back);document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',contain);
   releases.reverse().forEach(release=>release());
   // Renderer-owned inert flags are removed later in the same DOM commit.
   // Restore only after that commit, and never steal focus from a replacement.
   queueMicrotask(()=>{
    if(mounted||document.activeElement!==document.body&&!dialog.contains(document.activeElement))return;
    const target=previous?.isConnected?previous:returnFocus?.();
    if(target?.isConnected&&!target.closest('[inert]'))target.focus({preventScroll:true});
   });
  };
 };
 return {ref};
}
