import {calendarInstant,calendarWall} from './calendar-time';
export type CalendarRepeat='none'|'daily'|'weekdays'|'weekly';
export interface RecurringCalendarRecord {id:string;begin:number;end:number;timeZone?:string;allDay?:boolean;repeat?:CalendarRepeat}
export type CalendarOccurrence<T> = T & {seriesId?:string;occurrenceBegin?:number};
const DAY=86400000;
/** Range expansion only. Stored series are never changed by a calendar query. */
export function expandCalendarSeries<T extends RecurringCalendarRecord>(row:T,range:{begin:number;end:number},maximum=2000):{events:CalendarOccurrence<T>[];truncated:boolean}{
 if(!Number.isFinite(range.begin)||!Number.isFinite(range.end)||range.end<=range.begin||!Number.isInteger(maximum)||maximum<1||maximum>10000)throw Error('Invalid calendar range.');
 if(!Number.isFinite(row.begin)||!Number.isFinite(row.end)||row.end<=row.begin)throw Error('Invalid event interval.');
 const repeat=row.repeat||'none';if(!['none','daily','weekdays','weekly'].includes(repeat))throw Error('Invalid event repeat rule.');
 if(repeat==='none')return {events:row.begin<range.end&&row.end>range.begin?[{...row}]:[],truncated:false};
 const zone=row.allDay?'UTC':row.timeZone||'UTC',firstWall=Date.parse(calendarWall(row.begin,zone)+'Z'),duration=row.end-row.begin;
 const stride=repeat==='weekly'?7:1;
 // Seek near the requested range without iterating decades of historical occurrences.
 // Three civil days of margin cover offset transitions including skipped dates.
 const first=Math.max(0,Math.floor((range.begin-duration-row.begin)/DAY/stride)-3);
 const last=Math.max(first,Math.ceil((range.end-row.begin)/DAY/stride)+3);
 if(last-first>40000)throw Error('Choose a smaller calendar range.');
 const events:CalendarOccurrence<T>[]=[];
 for(let index=first;index<=last;index++){
   const civil=firstWall+index*stride*DAY,date=new Date(civil);
   if(repeat==='weekdays'&&[0,6].includes(date.getUTCDay()))continue;
   const begin=index===0?row.begin:calendarInstant(date.toISOString().slice(0,-1),zone,Number.NaN,'forward'),end=begin+duration;
   if(begin<range.begin-duration||begin>=range.end||end<=range.begin)continue;
   // A skipped civil date can map to the following day's instant. Emit it once.
   if(events.some(event=>event.begin===begin))continue;
   if(events.length===maximum)return {events,truncated:true};
   events.push({...row,id:`${row.id}:occ:${begin}`,begin,end,seriesId:row.id,occurrenceBegin:begin});
 }
 return {events,truncated:false};
}
