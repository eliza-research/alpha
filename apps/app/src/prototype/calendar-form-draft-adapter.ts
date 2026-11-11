import {Capacitor} from '@capacitor/core';
import {AssistantDraftController} from './assistant-draft-controller';
import {assistantDraftStore} from '../runtime/assistant-draft-store';
import {encodeCalendarForm,decodeCalendarForm,snapshotCalendarForm} from '../runtime/calendar-form-draft';
import {openDomainRecovery} from '../browser/domain-recovery';
import {browserDevProfile} from '../browser/dev-profile';
type Bag=Record<string,any>;
/** Retained creation forms use the existing transactional text-draft primitive. */
export function installCalendarFormDraftAdapter(Component:any,views:Bag,options:{active?:(shell:any)=>boolean}={}){
 const enabled=(shell:any)=>options.active?.(shell)??true;
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render;
 let owner:any;
 p.componentDidMount=function(){
  mount.call(this);owner=this;this.calendarDraftText='';
  this.calendarDraft=new AssistantDraftController(async binding=>{const store=await assistantDraftStore(binding);return {...store,read:async()=>{const row=await store.read();if(row?.text)decodeCalendarForm(row.text);return row;},save:async(expected,text)=>{if(text)decodeCalendarForm(text);return store.save(expected,text);}};},()=>this.calendarDraftText,text=>{
   this.calendarDraftText=text;
   if(this.calendarDraftRestore&&text){const restored=decodeCalendarForm(text);this.calendarDraftAnchor=new Date();this.calendarDraftIdentity=restored.form.creationId;this.vset('calendar',{form:restored.form,open:null,month:null});if(restored.zone!==Intl.DateTimeFormat().resolvedOptions().timeZone)this.toast('Time zone changed');}
  },()=>{if(this.live)this.vset('calendar',{});});
  if(enabled(this)){this.calendarDraftBound=true;void this.calendarDraft.open(JSON.stringify(['calendar-creation-form',browserDevProfile?'development':'app']));}
 };
 p.componentDidUpdate=function(previous:Bag){
  update.call(this,previous);if(!enabled(this))return;if(!this.calendarDraftBound){this.calendarDraftBound=true;void this.calendarDraft.open(JSON.stringify(['calendar-creation-form',browserDevProfile?'development':'app']));}const form=this.vget('calendar').form;
  if(!form||form.id||form.alphaCalendarId||form.alphaReminderId||!form.creationId)return;
  if(this.calendarDraftIdentity!==form.creationId){this.calendarDraftIdentity=form.creationId;this.calendarDraftAnchor=new Date();}
  const today=new Date(),anchor=this.calendarDraftAnchor as Date;
  const civil=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  if(civil(today)!==civil(anchor)){this.calendarDraftAnchor=today;this.vset('calendar',{form:{...form,off:form.off+(civil(anchor)-civil(today))/86400000}});return;}
  try{const text=encodeCalendarForm(form,this.calendarDraftAnchor);const wasInvalid=this.calendarFormValidationError;this.calendarFormValidationError=false;if(wasInvalid)this.vset('calendar',{});if(text===this.calendarDraftSuppressed)return;this.calendarDraftText=text;this.calendarDraft?.edit(text);}catch{if(!this.calendarFormValidationError){this.calendarFormValidationError=true;this.vset('calendar',{});}}
 };
 p.calendarFormCommitted=function(form:Bag){
  if(!form||form.id||!this.calendarDraft)return;
  const failed=()=>{if(this.live)this.toast('Saved · discard draft');};
  try{const text=encodeCalendarForm(form,this.calendarDraftAnchor||new Date());this.calendarDraftSuppressed=text;
   void this.calendarDraft.consume(text,()=>this.live).catch(failed);
  }catch{failed();}
 };
 p.componentWillUnmount=function(){this.calendarDraft?.retire(false);this.calendarDraftRecovery?.abort();if(owner===this)owner=undefined;unmount.call(this);};
 views.calendar.render=function(state:Bag,api:Bag){
  if(!owner||!enabled(owner))return render(state,api);
  const out=render(state,api),shell=owner,controller=shell?.calendarDraft,draft=controller?.state;
  if(!shell||!controller)return out;
  const active=!!state.form&&!state.form.id;
  // New event reopens this retained form; discard stays inside its editor.
  out.formDraftAvailable=false;
  out.canDiscardFormDraft=active&&!!shell.calendarDraftText;
  out.formDraftStatus=active?(shell.calendarFormValidationError?'Can’t keep edits':draft.message==='Draft saved locally.'?'Saved':draft.message.replace('before sending','before saving')):'';
  out.formDraftConflict=active&&draft.conflict;
  out.formDraftError=active&&draft.error;out.formDraftListError=!state.form&&draft.error;
  out.formDraftSavedTitle=(()=>{try{return decodeCalendarForm(draft.savedText).form.title||'Untitled event';}catch{return 'Unavailable';}})();
  const restore=(saved=false)=>{try{shell.calendarDraftRestore=true;if(saved)controller.restoreSaved();else{const restored=decodeCalendarForm(shell.calendarDraftText);shell.calendarDraftAnchor=new Date();shell.calendarDraftIdentity=restored.form.creationId;api.set({form:restored.form,open:null,month:null});if(restored.zone!==Intl.DateTimeFormat().resolvedOptions().timeZone)api.toast('Time zone changed');}}catch{api.toast('Can’t restore');}finally{shell.calendarDraftRestore=false;}};
  out.discardFormDraft=()=>{
   const form=state.form;if(!active||!window.confirm('Discard draft?'))return;
   const text=shell.calendarDraftText;
   const current=()=>owner===shell&&shell.live&&api.isActive()&&shell.vget('calendar').form===form;
   if(!current())return;
   shell.calendarDraftSuppressed=text;
   void controller.consume(text,current).then(()=>{if(owner===shell&&shell.live&&api.isActive()&&shell.vget('calendar').form===form)api.set({form:null,open:null});}).catch(()=>{shell.calendarDraftSuppressed=undefined;api.toast('Draft changed');});
  };
  out.resumeFormDraft=()=>restore();out.restoreFormDraft=()=>restore(true);out.replaceFormDraft=()=>controller.keepCurrent();out.retryFormDraft=()=>controller.retry();
  out.recoverFormDraft=()=>{const recovery=controller.recovery();if(!recovery)return;shell.calendarDraftRecovery?.abort();const abort=shell.calendarDraftRecovery=new AbortController();openDomainRecovery({capture:async signal=>{const captured=await recovery.capture(signal);return {...captured,raw:JSON.stringify({saved:captured.raw,currentForm:shell.vget('calendar').form?snapshotCalendarForm(shell.vget('calendar').form):shell.calendarDraftText})};},reset:recovery.reset},'calendar form','Calendar form recovery','Download first',abort.signal,undefined,Capacitor.getPlatform()==='android'?'device':'browser');};
  const newEvent=out.newEvent;out.newEvent=()=>{if(shell.calendarDraftText&&!state.form){restore();return;}newEvent();};
  return out;
 };
}
