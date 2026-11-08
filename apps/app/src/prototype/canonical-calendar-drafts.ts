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
 const origins=new WeakMap<object,{owner:Bag;ownerKey:string;binding:object;identity:string;text:string}>();
 const admissions=new WeakMap<object,{origin:object;signature:string}>();
 let owner:Bag|undefined;
 const ownsDraft=(shell:Bag,key:string,binding:object|undefined)=>!!binding&&owner===shell&&shell.live&&
  shell.agentCalendar?.state.ownerKey===key&&shell.canonicalDraftOwner===key&&shell.canonicalDraftBinding===binding;
 p.flushCalendarForAppUpdate=async function(current:()=>boolean){
  const exact=()=>current()&&!this.calendarSaving&&!this.agentCalendar?.state.mutating&&
   !this.calendarFormValidationError&&!this.calendarEditFormValidationError&&!this.canonicalDraftInvalid;
  if(!exact())throw Error('Calendar changes are still pending');
  const form=this.vget('calendar').form;
  if(form){
   const draft=form.canonicalOwnerKey?this.canonicalDraft:form.id?this.calendarEditDraft:this.calendarDraft;
   if(!draft?.binding)throw Error('Calendar draft has no storage owner');
  }
  const snapshot=JSON.stringify(form??null);
  const unchanged=()=>exact()&&JSON.stringify(this.vget('calendar').form??null)===snapshot;
  await Promise.all([this.canonicalDraft,this.calendarEditDraft,this.calendarDraft].map(draft=>draft.flush(unchanged)));
 };
 p.componentDidMount=function(){
  mount.call(this);owner=this;this.canonicalDraftText='';this.canonicalDraftOwner=null;this.canonicalDraftBinding=undefined;
  this.canonicalDraft=new AssistantDraftController(async binding=>{
   const key=JSON.parse(binding)[1] as string,store=await assistantDraftStore(binding);
   let foreign=false;
   const bound=(text:string)=>!text||decodeCanonicalCalendarDraft(text).form.canonicalOwnerKey===key;
   return{
    ...store,
    get recovery(){return foreign?undefined:store.recovery;},
    read:async(...args)=>{
     const row=await store.read(...args);
     foreign=!!row&&!bound(row.text);
     if(foreign)throw Error('Retained form belongs to another agent');
     return row;
    },
    save:async(expected,text,...args)=>{
     if(!bound(text))throw Error('Retained form belongs to another agent');
     return store.save(expected,text,...args);
    },
   };
  },()=>this.canonicalDraftText,text=>{
   this.canonicalDraftText=text;
   if(this.canonicalDraftRestoring&&text){
    const restored=decodeCanonicalCalendarDraft(text);
    if(restored.form.canonicalOwnerKey!==this.agentCalendar?.state.ownerKey)throw Error('Retained form belongs to another agent');
    this.canonicalDraftAnchor=new Date();this.vset('calendar',{form:restored.form});
   }
  },()=>{if(this.live)this.setState({});});
 };
 p.componentDidUpdate=function(...args:any[]){
  update?.apply(this,args);
  const key=this.agentCalendar?.state.ownerKey??null,form=this.vget('calendar').form;
  if(key!==(this.canonicalDraftOwner??null)){
   this.canonicalDraft.retire(false);
   this.canonicalDraftRecovery?.abort();
   this.canonicalDraftRecovery=undefined;this.canonicalDraftOwner=key;this.canonicalDraftBinding=key?Object.freeze({}):undefined;
   this.canonicalDraftText='';this.canonicalDraftIdentity=undefined;this.canonicalDraftAnchor=undefined;
   this.canonicalDraftSuppressed=undefined;this.canonicalDraftInvalid=false;
   if(key)void this.canonicalDraft.open(JSON.stringify(['canonical-calendar-editor',key]));
  }
  if(form?.canonicalOwnerKey&&form.canonicalOwnerKey!==key){this.vset('calendar',{form:null});return;}
  if(!key||form?.canonicalOwnerKey!==key){
   if(!form&&!this.canonicalDraftText)this.canonicalDraftInvalid=false;
   return;
  }
  const identity=form.creationId;
  if(this.canonicalDraftIdentity!==identity){this.canonicalDraftIdentity=identity;this.canonicalDraftAnchor=new Date();}
  const today=new Date(),anchor=this.canonicalDraftAnchor as Date,civil=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()),shift=(civil(anchor)-civil(today))/86400000;
  if(shift){this.canonicalDraftAnchor=today;this.vset('calendar',{form:{...form,off:form.off+shift,...(form.canonicalTiming?{canonicalTiming:[form.canonicalTiming[0]+shift,...form.canonicalTiming.slice(1)]}:{})}});return;}
  try{const raw=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor);this.canonicalDraftInvalid=false;if(raw!==this.canonicalDraftSuppressed){this.canonicalDraftText=raw;this.canonicalDraft.edit(raw);}}catch{this.canonicalDraftInvalid=true;}
 };
 p.calendarFormDestinationChanged=function(form:Bag,next:Bag){
  const replacement=destinationChanged?.call(this,form,next)??next;
  if(!form?.canonicalOwnerKey||form.id||form.canonicalEventKey||replacement?.cal!=='alpha-reminders')return replacement;
  try{
   const text=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor??new Date());
   const binding=this.canonicalDraftBinding;
   if(!ownsDraft(this,form.canonicalOwnerKey,binding)||this.canonicalDraftText!==text||encodeCanonicalCalendarDraft(this.vget('calendar').form,this.canonicalDraftAnchor??new Date())!==text)return replacement;
   const origin=Object.freeze({});origins.set(origin,{owner:this,ownerKey:form.canonicalOwnerKey,binding,identity:form.creationId,text});
   return {...replacement,[reminderDraftOrigin]:origin};
  }catch{return replacement;}
 };
 p.calendarFormAdmitted=function(form:Bag){
  const origin=(form&&Reflect.get(form,reminderDraftOrigin)),retained=origin&&origins.get(origin);
  if(!retained)return admitted?.call(this,form);
  if(retained.owner!==this||form.id||form.alphaReminderId||form.reminderEditTarget||form.cal!=='alpha-reminders'||form.creationId!==retained.identity||!ownsDraft(this,retained.ownerKey,retained.binding)||this.canonicalDraftText!==retained.text)return;
  const token=Object.freeze({});admissions.set(token,{origin,signature:submittedForm(form)});return token;
 };
 p.calendarFormCommitted=function(form:Bag,admission?:object){
  if(!form?.canonicalOwnerKey){
   committed?.call(this,form);
   const submitted=admission&&admissions.get(admission);if(admission)admissions.delete(admission);
   const retained=submitted&&origins.get(submitted.origin);
   if(!submitted||!retained||form?.id||form?.alphaReminderId||form?.reminderEditTarget||(form&&Reflect.get(form,reminderDraftOrigin))!==submitted.origin||retained.owner!==this||form.creationId!==retained.identity||form.cal!=='alpha-reminders'||submittedForm(form)!==submitted.signature)return;
   const exact=()=>{const visible=this.vget('calendar').form;return ownsDraft(this,retained.ownerKey,retained.binding)&&this.canonicalDraftText===retained.text&&(!visible||Reflect.get(visible,reminderDraftOrigin)===submitted.origin&&submittedForm(visible)===submitted.signature);};
   if(!exact())return;
   this.canonicalDraftSuppressed=retained.text;
   void this.canonicalDraft.consume(retained.text,exact).then(()=>origins.delete(submitted.origin)).catch(()=>{if(ownsDraft(this,retained.ownerKey,retained.binding))this.toast('Saved. Discard the leftover draft before saving again.');});return;
  }
  const key=form.canonicalOwnerKey,binding=this.canonicalDraftBinding;
  if(!ownsDraft(this,key,binding))return;
  try{const text=encodeCanonicalCalendarDraft(form,this.canonicalDraftAnchor??new Date());this.canonicalDraftSuppressed=text;void this.canonicalDraft.consume(text,()=>ownsDraft(this,key,binding)&&this.canonicalDraftText===text).catch(()=>{if(ownsDraft(this,key,binding))this.toast('Saved. Discard the leftover draft before saving again.');});}catch{this.toast('Saved. Discard the leftover draft before saving again.');}
 };
 p.componentWillUnmount=function(){this.canonicalDraft?.retire(false);this.canonicalDraftRecovery?.abort();if(owner===this)owner=undefined;unmount.call(this);};
 views.calendar.render=function(state:Bag,api:Bag){
  const shell=owner,controller=shell?.canonicalDraft,key=shell?.agentCalendar?.state.ownerKey,binding=shell?.canonicalDraftBinding;
  if(state.form?.canonicalOwnerKey&&state.form.canonicalOwnerKey!==key)state={...state,form:null};
  const out=render(state,api);
  if(!shell||!controller||!key||shell.canonicalDraftOwner!==key||state.form&&!state.form.canonicalOwnerKey||state.calendarAuthority==='android-native'||browserCalendarScope(shell))return out;
  const current=()=>ownsDraft(shell,key,binding);
  const active=!!state.form?.canonicalOwnerKey,draft=controller.state;
  out.formDraftAvailable=!state.form&&!!shell.canonicalDraftText;out.canDiscardFormDraft=out.formDraftAvailable;out.formDraftBusy=draft.opening||draft.consuming;out.formDraftStatus=active?(shell.canonicalDraftInvalid?'Check this draft.':draft.message.replace('before sending','before saving')):'';out.formDraftConflict=active&&draft.conflict;out.formDraftError=active&&draft.error;out.formDraftListError=!state.form&&draft.error;
  const restore=(saved=false)=>{if(!current())return;try{shell.canonicalDraftRestoring=true;if(saved)controller.restoreSaved();else{const restored=decodeCanonicalCalendarDraft(shell.canonicalDraftText);if(restored.form.canonicalOwnerKey!==key)throw Error('This draft belongs to another account');shell.canonicalDraftAnchor=new Date();api.set({form:restored.form,open:null});}}catch{api.toast('This draft belongs to another account. Open it to review.');}finally{shell.canonicalDraftRestoring=false;}};
  out.resumeFormDraft=()=>restore();out.restoreFormDraft=()=>restore(true);out.replaceFormDraft=()=>{if(current())controller.keepCurrent();};out.retryFormDraft=()=>{if(current())controller.retry();};out.formDraftSavedTitle=(()=>{try{return decodeCanonicalCalendarDraft(draft.savedText).form.title;}catch{return 'Saved draft';}})();
  out.discardFormDraft=()=>{if(!current()||state.form||!window.confirm('Discard this draft? Saved events won’t change.'))return;const text=shell.canonicalDraftText;void controller.consume(text,()=>current()&&!shell.vget('calendar').form&&shell.canonicalDraftText===text).catch(()=>{if(current())api.toast('This draft changed. Try again.');});};
  out.recoverFormDraft=()=>{if(!current())return;const recovery=controller.recovery();if(!recovery)return;shell.canonicalDraftRecovery?.abort();const abort=shell.canonicalDraftRecovery=new AbortController();openDomainRecovery(recovery,'calendar form','Calendar form recovery','Download this draft before resetting it. Saved events won’t change.',abort.signal);};
  for(const name of ['newEvent','addAt'])if(typeof out[name]==='function'){const start=out[name];out[name]=(...args:any[])=>{if(!current())return;if(!shell.vget('calendar').form&&(draft.opening||draft.consuming)){api.toast('Opening your draft. Try again in a moment.');return;}if(shell.canonicalDraftText&&!shell.vget('calendar').form){api.toast('Finish or discard your draft first.');return;}return start.apply(out,args);};}return out;
 };
}
