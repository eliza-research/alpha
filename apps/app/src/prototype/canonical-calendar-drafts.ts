import {snapshotCalendarForm} from '../runtime/calendar-form-draft';
import {AssistantDraftController} from './assistant-draft-controller';
import {assistantDraftStore} from '../runtime/assistant-draft-store';
import {encodeCanonicalCalendarDraft,decodeCanonicalCalendarDraft} from '../runtime/canonical-calendar-draft';
import {openDomainRecovery} from '../browser/domain-recovery';
import {browserCalendarScope} from './agent-calendar-adapter';
type Bag=Record<string,any>;
const reminderDraftOrigin=Symbol('canonical Calendar draft destination');
const submittedForm=(form:Bag)=>{const fields=snapshotCalendarForm(form);delete fields.reminderCreationId;return JSON.stringify(fields);};
/** Same existing transactional draft primitive, bound to canonical owner+agent+origin. */
export function installCanonicalCalendarDrafts(Component:any,views:Bag){
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render,committed=p.calendarFormCommitted,destinationChanged=p.calendarFormDestinationChanged,admitted=p.calendarFormAdmitted;
 const origins=new WeakMap<object,{owner:Bag;ownerKey:string;identity:string;text:string}>();
 const admissions=new WeakMap<object,{origin:object;signature:string}>();
 let owner:Bag|undefined;
 p.componentDidMount=function(){mount.call(this);owner=this;this.canonicalDraftText='';this.canonicalDraft=new AssistantDraftController(async binding=>{const store=await assistantDraftStore(binding);return{...store,read:async()=>{const row=await store.read();if(row?.text)decodeCanonicalCalendarDraft(row.text);return row;},save:async(expected,text)=>{if(text)decodeCanonicalCalendarDraft(text);return store.save(expected,text);}};},()=>this.canonicalDraftText,text=>{this.canonicalDraftText=text;if(this.canonicalDraftRestoring&&text){const restored=decodeCanonicalCalendarDraft(text);if(restored.form.canonicalOwnerKey!==this.agentCalendar?.state.ownerKey)throw Error('Retained form belongs to another agent');this.canonicalDraftAnchor=new Date();this.vset('calendar',{form:restored.form});}},()=>{if(this.live)this.setState({});});};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);const key=this.agentCalendar?.state.ownerKey;if(key&&key!==this.canonicalDraftOwner){this.canonicalDraftOwner=key;void this.canonicalDraft.open(JSON.stringify(['canonical-calendar-editor',key]));}const form=this.vget('calendar').form;if(!key||form?.canonicalOwnerKey!==key)return;const identity=form.creationId;if(this.canonicalDraftIdentity!==identity){this.canonicalDraftIdentity=identity;this.canonicalDraftAnchor=new Date();}const today=new Date(),anchor=this.canonicalDraftAnchor as Date,civil=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()),shift=(civil(anchor)-civil(today))/86400000;if(shift){this.canonicalDraftAnchor=today;this.vset('calendar',{form:{...form,off:form.off+shift,...(form.canonicalTiming?{canonicalTiming:[form.canonicalTiming[0]+shift,...form.canonicalTiming.slice(1)]}:{})}});return;}try{const raw=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor);this.canonicalDraftInvalid=false;if(raw!==this.canonicalDraftSuppressed){this.canonicalDraftText=raw;this.canonicalDraft.edit(raw);}}catch{this.canonicalDraftInvalid=true;}};
 p.calendarFormDestinationChanged=function(form:Bag,next:Bag){
  const replacement=destinationChanged?.call(this,form,next)??next;
  if(!form?.canonicalOwnerKey||form.id||form.canonicalEventKey||replacement?.cal!=='alpha-reminders')return replacement;
  try{
   const text=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor??new Date());
   if(this.agentCalendar?.state.ownerKey!==form.canonicalOwnerKey||this.canonicalDraftOwner!==form.canonicalOwnerKey||this.canonicalDraftText!==text||encodeCanonicalCalendarDraft(this.vget('calendar').form,this.canonicalDraftAnchor??new Date())!==text)return replacement;
   const origin=Object.freeze({});origins.set(origin,{owner:this,ownerKey:form.canonicalOwnerKey,identity:form.creationId,text});
   return {...replacement,[reminderDraftOrigin]:origin};
  }catch{return replacement;}
 };
 p.calendarFormAdmitted=function(form:Bag){
  const origin=(form&&Reflect.get(form,reminderDraftOrigin)),retained=origin&&origins.get(origin);
  if(!retained)return admitted?.call(this,form);
  if(retained.owner!==this||form.id||form.alphaReminderId||form.reminderEditTarget||form.cal!=='alpha-reminders'||form.creationId!==retained.identity||this.agentCalendar?.state.ownerKey!==retained.ownerKey||this.canonicalDraftOwner!==retained.ownerKey||this.canonicalDraftText!==retained.text)return;
  const token=Object.freeze({});admissions.set(token,{origin,signature:submittedForm(form)});return token;
 };
 p.calendarFormCommitted=function(form:Bag,admission?:object){
  if(!form?.canonicalOwnerKey){
   committed?.call(this,form);
   const submitted=admission&&admissions.get(admission);if(admission)admissions.delete(admission);
   const retained=submitted&&origins.get(submitted.origin);
   if(!submitted||!retained||form?.id||form?.alphaReminderId||form?.reminderEditTarget||(form&&Reflect.get(form,reminderDraftOrigin))!==submitted.origin||retained.owner!==this||form.creationId!==retained.identity||form.cal!=='alpha-reminders'||submittedForm(form)!==submitted.signature)return;
   const exact=()=>{const visible=this.vget('calendar').form;return this.live&&this.agentCalendar?.state.ownerKey===retained.ownerKey&&this.canonicalDraftOwner===retained.ownerKey&&this.canonicalDraftText===retained.text&&(!visible||Reflect.get(visible,reminderDraftOrigin)===submitted.origin&&submittedForm(visible)===submitted.signature);};
   if(!exact())return;
   this.canonicalDraftSuppressed=retained.text;
   void this.canonicalDraft.consume(retained.text,exact).then(()=>origins.delete(submitted.origin)).catch(()=>this.toast('Saved. The retained form could not be cleared; inspect Calendar before retrying.'));return;
  }
  try{const text=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor??new Date());this.canonicalDraftSuppressed=text;void this.canonicalDraft.consume(text,()=>this.live&&this.agentCalendar?.state.ownerKey===form.canonicalOwnerKey&&this.canonicalDraftText===text).catch(()=>this.toast('Saved. The retained form could not be cleared; inspect Calendar before retrying.'));}catch{this.toast('Saved. Inspect Calendar before retrying this retained form.');}
 };
 p.componentWillUnmount=function(){this.canonicalDraft?.retire(false);this.canonicalDraftRecovery?.abort();if(owner===this)owner=undefined;unmount.call(this);};
 views.calendar.render=function(state:Bag,api:Bag){const out=render(state,api),shell=owner,controller=shell?.canonicalDraft;if(!shell||!controller||state.form&&!state.form.canonicalOwnerKey||state.calendarAuthority==='android-native'||browserCalendarScope(shell))return out;const active=!!state.form?.canonicalOwnerKey,draft=controller.state;
  out.formDraftAvailable=!state.form&&!!shell.canonicalDraftText;out.canDiscardFormDraft=out.formDraftAvailable;out.formDraftBusy=draft.opening||draft.consuming;out.formDraftStatus=active?(shell.canonicalDraftInvalid?'This form needs review. Its text is retained.':draft.message.replace('before sending','before saving')):'';out.formDraftConflict=active&&draft.conflict;out.formDraftError=active&&draft.error;out.formDraftListError=!state.form&&draft.error;
  const restore=(saved=false)=>{try{shell.canonicalDraftRestoring=true;if(saved)controller.restoreSaved();else{const restored=decodeCanonicalCalendarDraft(shell.canonicalDraftText);if(restored.form.canonicalOwnerKey!==shell.agentCalendar?.state.ownerKey)throw Error('This form belongs to another agent');shell.canonicalDraftAnchor=new Date();api.set({form:restored.form,open:null});}}catch{api.toast('Retained form cannot be applied to this owner or source. Open form recovery.');}finally{shell.canonicalDraftRestoring=false;}};
  out.resumeFormDraft=()=>restore();out.restoreFormDraft=()=>restore(true);out.replaceFormDraft=()=>controller.keepCurrent();out.retryFormDraft=()=>controller.retry();out.formDraftSavedTitle=(()=>{try{return decodeCanonicalCalendarDraft(draft.savedText).form.title;}catch{return 'Saved form';}})();
  out.discardFormDraft=()=>{if(state.form||!window.confirm('Discard this retained form? Saved Calendar records will not change.'))return;const text=shell.canonicalDraftText;void controller.consume(text,()=>shell.live&&!shell.vget('calendar').form&&shell.canonicalDraftText===text).catch(()=>api.toast('Retained form changed; inspect recovery.'));};
  out.recoverFormDraft=()=>{const recovery=controller.recovery();if(!recovery)return;shell.canonicalDraftRecovery?.abort();const abort=shell.canonicalDraftRecovery=new AbortController();openDomainRecovery(recovery,'calendar form','Calendar form recovery','Download retained changes before resetting this form. Saved Calendar records will not change.',abort.signal);};
  for(const name of ['newEvent','addAt'])if(typeof out[name]==='function'){const start=out[name];out[name]=(...args:any[])=>{if(!shell.vget('calendar').form&&(draft.opening||draft.consuming)){api.toast('Opening the saved form. Try again in a moment.');return;}if(shell.canonicalDraftText&&!shell.vget('calendar').form){api.toast('Resume or discard the retained form before creating another.');return;}return start.apply(out,args);};}return out;
 };
}
