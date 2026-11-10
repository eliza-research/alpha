import {phoneWorkflowLocalDay,zoneOffsetMinutes} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {formatSchedule} from '../../../../.eliza/client-features/packages/ui/src/utils/cron-format.ts';
// Upstream plugin-scheduling/src/scheduled-task/trigger-tz.ts. The prepared
// browser SDK does not export this scheduling sentinel.
const OWNER_LOCAL_TZ='owner_local';

export const workflowDeviceTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export function workflowLocalInstant(stamp:string|number,locale?:string):string{
 const date=new Date(stamp);return Number.isFinite(date.getTime())?date.toLocaleString(locale,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
}
/** Display only. Foreign-clock recurrences name their next actual device-local
 * occurrence rather than claiming their wall time follows this device. */
export function workflowCronLabel(expression:string,zone:string,now=Date.now()):string{
 const canonical=expression.replace(/1,2,3,4,5$/, '1-5'),cadence=formatSchedule(canonical);
 if(/^Every (minute|hour|\d+ minutes|\d+ hours)$/.test(cadence))return cadence;
 if(zone===OWNER_LOCAL_TZ||zone===workflowDeviceTimeZone()){const label=formatSchedule(canonical);return label===canonical?'Repeating schedule':label;}
 const parts=expression.trim().split(/\s+/),[minute,hour,day,month,week]=parts;
 if(parts.length!==5||!/^\d+$/.test(minute)||!/^\d+$/.test(hour)||Number(minute)>59||Number(hour)>23||day!=='*'||month!=='*')return 'Repeating schedule';
 const days=week==='*'?[0,1,2,3,4,5,6]:week==='1-5'?[1,2,3,4,5]:week==='0,6'?[0,6]:/^[0-6](,[0-6])*$/.test(week)?week.split(',').map(Number):[];
 if(!days.length)return 'Repeating schedule';
 try{
  const start=Date.parse(phoneWorkflowLocalDay(now,zone)+'T00:00:00Z');
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const expected=hour.padStart(2,'0')+':'+minute.padStart(2,'0');
  for(let offset=0;offset<8;offset++){
   const date=new Date(start+offset*86400000);if(!days.includes(date.getUTCDay()))continue;
   const wall=date.getTime()+(Number(hour)*60+Number(minute))*60000;
   const candidates=[-36,0,36].map(delta=>wall-zoneOffsetMinutes(wall+delta*3600000,zone)*60000).filter(at=>at>now&&phoneWorkflowLocalDay(at,zone)===date.toISOString().slice(0,10)&&clock.format(at)===expected);
   if(candidates.length)return 'Next '+workflowLocalInstant(Math.min(...candidates));
  }
 }catch{/* An invalid source clock cannot supply a made-up local time. */}
 return 'Scheduled time unavailable';
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
