import type {CalendarResponse} from './calendar-response';
import {calendarInstant,calendarWall} from './calendar-time';
import {expandCalendarSeries,type CalendarRepeat} from './calendar-recurrence';
export type CalendarRecord={id:string;calendarId:string;title:string;body:string;location:string;begin:number;end:number;revision:string;allDay?:boolean;timeZone?:string;repeat?:CalendarRepeat;who?:string[];attendeeOptions?:Record<string,{optional:boolean}>;responses?:Record<string,CalendarResponse>;video?:boolean;alert?:number|null;seriesId?:string;occurrenceBegin?:number;excluded?:number[]};
export function calendarRecord(rows:CalendarRecord[],id:string):CalendarRecord|undefined{
 const direct=rows.find(row=>row.id===id);if(direct)return direct;
 const match=/^(.*):occ:(-?\d+)$/.exec(id);if(!match)return;
 const series=rows.find(row=>row.id===match[1]&&!row.seriesId),begin=Number(match[2]);
 if(!series||series.excluded?.includes(begin))return;
 const end=begin+series.end-series.begin;
 return expandCalendarSeries(series,{begin:end-1,end},1).events.find(row=>row.id===id);
}
export function calendarRange(rows:CalendarRecord[],range:{begin:number;end:number}){
 const result:CalendarRecord[]=[],overrides=new Set(rows.filter(row=>row.seriesId).map(row=>row.id));let truncated=false;
 for(const row of rows){
  if(row.seriesId){if(row.begin<range.end&&row.end>range.begin)result.push({...row});continue;}
  const expanded=expandCalendarSeries(row,range,2000);truncated ||= expanded.truncated;
  result.push(...expanded.events.filter(event=>!overrides.has(event.id)&&!row.excluded?.includes(event.occurrenceBegin!)));
 }
 result.sort((a,b)=>a.begin-b.begin||a.id.localeCompare(b.id));return {events:result.slice(0,2000),truncated:truncated||result.length>2000};
}
export function replaceCalendarRecord(rows:CalendarRecord[],record:CalendarRecord){if(record.seriesId){const series=rows.find(row=>row.id===record.seriesId);if(!series)throw Error('Calendar series changed.');series.revision=record.revision;}const replacement={...record,...(record.seriesId?{repeat:'none' as const,excluded:undefined}:{})};const index=rows.findIndex(row=>row.id===record.id);if(index<0)rows.push(replacement);else rows[index]=replacement;}
export function deleteCalendarRecord(rows:CalendarRecord[],record:CalendarRecord,newRevision:string){
 if(record.seriesId){const series=rows.find(row=>row.id===record.seriesId);if(!series)throw Error('Calendar series changed.');series.excluded=[...new Set([...(series.excluded||[]),record.occurrenceBegin!])];series.revision=newRevision;}
 return rows.filter(row=>row.id!==record.id&&(record.seriesId||row.seriesId!==record.id));
}

/** Keep deleted dates and edited occurrences excluded when a whole series moves. */
export function remapCalendarExclusions(rows:CalendarRecord[],before:CalendarRecord,next:CalendarRecord){
 const oldZone=before.allDay?'UTC':before.timeZone||'UTC',newZone=next.allDay?'UTC':next.timeZone||'UTC';
 const oldDay=Date.parse(calendarWall(before.begin,oldZone).slice(0,10)+'T00:00:00Z'),newWall=Date.parse(calendarWall(next.begin,newZone)+'Z');
 const exclusions=[...(before.excluded||[]),...rows.filter(row=>row.seriesId===before.id).map(row=>row.occurrenceBegin!)];
 return [...new Set(exclusions.map(instant=>{const day=Date.parse(calendarWall(instant,oldZone).slice(0,10)+'T00:00:00Z');return calendarInstant(new Date(newWall+day-oldDay).toISOString().slice(0,-1),newZone,Number.NaN,'forward');}))];
}
