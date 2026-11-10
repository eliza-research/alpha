import {holdPhoneInert} from '../runtime/modal-inert';
import {calendarApprovalPending,calendarApprovalStatus,type CalendarApproval} from '../runtime/calendar-approval';
import {calendarApprovalFields,type CalendarApprovalLabels} from './calendar-approval-fields';
/** A displayed request is read again at the tap. No queue or provider mutation occurs here. */
export function reviewCalendarApproval(read:(signal:AbortSignal)=>Promise<CalendarApproval|null>,signal:AbortSignal,current:()=>void,onRead:(row:CalendarApproval|null)=>void,labels:(row:CalendarApproval)=>CalendarApprovalLabels=()=>({})):Promise<{request:CalendarApproval;decision:'approve'|'reject'}|null>{
 signal.throwIfAborted();current();
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog');dialog.className='note-source-dialog calendar-approval-review';dialog.setAttribute('aria-label','Review Calendar change');
  const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg','s2','mut','line','acc'])dialog.style.setProperty('--'+token,style.getPropertyValue('--'+token));dialog.style.setProperty('--source-bg',style.getPropertyValue('--bg'));dialog.style.setProperty('--source-fg',style.getPropertyValue('--fg'));}
  const content=document.createElement('section');content.className='note-source-content';content.tabIndex=0;content.setAttribute('aria-label','Calendar request details');
  const heading=document.createElement('h2');heading.textContent='Calendar change';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Checking request…';
  const reason=document.createElement('p'),note=document.createElement('p');
  const details=document.createElement('dl');details.setAttribute('aria-label','Event details');details.hidden=true;details.style.cssText='display:grid;grid-template-columns:minmax(0,1fr);gap:4px;overflow-wrap:anywhere';
  const footer=document.createElement('footer'),close=document.createElement('button'),deny=document.createElement('button'),approve=document.createElement('button');close.textContent='Close';deny.textContent='Decline';approve.textContent='Approve';approve.className='calendar-approval-primary';deny.hidden=approve.hidden=true;footer.append(close,deny,approve);content.append(heading,status,reason,details,note);dialog.append(content,footer);
  const prior=document.activeElement as HTMLElement|null,release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));let alive=true,busy=false,complete=false,shown='',row:CalendarApproval|null=null;
  const finish=(value:{request:CalendarApproval;decision:'approve'|'reject'}|null,error?:unknown)=>{if(!alive)return;alive=false;signal.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',abort);window.removeEventListener('alpha:device-state',abort);window.removeEventListener('alpha-back',back,true);dialog.remove();release();if(prior?.isConnected)prior.focus();error?reject(error):resolve(value);};
  const abort=()=>finish(null),visibility=()=>{if(document.hidden)abort();},back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();abort();};
  const show=(next:CalendarApproval|null)=>{row=next;onRead(next);const presentation=next?.ownerVerified?calendarApprovalFields(next,labels(next)):null;shown=JSON.stringify(presentation);complete=!!presentation?.complete;status.textContent=calendarApprovalStatus(next);heading.textContent=presentation?.heading??'Calendar change';reason.textContent=presentation?.reason||'The saved request could not be verified. Nothing will be approved here.';note.textContent=calendarApprovalPending(next)?presentation?.note??'':'';details.replaceChildren();for(const field of presentation?.fields??[]){const label=document.createElement('dt'),value=document.createElement('dd');label.textContent=field.label;label.style.fontWeight='600';value.textContent=field.value;value.style.cssText='margin:0 0 12px;white-space:pre-wrap';details.append(label,value);}details.hidden=!presentation;deny.hidden=approve.hidden=!calendarApprovalPending(next);approve.disabled=!complete;};
  const choose=async(decision:'approve'|'reject')=>{
   if(busy||!row||decision==='approve'&&!complete)return;busy=true;approve.disabled=deny.disabled=true;
   try{current();const expected=row.revision,presentation=shown,fresh=await read(signal);current();if(!alive)return;show(fresh);if(!calendarApprovalPending(fresh)||fresh!.revision!==expected||shown!==presentation){status.textContent=calendarApprovalPending(fresh)?'This request changed. Review its updated details before choosing again.':calendarApprovalStatus(fresh);return;}if(decision==='approve'&&!complete)return;finish({request:fresh!,decision});}
   catch(error){if(alive){show(null);status.textContent=error instanceof Error?error.message:'The request could not be checked.';}}
   finally{busy=false;approve.disabled=!complete;deny.disabled=false;}
  };
  close.onclick=abort;deny.onclick=()=>void choose('reject');approve.onclick=()=>void choose('approve');dialog.oncancel=event=>{event.preventDefault();abort();};dialog.onclose=abort;
  signal.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',abort);window.addEventListener('alpha:device-state',abort);window.addEventListener('alpha-back',back,true);
  try{document.body.append(dialog);dialog.showModal();close.focus();void read(signal).then(value=>{current();if(alive)show(value);}).catch(error=>{if(alive){show(null);status.textContent=error instanceof Error?error.message:'The request could not be checked.';}});if(signal.aborted)abort();}catch(error){finish(null,error);}
 });
}
