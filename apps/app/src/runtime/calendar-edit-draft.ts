import {calendarEditFields,decodeCalendarForm,snapshotCalendarForm} from './calendar-form-draft';
import {reminderTarget} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
type Form=Record<string,any>;
const fail=()=>{throw Error('Saved calendar edits need recovery.');};
const text=(value:any,max=256)=>{if(typeof value!=='string'||!value||value.length>max||value.includes('\0'))fail();return value as string;};
const only=(value:any,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail();};
export function snapshotCalendarEdit(form:Form){return {...snapshotCalendarForm(form),id:form.id,alphaCalendarId:form.alphaCalendarId,alphaReminderId:form.alphaReminderId,expected:form.expected,reminderEditTarget:form.reminderEditTarget,reminderEditSchedule:form.reminderEditSchedule,googleEventId:form.googleEventId,googleScope:form.googleScope,googleBase:form.googleBase};}
export function encodeCalendarEdit(form:Form,anchor=new Date()){
 const editable=calendarEditFields(form,anchor);let target:Form;
 // A Google event edit: its calendar (cal), event, scope and the version the owner started from.
 if(form.googleEventId&&!form.alphaCalendarId&&!form.alphaReminderId){target={kind:'google',sourceId:form.cal,eventId:form.googleEventId,scope:form.googleScope??'this',base:form.googleBase};}
 else if(form.googleEventId)return fail();
 else if(form.alphaCalendarId&&!form.alphaReminderId){target={kind:'calendar',id:form.alphaCalendarId,expected:form.expected};}
 else if(form.alphaReminderId&&!form.alphaCalendarId){const original=form.reminderEditSchedule;if(!Array.isArray(original)||original.length!==4)fail();const before=calendarEditFields({...form,off:original[0],t:original[1],repeat:original[2],alert:original[3]},anchor);target={kind:'reminder',id:form.alphaReminderId,selected:form.reminderEditTarget,status:form.reminderStatus,original:{date:before.date,t:original[1],repeat:original[2],alert:original[3]}};}
 else return fail();
 const raw=JSON.stringify({version:1,id:form.id,editable,target});decodeCalendarEdit(raw,anchor);return raw;
}
export function decodeCalendarEdit(raw:string,now=new Date()){
 if(new TextEncoder().encode(raw).length>64000)fail();const value=JSON.parse(raw);only(value,['version','id','editable','target']);if(value.version!==1)fail();const target=value.target,id=text(value.id,target?.kind==='google'?10240:512);
 const restored=decodeCalendarForm(JSON.stringify(value.editable),now,false),form:Form={...restored.form,id};
 if(form.creationId!==undefined||form.reminderCreationId!==undefined)fail();
 if(target?.kind==='calendar'){
  only(target,['kind','id','expected']);const expected=target.expected;only(expected,['title','body','location','begin','end','revision']);
  for(const key of ['title','body','location'])if(typeof expected[key]!=='string'||expected[key].length>32768)fail();
  if(!Number.isSafeInteger(expected.begin)||!Number.isSafeInteger(expected.end)||expected.begin<0||expected.end<=expected.begin)fail();text(expected.revision,512);
  if(!form.cal.startsWith('native:'))fail();form.alphaCalendarId=text(target.id);form.expected={...expected};
 }else if(target?.kind==='google'){
  only(target,['kind','sourceId','eventId','scope','base']);const base=target.base;only(base,['revision','begin','end']);
  if(text(target.sourceId,8192)!==form.cal||!form.cal.startsWith('google:')||!['this','all'].includes(target.scope))fail();
  if(!Number.isSafeInteger(base.begin)||!Number.isSafeInteger(base.end)||base.begin<0||base.end<base.begin)fail();text(base.revision,32768);
  form.googleEventId=text(target.eventId,1024);form.googleScope=target.scope;form.googleBase={revision:base.revision,begin:base.begin,end:base.end};
 }else if(target?.kind==='reminder'){
  only(target,['kind','id','selected','status','original']);const selected=reminderTarget(target.selected);if(selected.reminderId!==text(target.id)||form.cal!=='alpha-reminders'||!['pending','scheduled','posted','completed','cancelled','permission-denied','scheduling-failed'].includes(target.status))fail();
  only(target.original,['date','t','repeat','alert']);const before=decodeCalendarForm(JSON.stringify({...value.editable,date:target.original.date,form:{...value.editable.form,t:target.original.t,repeat:target.original.repeat,alert:target.original.alert}}),now,false);
  form.alphaReminderId=target.id;form.reminderEditTarget=selected;form.reminderStatus=target.status;form.reminderEditSession={uncertain:false};form.reminderEditSchedule=[before.form.off,before.form.t,before.form.repeat,before.form.alert];
 }else fail();
 return {form,date:restored.date,zone:restored.zone};
}
export function calendarEditIdentity(form:Form){return JSON.stringify([form.id,form.expected?.revision,form.reminderEditTarget?.revision,...(form.googleEventId?[form.googleEventId,form.googleBase?.revision]:[])]);}
