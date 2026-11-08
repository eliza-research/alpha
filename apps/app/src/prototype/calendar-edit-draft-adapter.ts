import {Capacitor} from '@capacitor/core';
import {AssistantDraftController} from './assistant-draft-controller';
import {assistantDraftStore} from '../runtime/assistant-draft-store';
import {encodeCalendarEdit,decodeCalendarEdit,snapshotCalendarEdit,calendarEditIdentity} from '../runtime/calendar-edit-draft';
import {openDomainRecovery} from '../browser/domain-recovery';
import {browserDevProfile} from '../browser/dev-profile';
type Bag=Record<string,any>;
/** Retained existing-item forms use the existing transactional text-draft primitive. */
export function installCalendarEditDraftAdapter(Component:any,views:Bag,options:{active?:(shell:any)=>boolean}={}){
 const enabled=(shell:any)=>options.active?.(shell)??true;
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render;
 let owner:any;
 p.componentDidMount=function(){
  mount.call(this);owner=this;this.calendarEditDraftText='';
  this.calendarEditDraft=new AssistantDraftController(async binding=>{const store=await assistantDraftStore(binding);return {...store,read:async()=>{const row=await store.read();if(row?.text)decodeCalendarEdit(row.text);return row;},save:async(expected,text)=>{if(text)decodeCalendarEdit(text);return store.save(expected,text);}};},()=>this.calendarEditDraftText,text=>{
   this.calendarEditDraftText=text;
   if(this.calendarEditDraftRestore&&text){const restored=decodeCalendarEdit(text);this.calendarEditDraftAnchor=new Date();this.calendarEditDraftIdentity=calendarEditIdentity(restored.form);this.vset('calendar',{form:restored.form,open:null,month:null});if(restored.zone!==Intl.DateTimeFormat().resolvedOptions().timeZone)this.toast('Time zone changed. Review the restored date and time before saving.');}
  },()=>{if(this.live)this.vset('calendar',{});});
  if(enabled(this)){this.calendarEditDraftBound=true;void this.calendarEditDraft.open(JSON.stringify(['calendar-inline-edit-form',browserDevProfile?'development':'app']));}
 };
 p.componentDidUpdate=function(previous:Bag){
  update.call(this,previous);if(!enabled(this))return;if(!this.calendarEditDraftBound){this.calendarEditDraftBound=true;void this.calendarEditDraft.open(JSON.stringify(['calendar-inline-edit-form',browserDevProfile?'development':'app']));}const form=this.vget('calendar').form;
  if(!form?.id||!form.alphaCalendarId&&!form.alphaReminderId)return;
  if(this.calendarEditDraftIdentity!==calendarEditIdentity(form)){this.calendarEditDraftIdentity=calendarEditIdentity(form);this.calendarEditDraftAnchor=new Date();}
  const today=new Date(),anchor=this.calendarEditDraftAnchor as Date;
  const civil=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  if(civil(today)!==civil(anchor)){this.calendarEditDraftAnchor=today;this.vset('calendar',{form:{...form,off:form.off+(civil(anchor)-civil(today))/86400000,...(form.reminderEditSchedule?{reminderEditSchedule:[form.reminderEditSchedule[0]+(civil(anchor)-civil(today))/86400000,...form.reminderEditSchedule.slice(1)]}:{})}});return;}
  try{const text=encodeCalendarEdit(form,this.calendarEditDraftAnchor);const wasInvalid=this.calendarEditFormValidationError;this.calendarEditFormValidationError=false;if(wasInvalid)this.vset('calendar',{});if(text===this.calendarEditDraftSuppressed)return;this.calendarEditDraftText=text;this.calendarEditDraft?.edit(text);}catch{if(!this.calendarEditFormValidationError){this.calendarEditFormValidationError=true;this.vset('calendar',{});}}
 };
 p.calendarEditFormCommitted=function(form:Bag){
  if(!form?.id||!this.calendarEditDraft)return;
  const failed=()=>{if(this.live)this.toast('Saved, but the retained form could not be cleared. Review it before trying again.');};
  try{const text=encodeCalendarEdit(form,this.calendarEditDraftAnchor||new Date());this.calendarEditDraftSuppressed=text;
   void this.calendarEditDraft.consume(text,()=>this.live&&this.calendarEditDraftText===text).catch(failed);
  }catch{failed();}
 };
 const creationCommitted=p.calendarFormCommitted;
 p.calendarFormCommitted=function(form:Bag){if(form?.id)this.calendarEditFormCommitted(form);else creationCommitted?.call(this,form);};
 p.componentWillUnmount=function(){this.calendarEditDraft?.retire(false);this.calendarEditDraftRecovery?.abort();if(owner===this)owner=undefined;unmount.call(this);};
 views.calendar.render=function(state:Bag,api:Bag){
  if(!owner||!enabled(owner))return render(state,api);
  const out=render(state,api),shell=owner,controller=shell?.calendarEditDraft,draft=controller?.state;
  if(!shell||!controller)return out;
  const active=!!state.form?.id&&!!(state.form.alphaCalendarId||state.form.alphaReminderId);
  out.editDraftAvailable=!state.form&&!!shell.calendarEditDraftText;
  out.editDraftStatus=active?(shell.calendarEditFormValidationError?'This form is too large or has unsupported values. Current edits are not saved.':draft.message.replace('before sending','before saving')):'';
  out.editDraftConflict=active&&draft.conflict;
  out.editDraftError=active&&draft.error;out.editDraftListError=!state.form&&draft.error;
  out.editDraftSavedTitle=(()=>{try{return decodeCalendarEdit(draft.savedText).form.title||'Untitled event';}catch{return 'Saved form unavailable';}})();
  const restore=(saved=false)=>{try{shell.calendarEditDraftRestore=true;if(saved)controller.restoreSaved();else{const restored=decodeCalendarEdit(shell.calendarEditDraftText);shell.calendarEditDraftAnchor=new Date();shell.calendarEditDraftIdentity=calendarEditIdentity(restored.form);api.set({form:restored.form,open:null,month:null});if(restored.zone!==Intl.DateTimeFormat().resolvedOptions().timeZone)api.toast('Time zone changed. Review the restored date and time before saving.');}}catch{api.toast('The saved form could not be restored. Open form recovery.');}finally{shell.calendarEditDraftRestore=false;}};
  out.discardEditDraft=()=>{if(state.form||!window.confirm('Discard these retained edits? Saved events and reminders will not change.'))return;const text=shell.calendarEditDraftText;void controller.consume(text,()=>shell.live&&!shell.vget('calendar').form&&shell.calendarEditDraftText===text).catch(()=>api.toast('The retained form changed or could not be cleared. Resume it to review both copies.'));};
  out.resumeEditDraft=()=>restore();out.restoreEditDraft=()=>restore(true);out.replaceEditDraft=()=>controller.keepCurrent();out.retryEditDraft=()=>controller.retry();
  out.recoverEditDraft=()=>{const recovery=controller.recovery();if(!recovery)return;shell.calendarEditDraftRecovery?.abort();const abort=shell.calendarEditDraftRecovery=new AbortController();openDomainRecovery({capture:async signal=>{const captured=await recovery.capture(signal);return {...captured,raw:JSON.stringify({saved:captured.raw,currentForm:shell.vget('calendar').form?snapshotCalendarEdit(shell.vget('calendar').form):shell.calendarEditDraftText})};},reset:recovery.reset},'calendar edits','Calendar edit recovery','Save a backup before resetting the retained form. This does not change events or reminders. Reloading discards current unsaved edits.',abort.signal,undefined,Capacitor.getPlatform()==='android'?'device':'browser');};
  if(out.ev?.edit){const edit=out.ev.edit;out.ev.edit=()=>{if(shell.calendarEditDraftText&&!window.confirm('Replace the retained unsaved edits with a fresh editor?'))return;return edit();};}
  return out;
 };
}
