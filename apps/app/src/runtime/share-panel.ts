export type SharePanelOptions={title:string;current:()=>boolean;external?:()=>unknown|Promise<unknown>;email?:()=>unknown|Promise<unknown>;/** Shown under a disabled email row; null leaves the row out. */emailUnavailable?:string|null;copy?:()=>unknown|Promise<unknown>;copyLabel?:string;save?:()=>unknown|Promise<unknown>};
/** Returns a check that the watched value still equals its content when this was called.
 * `token` is a cheap identity for the value (the object a store replaces on every write);
 * `content` is the full value. While the token is the one last seen nothing is serialised,
 * so the panel's repeated check costs a comparison. A replaced token is compared by content,
 * and an equal replacement becomes the new token. The value behind a token must not be
 * mutated in place. */
export function unchangedSince(token:()=>unknown,content:()=>unknown=token):()=>boolean{
 let seen=token();const before=JSON.stringify(content());
 return()=>{const now=token();if(now===seen)return true;if(JSON.stringify(content())!==before)return false;seen=now;return true;};
}
function destinationFailure(error:unknown){
 if(error instanceof DOMException&&error.name==='AbortError')return;
 const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent='Sharing is unavailable. No completed handoff is confirmed.';Object.assign(notice.style,{position:'fixed',bottom:'24px',left:'16px',right:'16px',zIndex:'2147483647',padding:'16px',borderRadius:'16px',background:'#222',color:'#fff'});document.body.append(notice);setTimeout(()=>notice.remove(),6000);
}
let openPanel:(()=>void)|undefined;
let emailComposer:((title:string,text:string)=>void)|undefined;
export function setShareEmailComposer(composer:typeof emailComposer){emailComposer=composer;}
export function composeSharedText(title:string,text:string){if(!emailComposer)throw Error('Email is unavailable. No draft was created.');emailComposer(title,text);}
export function sharedTextEmailAvailable(){return !!emailComposer;}
/** One Alpha panel. Choosing a destination is explicit; closing never selects a fallback. */
export function openSharePanel(options:SharePanelOptions):Promise<void>{
 openPanel?.();
 if(document.hidden||!options.current())return Promise.resolve();
 return new Promise(resolve=>{
  const prior=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');
  dialog.className='alpha-share-panel';dialog.setAttribute('aria-label','Share');
  Object.assign(dialog.style,{border:'0',borderRadius:'24px',padding:'20px',width:'min(360px,calc(100vw - 32px))',maxHeight:'80dvh',boxSizing:'border-box',background:'var(--bg,#fff)',color:'var(--fg,#222)',overflow:'auto'});
  const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);dialog.style.fontSize=style.fontSize;dialog.style.fontFamily=style.fontFamily;for(const name of ['--bg','--fg','--s2','--mut'])dialog.style.setProperty(name,style.getPropertyValue(name));}
  const heading=document.createElement('h2');heading.textContent='Share';
  const header=document.createElement('div');header.className='share-heading';
  const close=document.createElement('button');close.type='button';close.className='share-close';close.setAttribute('aria-label','Close share');close.style.font='inherit';header.append(heading,close);
  const place=()=>{const frame=document.querySelector<HTMLElement>('.alpha-phone [data-screen="1"]');if(!frame)return;const rect=frame.getBoundingClientRect(),scale=rect.width/frame.offsetWidth,reserve=(parseFloat(getComputedStyle(frame).getPropertyValue('--alpha-dock-reserve'))||108)*scale,lower=Math.min(innerHeight-12,rect.bottom-reserve-8),upper=Math.max(12,rect.top+16);Object.assign(dialog.style,{position:'fixed',margin:'0',inset:'auto',left:`${Math.max(12,rect.left+12)}px`,bottom:`${innerHeight-lower}px`,width:`${Math.max(0,Math.min(innerWidth-24,rect.width-24))}px`,maxHeight:`${Math.max(0,lower-upper)}px`});};
  const status=document.createElement('p');status.setAttribute('role','status');
  const retirementEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];
  let selectionWatch:ReturnType<typeof setInterval>;
  let closed=false;
  const finish=()=>{if(closed)return;closed=true;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',finish);for(const event of retirementEvents)window.removeEventListener(event,finish);clearInterval(selectionWatch);window.removeEventListener('resize',place);if(openPanel===finish)openPanel=undefined;dialog.close();dialog.remove();if(prior?.isConnected&&!document.hidden){const menu=prior.closest('details');(menu&&!menu.open?menu.querySelector<HTMLElement>('summary'):prior)?.focus();}resolve();};
  const hidden=()=>{if(document.hidden)finish();};
  const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
  const action=(label:string,run?:()=>unknown|Promise<unknown>,reason?:string)=>{
   const button=document.createElement('button');button.type='button';button.className='share-row';button.style.font='inherit';button.textContent=label;button.style.setProperty('--share-icon',`url('/icons/lucide/${label==='Email'?'mail':label==='Share'?'share-2':label==='Save file'?'download':'copy'}.svg')`);
   if(!run){button.disabled=true;button.style.opacity='.5';if(reason){const hint=document.createElement('p');hint.textContent=reason;hint.style.fontSize='13px';dialog.append(button,hint);return;}}
   button.onclick=()=>{if(closed)return;if(document.hidden||!options.current()){status.textContent='The selection changed. Close and choose it again.';return;}finish();try{void Promise.resolve(run?.()).catch(destinationFailure);}catch(error){destinationFailure(error);}};dialog.append(button);
  };
  close.onclick=finish;dialog.append(header);if(options.email)action('Email',options.email);if(options.external)action('Share',options.external);
  if(options.copy)action(options.copyLabel||'Copy text',options.copy);
  if(options.save)action('Save file',options.save);
  dialog.append(status);dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)finish();}});dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});dialog.addEventListener('close',finish);
  // Keep keyboard traversal inside the panel; chooser handoff happens only after finish().
  dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const buttons=Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
  document.addEventListener('visibilitychange',hidden);window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',finish);for(const event of retirementEvents)window.addEventListener(event,finish);selectionWatch=setInterval(()=>{if(!options.current())finish();},250);document.body.append(dialog);openPanel=finish;
  window.addEventListener('resize',place);place();
  try{dialog.showModal();dialog.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}catch{finish();}
 });
}
