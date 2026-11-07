import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import type { LinkedCalendarLocalPort, LinkedCalendarLocalSnapshot } from '../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync';
import type { CalendarSyncBinding } from './calendar-linked-store';
import { canonicalSyncRecurrence } from '../browser/calendar-sync-fields';
type Value = Record<string, unknown>;
type NativeBridge={requestAccess():Promise<{status:string}>;sync(input: Value): Promise<Value>;addListener(name:'calendarSyncChanged',callback:()=>void):Promise<PluginListenerHandle>};
function bridge(){if(!Capacitor.isNativePlatform())throw Error('Device Calendar sync requires Android');return registerPlugin<NativeBridge>('AlphaCalendar');}
export type NativeCalendarSource = {lease: string; binding: CalendarSyncBinding; destination: {account:string;calendar:string}; events:Array<{id:string;revision:string}>; enabled:boolean};
let source: NativeCalendarSource | undefined;
function error(value: Value): Error {
 return Error(typeof value.message === 'string' ? value.message : value.status === 'cancelled' ? 'Calendar sync was not enabled.' : value.status === 'context-changed' ? 'Calendar permission, account or review changed. Review sync again.' : value.status === 'permission-required' ? 'Allow Calendar access to review device sync.' : value.status === 'conflict' ? 'The Calendar event changed. Nothing was overwritten.' : value.status === 'unknown' ? 'Calendar write could not be confirmed. It will not be repeated.' : 'Device Calendar sync is unavailable. Existing events are retained.');
}
function object(value: unknown): Value {if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid device Calendar response');return value as Value;}
function rows(value: unknown): Array<{id:string;revision:string}> {
 if(!Array.isArray(value)||value.length>2000)throw Error('Device Calendar event list needs review');
 const seen=new Set<string>();return value.map(raw=>{const row=object(raw);if(typeof row.id!=='string'||! /^[1-9][0-9]{0,18}$/.test(row.id)||seen.has(row.id)||typeof row.revision!=='string'||!/^[a-f0-9]{64}$/.test(row.revision))throw Error('Invalid device Calendar identity');seen.add(row.id);return {id:row.id,revision:row.revision};});
}
function projection(value: Value): NativeCalendarSource {
 if(value.status!=='ready'||typeof value.lease!=='string'||! /^[a-f0-9-]{36}$/.test(value.lease)||typeof value.enabled!=='boolean')throw error(value);
 const binding=object(value.binding) as CalendarSyncBinding,destination=object(value.destination);
 if(binding.environment!=='production'||Object.values(binding).some(value=>typeof value!=='string'||!value)||!/^native:[1-9][0-9]{0,18}$/.test(binding.localSourceId)||typeof destination.account!=='string'||typeof destination.calendar!=='string')throw Error('Device Calendar destination changed');
 return {lease:value.lease,binding:{...binding},destination:{account:destination.account,calendar:destination.calendar},events:rows(value.events),enabled:value.enabled};
}
async function call(kind:string,input:Value={},current:()=>boolean=()=>true,signal?:AbortSignal){
 signal?.throwIfAborted();if(!current()||document.hidden)throw new DOMException('Calendar sync context changed','AbortError');
 const value=await bridge().sync({kind,...input});signal?.throwIfAborted();if(!current()||document.hidden)throw new DOMException('Calendar sync context changed','AbortError');return value;
}
function snapshot(raw: unknown): LinkedCalendarLocalSnapshot<string>|null {
 if(raw===null)return null;const value=object(raw),event=object(value.event);
 if(typeof value.eventId!=='string'||! /^[1-9][0-9]{0,18}$/.test(value.eventId)||typeof value.revision!=='string'||! /^[a-f0-9]{64}$/.test(value.revision)||typeof event.title!=='string'||typeof event.description!=='string'||typeof event.location!=='string'||typeof event.startAt!=='string'||!Number.isFinite(Date.parse(event.startAt))||typeof event.endAt!=='string'||!Number.isFinite(Date.parse(event.endAt))||Date.parse(event.endAt)<=Date.parse(event.startAt)||typeof event.isAllDay!=='boolean'||!Array.isArray(event.attendees)||!Array.isArray(event.recurrence)||event.recurrence.some(line=>typeof line!=='string')||event.attendees.some(raw=>{const guest=object(raw);return typeof guest.email!=='string'||typeof guest.optional!=='boolean';})||(!event.isAllDay&&typeof event.timeZone!=='string'))throw Error('Invalid device Calendar event');
 return {eventId:value.eventId,revision:value.revision,event:{title:event.title,description:event.description,location:event.location,startAt:event.startAt,endAt:event.endAt,timeZone:typeof event.timeZone==='string'?event.timeZone:null,isAllDay:event.isAllDay,attendees:event.attendees.map(raw=>{const guest=object(raw);if(typeof guest.email!=='string'||typeof guest.optional!=='boolean')throw Error('Invalid device Calendar guest');return {email:guest.email,optional:guest.optional};}),recurrence:canonicalSyncRecurrence(event.recurrence.map(line=>{if(typeof line!=='string')throw Error('Invalid device Calendar recurrence');return line;}),event.isAllDay)}};
}
async function operationId(value:unknown){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
export const nativeCalendarSync = {
 async prepare(selection:{environment:'production'|'staging';connectionId:string;calendarId:string},current:()=>boolean,signal:AbortSignal,requestPermission=false){if(selection.environment!=='production')throw Error('Device Calendar sync does not use a different Cloud environment.');let value=await call('prepare',{selection},current,signal);if(value.status==='permission-required'&&requestPermission){signal.throwIfAborted();if(!current()||document.hidden)throw new DOMException('Calendar review changed','AbortError');const permission=await bridge().requestAccess();signal.throwIfAborted();if(permission.status!=='granted')throw error(value);value=await call('prepare',{selection},current,signal);}source=projection(value);return source;},
 async enable(current:()=>boolean){if(!source)throw Error('Review Calendar sync first');source=projection(await call('enable',{lease:source.lease},current));return source;},
 async events(admitted:NativeCalendarSource,current:()=>boolean,signal:AbortSignal){const result=await call("list",{lease:admitted.lease},current,signal);if(result.status!=="ready")throw error(result);return rows(result.events);},
 async pause(){const result=await bridge().sync({kind:'pause'});source=undefined;if(result.status!=='paused')throw error(result);},
 cancel(){source=undefined;void bridge().sync({kind:'cancel'}).catch(()=>{});},
 async enabled(){if(!source)return false;const result=await call('status',{lease:source.lease});if(result.status!=='ready')return false;return result.enabled===true;},
 async observe(listener:()=>void){return bridge().addListener('calendarSyncChanged',listener);},
 port(admitted:NativeCalendarSource,current:()=>boolean,signal:AbortSignal):LinkedCalendarLocalPort<string>&{deletionUndone(id:string):boolean}{
  const input={lease:admitted.lease},undone=new Set<string>();
  const get=async(id:string)=>{const result=await call('get',{...input,eventId:id},current,signal);if(result.status!=='ready')throw error(result);const observed=snapshot(result.snapshot);if(result.recoveries!==undefined){if(!Array.isArray(result.recoveries)||result.recoveries.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Error('Invalid native Calendar recovery receipt');for(const operationId of result.recoveries)await call('ack',{...input,operationId},current,signal);}return observed;};
  return {
   get,
   deletionUndone:(id:string)=>undone.has(id),
   async applyProviderEvent(id,event,expectedRevision){
    const operation=await operationId(['native-calendar-apply-v1',admitted.binding,id,expectedRevision,event]);const result=await call('apply',{...input,eventId:id,expectedRevision,event,operationId:operation},current,signal);
    if(result.status!=='saved')throw error(result);const saved=snapshot(result.snapshot);if(!saved||saved.eventId!==id)throw Error('Device Calendar save was not confirmed');await call('ack',{...input,operationId:operation},current,signal);window.dispatchEvent(new CustomEvent('alpha:calendar-committed',{detail:{eventId:id}}));return saved;
   },
   async delete(id,expectedRevision){
    const operation=await operationId(['native-calendar-delete-v1',admitted.binding,id,expectedRevision]);const result=await call('delete',{...input,eventId:id,expectedRevision,operationId:operation},current,signal);
    if(result.status!=='queued')throw error(result);window.dispatchEvent(new Event('alpha:deletions-changed'));
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
     const response=await call('deletion',{...input,operationId:operation},current,signal);if(response.status!=='receipt')throw error(response);const receipt=object(response.receipt),phase=receipt.phase;
     if(phase==='deleted'){if(await get(id)!==null)throw Error('Calendar deletion readback changed');await call('ack',{...input,operationId:operation},current,signal);window.dispatchEvent(new CustomEvent('alpha:calendar-committed',{detail:{eventId:id}}));return;}
     if(phase==='undone'){undone.add(id);await call('ack',{...input,operationId:operation},current,signal);throw Error('Deletion undone. The local event is kept and its Google link is paused.');}
     if(phase!=='queued')throw Error('Calendar deletion is paused or unconfirmed. It will not be repeated.');
     await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new DOMException('Calendar sync stopped','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},400);signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();});
    }
    throw Error('Calendar deletion is still pending. Check its Undo receipt; it will not be repeated.');
   },
  };
 },
};
