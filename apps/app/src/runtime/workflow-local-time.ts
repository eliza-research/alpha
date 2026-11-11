import {formatDateTime,formatTime,formatMonthDay} from '../prototype/locale-time.ts';
import {phoneWorkflowLocalDay,zoneOffsetMinutes} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {formatSchedule} from '../../../../.eliza/client-features/packages/ui/src/utils/cron-format.ts';
// Upstream plugin-scheduling/src/scheduled-task/trigger-tz.ts. The prepared
// browser SDK does not export this scheduling sentinel.
const OWNER_LOCAL_TZ='owner_local';

/** Daily/weekly clock schedules only; never reinterpret monthly or interval cron. */
export function workflowClockSchedule(expression:string):{time:string;days:number[]}|null{
 const parts=expression.trim().split(/\s+/);if(parts.length!==5||parts[2]!=='*'||parts[3]!=='*'||!/^\d{1,2}$/.test(parts[0])||!/^\d{1,2}$/.test(parts[1])||Number(parts[0])>59||Number(parts[1])>23)return null;
 const days:number[]=[];
 for(const part of (parts[4]==='*'?'0-6':parts[4]).split(',')){
  const match=/^([0-6])(?:-([0-6]))?$/.exec(part);if(!match)return null;
  const first=Number(match[1]),last=Number(match[2]??match[1]);if(last<first)return null;
  for(let day=first;day<=last;day++)if(!days.includes(day))days.push(day);
 }
 return days.length?{time:parts[1].padStart(2,'0')+':'+parts[0].padStart(2,'0'),days:days.sort((a,b)=>a-b)}:null;
}
export function workflowClockExpression(time:string,days:number[]):string{
 const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
 if(!match||!days.length||days.some(day=>!Number.isInteger(day)||day<0||day>6))throw Error('Choose a time and at least one day.');
 const ordered=[...new Set(days)].sort((a,b)=>a-b);
 return `${Number(match[2])} ${Number(match[1])} * * ${ordered.length===7?'*':ordered.join(',')==='1,2,3,4,5'?'1-5':ordered.join(',')}`;
}

export const workflowDeviceTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export function workflowLocalInstant(stamp:string|number,locale?:string):string{
 const date=new Date(stamp);return Number.isFinite(date.getTime())?formatDateTime(date,locale):'';
}
/** Display only. Foreign-clock recurrences name their next actual device-local
 * occurrence rather than claiming their wall time follows this device. */
export function workflowCronLabel(expression:string,zone:string,now=Date.now()):string{
 const canonical=expression.replace(/1,2,3,4,5$/, '1-5'),cadence=formatSchedule(canonical);
 if(/^Every (minute|hour|\d+ minutes|\d+ hours)$/.test(cadence))return cadence;
 if(zone===OWNER_LOCAL_TZ||zone===workflowDeviceTimeZone()){const label=formatSchedule(canonical);if(label!==canonical)return label;const clock=workflowClockSchedule(canonical);if(!clock)return 'Repeating schedule';const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];const at=formatSchedule(workflowClockExpression(clock.time,[0,1,2,3,4,5,6])).replace('Every day at ','');return clock.days.map(day=>names[day]).join(', ')+' at '+at;}
 const next=workflowNextClockOccurrence(expression,zone,now);
 return next===null?'Scheduled time unavailable':'Next '+workflowLocalInstant(next);
}
/** Resolve a clock recurrence in its own zone, including DST gaps and repeated hours. */
export function workflowNextClockOccurrence(expression:string,zone:string,now=Date.now()):number|null{
 const clock=workflowClockSchedule(expression);if(!clock)return null;
 zone=!zone||zone===OWNER_LOCAL_TZ?workflowDeviceTimeZone():zone;
 try{
  const start=Date.parse(phoneWorkflowLocalDay(now,zone)+'T00:00:00Z'),[hour,minute]=clock.time.split(':').map(Number);
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let offset=0;offset<8;offset++){
   const date=new Date(start+offset*86400000);if(!clock.days.includes(date.getUTCDay()))continue;
   const wall=date.getTime()+(hour*60+minute)*60000;
   const candidates=[-36,0,36].map(delta=>wall-zoneOffsetMinutes(wall+delta*3600000,zone)*60000).filter(at=>at>=now&&phoneWorkflowLocalDay(at,zone)===date.toISOString().slice(0,10)&&format.format(at)===clock.time);
   if(candidates.length)return Math.min(...candidates);
  }
 }catch{/* Invalid source zones do not invent an occurrence. */}
 return null;
}
export function workflowSnoozeTime(stamp:string|number,now=Date.now()):string{
 const date=new Date(stamp);if(!Number.isFinite(date.getTime()))return '';
 const sameDay=date.toDateString()===new Date(now).toDateString();
 return (sameDay?'':formatMonthDay(date,date.getFullYear()!==new Date(now).getFullYear())+', ')+formatTime(date);
}

/** Native datetime-local controls use the browser's zone; stored instants keep their zone. */
export function automationLocalDateInput(stamp:string|number):string{const date=new Date(stamp);return Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';}
export function localDate(value:string):Date{
 const fields=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value),date=new Date(value);
 if(!fields||!Number.isFinite(date.getTime()))throw Error('Choose a valid local date and time.');
 const expected=fields.slice(1,7).map(part=>Number(part||0)),actual=[date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()];
 if(expected.some((part,index)=>part!==actual[index])||date.getMilliseconds()!==Number((fields[7]||'').padEnd(3,'0')))throw Error('This local time does not exist. Choose another time.');
 return date;
}
