import type {CreateLifeOpsCalendarEventRequest,LifeOpsCalendarEvent,LifeOpsCalendarEventUpdate,LifeOpsCalendarFeed,LifeOpsCalendarSummary,LifeOpsNextCalendarEventContext,GetLifeOpsCalendarFeedRequest,LifeOpsLinkedCalendarControl,UpdateLifeOpsLinkedCalendarControlRequest} from '../../../../.eliza/client-features/packages/contracts/src/calendar';
import {eventEditorMutability,cancellationModeForEditorEvent} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-policy';
import {agentCalendarClient,type AgentCalendarClient,type AppRecordPort} from './agent-calendar-client';
export type AgentCalendarSyncReview={binding:string;control:LifeOpsLinkedCalendarControl;sources:LifeOpsCalendarSummary[];visibleLocalEventIds:string[]};
export type LegacyCalendarCapture={fingerprint:string;present:boolean;readable:boolean;pending:boolean;records:readonly unknown[]};
export interface CalendarPreservation {
 capture(signal:AbortSignal):Promise<LegacyCalendarCapture>;
 retainedReadOnly(ownerKey:string,fingerprint:string,signal:AbortSignal):Promise<boolean>;
 /** Only an explicit owner transition action may call this; never a refresh. */
 confirmReadOnly?(ownerKey:string,fingerprint:string,signal:AbortSignal):Promise<void>;
}
export type AgentCalendarState={ownerKey:string|null;status:'disconnected'|'transition-required'|'legacy-recovery'|'loading'|'ready'|'partial'|'unavailable'|'error';feed:LifeOpsCalendarFeed|null;calendars:LifeOpsCalendarSummary[];next:LifeOpsNextCalendarEventContext|null;nextFresh:boolean;legacy:LegacyCalendarCapture|null;error:string|null;mutating:boolean};
export const calendarOwnerKey=(p:AppRecordPort)=>JSON.stringify([new URL(p.identity.origin).origin,p.identity.ownerId,p.identity.agentId]);
export const calendarSourceKey=(s:Pick<LifeOpsCalendarSummary,'provider'|'side'|'grantId'|'calendarId'|'connectorAccountId'>)=>JSON.stringify([s.provider,s.side,s.grantId,s.connectorAccountId,s.calendarId]);
export const calendarEventKey=(e:LifeOpsCalendarEvent)=>JSON.stringify([e.provider,e.side,e.grantId??'',e.connectorAccountId??'',e.calendarId,e.externalId,e.id]);
const empty=():AgentCalendarState=>({ownerKey:null,status:'disconnected',feed:null,calendars:[],next:null,nextFresh:false,legacy:null,error:null,mutating:false});
type ClientFactory=(p:AppRecordPort,s:AbortSignal)=>Pick<AgentCalendarClient,'getLifeOpsCalendarFeed'|'getLifeOpsCalendars'|'getLifeOpsNextCalendarEventContext'|'createLifeOpsCalendarEvent'|'updateLifeOpsCalendarEvent'|'deleteLifeOpsCalendarEvent'|'getLinkedCalendarControl'|'updateLinkedCalendarControl'>;
/** UI snapshot only. CalendarService remains the sole app-record authority. */
export class AgentCalendar {
 private value=empty();private epoch=0;private abort:AbortController|undefined;private reading:AbortController|undefined;private listeners=new Set<()=>void>();private binding='';private nextQuery='';private deferredRefresh:GetLifeOpsCalendarFeedRequest|undefined;private sourceRevisions=new Map<string,string>();
 constructor(private port:()=>AppRecordPort|null,private preservation:CalendarPreservation,private client:ClientFactory=agentCalendarClient){}
 get state():Readonly<AgentCalendarState>{return this.value;}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 private publish(patch:Partial<AgentCalendarState>){this.value={...this.value,...patch};for(const fn of this.listeners)fn();}
 retire(){++this.epoch;this.abort?.abort();this.abort=this.reading=undefined;this.binding='';this.nextQuery='';this.deferredRefresh=undefined;this.sourceRevisions.clear();this.publish(empty());}
 private current(port:AppRecordPort,epoch:number,signal:AbortSignal){signal.throwIfAborted();if(!port.current())throw Error('Calendar owner or agent changed');const now=this.port();if(!now||epoch!==this.epoch||this.binding!==JSON.stringify([calendarOwnerKey(now),now.sessionId,now.scope]))throw Error('Calendar owner or agent changed');}
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
  if(!port){this.binding='';this.publish(empty());return;}
  if(!port.current()){this.binding='';this.publish(empty());return;}const ownerKey=calendarOwnerKey(port),binding=JSON.stringify([ownerKey,port.sessionId,port.scope]),query=JSON.stringify(window);
  if(this.binding!==binding||this.nextQuery!==query)this.value=empty();this.binding=binding;this.nextQuery=query;
  this.invalidateNext();
  this.publish({ownerKey,status:'loading',error:null,feed:null,calendars:[],nextFresh:false,mutating:false});
  try{
   const legacy=await this.preservation.capture(signal);this.current(port,epoch,signal);this.publish({legacy});
   if(!legacy.readable||legacy.pending){this.publish({status:'legacy-recovery'});return;}
   if(legacy.present&&!await this.preservation.retainedReadOnly(ownerKey,legacy.fingerprint,signal)){this.current(port,epoch,signal);this.publish({status:'transition-required'});return;}
   this.current(port,epoch,signal);const api=this.client(port,signal);
   const [feedRead,sourcesRead,nextRead]=await Promise.allSettled([api.getLifeOpsCalendarFeed(window,{signal}),api.getLifeOpsCalendars({side:window.side,mode:window.mode},{signal}),api.getLifeOpsNextCalendarEventContext({side:window.side,mode:window.mode,timeZone:window.timeZone})]);
   this.current(port,epoch,signal);
   if(sourcesRead.status==='rejected')throw sourcesRead.reason;
   const sources=sourcesRead.value;
   // Home next-context is aggregated with hidden calendars excluded, even when
   // the separate visible feed query explicitly includes a hidden source.
   const ownsNext=(next:LifeOpsNextCalendarEventContext|null)=>{const event=next?.event;return !event||event.agentId===port.identity.agentId&&Date.parse(event.endAt)>Date.now()&&sources.calendars.some(source=>source.includeInFeed===true&&['owner','writer','reader'].includes(source.accessRole)&&source.provider===event.provider&&source.side===event.side&&source.grantId===event.grantId&&source.calendarId===event.calendarId&&(!event.connectorAccountId||source.connectorAccountId===event.connectorAccountId));};
   let next=ownsNext(this.value.next)?this.value.next:null;
   if(nextRead.status==='fulfilled'){
    if(nextRead.value?.event&&nextRead.value.event.agentId!==port.identity.agentId)throw Error('Calendar response belongs to another agent');
    if(!ownsNext(nextRead.value))throw Error('Next Calendar event owner, source or end time could not be verified');
    next=nextRead.value;
   }
   const feed=feedRead.status==='fulfilled'?feedRead.value:null;
   if(feed&&(window.timeMin&&Date.parse(window.timeMin)!==Date.parse(feed.timeMin)||window.timeMax&&Date.parse(window.timeMax)!==Date.parse(feed.timeMax)))throw Error('Calendar response window changed');
   if(feed?.events.some((e:LifeOpsCalendarEvent)=>e.agentId!==port.identity.agentId))throw Error('Calendar response belongs to another agent');
   const revisions=await Promise.all(sources.calendars.map(async(source:LifeOpsCalendarSummary)=>[calendarSourceKey(source),Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(calendarSourceKey(source))))).map(n=>n.toString(16).padStart(2,'0')).join('')] as const));this.current(port,epoch,signal);this.sourceRevisions=new Map(revisions);
   const nextFresh=nextRead.status==='fulfilled'&&feed?.state==='complete'&&next?.calendarFeedState==='complete';
   this.publish({feed,calendars:sources.calendars,next,nextFresh:!!nextFresh,status:!feed?'error':feed.state==='complete'?'ready':feed.state==='partial'?'partial':'unavailable',error:feedRead.status==='rejected'?'Calendar could not be refreshed. Saved next event is unverified.':nextRead.status==='rejected'?'Next event could not be refreshed. Saved event is unverified.':null});
  }catch(error){if(epoch===this.epoch&&!signal.aborted)this.publish({status:'error',error:error instanceof Error?error.message:'Calendar could not be verified',feed:null,calendars:[],next:null,nextFresh:false});}
  finally{if(this.reading===controller){this.reading=undefined;const pending=this.deferredRefresh;this.deferredRefresh=undefined;if(pending&&epoch===this.epoch)void this.refresh(pending);}}
 }
 async confirmLegacyRetention(){
  const port=this.port(),previous=this.value.legacy;if(!port||!previous||!this.preservation.confirmReadOnly)throw Error('Calendar transition review is required');
  if(!port.current())throw Error('Calendar owner or agent changed');const controller=new AbortController(),fresh=await this.preservation.capture(controller.signal);if(!port.current())throw Error('Calendar owner or agent changed');
  if(!fresh.readable||fresh.pending||fresh.fingerprint!==previous.fingerprint||calendarOwnerKey(port)!==this.value.ownerKey)throw Error('Saved app calendar changed; review preservation again');
  await this.preservation.confirmReadOnly(calendarOwnerKey(port),fresh.fingerprint,controller.signal);if(!port.current())throw Error('Calendar owner or agent changed');
 }
 selection(eventKey:string){
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
 sourceSelection(sourceKey:string){const c=this.value.calendars.find(c=>calendarSourceKey(c)===sourceKey);if(!c||(!Number.isSafeInteger(c.selectionVersion)||c.selectionVersion<0))return;return{kind:'canonical-calendar-source',id:c.calendarId,revision:String(c.selectionVersion),accountId:c.grantId,sourceRevision:this.sourceRevisions.get(sourceKey)};}
 sourceHandle(key:string){const revision=this.sourceRevisions.get(key);return revision?'agent:'+revision:undefined;}
 sourceKeyForHandle(handle:string){return this.value.calendars.map(calendarSourceKey).find(key=>this.sourceHandle(key)===handle);}
 private async mutate<T>(operation:(api:ReturnType<ClientFactory>,port:AppRecordPort)=>Promise<T>,creation=false):Promise<T>{
  if(this.value.mutating||!(creation?['ready','partial','unavailable']:['ready','partial']).includes(this.value.status))throw Error('Wait for the current Calendar source');
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
  const event=this.value.feed?.events.find(e=>calendarEventKey(e)===key);if(!event)throw Error('Refresh this event before editing');const policy=eventEditorMutability(event);
  if(policy.kind!=='editable'||policy.providerVersion!==version)throw Error('The provider version changed or is read only');
  if((event.recurringEventId||event.recurrence?.length)&&!scope)throw Error('Choose occurrence or series scope before changing a repeating event');return event;
 }
}
