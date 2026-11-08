import {guardPendingCalendarChanges,type CalendarDeletionState,type CalendarDeletion} from './calendar-deletions';
import type {CalendarRecord} from './calendar-records';
import type {CalendarResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract';
import {revision} from './revision';
import {browserDocuments} from './documents';
import {BrowserDomainDocument,type DomainRecovery} from './domain-document';
export type BrowserCalendarState={deletions?:Record<string,CalendarDeletion>;deleteClaims?:Record<string,string>;creations?:Record<string,{binding:string;result:{status:'saved';id:string;calendarId:string;creationId:string};acknowledged:boolean;at?:number}>;alertDismissed?:Record<string,number>;preferences?:{visible:boolean;color:'acc'|'fg'|'mut'};sourceRevision:string;events:CalendarRecord[];receipts?:Record<string,{binding:string;result:CalendarResult;at?:number}>};
export const initialCalendarState=():BrowserCalendarState=>({sourceRevision:revision(),events:[]});

export const calendarStorageKey='alpha.browser.calendar.v1';
const domain=new BrowserDomainDocument(browserDocuments,calendarStorageKey,()=>localStorage.getItem(calendarStorageKey));
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('alpha.browser.documents.v1');
const refresh=()=>window.dispatchEvent(new Event('alpha:calendar-document-changed'));
if(channel)channel.onmessage=event=>{if(event.data?.key===calendarStorageKey)refresh();};
// The originating action owns its completion UI, including delayed receipts.
const changed=()=>{channel?.postMessage({key:calendarStorageKey});window.dispatchEvent(new Event('alpha:calendar-sync-source-changed'));};

export const calendarDocument={
 read:<T>(initial:()=>T|Promise<T>,signal?:AbortSignal)=>domain.read(initial,signal),
 readRaw:(signal?:AbortSignal)=>domain.readRaw(signal),
 capture:(signal?:AbortSignal)=>domain.capture(signal),
 async restore(expected:DomainRecovery,raw:string,signal?:AbortSignal){await domain.restore(expected,raw,signal);changed();},
 async reset(expected:DomainRecovery,signal?:AbortSignal){await domain.reset(expected,signal);changed();},
 async edit<T,R>(initial:()=>T|Promise<T>,edit:(data:T)=>R|Promise<R>,signal?:AbortSignal):Promise<R>{
  let modified=false;
  const result=await domain.edit(initial,async data=>{
   const before=JSON.stringify(data),result=await edit(data);
   guardPendingCalendarChanges(JSON.parse(before) as CalendarDeletionState,data as CalendarDeletionState);
   modified=before!==JSON.stringify(data);return result;
  },signal);
  // Only changed domain bytes need a cross-tab refresh.
  if(modified)changed();return result;
 },
};
/** Claim an empty source once, so its identity survives reloads and sync checkpoints. */
export async function prepareCalendarSource(){const raw=await calendarDocument.readRaw(),data:BrowserCalendarState=raw===null?await calendarDocument.edit(initialCalendarState,data=>data):JSON.parse(raw);if(typeof data.sourceRevision!=='string'||!data.sourceRevision||!Array.isArray(data.events))throw Error('The local calendar needs recovery.');return {status:'ready' as const,sourceId:'local' as const,sourceRevision:data.sourceRevision};}
