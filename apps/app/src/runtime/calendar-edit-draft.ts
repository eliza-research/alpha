import {calendarEditFields,decodeCalendarForm,snapshotCalendarForm} from './calendar-form-draft';
import {reminderTarget} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
type Form=Record<string,any>;
const fail=()=>{throw Error('Saved calendar edits need recovery.');};
const text=(value:any,max=256)=>{if(typeof value!=='string'||!value||value.length>max||value.includes('\0'))fail();return value as string;};
const only=(value:any,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail();};
export function snapshotCalendarEdit(form:Form){return {...snapshotCalendarForm(form),id:form.id,alphaCalendarId:form.alphaCalendarId,alphaReminderId:form.alphaReminderId,expected:form.expected,reminderEditTarget:form.reminderEditTarget,reminderEditSchedule:form.reminderEditSchedule};}
export function encodeCalendarEdit(form:Form,anchor=new Date()){
 const editable=calendarEditFields(form,anchor);let target:Form;
 if(form.alphaCalendarId&&!form.alphaReminderId){target={kind:'calendar',id:form.alphaCalendarId,expected:form.expected};}
 else if(form.alphaReminderId&&!form.alphaCalendarId){const original=form.reminderEditSchedule;if(!Array.isArray(original)||original.length!==4)fail();const before=calendarEditFields({...form,off:original[0],t:original[1],repeat:original[2],alert:original[3]},anchor);target={kind:'reminder',id:form.alphaReminderId,selected:form.reminderEditTarget,status:form.reminderStatus,original:{date:before.date,t:original[1],repeat:original[2],alert:original[3]}};}
 else return fail();
 const raw=JSON.stringify({version:1,id:form.id,editable,target});decodeCalendarEdit(raw,anchor);return raw;
}
export function decodeCalendarEdit(raw:string,now=new Date()){
 if(new TextEncoder().encode(raw).length>64000)fail();const value=JSON.parse(raw);only(value,['version','id','editable','target']);if(value.version!==1)fail();const id=text(value.id,512),target=value.target;
 const restored=decodeCalendarForm(JSON.stringify(value.editable),now,false),form:Form={...restored.form,id};
 if(form.creationId!==undefined||form.reminderCreationId!==undefined)fail();
 if(target?.kind==='calendar'){
  only(target,['kind','id','expected']);const expected=target.expected;only(expected,['title','body','location','begin','end','revision']);
  for(const key of ['title','body','location'])if(typeof expected[key]!=='string'||expected[key].length>32768)fail();
  if(!Number.isSafeInteger(expected.begin)||!Number.isSafeInteger(expected.end)||expected.begin<0||expected.end<=expected.begin)fail();text(expected.revision,512);
  if(!form.cal.startsWith('native:'))fail();form.alphaCalendarId=text(target.id);form.expected={...expected};
 }else if(target?.kind==='reminder'){
  only(target,['kind','id','selected','status','original']);const selected=reminderTarget(target.selected);if(selected.reminderId!==text(target.id)||form.cal!=='alpha-reminders'||!['pending','scheduled','posted','completed','cancelled','permission-denied','scheduling-failed'].includes(target.status))fail();
  only(target.original,['date','t','repeat','alert']);const before=decodeCalendarForm(JSON.stringify({...value.editable,date:target.original.date,form:{...value.editable.form,t:target.original.t,repeat:target.original.repeat,alert:target.original.alert}}),now,false);
  form.alphaReminderId=target.id;form.reminderEditTarget=selected;form.reminderStatus=target.status;form.reminderEditSession={uncertain:false};form.reminderEditSchedule=[before.form.off,before.form.t,before.form.repeat,before.form.alert];
 }else fail();
 return {form,date:restored.date,zone:restored.zone};
}
export function calendarEditIdentity(form:Form){return JSON.stringify([form.id,form.expected?.revision,form.reminderEditTarget?.revision]);}
