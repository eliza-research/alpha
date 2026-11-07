import {calendarAgenda,calendarAgendaRows,calendarDayColumns,calendarDayCount,calendarDayLabel,visibleCalendarDays} from './calendar-days';
type Bag=Record<string,any>;
const DAY=86400000;
const civilDay=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
/** Shared presentation only: all provider identity stays in the unsplit records. */
export function presentCalendarIntervals(render:(state:Bag,api:Bag)=>Bag,state:Bag,api:Bag,out:Bag,rangeReady:boolean){
    const allDay=(state.events||[]).filter((e:Bag)=>e.calendarInterval&&e.allDay);
    const day=Number(state.day||0),onDay=(off:number)=>allDay.filter((e:Bag)=>off>=e.off&&off<e.allDayEndOff);
    const timed=(state.events||[]).filter((e:Bag)=>e.calendarInterval&&!e.allDay);
    const bounds=(off:number)=>{const now=new Date(api.now);return [new Date(now.getFullYear(),now.getMonth(),now.getDate()+off).getTime(),new Date(now.getFullYear(),now.getMonth(),now.getDate()+off+1).getTime()];};
    const timedOn=(off:number)=>{const [start,end]=bounds(off);return timed.filter((e:Bag)=>e.calendarIntervalData.begin<end&&e.calendarIntervalData.end>start);};
    const segmentsFor=(off:number)=>{
      const [dayStart,dayEnd]=bounds(off);
      return timedOn(off).map((e:Bag)=>{
        const start=new Date(Math.max(dayStart,e.calendarIntervalData.begin)),end=new Date(Math.min(dayEnd,e.calendarIntervalData.end));
        const t=start.getHours()+start.getMinutes()/60,finish=end.getTime()===dayEnd?24:end.getHours()+end.getMinutes()/60;
        // A repeated-hour interval may have a nonpositive wall span. Its visual
        // height uses actual elapsed time; detail always retains original instants.
        const d=Math.min(24-t,Math.max(.25,finish>t?finish-t:(end.getTime()-start.getTime())/3600000));
        return {...e,off,t,d};
      });
    };
    const segments=segmentsFor(day);
    const local=(state.events||[]).filter((e:Bag)=>!e.calendarInterval);
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
    const dayCount=calendarDayCount();
    const visibleDays=visibleCalendarDays(day,dayCount);
    const timelines=new Map<number,Bag[]>(visibleDays.map(off=>[off,off===day?timeline:[...local,...segmentsFor(off)]]));
    const columns=dayCount>1?visibleDays.map(off=>({off,events:off===day?out.dayEvents as Bag[]:dayEventsOf(render({...state,day:off,events:timelines.get(off)},api))})):[];
    const realDay=visibleDays.flatMap(off=>timelines.get(off)!.filter((e:Bag)=>(e.calendarInterval||e.alphaReminderId)&&!e.allDay&&e.off===off&&Number.isFinite(e.t)&&e.t>=0));
    const first=Math.min(7,...realDay.map((e:Bag)=>Math.floor(e.t))),last=Math.max(23,...realDay.map((e:Bag)=>Math.min(24,Math.ceil(e.t+e.d))));
    if(first<7||last>23){
      const shift=(7-first)*56;
      for(const column of columns)column.events=column.events.map((e:Bag)=>({...e,top:e.top+shift}));
      out.dayEvents=out.dayEvents.map((e:Bag)=>({...e,top:e.top+shift}));
      const added=[];
      for(let hour=first;hour<7;hour++)added.push({top:(hour-first)*56+8,lt:(hour-first)*56,label:`${hour%12||12} am`});
      out.hours=[...added,...out.hours.map((h:Bag)=>({...h,top:h.top+shift,lt:h.lt+shift}))];
      if(last===24)out.hours.push({top:(24-first)*56+8,lt:(24-first)*56,label:'Midnight'});
      out.nowTop+=shift;out.nativeTimelineHeight=`${Math.max(912+shift,(last-first)*56+16)}px`;
      const now=new Date(api.now),time=now.getHours()+now.getMinutes()/60;
      out.showNow=day===0&&time>=first&&time<=last;
    }
    const occupied=(off:number)=>onDay(off).length>0||timedOn(off).length>0;
    if(segments.length)out.empty=false;
    out.nativeAllDay=onDay(day).map((e:Bag)=>({title:e.title,open:()=>api.set({open:e.id,openDay:day})}));
    out.events=dayCount>1?[]:out.dayEvents;
    if(dayCount>1){
      out.nativeAllDay=visibleDays.flatMap(off=>onDay(off).map((e:Bag)=>({title:`${calendarDayLabel(api.now,off)} · ${e.title}`,open:()=>api.set({open:e.id,openDay:off})})));
      const now=new Date(api.now),time=now.getHours()+now.getMinutes()/60;
      out.dayColumns=calendarDayColumns(columns,api.now,out.nowTop,time>=first&&time<=last,day);
      out.multiDay=true;out.dayCount=dayCount;out.showNow=false;
      out.empty=columns.every(column=>!column.events.length)&&!out.nativeAllDay.length;
      if(out.empty&&rangeReady)out.emptyText='No visible events or reminders for these days.';
    }
    out.hasNativeAllDay=out.nativeAllDay.length>0;
    if(out.hasNativeAllDay)out.empty=false;
    // Large text lists the selected day instead of drawing timed blocks; the timeline stays mounted
    // (hidden) so its scroll position survives returning to normal text.
    out.agenda=calendarAgenda();
    out.agendaRows=out.agenda?calendarAgendaRows(out.nativeAllDay,out.dayEvents):[];
    const selectedDate=new Date(api.now);selectedDate.setDate(selectedDate.getDate()+day);
    const weekStart=day-(selectedDate.getDay()+6)%7;
    out.week=out.week.map((w:Bag,i:number)=>occupied(weekStart+i)?{...w,dot:weekStart+i===0?'var(--acct)':'var(--mut)'}:w);
    const monthBase=new Date(selectedDate);monthBase.setDate(1);monthBase.setMonth(monthBase.getMonth()+Number(state.month||0));
    const gridStart=new Date(monthBase);gridStart.setDate(1-(monthBase.getDay()+6)%7);
    const gridOff=(civilDay(gridStart)-civilDay(new Date(api.now)))/DAY;
    out.mdays=out.mdays.map((d:Bag,i:number)=>occupied(gridOff+i)?{...d,dot:gridOff+i===0?'var(--acct)':'var(--fg)'}:d);
 return out;
}
