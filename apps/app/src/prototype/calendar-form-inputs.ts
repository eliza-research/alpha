type Form={off:number;t:number;d:number};
const DAY=86400000;
const civil=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
const dateValue=(at:number)=>{const date=new Date(at);return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';};
const minutes=(hours:number)=>Math.round(hours*60);
const timeValue=(value:number)=>{if(!Number.isFinite(value))return '';const at=((value%1440)+1440)%1440;return `${String(Math.floor(at/60)).padStart(2,'0')}:${String(at%60).padStart(2,'0')}`;};
function readDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose a complete date.');const at=Date.parse(value+'T12:00:00Z');if(!Number.isFinite(at)||dateValue(at)!==value)throw Error('Choose a valid date.');return at-12*3600000;}
function readTime(value:string){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('Choose a valid time.');return Number(value.slice(0,2))*60+Number(value.slice(3));}
/** These are civil editor values. Calendar's IANA converter still rejects missing/ambiguous times at Save. */
export function calendarFormInputs(form:Form,now=new Date()){
 const startDay=civil(now)+form.off*DAY,end=minutes(form.t+form.d);
 return {date:dateValue(startDay),startTime:timeValue(minutes(form.t)),endDate:dateValue(startDay+Math.floor(end/1440)*DAY),endTime:timeValue(end)};
}
export function calendarFormInputPatch(form:Form,kind:'date'|'startTime'|'endDate'|'endTime',value:string,now=new Date()):Partial<Form>{
 if(kind==='date')return {off:(readDate(value)-civil(now))/DAY};
 if(kind==='startTime')return {t:readTime(value)/60};
 const original=calendarFormInputs(form,now),endDay=(readDate(kind==='endDate'?value:original.endDate)-(civil(now)+form.off*DAY))/DAY;
 const endTime=readTime(kind==='endTime'?value:original.endTime),duration=endDay*1440+endTime-minutes(form.t);
 if(duration<=0)throw Error('Choose an end after the start.');
 return {d:duration/60};
}
/** Today starts at the next full local hour; a later selected day starts at 10. */
export function calendarDefaultEventStart(off:number,now=new Date()){
 if(off!==0)return {off,t:10};
 const next=new Date(now);next.setHours(next.getHours()+1,0,0,0);
 return {off:(civil(next)-civil(now))/DAY,t:next.getHours()};
}
/** A typed address is a guest draft only. Contacts and provider records are never created here. */
export function calendarGuestEmail(value:unknown):string|null{
 if(typeof value!=='string')return null;const email=value.trim();
 return email.length<=254&&/^[^\s@,;<>"()\[\]\\]+@[^\s@,;<>"()\[\]\\]+$/.test(email)?email:null;
}
