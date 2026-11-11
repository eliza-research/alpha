import {testMocksEnabled} from '../build-flags';
import {openRetainedDataNotice} from './retained-data-notice';
import {layoutBrowserDialog} from './dialog-layout';
import type {DomainRecovery,BrowserDomainDocument} from './domain-document';
let current:HTMLDialogElement|undefined;
type RestoreOption={prepare:(raw:string)=>{raw:string;summary:string};salvage?:(raw:string)=>{raw:string;summary:string};save:(expected:DomainRecovery,raw:string,signal:AbortSignal)=>Promise<void>};
/** Exact-byte backup and explicitly confirmed, revision-checked recovery. */
export function openDomainRecovery(domain:Pick<BrowserDomainDocument,'capture'|'reset'>,name:string,heading:string,description:string,signal?:AbortSignal,restoreOption?:RestoreOption,storage:'browser'|'device'='browser'){
 if(!testMocksEnabled){openRetainedDataNotice(heading,signal);return;}
 if(signal?.aborted||current?.open)return;
 const dialog=current=document.createElement('dialog');dialog.setAttribute('aria-label',heading);dialog.style.cssText='box-sizing:border-box;width:min(400px,94vw);max-height:85dvh;overflow:auto;padding:24px;border:0;border-radius:20px;background:var(--bg,#fff);color:var(--fg,#111);font:16px/1.5 system-ui';
 const previous=document.activeElement as HTMLElement|null,abort=new AbortController();let closed=false,confirming=false,busy=false,captured:DomainRecovery|undefined;
 const title=document.createElement('h2');title.textContent=heading;
 const text=document.createElement('p');text.textContent=description;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent=`Reading saved ${name}…`;
 const button=(label:string)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='min-height:44px;margin:4px;padding:10px;font:inherit';return b;};
 const backup=button(`Download ${name} backup`),legacy=button('Download old copy'),reset=button(`Reset ${storage==='browser'?'app':storage} ${name}`),close=button('Close recovery');backup.disabled=reset.disabled=true;legacy.hidden=true;
 const download=(raw:string,name:string)=>{
  if(busy||closed)return;
  if(storage==='device'){
   busy=true;backup.disabled=reset.disabled=true;
   void (async()=>{
    try{
     const {saveNativeRecoveryBackup}=await import('../runtime/native-recovery-backup');
     const message=await saveNativeRecoveryBackup(raw,name,abort.signal);
     if(!closed)status.textContent=message;
    }catch{if(!closed)status.textContent='Backup unconfirmed';}
    finally{busy=false;if(!closed){backup.disabled=reset.disabled=false;}}
   })();return;
  }
  const url=URL.createObjectURL(new Blob([raw],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);
  try{link.click();status.textContent='Downloading';}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 };
 backup.onclick=()=>{if(captured?.raw!==null&&captured?.raw!==undefined)download(captured.raw,captured.format==='domain'?`Alpha-${name}-recovery.txt`:`Alpha-${name}-store-recovery.txt`);};
 legacy.onclick=()=>{if(captured?.legacy!==null&&captured?.legacy!==undefined)download(captured.legacy,`Alpha-${name}-older-copy.txt`);};
 reset.onclick=()=>{if(busy||closed||!captured)return;if(!confirming){confirming=true;reset.textContent=`Confirm ${name} reset`;status.textContent=`Reset ${name}? Can’t be undone.`;return;}busy=true;reset.disabled=true;
  void (async()=>{try{if(document.hidden)throw Error('Reset cancelled.');await domain.reset(captured!,abort.signal);if(!closed){status.textContent=`${name[0].toUpperCase()+name.slice(1)} reset. Reloading…`;location.reload();}}catch(error){if(!closed){status.textContent=error instanceof Error?error.message:`Reset could not be confirmed. Reload to inspect the ${name}.`;confirming=false;reset.textContent=`Reset ${storage==='browser'?'app':storage} ${name}`;reset.disabled=false;}}finally{busy=false;}})();
 };
 const importLabel=document.createElement('label');importLabel.textContent='Choose calendar backup';
 const file=document.createElement('input');file.type='file';file.accept='.txt,.json,application/json,text/plain';file.setAttribute('aria-label','Choose calendar backup');importLabel.append(file);
 const salvageLabel=document.createElement('label'),salvage=document.createElement('input');salvage.type='checkbox';salvageLabel.append(salvage,document.createTextNode('Recover events'));
 const preview=document.createElement('p');preview.style.whiteSpace='pre-wrap';preview.setAttribute('aria-live','polite');
 const restore=button('Review calendar restore');restore.disabled=true;
 let selection=0,prepared:{raw:string;summary:string}|undefined,restoreConfirmed=false;
 const readSelection=()=>{if(busy||closed)return;const epoch=++selection;prepared=undefined;restoreConfirmed=false;restore.textContent='Review calendar restore';restore.disabled=true;const chosen=file.files?.[0],recoverPartial=salvage.checked;preview.textContent='';if(!chosen)return;preview.textContent='Reading backup…';
  void (async()=>{try{if(chosen.size>5*1024*1024)throw Error('Calendar backup must be 5 MB or smaller.');const raw=await chosen.text();if(closed||epoch!==selection)return;prepared=recoverPartial&&restoreOption!.salvage?restoreOption!.salvage(raw):restoreOption!.prepare(raw);preview.textContent=prepared.summary;restore.disabled=!captured;}catch(error){if(!closed&&epoch===selection)preview.textContent=error instanceof Error?error.message:'Backup could not be read.';}})();
 };
 file.onchange=readSelection;salvage.onchange=readSelection;
 restore.onclick=()=>{if(busy||closed||!prepared||!captured||!restoreOption)return;if(!restoreConfirmed){restoreConfirmed=true;restore.textContent='Confirm calendar restore';preview.textContent=prepared.summary+'\nThis replaces all active calendar events. Download the current calendar first if you want to keep it. No invitations are sent; restored alerts are off. Preferences and operation history are not restored.';return;}
  busy=true;restore.disabled=reset.disabled=file.disabled=salvage.disabled=true;const selected=prepared;
  void (async()=>{try{if(document.hidden)throw Error('Restore cancelled.');await restoreOption.save(captured!,selected.raw,abort.signal);if(!closed)location.reload();}catch(error){if(!closed){preview.textContent=error instanceof Error?error.message:'Restore could not be confirmed. Reload to inspect the calendar.';restoreConfirmed=false;restore.textContent='Review calendar restore';restore.disabled=false;reset.disabled=false;file.disabled=salvage.disabled=false;}}finally{busy=false;}})();
 };
 const trapFocus=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')).filter(item=>item.getClientRects().length);const first=items[0],last=items.at(-1);if(!first||!last)return;if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}};
 dialog.addEventListener('keydown',trapFocus);
 const retireEvents=['pagehide','launcher-home','alpha:device-state','alpha:dev-incoming-call'];
 const dispose=()=>{if(closed)return;closed=true;abort.abort();signal?.removeEventListener('abort',dispose);dialog.remove();if(current===dialog)current=undefined;window.removeEventListener('alpha-back',back,true);for(const event of retireEvents)window.removeEventListener(event,dispose,true);document.removeEventListener('visibilitychange',visibility);previous?.focus();};
 signal?.addEventListener('abort',dispose,{once:true});
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dispose();},visibility=()=>{if(document.hidden)dispose();};close.onclick=dispose;dialog.oncancel=e=>{e.preventDefault();dispose();};window.addEventListener('alpha-back',back,true);for(const event of retireEvents)window.addEventListener(event,dispose,true);document.addEventListener('visibilitychange',visibility);dialog.append(title,text,backup,legacy,reset,status);if(restoreOption){dialog.append(importLabel);if(restoreOption.salvage)dialog.append(salvageLabel);dialog.append(preview,restore);}dialog.append(close);layoutBrowserDialog(dialog,[close]);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();close.focus();
 void domain.capture(abort.signal).then(value=>{if(closed)return;captured=value;if(prepared)restore.disabled=false;backup.disabled=value.raw===null;reset.disabled=value.raw===null&&!value.snapshot;legacy.hidden=value.legacy===null||value.legacy===value.raw;status.textContent=value.legacyChanged?'Conflict in another tab':value.format==='unrecognized'?'Needs recovery':value.raw===null?`No saved ${storage} ${name}.`:'Nothing deleted until you confirm';},()=>{if(!closed)status.textContent='Unreadable';});
}
