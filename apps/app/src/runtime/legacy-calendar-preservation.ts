import {calendarDocument} from '../browser/calendar-store';
import type {CalendarPreservation,LegacyCalendarCapture} from './agent-calendar';
export interface LegacyCalendarApproval {
 has(ownerKey:string,fingerprint:string,signal:AbortSignal):Promise<boolean>;
 /** Existing reviewed preference/retention storage owns this marker, not calendar data. */
 retain(ownerKey:string,fingerprint:string,signal:AbortSignal):Promise<void>;
}
/** Capture only. BrowserDomainDocument.capture never imports/resets/writes old data. */
export function legacyCalendarPreservation(approval:LegacyCalendarApproval):CalendarPreservation{
 return{
  capture:async(signal)=>{
   const captured=await calendarDocument.capture(signal);signal.throwIfAborted();
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(captured))))).map(n=>n.toString(16).padStart(2,'0')).join('');
   const present=captured.raw!==null||captured.legacy!==null||!!captured.snapshot;
   let readable=captured.format==='domain'&&!captured.legacyChanged,records:unknown[]=[],pending=false;
   if(captured.raw!==null){try{const value=JSON.parse(captured.raw);if(!value||!Array.isArray(value.events))readable=false;else{records=value.events;if(records.some((row:any)=>!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||typeof row.calendarId!=='string'||typeof row.title!=='string'||!Number.isFinite(row.begin)||!Number.isFinite(row.end)||row.end<=row.begin||row.repeat!==undefined&&!['none','daily','weekdays','weekly'].includes(row.repeat)))readable=false;pending=Object.values(value.deletions??{}).some((row:any)=>!['deleted','undone'].includes(row?.phase))||Object.values(value.creations??{}).some((row:any)=>row?.acknowledged!==true)||Object.keys(value.deleteClaims??{}).length>0;}}catch{readable=false;}}
   return{fingerprint,present,readable,pending,records:readable?structuredClone(records):[]} satisfies LegacyCalendarCapture;
  },
  retainedReadOnly:(owner,fingerprint,signal)=>approval.has(owner,fingerprint,signal),
  confirmReadOnly:(owner,fingerprint,signal)=>approval.retain(owner,fingerprint,signal),
 };
}
