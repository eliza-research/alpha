import {getZonedDateParts} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time';
type Bag=Record<string,any>;
const DAY=86400000;
const iso=(at:number)=>new Date(at).toISOString().slice(0,10);
const dateValue=(value:string)=>{const at=Date.parse(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(at)&&iso(at)===value?at:null;};
const timeValue=(value:string)=>{const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);return match?Number(match[1])*60+Number(match[2]):null;};
const clock=(minutes:number)=>String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
/** Presentation only: the existing Calendar owns records, drafts and conditional writes. */
export function installCalendarFormPresentation(views:Bag){
 const render=views.calendar.render;
 views.calendar.render=(state:Bag,api:Bag)=>{
  const out=render(state,api),form=state.form;
  const start=out.newEvent;
  out.newEvent=()=>{if(!form&&!out.canonicalDraftEntries&&out.editDraftAvailable&&out.resumeEditDraft){out.resumeEditDraft();return;}if(!form&&!out.canonicalDraftEntries&&out.formDraftAvailable&&out.resumeFormDraft){out.resumeFormDraft();return;}start?.();};
  if(!form||!out.f)return out;
  const f=out.f,zone=form.zone||Intl.DateTimeFormat().resolvedOptions().timeZone,today=getZonedDateParts(new Date(),zone),anchor=Date.UTC(today.year,today.month-1,today.day);
  const startDay=anchor+Number(form.off||0)*DAY,startMinutes=Math.round(Number(form.t||0)*60),duration=Math.max(1,Math.round(Number(form.d||1)*60)),endMinutes=startMinutes+duration;
  const from=form.allDay&&form.canonicalAllDay?form.canonicalAllDay.startDate:iso(startDay),to=form.allDay?(form.canonicalAllDay?.endDateExclusive||iso(anchor+Number(form.nativeAllDayEndOff??Number(form.off||0)+1)*DAY)):iso(startDay+Math.floor(endMinutes/1440)*DAY);
  f.fromDate=from;f.toDate=form.allDay&&to<=from?iso(startDay+DAY):to;f.fromTime=form.allDay?'00:00':clock(startMinutes);f.toTime=form.allDay?'00:00':clock(endMinutes);f.timeDisabled=!!form.allDay;f.cals=[];f.videoAvailable=false;
  const change=(patch:Bag)=>api.set({form:{...form,...patch}});
  f.changeFromDate=(event:Event)=>{const value=(event.target as HTMLInputElement).value,at=dateValue(value);if(at===null)return;const patch:Bag={off:(at-anchor)/DAY};if(form.allDay)patch.canonicalAllDay={startDate:value,endDateExclusive:f.toDate>value?f.toDate:iso(at+DAY)};change(patch);};
  f.changeToDate=(event:Event)=>{const value=(event.target as HTMLInputElement).value,at=dateValue(value);if(at===null)return;if(form.allDay){if(value<=from){api.toast('To must be after From.');return;}change({canonicalAllDay:{startDate:from,endDateExclusive:value}});return;}const end=(at-startDay)/DAY*1440+endMinutes%1440;if(end<=startMinutes){api.toast('To must be after From.');return;}change({d:(end-startMinutes)/60});};
  f.changeFromTime=(event:Event)=>{const at=timeValue((event.target as HTMLInputElement).value);if(at!==null&&!form.allDay)change({t:at/60});};
  f.changeToTime=(event:Event)=>{const at=timeValue((event.target as HTMLInputElement).value);if(at===null||form.allDay)return;let end=Math.floor(endMinutes/1440)*1440+at;if(end<=startMinutes)end+=1440;change({d:(end-startMinutes)/60});};
  f.allDay=!!form.allDay;f.toggleAllDay=()=>change({allDay:!form.allDay,...(!form.allDay?{canonicalAllDay:{startDate:iso(startDay),endDateExclusive:iso(startDay+Math.max(1,Math.ceil(endMinutes/1440))*DAY)}}:{canonicalAllDay:undefined})});
  f.hasExtras=!!(f.repeats?.length||f.alerts?.length);
  return out;
 };
}
