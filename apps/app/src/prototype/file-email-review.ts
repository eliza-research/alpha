import { holdPhoneInert } from '../runtime/modal-inert';
import { reviewMailAttachment, type MailAttachment } from '../runtime/inbox-attachment';
import { describeEmailTarget, type EmailTarget } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/use-in-email.ts';

type SelectedFile = MailAttachment & { size: number; sha256: string };
/** Reads only after an explicit Files action. Selection/context alone never attaches bytes. */
export function reviewFileEmail(options: {
 sourceNote?: string;
 read: () => Promise<SelectedFile>; current: () => boolean; target: () => EmailTarget;
 insert: (file: MailAttachment, token: string) => boolean; inserted: () => void;
}): () => void {
 const previous=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');
 dialog.className='note-source-dialog';dialog.setAttribute('aria-label','Use selected file in email');
 const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
 const content=document.createElement('div');content.className='note-source-content';
 const title=document.createElement('h2');title.textContent='Use selected file in email';
 const destination=document.createElement('p'),details=document.createElement('p'),policy=document.createElement('p'),status=document.createElement('p');status.setAttribute('role','status');
 policy.textContent='Attach a copy to a local draft only. Review recipients, message and attachments before the separate Send step. Save locally to keep the exact copy for restart.'+(options.sourceNote?' '+options.sourceNote:'');
 const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.disabled=true;label.style.cssText='display:flex;align-items:center;gap:8px;min-height:44px';label.append(check,document.createTextNode('Attach this file'));
 const footer=document.createElement('footer'),cancel=document.createElement('button'),confirm=document.createElement('button');cancel.textContent='Cancel';confirm.textContent='Insert attachment into draft';confirm.disabled=true;
 content.append(title,destination,details,label,policy,status);footer.append(cancel,confirm);dialog.append(content,footer);
 let ended=false,busy=false,file:SelectedFile|undefined,target:EmailTarget|undefined;
 const release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));
 const close=()=>{if(ended)return;ended=true;file=undefined;target=undefined;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',close);window.removeEventListener('launcher-home',close);window.removeEventListener('blur',close);window.removeEventListener('alpha-back',back,true);dialog.remove();release();if(previous?.isConnected)previous.focus();};
 const visibility=()=>{if(document.hidden)close();},back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close();};
 const current=()=>!ended&&!document.hidden&&options.current();
 cancel.onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclose=close;
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',close);window.addEventListener('launcher-home',close);window.addEventListener('blur',close);window.addEventListener('alpha-back',back,true);
 document.body.append(dialog);dialog.showModal();cancel.focus();status.textContent='Checking selected file…';
 const checked=async()=>{const value=await options.read(),review=await reviewMailAttachment(value);if(!current())throw Error('The selection changed. Nothing was added.');if(review.sha256!==value.sha256||review.size!==value.size)throw Error('The selected file changed. Select it again.');return value;};
 void (async()=>{try{
  file=await checked();target=options.target();const description=describeEmailTarget(target);
  destination.textContent=[description.account,description.destination].filter(Boolean).join(' · ');
  details.textContent=`${file.name} · ${file.mimeType} · ${file.size.toLocaleString()} bytes`;
  status.textContent=target.ready?'No attachment is selected yet.':target.reason;check.disabled=!target.ready;
 }catch(error){if(!ended)status.textContent=error instanceof Error?error.message:'File unavailable. Nothing was added.';}})();
 check.onchange=()=>{confirm.disabled=!check.checked||busy||!target?.ready;status.textContent=check.checked?'One attachment selected. Nothing has been uploaded.':'Attachment removed from this review. Nothing was added.';};
 confirm.onclick=()=>{if(busy||!check.checked||!file||!target?.ready)return;busy=true;confirm.disabled=true;check.disabled=true;
  void (async()=>{try{
   const fresh=await checked();
   if(fresh.sha256!==file!.sha256||fresh.size!==file!.size||fresh.name!==file!.name||fresh.mimeType!==file!.mimeType)throw Error('The file changed since review. Cancel and select it again. Nothing was added.');
   if(!current()||!options.insert(file!,target!.token))throw Error('The account, draft or attachment selection changed, or this file is already attached. Cancel and review again. Nothing was added.');
   close();options.inserted();
  }catch(error){if(!ended)status.textContent=error instanceof Error?error.message:'File unavailable. Nothing was added.';}})();
 };
 return close;
}
