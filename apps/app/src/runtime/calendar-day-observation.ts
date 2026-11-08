import {parseClientCalendarDayObservation,type ClientCalendarDayObservation} from '../../../../.eliza/client-features/packages/contracts/src/client-turn-observation.ts';
import {getZonedDateParts,addDaysToLocalDate} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time';

/** The ordinary canonical Calendar surface, without event/feed contents. */
export interface CalendarDaySurface {
 live:boolean;view:string;screen:string;hidden:boolean;pageSuspended:boolean;
 secure:boolean;shade:boolean;connectionOpen:boolean;recovery:boolean;clockDraft:boolean;
 ownerCurrent:boolean;ownerKey:string|null;expectedOwnerKey:string|null;status:string;mutating:boolean;
 calendar:{day:unknown;month?:unknown;form?:unknown;open?:unknown;calendarAuthority?:unknown};
}
/** A visible civil day is lookup context only; no source, selection or read grant is inferred. */
export function calendarDayObservation(surface:CalendarDaySurface,timeZone:string,now=Date.now()):ClientCalendarDayObservation|undefined {
 const state=surface.calendar;
 if(!surface.live||surface.view!=='calendar'||surface.screen!=='home'||surface.hidden||surface.pageSuspended||surface.secure||surface.shade||surface.connectionOpen||surface.recovery||surface.clockDraft||!surface.ownerCurrent||!surface.ownerKey||surface.ownerKey!==surface.expectedOwnerKey||surface.status!=='ready'||surface.mutating||state.form||state.open||state.month!==undefined&&state.month!==null||state.calendarAuthority!==undefined&&state.calendarAuthority!=='canonical'||!Number.isSafeInteger(state.day)||!Number.isFinite(now))return;
 try{
  const day=addDaysToLocalDate(getZonedDateParts(new Date(now),timeZone),state.day as number);
  return parseClientCalendarDayObservation({date:`${day.year}-${String(day.month).padStart(2,'0')}-${String(day.day).padStart(2,'0')}`,timeZone});
 }catch{return;}
}
