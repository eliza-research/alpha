import {calendarEditFields,decodeCalendarForm,snapshotCalendarForm} from './calendar-form-draft';
type Bag=Record<string,any>;
/** Only UI draft framing; existing Calendar form codec validates authored fields.
 * IDs/versions are retained hints and must be revalidated against the current feed. */
export function encodeCanonicalCalendarDraft(form:Bag,anchor=new Date()){
 if(typeof form.canonicalOwnerKey!=='string'||!form.canonicalOwnerKey||typeof form.creationId!=='string')throw Error('Canonical Calendar draft binding is unavailable');
 const value={version:1,owner:form.canonicalOwnerKey,key:form.creationId,id:form.id??null,event:form.canonicalEventKey??null,providerVersion:form.expectedProviderVersion??null,timing:form.canonicalTiming?[calendarEditFields({...form,off:form.canonicalTiming[0]},anchor).date,...form.canonicalTiming.slice(1)]:null,allDay:form.allDay===true,allDayRange:form.canonicalAllDay??null,recurrenceScope:form.recurrenceScope??null,payload:calendarEditFields(form,anchor)};
 const raw=JSON.stringify(value);decodeCanonicalCalendarDraft(raw,anchor);return raw;
}
export function decodeCanonicalCalendarDraft(raw:string,now=new Date()):{form:Record<string,any>;date:string;zone:string}{
 if(new TextEncoder().encode(raw).length>64000)throw Error('Calendar draft requires recovery');
 const value=JSON.parse(raw);const keys=['version','owner','key','id','event','providerVersion','timing','allDay','allDayRange','recurrenceScope','payload'];
 if(!value||value.version!==1||Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k))||typeof value.owner!=='string'||!value.owner||value.owner.length>2048||typeof value.key!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(value.key)||typeof value.allDay!=='boolean')throw Error('Calendar draft requires recovery');
 for(const key of ['id','event','providerVersion'])if(value[key]!==null&&(typeof value[key]!=='string'||value[key].length>4096))throw Error('Calendar draft target requires recovery');
 if(value.recurrenceScope!==null&&!['instance','series','this_and_following'].includes(value.recurrenceScope))throw Error('Calendar recurrence scope requires recovery');
 if(value.timing!==null&&(!Array.isArray(value.timing)||value.timing.length!==5||typeof value.timing[0]!=='string'||value.timing.slice(1,3).some((n:any)=>!Number.isFinite(n))||typeof value.timing[3]!=='string'||typeof value.timing[4]!=='boolean'))throw Error('Calendar timing draft requires recovery');
 if(value.allDayRange!==null&&(typeof value.allDayRange!=='object'||Object.keys(value.allDayRange).length!==2||typeof value.allDayRange.startDate!=='string'||typeof value.allDayRange.endDateExclusive!=='string'))throw Error('Calendar all-day draft requires recovery');
 const {form,date,zone}=decodeCalendarForm(JSON.stringify(value.payload),now,false);
 return{form:{...form,id:value.id,canonicalOwnerKey:value.owner,creationId:value.key,canonicalEventKey:value.event,expectedProviderVersion:value.providerVersion,canonicalTiming:value.timing?[decodeCalendarForm(JSON.stringify({...value.payload,date:value.timing[0]}),now,false).form.off,...value.timing.slice(1)]:null,allDay:value.allDay,canonicalAllDay:value.allDayRange,recurrenceScope:value.recurrenceScope},date,zone};
}
