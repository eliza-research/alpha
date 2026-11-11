import {layoutBrowserDialog} from './dialog-layout';
let current:HTMLDialogElement|undefined;
/** Recovery keeps data in Alpha; production has no backup, import or per-store reset. */
export function openRetainedDataNotice(heading:string,signal?:AbortSignal){
 if(signal?.aborted||current?.open)return;
 const dialog=current=document.createElement('dialog'),previous=document.activeElement as HTMLElement|null;
 dialog.setAttribute('aria-label',heading);dialog.style.cssText='box-sizing:border-box;width:min(400px,94vw);max-height:85dvh;overflow:auto;padding:24px;border:0;border-radius:20px;background:var(--bg,#fff);color:var(--fg,#111);font:16px/1.5 system-ui';
 const title=document.createElement('h2');title.textContent=heading;
 const text=document.createElement('p');text.textContent='Data kept';
 const close=document.createElement('button');close.textContent='Close';close.style.cssText='min-height:44px;padding:10px;font:inherit';
 const dispose=()=>{signal?.removeEventListener('abort',dispose);window.removeEventListener('pagehide',dispose);window.removeEventListener('alpha-back',back,true);document.removeEventListener('visibilitychange',hidden);dialog.remove();if(current===dialog)current=undefined;previous?.focus();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dispose();},hidden=()=>{if(document.hidden)dispose();};
 close.onclick=dispose;dialog.oncancel=e=>{e.preventDefault();dispose();};signal?.addEventListener('abort',dispose,{once:true});window.addEventListener('pagehide',dispose);window.addEventListener('alpha-back',back,true);document.addEventListener('visibilitychange',hidden);
 dialog.append(title,text,close);layoutBrowserDialog(dialog,[close]);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();close.focus();
}
