import {noteLinkOf} from './note-origin.ts';
type Form=Record<string,any>;
// `origin` is a display back-reference to the note a draft came from. It grants no access.
// `allDay` is stored only as true, for creation forms (an all-day form restored without it would come back as a timed event).
const fields=['title','notes','where','t','d','video','who','cal','repeat','alert','creationId','reminderCreationId','origin','allDay','zone'] as const;
/** Backup may retain invalid edits, but never adds proposal/source authority. */
export function snapshotCalendarForm(form:Form){return Object.fromEntries([...fields,'off'].filter(key=>form[key]!==undefined).map(key=>[key,form[key]]));}
const day=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
const fail=()=>{throw Error('Saved calendar form needs recovery.');};
function validate(value:any,requireCreation=true){
 if(!value||value.version!==1||Object.keys(value).some(key=>!['version','date','zone','form'].includes(key))||typeof value.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!Number.isFinite(Date.parse(value.date))||new Date(value.date).toISOString().slice(0,10)!==value.date||typeof value.zone!=='string')fail();
 try{new Intl.DateTimeFormat('en',{timeZone:value.zone});}catch{fail();}
 const f=value.form;if(!f||Array.isArray(f)||Object.keys(f).some(key=>!(fields as readonly string[]).includes(key)))fail();
 for(const key of ['title','notes','where'])if(typeof f[key]!=='string'||f[key].length>(key==='notes'?32768:2048))fail();
 if(!Number.isFinite(f.t)||f.t<0||f.t>=24||!Number.isFinite(f.d)||f.d<=0||f.d>168||typeof f.video!=='boolean'||!Array.isArray(f.who)||f.who.length>100||f.who.some((id:any)=>typeof id!=='string'||id.length>256))fail();
 if(typeof f.cal!=='string'||f.cal.length>256||!(f.cal==='alpha-reminders'||f.cal.startsWith('native:')||/^agent:[a-f0-9]{64}$/.test(f.cal))||!(['none','daily','weekdays','weekly'].includes(f.repeat)||/^agent:[a-f0-9]{64}$/.test(f.cal)&&f.repeat==='preserve')||f.alert!==null&&(!Number.isFinite(f.alert)||f.alert<0||f.alert>10080))fail();
 for(const key of ['creationId','reminderCreationId'])if(f[key]!==undefined&&(typeof f[key]!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(f[key])))fail();
 if(f.origin!==undefined&&JSON.stringify(noteLinkOf(f.origin))!==JSON.stringify(f.origin))fail();
 if(f.allDay!==undefined&&f.allDay!==true)fail();
 if(f.zone!==undefined){if(typeof f.zone!=='string')fail();try{new Intl.DateTimeFormat('en',{timeZone:f.zone});}catch{fail();}}
 if(requireCreation&&!f.creationId)fail();
 if(new TextEncoder().encode(JSON.stringify(value)).length>64000)fail();
 return value as {version:1;date:string;zone:string;form:Form};
}
/** Only editable creation fields and original idempotency IDs; no selected-source authority. */
export function encodeCalendarForm(form:Form,anchor=new Date()){
 if(form.id||form.alphaCalendarId||form.alphaReminderId||!Number.isSafeInteger(form.off))fail();
 const payload={version:1,date:new Date(day(anchor)+form.off*86400000).toISOString().slice(0,10),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,form:Object.fromEntries(fields.filter(key=>key==='allDay'?form.allDay===true:form[key]!==undefined).map(key=>[key,form[key]]))};
 return JSON.stringify(validate(payload));
}
export function calendarEditFields(form:Form,anchor=new Date()){
 if(!Number.isSafeInteger(form.off))fail();
 const payload={version:1,date:new Date(day(anchor)+form.off*86400000).toISOString().slice(0,10),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,form:Object.fromEntries(fields.filter(key=>!['creationId','reminderCreationId','origin','allDay'].includes(key)&&form[key]!==undefined).map(key=>[key,form[key]]))};
 return validate(payload,false);
}
export function decodeCalendarForm(raw:string,now=new Date(),requireCreation=true){
 const payload=validate(JSON.parse(raw),requireCreation);
 const form:Form={...payload.form,id:null,off:(Date.parse(payload.date)-day(now))/86400000,separateCreation:false};
 return {form,date:payload.date,zone:payload.zone};
}
/** Why a form's start/end cannot be saved, or '' when it can. A form whose own duration is
 * zero or negative is a user-correctable end time; only a positive duration that resolves to a
 * missing or non-advancing wall time is a clock change. */
export function calendarFormTimeProblem(start:Date|null,end:Date|null,hours:number):string{
 if(!Number.isFinite(hours)||hours<=0)return 'Choose an end time after the start. Nothing was saved.';
 if(!start||!end||end.getTime()<=start.getTime())return 'This local time does not exist because the clocks change. Choose another start or end time. Nothing was saved.';
 return '';
}
