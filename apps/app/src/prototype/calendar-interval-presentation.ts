import {calendarAgenda,calendarAgendaRows,calendarDayColumns,calendarDayCount,calendarDayLabel,visibleCalendarDays} from './calendar-days';
import {formatHour,formatTime,formatMonthDay,formatFullDateTime} from './locale-time';
type Bag=Record<string,any>;
const DAY=86400000;
const civilDay=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
/** Original instants, never a per-day layout duration, determine the readable detail. */
export function calendarIntervalDetail(begin:number,end:number){
 const start=new Date(begin),finish=new Date(end),crossDate=civilDay(start)!==civilDay(finish),offsetChanged=start.getTimezoneOffset()!==finish.getTimezoneOffset();
 const offset=(date:Date)=>{const minutes=-date.getTimezoneOffset();return `UTC${minutes<0?'-':'+'}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')}:${String(Math.abs(minutes)%60).padStart(2,'0')}`;};
 return {when:`${formatTime(start)}${offsetChanged?' '+offset(start):''} – ${formatTime(finish)}${offsetChanged?' '+offset(finish):''}`,...(crossDate?{day:`${formatMonthDay(start,true)} – ${formatMonthDay(finish,true)}`}:{}) ,summary:`${formatFullDateTime(start)}${offsetChanged?' '+offset(start):''} – ${formatFullDateTime(finish)}${offsetChanged?' '+offset(finish):''}`};
}
type TimedDay = {off: number; start: number; end: number};

function firstDay(days: TimedDay[], before: (day: TimedDay) => boolean) {
  let low = 0, high = days.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (before(days[mid])) low = mid + 1;
    else high = mid;
  }
  return low;
}

function clipToDay(event: Bag, begin: number, end: number, day: TimedDay) {
  const start = new Date(Math.max(day.start, begin)), finish = new Date(Math.min(day.end, end));
  const t = start.getHours() + start.getMinutes() / 60;
  const finishHour = finish.getTime() === day.end ? 24 : finish.getHours() + finish.getMinutes() / 60;
  // A repeated-hour interval may have a nonpositive wall span. Its visual
  // height uses actual elapsed time; detail always retains original instants.
  const d = Math.min(24 - t, Math.max(.25, finishHour > t ? finishHour - t : (finish.getTime() - start.getTime()) / 3600000));
  return {...event, off: day.off, t, d};
}

function indexTimedDays(timed: Bag[], now: Date, visibleDays: number[], occupied: Map<number, boolean>) {
  const bounds = (off: number): TimedDay => ({
    off,
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + off).getTime(),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + off + 1).getTime(),
  });
  const columns = visibleDays.map(off => ({...bounds(off), events: [] as Bag[]}));
  const segments = new Map(columns.map(day => [day.off, day.events]));
  if (!timed.length) return segments;
  // The month grid can be far from the timeline. Index only queried dates
  // with no all-day event, and keep non-finite boundaries out of the search.
  const dotDays = [...occupied]
    .filter(([off, hasEvent]) => !hasEvent && Number.isFinite(off))
    .map(([off]) => off)
    .sort((a, b) => a - b)
    .map(bounds)
    .filter(day => Number.isFinite(day.start) && Number.isFinite(day.end));
  const changes = new Int32Array(dotDays.length + 1);
  for (const event of timed) {
    const {begin, end} = event.calendarIntervalData;
    if (dotDays.length) {
      // Each interval overlaps one range of queried days. Search local
      // midnight instants, so short and long days use their actual bounds.
      const first = firstDay(dotDays, day => !(day.end > begin));
      const after = firstDay(dotDays, day => day.start < end);
      if (first < after) {
        changes[first]++;
        changes[after]--;
      }
    }
    for (const day of columns) {
      if (begin < day.end && end > day.start) day.events.push(clipToDay(event, begin, end, day));
    }
  }
  let count = 0;
  dotDays.forEach(({off}, index) => {
    count += changes[index];
    if (count > 0) occupied.set(off, true);
  });
  return segments;
}

