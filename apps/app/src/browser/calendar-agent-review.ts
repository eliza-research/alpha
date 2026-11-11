/**
 * The exact text of the browser build's "Review calendar change" dialog for an agent proposal.
 *
 * The agent contract (calendar-contract.ts) carries a title, description, location, start, end and
 * one IANA time zone. It carries no attendees and no all-day flag, so a proposal can neither add a
 * guest nor change whether an event is all day. The review says so in words, and names the calendar
 * and account that will be written, so the person confirming reads every consequence of Confirm.
 */
import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
type Fields={title:string;description:string;location:string;start:string;end:string;timeZone:string};
type Existing={allDay?:boolean;who?:string[];seriesId?:string};
export type CalendarReviewSource={name:string;account:string};
const day=(at:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'}).format(at);
const last=(end:string)=>day(Math.max(Date.parse(end)-1,0));
/** An all-day event is whole UTC calendar dates. An agent update that names any other instants
 * cannot be shown truthfully as dates, so it is refused before review instead of being saved. */
export const wholeUtcDates=(fields:Pick<Fields,'start'|'end'>)=>Date.parse(fields.start)%86400000===0&&Date.parse(fields.end)%86400000===0;
const actions={calendar_create:'Create event',calendar_update:'Update event',calendar_delete:'Delete event',calendar_read_selected:'Share with agent'} as const;
export function calendarAgentReviewText(type:keyof typeof actions,fields:Fields,source:CalendarReviewSource,existing?:Existing,deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone):string{
  const guests=existing?.who?.length||0,people=`${guests} ${guests===1?'person':'people'}`;
  const attendees=type==='calendar_create'?'No invites sent'
    :type==='calendar_update'?(guests?`${people} · no invites sent`:'No invites sent')
    :type==='calendar_delete'?(guests?`${people} · no cancellation sent`:'Attendees: none.')
    :(guests?`${people} · names not shared`:'Attendees: none.');
  return [
    actions[type]+(existing?.seriesId?' · This occurrence only':''),
    `“${fields.title}”`,
    `${source.name} · ${source.account}`,
    ...(existing?.allDay?[
      // All-day events are stored as UTC calendar dates with an exclusive end.
      (first=>first===last(fields.end)?first:`${first} – ${last(fields.end)}`)(day(Date.parse(fields.start))),
      'All day',
    ]:[
      `${formatDeviceRecordDateTime(fields.start,fields.timeZone)} – ${formatDeviceRecordDateTime(fields.end,fields.timeZone)}`,
      `Time zone: ${fields.timeZone}${fields.timeZone===deviceZone?'':` (this phone is set to ${deviceZone})`}`,
    ]),
    attendees,
    ...(fields.location.trim()?[`Location: ${fields.location}`]:[]),
    ...(fields.description.trim()?[fields.description]:[]),
  ].join('\n');
}
