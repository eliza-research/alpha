import {calendarEditorCommand} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-command';
import type {LifeOpsCalendarEvent,LifeOpsCalendarEventUpdate,CreateLifeOpsCalendarEventRequest} from '../../../../.eliza/client-features/packages/contracts/src/calendar';
import {getZonedDateParts,addDaysToLocalDate,buildUtcDateFromLocalParts} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time';
import {calendarEventKey,calendarSourceKey} from './agent-calendar';
const DAY=86400000;
const civil=(p:{year:number;month:number;day:number})=>Date.UTC(p.year,p.month-1,p.day);
const date=(p:{year:number;month:number;day:number})=>`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
/** Presentation keys never become provider IDs or native selections. */
export function canonicalCalendarRow(event:LifeOpsCalendarEvent,displayZone:string,now=new Date()){
 const today=getZonedDateParts(now,displayZone),start=getZonedDateParts(new Date(event.startAt),event.isAllDay?'UTC':displayZone),end=getZonedDateParts(new Date(event.endAt),event.isAllDay?'UTC':displayZone);
 return{id:'canonical-calendar:'+calendarEventKey(event),canonicalEvent:structuredClone(event),canonicalEventKey:calendarEventKey(event),off:(civil(start)-civil(today))/DAY,t:event.isAllDay?0:start.hour+start.minute/60,d:event.isAllDay?0:(Date.parse(event.endAt)-Date.parse(event.startAt))/3600000,allDay:event.isAllDay,allDayEndOff:(civil(end)-civil(today))/DAY,title:event.title,notes:event.description,where:event.location,who:[],video:false,repeat:'none',alert:null,cal:calendarSourceKey({provider:event.provider,side:event.side,grantId:event.grantId??'',connectorAccountId:event.connectorAccountId??'',calendarId:event.calendarId})};
}
export type CanonicalCalendarForm={ownerKey:string;operationKey:string;sourceKey:string;eventKey?:string;expectedProviderVersion?:string;date:{year:number;month:number;day:number};startMinutes:number;durationMinutes:number;timeZone:string;title:string;notes:string;location:string;allDay?:{startDate:string;endDateExclusive:string};recurrence?:string[];recurrenceScope?:LifeOpsCalendarEventUpdate['recurrenceScope'];attendees?:CreateLifeOpsCalendarEventRequest['attendees']};
/** Date/time conversion is the Calendar domain's rejecting IANA primitive, not a host parser. */
export function calendarFormRange(form:CanonicalCalendarForm){
 if(form.allDay)return{allDay:{...form.allDay}};
 if(!Number.isInteger(form.startMinutes)||form.startMinutes<0||form.startMinutes>=1440||!Number.isFinite(form.durationMinutes)||form.durationMinutes<=0)throw Error('Choose a valid start and end time');
 const at=(minutes:number)=>{const d=addDaysToLocalDate(form.date,Math.floor(minutes/1440)),time=minutes%1440;return buildUtcDateFromLocalParts(form.timeZone,{...d,hour:Math.floor(time/60),minute:time%60,second:0},'reject').toISOString();};
 return{startAt:at(form.startMinutes),endAt:at(form.startMinutes+form.durationMinutes)};
}
export function calendarFormCreate(form:CanonicalCalendarForm):Omit<CreateLifeOpsCalendarEventRequest,'side'|'grantId'|'calendarId'> & {idempotencyKey:string}{return calendarEditorCommand({kind:'create',fields:form,range:calendarFormRange(form),operationKey:form.operationKey});}
/** UI conversion only; shared command helper owns field/range/recurrence diffing. */
export function calendarFormPatch(form:CanonicalCalendarForm,event:LifeOpsCalendarEvent,changed:{timing?:boolean;zone?:boolean}={timing:true,zone:true}):LifeOpsCalendarEventUpdate & {idempotencyKey:string}{return calendarEditorCommand({kind:'update',fields:form,event,changed:{timing:!!changed.timing,zone:!!changed.zone},...(changed.timing?{range:calendarFormRange(form)}:{}),operationKey:form.operationKey});}
export function canonicalHomeCalendar(next:{event:LifeOpsCalendarEvent|null;calendarFeedState:string;readScope:{timeMin:string;timeMax:string}}|null,fresh=true){return{kind:'canonical-calendar' as const,event:next?.event??null,verified:fresh&&next?.calendarFeedState==='complete',emptyLabel:fresh&&next?.calendarFeedState==='complete'?'No upcoming events in this window':'Calendar has not been verified',window:next?.readScope??null};}