/** Shared presentation only: all provider identity stays in the unsplit records. */
export function presentCalendarIntervals(render:(state:Bag,api:Bag)=>Bag,state:Bag,api:Bag,out:Bag,rangeReady:boolean){
    const day=Number(state.day||0),now=new Date(api.now);
    const dayCount=calendarDayCount(),visibleDays=visibleCalendarDays(day,dayCount);
    const selectedDate=new Date(now);selectedDate.setDate(selectedDate.getDate()+day);
    const weekStart=day-(selectedDate.getDay()+6)%7;
    const monthBase=new Date(selectedDate);monthBase.setDate(1);monthBase.setMonth(monthBase.getMonth()+Number(state.month||0));
    const gridStart=new Date(monthBase);gridStart.setDate(1-(monthBase.getDay()+6)%7);
    const gridOff=(civilDay(gridStart)-civilDay(now))/DAY;
    const allDay: Bag[] = [], timed: Bag[] = [], local: Bag[] = [];
    for (const event of state.events || []) {
      if (!event.calendarInterval) local.push(event);
      else if (event.allDay) allDay.push(event);
      else timed.push(event);
    }
    const coversDay = (event: Bag, off: number) => off >= event.off && off < event.allDayEndOff;
    const onDay = (off: number) => allDay.filter(event => coversDay(event, off));
    const offsets = new Set<number>([...out.week.map((_: Bag, i: number) => weekStart + i), ...out.mdays.map((_: Bag, i: number) => gridOff + i)]);
    const occupied = new Map([...offsets].map(off => [off, allDay.some(event => coversDay(event, off))]));
    const timedDays = indexTimedDays(timed, now, visibleDays, occupied);
    const segments = timedDays.get(day)!;
    const timeline=[...local,...segments];
    // Temporary per-day layout only: provider IDs, original timestamps and
    // selected-object identity stay in the durable state, never in split copies.
    // The renderer's selected-day layout (`events` from a renderer without day columns).
    const dayEventsOf=(result:Bag):Bag[]=>result.dayEvents??result.events??[];
    out.dayEvents=dayEventsOf(out);
    if(allDay.length||timed.length)out.dayEvents=dayEventsOf(render({...state,events:timeline},api));
    // Wide canvases show the selected day and the days after it side by side (measured width,
    // runtime/canvas-geometry.ts); large text keeps the single-day agenda. Each column is the
    // same per-day layout, so event identity, recurrence occurrence and time zone are unchanged.
    const timelines=new Map<number,Bag[]>(visibleDays.map(off=>[off,off===day?timeline:[...local,...timedDays.get(off)!]]));
    const columns=dayCount>1?visibleDays.map(off=>({off,events:off===day?out.dayEvents as Bag[]:dayEventsOf(render({...state,day:off,events:timelines.get(off)},api))})):[];
    const realDay=visibleDays.flatMap(off=>timelines.get(off)!.filter((e:Bag)=>(e.calendarInterval||e.alphaReminderId)&&!e.allDay&&e.off===off&&Number.isFinite(e.t)&&e.t>=0));
    const first=Math.min(7,...realDay.map((e:Bag)=>Math.floor(e.t))),last=Math.max(23,...realDay.map((e:Bag)=>Math.min(24,Math.ceil(e.t+e.d))));
    if(first<7||last>23){
      const shift=(7-first)*56;
      for(const column of columns)column.events=column.events.map((e:Bag)=>({...e,top:e.top+shift}));
      out.dayEvents=out.dayEvents.map((e:Bag)=>({...e,top:e.top+shift}));
      const added=[];
      for(let hour=first;hour<7;hour++)added.push({top:(hour-first)*56+8,lt:(hour-first)*56,label:formatHour(hour)});
      out.hours=[...added,...out.hours.map((h:Bag)=>({...h,top:h.top+shift,lt:h.lt+shift}))];
      if(last===24)out.hours.push({top:(24-first)*56+8,lt:(24-first)*56,label:formatHour(0)});
      out.nowTop+=shift;out.nativeTimelineHeight=`${Math.max(912+shift,(last-first)*56+16)}px`;
      const time=now.getHours()+now.getMinutes()/60;
      out.showNow=day===0&&time>=first&&time<=last;
    }
    if(segments.length)out.empty=false;
    out.nativeAllDay=onDay(day).map((e:Bag)=>({title:e.title,open:()=>api.set({open:e.id,openDay:day})}));
    out.events=dayCount>1?[]:out.dayEvents;
    if(dayCount>1){
      out.nativeAllDay=visibleDays.flatMap(off=>onDay(off).map((e:Bag)=>({title:`${calendarDayLabel(api.now,off)} · ${e.title}`,open:()=>api.set({open:e.id,openDay:off})})));
      const time=now.getHours()+now.getMinutes()/60;
      out.dayColumns=calendarDayColumns(columns,api.now,out.nowTop,time>=first&&time<=last,day);
      out.multiDay=true;out.dayCount=dayCount;out.showNow=false;
      out.empty=columns.every(column=>!column.events.length)&&!out.nativeAllDay.length;
      if(out.empty&&rangeReady)out.emptyText='Free';
    }
    out.hasNativeAllDay=out.nativeAllDay.length>0;
    if(out.hasNativeAllDay)out.empty=false;
    // Large text lists the selected day instead of drawing timed blocks; the timeline stays mounted
    // (hidden) so its scroll position survives returning to normal text.
    out.agenda=calendarAgenda();
    out.agendaRows=out.agenda?calendarAgendaRows(out.nativeAllDay,out.dayEvents):[];
    out.week=out.week.map((w:Bag,i:number)=>occupied.get(weekStart+i)?{...w,dot:weekStart+i===0?'var(--acct)':'var(--mut)'}:w);
    out.mdays=out.mdays.map((d:Bag,i:number)=>occupied.get(gridOff+i)?{...d,dot:gridOff+i===0?'var(--acct)':'var(--fg)'}:d);
 return out;
}
