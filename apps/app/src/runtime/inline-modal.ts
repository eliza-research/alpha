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
  const isSheet=getComputedStyle(dialog).bottom==='0px'&&parseFloat(getComputedStyle(dialog).borderTopLeftRadius)>0;
  const grip=isSheet?dialog.firstElementChild as HTMLElement|null:null;
  const oldTouchAction=grip?.style.touchAction;
  if(grip)grip.style.touchAction='none';
  let drag:{id:number;x:number;y:number;distance:number}|null=null;
  const resetDrag=()=>{drag=null;dialog.style.translate='';};
  const pointerDown=(event:PointerEvent)=>{
   if(!isSheet||!ownsFocus()||event.button!==0||event.clientY>dialog.getBoundingClientRect().top+80||(event.target as Element).closest('button,input,textarea,select,a'))return;
   drag={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0};
   dialog.setPointerCapture(event.pointerId);
  };
  const pointerMove=(event:PointerEvent)=>{
   if(!drag||drag.id!==event.pointerId)return;
   const distance=event.clientY-drag.y;
   if(Math.abs(event.clientX-drag.x)>Math.max(16,Math.abs(distance))){resetDrag();return;}
   drag.distance=Math.max(0,distance);
   dialog.style.translate='0 '+drag.distance+'px';
   event.preventDefault();
  };
  const pointerUp=(event:PointerEvent)=>{
   if(!drag||drag.id!==event.pointerId)return;
   const dismiss=drag.distance>=72;
   resetDrag();
   if(dismiss&&ownsFocus()){event.preventDefault();event.stopPropagation();close();}
  };
  dialog.addEventListener('pointerdown',pointerDown);
  dialog.addEventListener('pointermove',pointerMove);
  dialog.addEventListener('pointerup',pointerUp);
  dialog.addEventListener('pointercancel',resetDrag);
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
   resetDrag();
   if(grip)grip.style.touchAction=oldTouchAction||'';
   dialog.removeEventListener('pointerdown',pointerDown);
   dialog.removeEventListener('pointermove',pointerMove);
   dialog.removeEventListener('pointerup',pointerUp);
   dialog.removeEventListener('pointercancel',resetDrag);
   observer.disconnect();window.removeEventListener('alpha-back',back,true);dialog.removeEventListener('cancel',back);document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',contain);
   releases.reverse().forEach(release=>release());
   // Renderer-owned inert flags are removed later in the same DOM commit.
   // Restore only after that commit, and never steal focus from a replacement.
   queueMicrotask(()=>{
    const displaced=()=>!!mounted||document.activeElement!==document.body&&!dialog.contains(document.activeElement);
    const restore=()=>{
     if(displaced())return true;
     const target=previous?.isConnected?previous:returnFocus?.();
     if(!target?.isConnected||target.closest('[inert],[hidden]')||target.matches(':disabled')||!target.getClientRects().length)return false;
     target.focus({preventScroll:true});return true;
    };
    if(restore())return;
    // A successful asynchronous mutation may briefly remove its toolbar while reloading.
    // Wait for its replacement, but never take focus from another control or modal.
    const watcher=new MutationObserver(()=>{if(restore())stop();});
    const timer=setTimeout(()=>stop(),1000);
    const stop=()=>{watcher.disconnect();clearTimeout(timer);document.removeEventListener('focusin',changed);};
    const changed=()=>{if(displaced())stop();};
    document.addEventListener('focusin',changed);watcher.observe(phone||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['inert','hidden','aria-hidden','disabled']});
   });
  };
 };
 return {ref};
}
