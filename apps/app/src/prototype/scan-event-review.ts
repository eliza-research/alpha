import {scanEventDraft,scanAllDayEventDraft,suggestScanEventDetails,type ScanEventDraft,type ScanEventSuggestion} from './scan-event';

const repeatLabel:Record<NonNullable<ScanEventSuggestion['recurrence']>['repeat'],string>={daily:'daily',weekdays:'on weekdays',weekly:'weekly'};
/** Suggestions only. Every inference is listed, repeats need an explicit tick and Calendar's own Save remains the only write. */
export function createScanEventReview(text:()=>string,active:()=>boolean,review:(draft:ScanEventDraft)=>boolean,now:()=>Date=()=>new Date()){
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Create event draft';summary.style.cssText='cursor:pointer;min-height:44px;padding-top:12px';
 const description=document.createElement('p');description.textContent='Check each detail against the photo. Unclear dates and times stay blank. Save in Calendar to create the event.';
 const zone=document.createElement('p');zone.textContent='Local time · '+Intl.DateTimeFormat().resolvedOptions().timeZone;
 const notes=document.createElement('ul');notes.setAttribute('aria-label','Suggestion notes');notes.style.cssText='margin:0;padding-left:20px;display:grid;gap:4px';notes.hidden=true;
 const source=document.createElement('p');source.setAttribute('aria-label','Printed time zone');source.hidden=true;
 const form=document.createElement('form');form.style.cssText='display:grid;gap:12px';
 const input=(name:string,type:string)=>{const label=document.createElement('label');label.textContent=name;label.style.cssText='display:grid;gap:4px';const value=document.createElement('input');value.type=type;value.setAttribute('aria-label',name);value.style.cssText='box-sizing:border-box;width:100%;min-height:44px;font:inherit;color:inherit;background:var(--s2,#eee);border:1px solid var(--bd,#aaa);border-radius:8px;padding:8px';label.append(value);form.append(label);return value;};
 const check=(name:string)=>{const label=document.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;min-height:44px';const value=document.createElement('input');value.type='checkbox';value.setAttribute('aria-label',name);value.style.cssText='width:24px;height:24px';const text=document.createElement('span');text.textContent=name;label.append(value,text);form.append(label);return {label,value,text};};
 const title=input('Event title','text'),date=input('Event date','date'),allDay=check('All day'),time=input('Event start time','time'),minutes=input('Event duration in minutes','number'),location=input('Event location','text'),repeat=check('Repeat');
 repeat.label.hidden=true;
 title.maxLength=200;title.required=true;date.required=true;date.min='1970-01-01';date.max='2100-12-31';minutes.min='15';minutes.max='1440';minutes.step='1';location.maxLength=500;
 const syncAllDay=()=>{time.required=!allDay.value.checked;minutes.required=!allDay.value.checked;time.disabled=allDay.value.checked;minutes.disabled=allDay.value.checked;};
 allDay.value.onchange=syncAllDay;syncAllDay();
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-label','Event draft status');
 const button=document.createElement('button');button.type='submit';button.textContent='Review in Calendar';button.style.cssText='min-height:44px;font:inherit;background:var(--s2,#eee);color:inherit;border:1px solid var(--bd,#aaa);border-radius:8px;padding:8px 16px';form.append(button,status);
 let initialized=false,submitted=false,suggested:ScanEventSuggestion|null=null;
 const initialize=()=>{if(initialized||!details.open)return;initialized=true;suggested=suggestScanEventDetails(text(),{now:now()});const fields=suggested.fields;title.value=fields.title;date.value=fields.date;time.value=fields.time;minutes.value=String(fields.minutes);location.value=fields.location;
  allDay.value.checked=suggested.allDay;syncAllDay();
  notes.replaceChildren(...suggested.disclosures.map(note=>{const item=document.createElement('li');item.textContent=note;return item;}));notes.hidden=!suggested.disclosures.length;
  source.hidden=!suggested.sourceZone;source.textContent=suggested.sourceZone?`Printed time zone: ${suggested.sourceZone}. The start time above is converted to your local time.`:'';
  const hint=suggested.recurrence;repeat.label.hidden=!hint;repeat.value.checked=false;if(hint){repeat.text.textContent=`Repeat ${repeatLabel[hint.repeat]} (suggested from “${hint.evidence}”)`;repeat.value.setAttribute('aria-label',repeat.text.textContent);}};
 details.addEventListener('toggle',initialize);
 form.onsubmit=event=>{event.preventDefault();if(submitted||!active())return;try{const hint=suggested?.recurrence;const reviewedRepeat=hint&&repeat.value.checked?hint.repeat:'none';const draft=allDay.value.checked?scanAllDayEventDraft({title:title.value,date:date.value,location:location.value,repeat:reviewedRepeat},text()):scanEventDraft({title:title.value,date:date.value,time:time.value,minutes:Number(minutes.value),location:location.value,repeat:reviewedRepeat},text());if(!review(draft)){status.textContent='Calendar could not open. Your draft remains here.';return;}submitted=true;button.disabled=true;}catch(error){status.textContent=error instanceof Error?error.message:'Check the event details.';}};
 details.append(summary,description,zone,notes,source,form);return details;
}
