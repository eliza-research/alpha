export type SharePanelOptions={title:string;current:()=>boolean;external:()=>unknown|Promise<unknown>;email?:()=>unknown|Promise<unknown>;/** Shown under a disabled email row; null leaves the row out. */emailUnavailable?:string|null;copy?:()=>unknown|Promise<unknown>;copyLabel?:string;save?:()=>unknown|Promise<unknown>};
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
  Object.assign(dialog.style,{border:'0',borderRadius:'24px',padding:'24px',width:'min(360px,calc(100vw - 32px))',maxHeight:'80dvh',boxSizing:'border-box',background:'var(--bg,#fff)',color:'var(--fg,#222)',overflow:'auto'});
  const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);dialog.style.fontSize=style.fontSize;dialog.style.fontFamily=style.fontFamily;for(const name of ['--bg','--fg','--s2','--mut'])dialog.style.setProperty(name,style.getPropertyValue(name));}
  const heading=document.createElement('h2');heading.textContent='Share';heading.style.margin='0 0 8px';
  const title=document.createElement('p');title.textContent=options.title;Object.assign(title.style,{overflowWrap:'anywhere',margin:'0 0 18px',color:'var(--mut,#666)'});
  const status=document.createElement('p');status.setAttribute('role','status');
  const retirementEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];
  let selectionWatch:ReturnType<typeof setInterval>;
  let closed=false;
  const finish=()=>{if(closed)return;closed=true;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',finish);for(const event of retirementEvents)window.removeEventListener(event,finish);clearInterval(selectionWatch);if(openPanel===finish)openPanel=undefined;dialog.close();dialog.remove();if(prior?.isConnected&&!document.hidden)prior.focus();resolve();};
  const hidden=()=>{if(document.hidden)finish();};
  const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
  const action=(label:string,run?:()=>unknown|Promise<unknown>,reason?:string)=>{
   const button=document.createElement('button');button.type='button';button.textContent=label;Object.assign(button.style,{display:'block',width:'100%',minHeight:'48px',padding:'12px 16px',marginTop:'8px',border:'0',borderRadius:'14px',background:'var(--s2,#eee)',color:'inherit',textAlign:'left',font:'inherit'});
   if(!run){button.disabled=true;button.style.opacity='.5';if(reason){const hint=document.createElement('p');hint.textContent=reason;hint.style.fontSize='13px';dialog.append(button,hint);return;}}
   button.onclick=()=>{if(document.hidden||!options.current()){status.textContent='The selection changed. Close and choose it again.';return;}finish();try{void Promise.resolve(run?.()).catch(destinationFailure);}catch(error){destinationFailure(error);}};dialog.append(button);
  };
  dialog.append(heading,title);if(options.email||options.emailUnavailable!==null)action('Share to email',options.email,options.emailUnavailable||'Email is unavailable for this selection.');action('Share externally',options.external);
  if(options.copy)action(options.copyLabel||'Copy text',options.copy);
  if(options.save)action('Save locally',options.save);
  action('Cancel',()=>{});dialog.append(status);dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});dialog.addEventListener('close',finish);
  // Keep keyboard traversal inside the panel; chooser handoff happens only after finish().
  dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const buttons=Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
  document.addEventListener('visibilitychange',hidden);window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',finish);for(const event of retirementEvents)window.addEventListener(event,finish);selectionWatch=setInterval(()=>{if(!options.current())finish();},250);document.body.append(dialog);openPanel=finish;
  try{dialog.showModal();dialog.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}catch{finish();}
 });
}
