import type {CreateLifeOpsCalendarEventRequest,LifeOpsCalendarEvent,LifeOpsCalendarEventUpdate,LifeOpsCalendarFeed,LifeOpsCalendarSummary,LifeOpsNextCalendarEventContext,GetLifeOpsCalendarFeedRequest,LifeOpsLinkedCalendarControl,LifeOpsLinkedCalendarEventView,UpdateLifeOpsLinkedCalendarControlRequest} from '../../../../.eliza/client-features/packages/contracts/src/calendar';
import {eventEditorMutability,cancellationModeForEditorEvent} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-policy';
import {agentCalendarClient,type AgentCalendarClient,type AppRecordPort} from './agent-calendar-client';
import type {ServiceReadCache} from './service-read-cache';
export type AgentCalendarSyncReview={binding:string;control:LifeOpsLinkedCalendarControl;sources:LifeOpsCalendarSummary[];visibleLocalEventIds:string[]};
export type LegacyCalendarCapture={fingerprint:string;present:boolean;readable:boolean;pending:boolean;records:readonly unknown[]};
export interface CalendarPreservation {
 capture(signal:AbortSignal):Promise<LegacyCalendarCapture>;
 retainedReadOnly(ownerKey:string,fingerprint:string,signal:AbortSignal):Promise<boolean>;
 /** Only an explicit owner transition action may call this; never a refresh. */
 confirmReadOnly?(ownerKey:string,fingerprint:string,signal:AbortSignal,current:()=>void):Promise<void>;
}
export type AgentCalendarState={ownerKey:string|null;status:'disconnected'|'transition-required'|'legacy-recovery'|'loading'|'ready'|'partial'|'unavailable'|'error';feed:LifeOpsCalendarFeed|null;calendars:LifeOpsCalendarSummary[];next:LifeOpsNextCalendarEventContext|null;nextFresh:boolean;savedAt:number|null;legacy:LegacyCalendarCapture|null;error:string|null;mutating:boolean};
export const calendarOwnerKey=(p:AppRecordPort)=>JSON.stringify([new URL(p.identity.origin).origin,p.identity.ownerId,p.identity.agentId]);
export const calendarSourceKey=(s:Pick<LifeOpsCalendarSummary,'provider'|'side'|'grantId'|'calendarId'|'connectorAccountId'>)=>JSON.stringify([s.provider,s.side,s.grantId,s.connectorAccountId,s.calendarId]);
export const calendarEventKey=(e:LifeOpsCalendarEvent)=>JSON.stringify([e.provider,e.side,e.grantId??'',e.connectorAccountId??'',e.calendarId,e.externalId,e.id]);
const empty=():AgentCalendarState=>({ownerKey:null,status:'disconnected',feed:null,calendars:[],next:null,nextFresh:false,savedAt:null,legacy:null,error:null,mutating:false});
/** A response that cannot belong to this owner, agent or window; never kept across a refresh. */
class CalendarIntegrityError extends Error{}
type ClientFactory=(p:AppRecordPort,s:AbortSignal)=>Pick<AgentCalendarClient,'getLifeOpsCalendarFeed'|'getLifeOpsCalendars'|'getLifeOpsNextCalendarEventContext'|'createLifeOpsCalendarEvent'|'updateLifeOpsCalendarEvent'|'deleteLifeOpsCalendarEvent'|'getLinkedCalendarControl'|'updateLinkedCalendarControl'>;
type CalendarReadCache=Pick<ServiceReadCache,'get'|'put'>;
type SavedCalendar={version:1;ownerKey:string;query:string;feed:LifeOpsCalendarFeed;calendars:LifeOpsCalendarSummary[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const sourceMatches=(source:LifeOpsCalendarSummary,event:LifeOpsCalendarEvent)=>source.provider===event.provider&&source.side===event.side&&source.grantId===event.grantId&&source.connectorAccountId===event.connectorAccountId&&source.calendarId===event.calendarId;
const calendarSourceRevisions=(sources:LifeOpsCalendarSummary[])=>Promise.all(sources.map(async source=>[calendarSourceKey(source),Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(calendarSourceKey(source))))).map(n=>n.toString(16).padStart(2,'0')).join('')] as const));
/** Persisted rows are untrusted presentation data, not provider revisions or grants. */
function savedCalendar(value:unknown,ownerKey:string,query:string,agentId:string,window:GetLifeOpsCalendarFeedRequest):SavedCalendar|null{
 if(!record(value)||value.version!==1||value.ownerKey!==ownerKey||value.query!==query||!record(value.feed)||!Array.isArray(value.calendars))return null;
 const feed=value.feed,calendars=value.calendars;
 const string=(v:unknown)=>typeof v==='string',nullable=(v:unknown)=>v===null||string(v),date=(v:unknown)=>string(v)&&Number.isFinite(Date.parse(v as string));
 const source=(c:unknown):c is LifeOpsCalendarSummary=>record(c)&&['eliza','google','microsoft','apple_calendar','ics'].includes(c.provider as string)&&['owner','agent'].includes(c.side as string)&&['grantId','connectorAccountId','calendarId','summary','accessRole'].every(k=>string(c[k]))&&['accountEmail','description','backgroundColor','foregroundColor','timeZone'].every(k=>nullable(c[k]))&&['primary','selected','includeInFeed'].every(k=>typeof c[k]==='boolean')&&Number.isSafeInteger(c.selectionVersion)&&Number(c.selectionVersion)>=0;
 if(!calendars.every(source)||new Set(calendars.map(calendarSourceKey)).size!==calendars.length||!['complete','partial','unavailable'].includes(feed.state as string)||!['cache','synced'].includes(feed.source as string)||!string(feed.calendarId)||!date(feed.timeMin)||!date(feed.timeMax)||Date.parse(feed.timeMin as string)>=Date.parse(feed.timeMax as string)||!(feed.syncedAt===null||date(feed.syncedAt))||!Array.isArray(feed.events)||!Array.isArray(feed.sources))return null;
 if(window.timeMin&&Date.parse(window.timeMin)!==Date.parse(feed.timeMin as string)||window.timeMax&&Date.parse(window.timeMax)!==Date.parse(feed.timeMax as string))return null;
 if(!feed.events.every((e:unknown)=>record(e)&&e.agentId===agentId&&['id','externalId','title','description','location','status'].every(k=>string(e[k]))&&date(e.startAt)&&date(e.endAt)&&Date.parse(e.endAt as string)>Date.parse(e.startAt as string)&&typeof e.isAllDay==='boolean'&&['timezone','htmlLink','conferenceLink'].every(k=>nullable(e[k]))&&(e.organizer===null||record(e.organizer))&&record(e.metadata)&&Array.isArray(e.attendees)&&e.attendees.every(a=>record(a)&&['email','displayName','responseStatus'].every(k=>nullable(a[k]))&&['self','organizer','optional'].every(k=>typeof a[k]==='boolean'))&&(e.recurrence==null||Array.isArray(e.recurrence)&&e.recurrence.every(string))&&(e.recurringEventId==null||string(e.recurringEventId))&&calendars.filter(c=>sourceMatches(c,e as unknown as LifeOpsCalendarEvent)&&c.includeInFeed&&['owner','writer','reader'].includes(c.accessRole)).length===1))return null;
 return value as unknown as SavedCalendar;
}
/** UI snapshot only. CalendarService remains the sole app-record authority. */
export class AgentCalendar {
 private value=empty();private epoch=0;private abort:AbortController|undefined;private reading:AbortController|undefined;private listeners=new Set<()=>void>();private binding='';private nextQuery='';private deferredRefresh:GetLifeOpsCalendarFeedRequest|undefined;private sourceRevisions=new Map<string,string>();
 constructor(private port:()=>AppRecordPort|null,private preservation:CalendarPreservation,private client:ClientFactory=agentCalendarClient,private cache:(port:AppRecordPort)=>Promise<CalendarReadCache|null>=async()=>null){}
 get state():Readonly<AgentCalendarState>{return this.value;}
 /** A retained ready feed can still have an outstanding read. */
 get refreshing(){return this.reading!==undefined;}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private publish(patch:Partial<AgentCalendarState>){this.value={...this.value,...patch};for(const fn of this.listeners)fn();}
 retire(){++this.epoch;this.abort?.abort();this.abort=this.reading=undefined;this.binding='';this.nextQuery='';this.deferredRefresh=undefined;this.sourceRevisions.clear();this.publish(empty());}
 private current(port:AppRecordPort,epoch:number,signal:AbortSignal){signal.throwIfAborted();if(!port.current())throw new CalendarIntegrityError('Calendar owner or agent changed');const now=this.port();if(!now||epoch!==this.epoch||this.binding!==JSON.stringify([calendarOwnerKey(now),now.sessionId,now.scope]))throw new CalendarIntegrityError('Calendar owner or agent changed');}
 /** Invalidate presentation freshness without changing the authoritative event/feed. */
 invalidateNext(){
  const event=this.value.next?.event,ended=!!event&&!(Date.parse(event.endAt)>Date.now());
  if(this.value.nextFresh||ended)this.publish({nextFresh:false,...(ended?{next:null}:{})});
 }
 async refresh(window:GetLifeOpsCalendarFeedRequest){
  // Cost: reuse the existing three reads. All refresh triggers share one pending
  // window while a mutation is in flight; never abort an accepted write for a read.
  if(this.value.mutating){this.deferredRefresh={...window};this.invalidateNext();return;}
  const port=this.port();
  // The same query while its reads are in flight queues one trailing refresh: the resident keeps
  // serving an aborted read, so abort-and-restart only stacks Cloud work. A changed query aborts all three.
  if(this.reading&&port?.current()&&this.binding===JSON.stringify([calendarOwnerKey(port),port.sessionId,port.scope])&&this.nextQuery===JSON.stringify(window)){this.deferredRefresh={...window};this.invalidateNext();return;}
  this.abort?.abort();this.deferredRefresh=undefined;const controller=this.abort=this.reading=new AbortController(),signal=controller.signal,epoch=++this.epoch;
  if(!port){this.reading=undefined;this.binding='';this.publish(empty());return;}
  if(!port.current()){this.reading=undefined;this.binding='';this.publish(empty());return;}const ownerKey=calendarOwnerKey(port),binding=JSON.stringify([ownerKey,port.sessionId,port.scope]),query=JSON.stringify(window);
  // A re-read of the same owner and window keeps the shown feed until it is replaced, so the
  // visible day and selection (and with them a live turn and its proposals) stay stable.
  const sameWindow=this.binding===binding&&this.nextQuery===query,revalidating=sameWindow&&(this.value.status==='ready'||this.value.status==='partial'),saved=sameWindow&&this.value.savedAt!==null;
  if(this.binding!==binding||this.nextQuery!==query)this.value=empty();this.binding=binding;this.nextQuery=query;
  this.invalidateNext();
  if(revalidating||saved)this.publish({error:null,...(saved?{status:'loading' as const}:{})});else this.publish({ownerKey,status:'loading',error:null,feed:null,calendars:[],nextFresh:false,savedAt:null,mutating:false});
  try{
   const legacy=await this.preservation.capture(signal);this.current(port,epoch,signal);this.publish({legacy});
   if(!legacy.readable||legacy.pending){this.publish({status:'legacy-recovery',feed:null,calendars:[],savedAt:null,next:null,nextFresh:false});return;}
   if(legacy.present&&!await this.preservation.retainedReadOnly(ownerKey,legacy.fingerprint,signal)){this.current(port,epoch,signal);this.publish({status:'transition-required',feed:null,calendars:[],savedAt:null,next:null,nextFresh:false});return;}
   this.current(port,epoch,signal);const api=this.client(port,signal);
   const cacheKey=JSON.stringify(['calendar:feed:v1',ownerKey,port.scope??'',query]);
   const refusalKey=JSON.stringify(['calendar:access-refused:v1',ownerKey,port.scope??'']);
   let liveSettled=false;
   const cache=this.cache(port).catch(()=>null);
   // Local storage and the existing three provider reads run together. A slow
   // local read cannot delay or replace the newer provider result.
   const restoration=(async()=>{try{
    if(revalidating||saved)return;
    const store=await cache,[entry,refusal]=await Promise.all([store?.get<unknown>(cacheKey),store?.get<number>(refusalKey)]);
    this.current(port,epoch,signal);if(liveSettled||!entry)return;
    if(typeof refusal?.value==='number'&&entry.at<=refusal.value)return;
    const snapshot=savedCalendar(entry.value,ownerKey,query,port.identity.agentId,window);if(!snapshot)return;
    const revisions=await calendarSourceRevisions(snapshot.calendars);
    this.current(port,epoch,signal);if(liveSettled)return;
    this.sourceRevisions=new Map(revisions);this.publish({feed:snapshot.feed,calendars:snapshot.calendars,savedAt:entry.at,next:null,nextFresh:false});
   }catch{/* A missing or invalid local snapshot never blocks a live read. */}})();
   const save=(value:SavedCalendar|null)=>cache.then(store=>{this.current(port,epoch,signal);return store?.put(cacheKey,value);}).catch(()=>{});
   let authorizationRefused=false,refusalSaved:Promise<unknown>|undefined;
   const refuseUnauthorized=(error:unknown):never=>{
    if(record(error)&&(error.status===401||error.status===403)){
     this.current(port,epoch,signal);
     if(!authorizationRefused){
      authorizationRefused=true;liveSettled=true;this.sourceRevisions.clear();
      this.publish({status:'error',error:'Calendar access was refused. Check your connection before trying again.',feed:null,calendars:[],savedAt:null,next:null,nextFresh:false});
      // Other months of this owner can contain the same refused source. Their
      // older snapshots remain hidden on reload even when they were not open.
      const refusedAt=Date.now();
      refusalSaved=cache.then(async store=>{this.current(port,epoch,signal);await store?.put(cacheKey,null);await store?.put(refusalKey,refusedAt);}).catch(()=>{});
     }
    }
    throw error;
   };
   const [feedRead,sourcesRead,nextRead]=await Promise.allSettled([api.getLifeOpsCalendarFeed(window,{signal}).catch(refuseUnauthorized),api.getLifeOpsCalendars({side:window.side,mode:window.mode},{signal}).catch(refuseUnauthorized),api.getLifeOpsNextCalendarEventContext({side:window.side,mode:window.mode,timeZone:window.timeZone})]);
   if(authorizationRefused){await refusalSaved;return;}
   if(feedRead.status==='rejected'||sourcesRead.status==='rejected')await restoration;
   liveSettled=true;this.current(port,epoch,signal);
   if(sourcesRead.status==='rejected')throw sourcesRead.reason;
   const sources=sourcesRead.value;
   if(this.value.savedAt!==null&&this.value.feed?.events.some(event=>!sources.calendars.some(source=>sourceMatches(source,event)&&source.includeInFeed&&['owner','writer','reader'].includes(source.accessRole)))){
    this.publish({feed:null,calendars:[],savedAt:null});void save(null);
   }
   // Home next-context is aggregated with hidden calendars excluded, even when
   // the separate visible feed query explicitly includes a hidden source.
   const ownsNext=(next:LifeOpsNextCalendarEventContext|null)=>{const event=next?.event;return !event||event.agentId===port.identity.agentId&&sources.calendars.some(source=>source.includeInFeed===true&&['owner','writer','reader'].includes(source.accessRole)&&source.provider===event.provider&&source.side===event.side&&source.grantId===event.grantId&&source.calendarId===event.calendarId&&(!event.connectorAccountId||source.connectorAccountId===event.connectorAccountId));};
   // The agent keeps an event until endAt >= its clock; one that ended on the phone clock is dropped, not an error.
   const live=(next:LifeOpsNextCalendarEventContext|null)=>!next?.event||Date.parse(next.event.endAt)>Date.now();
   let next=ownsNext(this.value.next)&&live(this.value.next)?this.value.next:null,ended=false;
   if(nextRead.status==='fulfilled'){
    if(nextRead.value?.event&&nextRead.value.event.agentId!==port.identity.agentId)throw new CalendarIntegrityError('Calendar response belongs to another agent');
    if(!ownsNext(nextRead.value))throw new CalendarIntegrityError('Next Calendar event owner or source could not be verified');
    ended=!live(nextRead.value);next=ended?null:nextRead.value;
   }
   const feed=feedRead.status==='fulfilled'?feedRead.value:null;
   // A failed feed read during a re-read is a transport failure: keep the shown feed (catch below).
   if((revalidating||this.value.savedAt!==null)&&feedRead.status==='rejected')throw feedRead.reason;
   if(feed&&(window.timeMin&&Date.parse(window.timeMin)!==Date.parse(feed.timeMin)||window.timeMax&&Date.parse(window.timeMax)!==Date.parse(feed.timeMax)))throw new CalendarIntegrityError('Calendar response window changed');
   if(feed?.events.some((e:LifeOpsCalendarEvent)=>e.agentId!==port.identity.agentId))throw new CalendarIntegrityError('Calendar response belongs to another agent');
   const revisions=await calendarSourceRevisions(sources.calendars);this.current(port,epoch,signal);this.sourceRevisions=new Map(revisions);
   const nextFresh=nextRead.status==='fulfilled'&&!ended&&feed?.state==='complete'&&next?.calendarFeedState==='complete';
   const snapshot={version:1 as const,ownerKey,query,feed:feed!,calendars:sources.calendars};void save(feed?savedCalendar(snapshot,ownerKey,query,port.identity.agentId,window):null);
   this.publish({feed,calendars:sources.calendars,savedAt:null,next,nextFresh:!!nextFresh,status:!feed?'error':feed.state==='complete'?'ready':feed.state==='partial'?'partial':'unavailable',error:feedRead.status==='rejected'?'Calendar could not be refreshed. Saved next event is unverified.':nextRead.status==='rejected'?'Next event could not be refreshed. Saved event is unverified.':null});
  }catch(error){
   if(error instanceof CalendarIntegrityError&&epoch===this.epoch&&!signal.aborted){
    void this.cache(port).then(store=>{this.current(port,epoch,signal);return store?.put(JSON.stringify(['calendar:feed:v1',ownerKey,port.scope??'',query]),null);}).catch(()=>{});
   }
   if(epoch===this.epoch&&!signal.aborted){
    // A failed re-read keeps the shown feed; a response that fails an ownership or window check never does.
    if((revalidating||this.value.savedAt!==null)&&!(error instanceof CalendarIntegrityError))this.publish({error:'Calendar could not load. Try again.',next:null,nextFresh:false});
    else this.publish({status:'error',error:'Calendar could not load. Try again.',feed:null,calendars:[],savedAt:null,next:null,nextFresh:false});
   }
  }
  finally{if(this.reading===controller){this.reading=undefined;const pending=this.deferredRefresh;this.deferredRefresh=undefined;if(pending&&epoch===this.epoch)void this.refresh(pending);else this.publish({});}}
 }
 async confirmLegacyRetention(reviewCurrent=()=>true,signal=new AbortController().signal){
  const port=this.port(),previous=this.value.legacy;if(!port||!previous||!this.preservation.confirmReadOnly)throw Error('Calendar transition review is required');
  const ownerKey=calendarOwnerKey(port);
  const current=()=>{signal.throwIfAborted();if(!reviewCurrent()||!port.current()||ownerKey!==this.value.ownerKey)throw Error('Calendar owner or agent changed');};
  current();const fresh=await this.preservation.capture(signal);current();
  if(!fresh.readable||fresh.pending||fresh.fingerprint!==previous.fingerprint||this.value.legacy?.fingerprint!==previous.fingerprint)throw Error('Saved app calendar changed; review preservation again');
  await this.preservation.confirmReadOnly(ownerKey,fresh.fingerprint,signal,current);current();
 }
 selection(eventKey:string){
  if(this.value.savedAt!==null)return;
  const e=this.value.feed?.events.find(e=>calendarEventKey(e)===eventKey);if(!e||typeof e.metadata.etag!=='string'||!e.metadata.etag.trim()||!e.grantId)return;
  const matches=this.value.calendars.filter(c=>c.provider===e.provider&&c.side===e.side&&c.grantId===e.grantId&&c.calendarId===e.calendarId&&(!e.connectorAccountId||c.connectorAccountId===e.connectorAccountId));if(matches.length!==1)return;
  return{kind:'canonical-calendar-event',id:e.id,revision:e.metadata.etag.trim(),accountId:e.grantId,sourceRevision:this.sourceRevisions.get(calendarSourceKey(matches[0]))};
 }
 /** Read back the selected canonical event before returning from Maps. This does not mutate or publish a new collection. */
 async verifyEventReturn(input:{eventKey:string;revision:string;sourceRevision:string;begin:number},signal:AbortSignal):Promise<'found'|'missing'|'unknown'>{
  const selected=()=>{const value=this.selection(input.eventKey);return value?.revision===input.revision&&value.sourceRevision===input.sourceRevision;};
  const port=this.port(),epoch=this.epoch;
  if(!port||this.value.mutating||!selected()||!Number.isSafeInteger(input.begin))return 'unknown';
  this.current(port,epoch,signal);
  const window={timeMin:new Date(input.begin-1).toISOString(),timeMax:new Date(input.begin+1).toISOString(),timeZone:'UTC'};
  const api=this.client(port,signal);
  const [feed,sources]=await Promise.all([api.getLifeOpsCalendarFeed(window,{signal}),api.getLifeOpsCalendars({}, {signal})]);
  this.current(port,epoch,signal);
  if(this.value.mutating||!selected()||feed.state!=='complete'||Date.parse(feed.timeMin)!==Date.parse(window.timeMin)||Date.parse(feed.timeMax)!==Date.parse(window.timeMax))return 'unknown';
  if(feed.events.some(event=>event.agentId!==port.identity.agentId))return 'unknown';
  const matches=feed.events.filter(event=>calendarEventKey(event)===input.eventKey);
  if(!matches.length)return 'missing';
  if(matches.length!==1)return 'unknown';
  const event=matches[0];
  if(event.status==='cancelled'||Date.parse(event.startAt)!==input.begin||event.metadata.etag!==input.revision)return 'missing';
  const readable=sources.calendars.filter(source=>source.includeInFeed===true&&['owner','writer','reader'].includes(source.accessRole)&&source.provider===event.provider&&source.side===event.side&&source.grantId===event.grantId&&source.calendarId===event.calendarId&&(!event.connectorAccountId||source.connectorAccountId===event.connectorAccountId));
  return readable.length===1?'found':'missing';
 }
 sourceSelection(sourceKey:string){if(this.value.savedAt!==null)return;const c=this.value.calendars.find(c=>calendarSourceKey(c)===sourceKey);if(!c||(!Number.isSafeInteger(c.selectionVersion)||c.selectionVersion<0))return;return{kind:'canonical-calendar-source',id:c.calendarId,revision:String(c.selectionVersion),accountId:c.grantId,sourceRevision:this.sourceRevisions.get(sourceKey)};}
 sourceHandle(key:string){const revision=this.sourceRevisions.get(key);return revision?'agent:'+revision:undefined;}
 sourceKeyForHandle(handle:string){return this.value.calendars.map(calendarSourceKey).find(key=>this.sourceHandle(key)===handle);}
 private async mutate<T>(operation:(api:ReturnType<ClientFactory>,port:AppRecordPort)=>Promise<T>,creation=false):Promise<T>{
  if(this.value.savedAt!==null||this.reading||this.value.mutating||!(creation?['ready','partial','unavailable']:['ready','partial']).includes(this.value.status))throw Error('Wait for the current Calendar source');
  const port=this.port();if(!port||calendarOwnerKey(port)!==this.value.ownerKey)throw Error('Calendar owner changed');if(!port.current())throw Error('Calendar owner or agent changed');
  const epoch=this.epoch,signal=this.abort?.signal;if(!signal)throw Error('Calendar is not ready');
  this.publish({mutating:true});
  try{
   const fresh=await this.preservation.capture(signal);this.current(port,epoch,signal);
   if(!fresh.readable||fresh.pending||fresh.fingerprint!==this.value.legacy?.fingerprint)throw Error('Saved app calendar changed; review preservation before continuing');
   const result=await operation(this.client(port,signal),port);this.current(port,epoch,signal);return result;
  }
  finally{if(epoch===this.epoch){const pending=this.deferredRefresh;this.deferredRefresh=undefined;this.publish({mutating:false});if(pending&&epoch===this.epoch)void this.refresh(pending);}}
 }
 create(sourceKey:string,request:Omit<CreateLifeOpsCalendarEventRequest,'side'|'grantId'|'calendarId'> & {idempotencyKey:string}){
  const source=this.value.calendars.find(s=>calendarSourceKey(s)===sourceKey);if(!source)throw Error('Choose an authorized Calendar source');
  if(!request.idempotencyKey.trim())throw Error('Retain this draft operation key');
  return this.mutate(async(api,port)=>{const result=await api.createLifeOpsCalendarEvent({...request,side:source.side,grantId:source.grantId,calendarId:source.calendarId});if(result.outcome==='event'&&result.event.agentId!==port.identity.agentId)throw Error('Created event owner could not be verified');return result;},true);
 }
 update(eventKey:string,version:string,patch:LifeOpsCalendarEventUpdate & {idempotencyKey:string}){
  const event=this.eventForMutation(eventKey,version,patch.recurrenceScope);
  if(patch.calendarId&&patch.calendarId!==event.calendarId||patch.grantId&&patch.grantId!==event.grantId||patch.side&&patch.side!==event.side)throw Error('Moving events between sources requires a separate supported action');
  return this.mutate(async(api,port)=>{const result=await api.updateLifeOpsCalendarEvent(event.externalId,{...patch,side:event.side,grantId:event.grantId,calendarId:event.calendarId,expectedProviderVersion:version});if(result.event.agentId!==port.identity.agentId||result.event.calendarId!==event.calendarId||result.event.grantId!==event.grantId)throw Error('Updated event source could not be verified');return result;});
 }
 delete(eventKey:string,version:string,key:string,scope?:LifeOpsCalendarEventUpdate['recurrenceScope']){
  const event=this.eventForMutation(eventKey,version,scope),mode=cancellationModeForEditorEvent(event);if(!mode)throw Error('Organizer disposition is unavailable; no cancellation was sent');if(!key.trim())throw Error('Retain this deletion operation key');
  return this.mutate(api=>api.deleteLifeOpsCalendarEvent(event.externalId,{side:event.side,grantId:event.grantId,calendarId:event.calendarId,expectedProviderVersion:version,idempotencyKey:key,cancellationMode:mode,...(scope?{recurrenceScope:scope}:{})}));
 }
 /** Review the same owner-bound Calendar service as the active view; no legacy source is read or linked. */
 async reviewSync():Promise<AgentCalendarSyncReview>{
  return this.mutate(async(api,port)=>{
   const binding=JSON.stringify([calendarOwnerKey(port),port.sessionId,port.scope]);
   const [control,result]=await Promise.all([api.getLinkedCalendarControl(),api.getLifeOpsCalendars({side:'owner'})]);
   return {binding,control,sources:result.calendars.filter(source=>source.provider==='google'&&source.side==='owner'&&['owner','writer'].includes(source.accessRole)),visibleLocalEventIds:this.value.feed?.events.filter(event=>event.provider==='eliza'&&event.side==='owner').map(event=>event.id)??[]};
  },true);
 }
 /** The linked event rows with their local titles, for the sync review: one read on the same owner-bound port, no write. */
 async listLinkedEvents(signal:AbortSignal):Promise<LifeOpsLinkedCalendarEventView[]>{
  const port=this.port(),check=()=>{signal.throwIfAborted();const now=this.port();if(!port?.current()||!now||this.binding!==JSON.stringify([calendarOwnerKey(port),port.sessionId,port.scope])||this.binding!==JSON.stringify([calendarOwnerKey(now),now.sessionId,now.scope]))throw Error('Calendar owner or agent changed');};
  check();const result=await port!.request('/api/lifeops/calendar/links?view=events','GET',undefined,signal) as {links?:unknown};check();
  if(!Array.isArray(result?.links))throw Error('Calendar sync links could not be read');
  return result.links as LifeOpsLinkedCalendarEventView[];
 }
 /** sending runs once its fence, owner and destination checks pass, immediately before the control write. */
 async changeSync(review:AgentCalendarSyncReview,operation:UpdateLifeOpsLinkedCalendarControlRequest['operation'],key:string,current:()=>boolean,sourceKey?:string,sending?:()=>void){
  if(!current())throw Error('Keep or finish the current Calendar draft before changing sync');
  const port=this.port();
  if(!port||review.binding!==JSON.stringify([calendarOwnerKey(port),port.sessionId,port.scope])||this.value.ownerKey!==calendarOwnerKey(port))throw Error('Calendar owner or agent changed; review sync again');
  if(!key.trim())throw Error('Retain this sync operation key');
  const epoch=this.epoch,signal=this.abort?.signal;if(!signal)throw Error('Calendar is not ready');
  return this.mutate(async(api)=>{
   let request:UpdateLifeOpsLinkedCalendarControlRequest={operation:operation as 'pause'|'resume'|'recover',expectedRevision:review.control.revision,idempotencyKey:key};
   if(operation==='select'||operation==='resume'){
    const selected=operation==='select'?review.sources.find(source=>calendarSourceKey(source)===sourceKey):review.sources.find(source=>source.connectorAccountId===review.control.destination?.connectorAccountId&&source.calendarId===review.control.destination?.providerCalendarId);
    if(!selected)throw Error('Choose a current authorized Google Calendar destination');
    const fresh=await api.getLifeOpsCalendars({side:'owner'});
    if(!fresh.calendars.some(source=>calendarSourceKey(source)===calendarSourceKey(selected)&&source.selectionVersion===selected.selectionVersion&&source.provider==='google'&&source.side==='owner'&&['owner','writer'].includes(source.accessRole)))throw Error('Calendar destination changed; review sync again');
    if(operation==='select')request={operation,expectedRevision:review.control.revision,idempotencyKey:key,destination:{connectorAccountId:selected.connectorAccountId,providerCalendarId:selected.calendarId}};
   }
   this.current(port,epoch,signal);if(!current())throw Error('Calendar context changed; review sync again');
   sending?.();
   return api.updateLinkedCalendarControl(request);
  },true);
 }
 private eventForMutation(key:string,version:string,scope?:LifeOpsCalendarEventUpdate['recurrenceScope']){
  if(this.value.savedAt!==null)throw Error('Refresh this event before editing');
  const event=this.value.feed?.events.find(e=>calendarEventKey(e)===key);if(!event)throw Error('Refresh this event before editing');const policy=eventEditorMutability(event);
  if(policy.kind!=='editable'||policy.providerVersion!==version)throw Error('The provider version changed or is read only');
  if((event.recurringEventId||event.recurrence?.length)&&!scope)throw Error('Choose occurrence or series scope before changing a repeating event');return event;
 }
}
