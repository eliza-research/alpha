import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
import {CALENDAR_AVAILABILITY_MAX_CALENDARS,type CalendarAvailabilityOperation,type CalendarAvailabilityResult} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import type {AvailabilityReview,AvailabilitySource} from '../runtime/calendar-availability';
import {openReview} from './source-review-dialog';
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
const windowText=(window:{start:string;end:string;timeZone:string})=>`${formatDeviceRecordDateTime(window.start,window.timeZone)} to ${formatDeviceRecordDateTime(window.end,window.timeZone)} (${window.timeZone})`;

/** Step one: the owner ticks the calendars this phone may read. Nothing is preselected,
 * and the calendar names never leave this dialog. */
export function chooseAvailabilityCalendars(sources:readonly AvailabilitySource[],operation:CalendarAvailabilityOperation,signal:AbortSignal,current:()=>void):Promise<string[]|null>{
 current();
 return openReview<string[]>('Calendars','On phone',signal,({content,footer,close})=>{
  const list=element('fieldset');list.style.border='0';list.style.padding='0';list.style.margin='0';list.append(element('legend','On phone'));
  const boxes:HTMLInputElement[]=[];
  for(const source of sources){
   const row=element('label');row.style.display='flex';row.style.alignItems='center';row.style.gap='12px';row.style.minHeight='44px';
   const box=element('input');box.type='checkbox';box.value=source.id;box.style.width='24px';box.style.height='24px';box.style.flexShrink='0';
   row.append(box,element('span',`${source.name} · ${source.account}`));list.append(row);boxes.push(box);
  }
  const status=element('p');status.setAttribute('role','status');
  const check=element('button','Check');check.setAttribute('aria-disabled','true');const cancel=element('button','Cancel');
  const picked=()=>boxes.filter(box=>box.checked).map(box=>box.value);
  const refresh=()=>{const count=picked().length,over=count>CALENDAR_AVAILABILITY_MAX_CALENDARS,blocked=count===0||over;check.setAttribute('aria-disabled',String(blocked));check.style.opacity=blocked?'.45':'';status.textContent=over?`Max ${CALENDAR_AVAILABILITY_MAX_CALENDARS}`:count===0?'Pick a calendar':`${count} chosen`;};
  for(const box of boxes)box.onchange=refresh;refresh();
  check.onclick=()=>{try{current();const ids=picked();if(!ids.length||ids.length>CALENDAR_AVAILABILITY_MAX_CALENDARS){refresh();return;}close(ids);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(element('h2','Check availability'),element('p',windowText(operation)),element('p','Only ticked calendars are read'),list,status);
  footer.append(cancel,check);return boxes[0]??content;
 });
}
/** Step two: the exact answer that would be shared, shown before it leaves the phone. */
export async function confirmAvailabilityResult(result:CalendarAvailabilityResult,chosen:readonly AvailabilitySource[],signal:AbortSignal,current:()=>void):Promise<boolean>{
 current();
 const approved=await openReview<boolean>('Share availability','Availability result',signal,({content,footer,close})=>{
  const share=element('button','Share with agent'),cancel=element('button','Cancel');
  share.onclick=()=>{try{current();close(true);}catch(error){close(null,error);}};cancel.onclick=()=>close(null);
  const heading=element('h2'),dot=element('span');dot.setAttribute('aria-hidden','true');dot.style.cssText=`display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle;background:${result.status==='free'?'#2e9d5b':'#d14343'}`;heading.append(dot,result.status==='free'?'Free':'Busy');
  content.append(heading,element('p',windowText(result.window)));
  if(result.busy.length){
   content.append(element('p','Busy'));
   const list=element('ul');
   for(const interval of result.busy)list.append(element('li',`${formatDeviceRecordDateTime(interval.start,result.window.timeZone)} to ${formatDeviceRecordDateTime(interval.end,result.window.timeZone)}${interval.allDay?' · all day':''}${interval.tentative?' · tentative':''}`));
   content.append(list);
  }
  content.append(element('p',`Read from: ${chosen.map(source=>`${source.name} · ${source.account}`).join('; ')}.`),element('p','Shares times only'));
  footer.append(cancel,share);return share;
 });
 return approved===true;
}
export const availabilityReview:AvailabilityReview={chooseCalendars:chooseAvailabilityCalendars,confirmResult:confirmAvailabilityResult};
