import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
import {calendarEventOverlapsRange} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import {parseWorkflowRead} from '../runtime/workflow-device-contract';
import {calendarSource} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import {stageCalendarDeletion,settleCalendarDeletions,undoCalendarDeletion,calendarDeletionPending} from './calendar-deletions';
import {browserDeletionOwner,browserDeletionOwnerCurrent,browserDeletionOwnerVisible} from '../runtime/deletion-owner';
import {rendererDeletionClock,deletionWindow} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
import {beginNoticeAction,noticeActionBlocked} from './notice-action';
import {calendarAlerts} from './calendar-alerts';
import {editCalendarResponse,calendarResponses} from './calendar-response';
import {openCalendarMeeting} from './calendar-meeting';
import {calendarRecord,calendarRange,remapCalendarExclusions,replaceCalendarRecord,type CalendarRecord} from './calendar-records';
import { editCalendarEvent } from './calendar-editor';
import { calendarInstant,calendarWall } from './calendar-time';
import { BrowserReviews } from './review';
import { calendarAgentReviewText, wholeUtcDates } from './calendar-agent-review';
import { validateCalendarResult,validateCalendarOperation, type CalendarFields, type CalendarResult } from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import { WebPlugin } from '@capacitor/core';
import { revision } from './revision';
import {calendarDocument,initialCalendarState as initial,prepareCalendarSource,type BrowserCalendarState as State} from './calendar-store';
type EventRow=CalendarRecord;
const source={id:'local',name:'App calendar',account:'Alpha Phone',local:true,writable:true};
const matches=(row:EventRow,expected:Partial<EventRow>|undefined)=>!!expected&&(!expected.revision||expected.revision===row.revision)&&(['title','body','location','begin','end'] as const).every(k=>row[k]===expected[k]);
export class BrowserCalendar extends WebPlugin {
  private reviews=new BrowserReviews();
  private async presentationState(){
    const cancellation=new AbortController(),view=document.documentElement.dataset.activeView;
    const retire=()=>cancellation.abort(),visibility=()=>{if(document.hidden)retire();};
    const events=['alpha-back','pagehide','alpha:device-state','launcher-home','alpha:dev-incoming-call','alpha:browser-open-view'];
    for(const event of events)window.addEventListener(event,retire,true);
    document.addEventListener('visibilitychange',visibility);
    try{visibility();const state=await calendarDocument.read(initial,cancellation.signal);return cancellation.signal.aborted||view!==document.documentElement.dataset.activeView?null:state;}
    catch(error){if(cancellation.signal.aborted&&error===cancellation.signal.reason)return null;throw error;}
    finally{for(const event of events)window.removeEventListener(event,retire,true);document.removeEventListener('visibilitychange',visibility);}
  }

  private active=new Map<string,{cancelled:boolean;controller:AbortController}>();
  async cancelAgent(input:{operationId:string}){const pending=this.active.get(input.operationId);if(pending){pending.cancelled=true;pending.controller.abort();}this.reviews.cancel(input.operationId);return {status:'cancelled'};}
  async executeAgent(input:{operation:unknown;operationId:string;journalIdentity?:{scope:string;proposalId:string}}) {
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId))throw Error('Invalid operation identity.');
    const operation=validateCalendarOperation(input.operation);
    if(operation.type==='calendar_read_next')return this.readNextAgent(input);
    const deletionOwner=operation.type==='calendar_delete'?browserDeletionOwner():null;
    const binding=JSON.stringify(operation),identity=operation.type==='calendar_create'?operation.source:operation.type==='calendar_create_local'?null:operation.target;
    if(this.active.has(input.operationId))return {status:'busy'};
    const ticket={cancelled:false,controller:new AbortController()};this.active.set(input.operationId,ticket);
    const fields=(row:EventRow):CalendarFields=>({title:row.title,description:row.body,location:row.location,start:new Date(row.begin).toISOString(),end:new Date(row.end).toISOString(),timeZone:row.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone});
    try {
      const operationHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(operation))))).map(v=>v.toString(16).padStart(2,'0')).join('');
      if(operation.type==='calendar_create_local'){if(ticket.cancelled||document.hidden)return {status:'cancelled'};await prepareCalendarSource();}
      const data=(await calendarDocument.read(initial,ticket.controller.signal)),row=operation.type==='calendar_create'||operation.type==='calendar_create_local'?undefined:calendarRecord(data.events,operation.target.eventId);
      if(operation.type==='calendar_delete'&&data.deleteClaims?.[input.operationId])return {status:'unknown'};
      const prior=data.receipts?.[input.operationId];
      if(prior)return prior.binding===binding?{status:'applied',result:prior.result}:{status:'conflict'};
      if(ticket.cancelled||document.hidden)return {status:'cancelled'};
      if(identity&&(identity.sourceId!=='local'||identity.sourceRevision!==data.sourceRevision)||operation.type!=='calendar_create'&&operation.type!=='calendar_create_local'&&(!row||row.revision!==operation.target.revision))return {status:'conflict'};
      if(operation.type==='calendar_update'&&row!.allDay&&!wholeUtcDates(operation.fields))return {status:'unsupported'};
      const reviewed='fields' in operation?operation.fields:fields(row!);
      const approved=await this.reviews.confirm(input.operationId,operation.type==='calendar_read_selected'?'Share calendar event with agent?':'Review calendar change',calendarAgentReviewText(operation.type==='calendar_create_local'?'calendar_create':operation.type,reviewed,source,row));
      if(!approved||ticket.cancelled)return {status:'cancelled'};
      return await calendarDocument.edit(initial,current=>{
        if(ticket.cancelled||document.hidden)return {status:'cancelled'};
        const receipt=current.receipts?.[input.operationId];if(receipt)return receipt.binding===binding?{status:'applied',result:receipt.result}:{status:'conflict'};
        const before=operation.type==='calendar_create'||operation.type==='calendar_create_local'?undefined:calendarRecord(current.events,operation.target.eventId);
        if(current.sourceRevision!==(identity?.sourceRevision??data.sourceRevision)||operation.type!=='calendar_create'&&operation.type!=='calendar_create_local'&&(!before||before.revision!==operation.target.revision))return {status:'conflict'};
        if(operation.type==='calendar_delete'){
          if(!deletionOwner||!browserDeletionOwnerCurrent(deletionOwner))return {status:'cancelled'};
          if(current.deleteClaims?.[input.operationId])return {status:'unknown'};
          if(Object.keys(current.deleteClaims||{}).length>=500)throw Error('Action deletion history requires review.');
          if(!input.journalIdentity)throw Error('Deletion journal identity missing.');
          const deletion=stageCalendarDeletion(current,before!,'event',deletionOwner,input.operationId);current.deletions![input.operationId].journalBinding={...input.journalIdentity,operationHash};(current.deleteClaims??={})[input.operationId]=binding;return {status:'queued',deletion};
        }
        let result:CalendarResult;
        if(operation.type==='calendar_create'||operation.type==='calendar_create_local'||operation.type==='calendar_update'){
          const f=operation.fields,event:EventRow={...before,id:before?.id||crypto.randomUUID(),calendarId:'local',title:f.title,body:f.description,location:f.location,begin:Date.parse(f.start),end:Date.parse(f.end),timeZone:f.timeZone,revision:revision()};
          replaceCalendarRecord(current.events,event);
          result={version:1,kind:operation.type,sourceId:'local',eventId:event.id,revision:event.revision};
        }else{
          result={version:1,kind:operation.type,sourceId:'local',eventId:before!.id,revision:before!.revision};
          result.fields=fields(before!);
        }
        (current.receipts??={})[input.operationId]={binding,result};return {status:'applied',result};
      },ticket.controller.signal);
    } catch(error){if(ticket.controller.signal.aborted&&error===ticket.controller.signal.reason)return {status:'cancelled'};throw error;} finally {if(this.active.get(input.operationId)===ticket)this.active.delete(input.operationId);}
  }
  /** Existing targetless next-event operation over this same local document. */
  private async readNextAgent(input:{operationId:string}) {
    if(document.hidden)return {status:'cancelled'};
    if(this.active.has(input.operationId))return {status:'busy'};
    const ticket={cancelled:false,controller:new AbortController()};this.active.set(input.operationId,ticket);
    const operation={type:'calendar_read_next' as const},binding=JSON.stringify(operation);
    try {
      await prepareCalendarSource();
      const raw=await calendarDocument.readRaw(ticket.controller.signal);if(raw===null)return {status:'unknown'};
      const data:State=JSON.parse(raw),snapshot=JSON.stringify(data);
      calendarSource({sourceId:source.id,sourceRevision:data.sourceRevision});
      if(!Array.isArray(data.events))throw Error('The local Calendar needs recovery.');
      const prior=data.receipts?.[input.operationId];
      if(prior)return prior.binding===binding?{status:'applied',result:validateCalendarResult(operation,prior.result)}:{status:'conflict'};
      if(ticket.cancelled||document.hidden)return {status:'cancelled'};
      const now=Date.now(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today=Date.parse(calendarWall(now,timeZone).slice(0,10)+'T00:00:00.000Z');
      const lastDay=new Date(today+30*86400000).toISOString().slice(0,10);
      const end=calendarInstant(lastDay+'T00:00:00.000',timeZone,Number.NaN,'forward');
      const window={start:new Date(now).toISOString(),end:new Date(end).toISOString(),timeZone};
      // UTC-encoded all-day dates need civil overlap filtering, as in agenda reads.
      const expanded=calendarRange(data.events,{begin:now-86400000,end:end+86400000});
      if(expanded.truncated)return {status:'overflow'};
      const candidates=expanded.events.filter(row=>row.calendarId===source.id&&calendarEventOverlapsRange(window,{start:new Date(row.begin).toISOString(),end:new Date(row.end).toISOString(),allDay:!!row.allDay})&&(row.allDay||row.begin>=now));
      const at=(row:EventRow)=>row.allDay?calendarInstant(new Date(row.begin).toISOString().slice(0,10)+'T00:00:00.000',timeZone,Number.NaN,'forward'):row.begin;
      candidates.sort((a,b)=>Math.max(now,at(a))-Math.max(now,at(b))||a.id.localeCompare(b.id));
      const row=candidates[0],result=validateCalendarResult(operation,{version:1,kind:operation.type,window,event:row?{title:row.title,start:new Date(row.begin).toISOString(),end:new Date(row.end).toISOString(),allDay:!!row.allDay,timing:row.allDay&&at(row)<now?'ongoing':'upcoming',timeZone}:null});
      const approved=await this.reviews.confirm(input.operationId,'Share next Calendar event?',`Read ${source.name} from ${formatDeviceRecordDateTime(window.start,timeZone)} to ${formatDeviceRecordDateTime(window.end,timeZone)} (end excluded). Share only the next event title and times, or a complete no-events result for this thirty-local-day window. Other calendars, descriptions, locations and attendees are excluded.`);
      if(!approved||ticket.cancelled||document.hidden)return {status:'cancelled'};
      if(Intl.DateTimeFormat().resolvedOptions().timeZone!==timeZone||await calendarDocument.readRaw(ticket.controller.signal)!==raw)return {status:'conflict'};
      return await calendarDocument.edit(initial,current=>{
        if(ticket.cancelled||document.hidden||Intl.DateTimeFormat().resolvedOptions().timeZone!==timeZone)return {status:'cancelled'};
        const prior=current.receipts?.[input.operationId];if(prior)return prior.binding===binding?{status:'applied',result:validateCalendarResult(operation,prior.result)}:{status:'conflict'};
        if(JSON.stringify(current)!==snapshot)return {status:'conflict'};
        if(Object.keys(current.receipts||{}).length>=1000)return {status:'unknown'};
        (current.receipts??={})[input.operationId]={binding,result};return {status:'applied',result};
      },ticket.controller.signal);
    }catch(error){if(ticket.controller.signal.aborted&&error===ticket.controller.signal.reason)return {status:'cancelled'};throw error;}
    finally{if(this.active.get(input.operationId)===ticket)this.active.delete(input.operationId);}
  }
  async changePreferences(input:{action:'visibility'|'color'}) {
    if(!['visibility','color'].includes(input.action))throw Error('Invalid calendar preference.');
    const result=await calendarDocument.edit(initial,data=>{
      const preferences=data.preferences??={visible:true,color:'acc'};
      if(input.action==='visibility')preferences.visible=!preferences.visible;
      else {const colors=['acc','fg','mut'] as const;preferences.color=colors[(colors.indexOf(preferences.color)+1)%colors.length];}
      return {...preferences};
    });
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
    return result;
  }
  async edit(input:{id:string;revision:string;people?:{id:string;name:string}[]}) {
    const state=await this.presentationState();if(!state)return {status:'cancelled'};
    const row=calendarRecord(state.events,input.id);
    if(!row||row.revision!==input.revision)throw Error('This event changed. Reopen it before editing.');
    if(input.people!==undefined&&(!Array.isArray(input.people)||input.people.length>1000||input.people.some(p=>!p||typeof p.id!=='string'||!p.id||p.id.length>128||typeof p.name!=='string'||p.name.length>300)))throw Error('Review the attendee list.');
    return editCalendarEvent({...row,...(row.seriesId?{repeat:'none' as const}:{})},async(next,current,signal)=>{
      await calendarDocument.edit(initial,data=>{if(!current())throw Error('Editing cancelled.');const before=calendarRecord(data.events,input.id);if(!before||before.revision!==input.revision)throw Error('This event changed. Reopen it before editing.');if((next.who?.length||0)>100)throw Error('Choose at most 100 attendees.');const updated={...before,...next,revision:revision()};if(updated.responses)updated.responses=Object.fromEntries(Object.entries(updated.responses).filter(([person])=>updated.who?.includes(person)));if(!before.seriesId&&before.repeat&&before.repeat!=='none')updated.excluded=remapCalendarExclusions(data.events,before,updated);replaceCalendarRecord(data.events,updated);},signal);
    },input.people,{id:input.id,revision:input.revision});
  }
  async editSeries(input:{id:string;revision:string;people?:{id:string;name:string}[]}){
    const data=await this.presentationState();if(!data)return {status:'cancelled'};
    const occurrence=calendarRecord(data.events,input.id),series=data.events.find(row=>row.id===occurrence?.seriesId);
    if(!occurrence||occurrence.revision!==input.revision||!series)throw Error('This series changed. Reopen it before editing.');
    if(!await this.reviews.confirm('edit-series-'+series.id,'Edit repeating series',`${series.title}\nChanges apply to the repeating schedule. Existing occurrence edits are kept.`))return {status:'cancelled'};
    return this.edit({id:series.id,revision:series.revision,people:input.people});
  }
  async removeSeries(input:{id:string;revision:string}){
    const data=await this.presentationState();if(!data)return {status:'cancelled'};
    const occurrence=calendarRecord(data.events,input.id),series=data.events.find(row=>row.id===occurrence?.seriesId);
    if(!occurrence||occurrence.revision!==input.revision||!series)return {status:'conflict'};
    if(!await this.reviews.confirm('delete-series-'+series.id,'Delete repeating series',`${series.title}\nDelete every occurrence, including edited dates, after 10 seconds? You can Undo during that time.`))return {status:'cancelled'};
    return calendarDocument.edit(initial,current=>{const row=current.events.find(row=>row.id===series.id),selected=calendarRecord(current.events,input.id);if(!row||row.revision!==series.revision||selected?.revision!==input.revision)return {status:'conflict'};const deletion=stageCalendarDeletion(current,row,'series','manual:'+current.sourceRevision);return {status:'queued',deletion};});
  }
  async editResponse(input:{id:string;revision:string;person:string;name:string}){
    const state=await this.presentationState();if(!state)return {status:'cancelled'};
    const row=calendarRecord(state.events,input.id);
    if(!row||row.revision!==input.revision||!row.who?.includes(input.person))throw Error('This guest list changed. Reopen the event.');
    return editCalendarResponse(input.name,row.responses?.[input.person]||'added',async(response,active,signal)=>{
      if(!Object.hasOwn(calendarResponses,response))throw Error('Choose a guest response.');
      await calendarDocument.edit(initial,data=>{if(!active())throw Error('Response editing cancelled.');const before=calendarRecord(data.events,input.id);if(!before||before.revision!==input.revision||!before.who?.includes(input.person))throw Error('This guest list changed. Reopen the event.');replaceCalendarRecord(data.events,{...before,responses:{...before.responses,[input.person]:response},revision:revision()});},signal);
    });
  }
  async joinMeeting(input:{id:string;revision:string;people?:string[]}){
    if(input.people!==undefined&&(!Array.isArray(input.people)||input.people.length>100||input.people.some(name=>typeof name!=='string'||name.length>300)))throw Error('Invalid meeting attendees.');
    const state=await this.presentationState();if(!state)return {status:'cancelled'};
    const row=calendarRecord(state.events,input.id);
    if(!row||row.revision!==input.revision||!row.video)throw Error('This meeting changed. Reopen the event.');
    return openCalendarMeeting(row.title,(input.people||row.who||[]).slice(0,100));
  }
  async listAlerts(){const data=(await calendarDocument.read(initial));return {items:calendarAlerts(data.events,data.alertDismissed||{}).filter(alert=>!calendarDeletionPending(data,alert.eventId))};}
  async alertAction(input:{id:string;revision:string;open:boolean}){
    const action=beginNoticeAction();
    try{
      const eventId=await calendarDocument.edit(initial,current=>{
        if(noticeActionBlocked())throw Error('Unlock to use this Calendar alert.');
        const active=calendarAlerts(current.events,current.alertDismissed||{}).find(row=>row.id===input.id&&row.revision===input.revision);
        if(!active)throw Error('Calendar alert changed.');
        current.alertDismissed=Object.fromEntries(Object.entries(current.alertDismissed||{}).filter(([,at])=>at>Date.now()-2*86400000));current.alertDismissed[active.receipt]=Date.now();return active.eventId;
      },action.signal);
      // A committed dismissal remains durable, even if its navigation is retired.
      if(input.open){if(action.signal.aborted||noticeActionBlocked())return {status:'cancelled'};const result=await this.open({id:eventId});if(result.status!=='opened')throw Error('Calendar navigation was cancelled.');}
      return {status:input.open?'opened':'dismissed'};
    }finally{action.dispose();}
  }
  async requestAccess(){return {status:'granted'};}
  async requestWorkflowReadAccess(){return {status:'granted'};}
  async workflowCalendars(){return {status:'ready',calendars:[source]};}
  /** The in-app calendar is the only free/busy source in the browser. Its name stays on this device. */
  async availabilitySources(input:{timeZone:string}){if(input?.timeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone)return {status:'timezone-changed'};const {sourceRevision}=await this.prepareAgentSource();return {status:'ready',timeZone:input.timeZone,calendars:[{id:source.id,name:'In this app',account:'Saved on this device',sourceRevision}]};}
  /**
   * Free/busy rows for the chosen calendar: interval, all-day flag and availability only.
   * Titles, notes, places and guests are never projected. All-day rows are matched by the
   * owner's civil dates. In-app events have no "show as free" setting, so each one is busy.
   */
  async readAvailability(input:{calendars:{id:string;revision:string}[];start:string;end:string;timeZone:string}){
    if(input.timeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone)return {status:'timezone-changed'};
    const begin=Date.parse(input.start),end=Date.parse(input.end);
    if(!Array.isArray(input.calendars)||input.calendars.length!==1||!Number.isFinite(begin)||!Number.isFinite(end)||begin<0||end<=begin||end-begin>7*86400000)throw Error('Invalid availability read.');
    const data=await calendarDocument.read(initial);
    if(input.calendars[0].id!==source.id||input.calendars[0].revision!==data.sourceRevision)return {status:'changed'};
    const civil=(instant:number)=>Date.parse(new Intl.DateTimeFormat('en-CA',{timeZone:input.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(instant)+'T00:00:00Z');
    const civilBegin=civil(begin),civilEnd=civil(end-1)+86400000;
    const range=calendarRange(data.events.filter(row=>row.calendarId===source.id),{begin:Math.min(begin,civilBegin),end:Math.max(end,civilEnd)});
    const rows=range.events.filter(row=>row.allDay?row.begin<civilEnd&&row.end>civilBegin:row.begin<end&&row.end>begin);
    if(range.truncated||rows.length>200)return {status:'too-many'};
    return {status:'ready',freshness:'local',events:rows.map(row=>({start:new Date(row.begin).toISOString(),end:new Date(row.end).toISOString(),allDay:!!row.allDay,availability:'busy'}))};
  }
  async list(input:{begin:number;end:number}) {const data=await calendarDocument.read(initial);return {status:'ready',calendars:[{...source,...(data.preferences??{visible:true,color:'acc'})}],...calendarRange(data.events,input)};}
  async prepareAgentSource(){return prepareCalendarSource();}
  /** Foreground standalone agenda over this SAME local Calendar document; no mirror. */
  async readAgenda(input:{operationId:string;source:unknown;operation:unknown}){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)||document.hidden)return {status:'cancelled',events:[]};
    const selected=calendarSource(input.source),op=parseWorkflowRead(input.operation);if(op.type!=='read_calendar_range'||op.calendarIds.length!==1||op.calendarIds[0]!==source.id||selected.sourceId!==source.id)throw Error('Calendar range source changed');
    const raw=await calendarDocument.readRaw(),data:State=raw===null?initial():JSON.parse(raw);
    if(selected.sourceRevision!==data.sourceRevision)return {status:'changed',events:[]};
    const approved=await this.reviews.confirm(input.operationId,'Share Calendar agenda?',`Read ${source.name} from ${formatDeviceRecordDateTime(op.start,op.timeZone)} to ${formatDeviceRecordDateTime(op.end,op.timeZone)} (end excluded). Share titles and times for this range only. Other calendars, event descriptions, locations and attendees are excluded.`);
    if(!approved||document.hidden)return {status:'cancelled',events:[]};
    if(await calendarDocument.readRaw()!==raw)return {status:'changed',events:[]};
    const result=await this.readWorkflowRange({calendarIds:op.calendarIds,start:op.start,end:op.end,timeZone:op.timeZone,maximumEvents:op.maximumEvents});
    if(document.hidden||await calendarDocument.readRaw()!==raw)return {status:'changed',events:[]};
    if(result.status==='ready'&&new TextEncoder().encode(JSON.stringify({kind:'calendar',events:result.events,source:selected,window:{start:op.start,end:op.end,timeZone:op.timeZone},complete:true})).length+78*result.events.length>65536)return {status:'overflow',events:[]};return result;
  }

  async pendingCreations(){const data=await calendarDocument.read(initial);return {status:'ready',creations:Object.values(data.creations||{}).filter(row=>!row.acknowledged).map(row=>row.result)};}
  async acknowledgeCreation(input:{creationId:string}){return calendarDocument.edit(initial,data=>{const receipt=data.creations?.[input.creationId];if(!receipt)throw Error('Creation receipt unavailable');receipt.acknowledged=true;return {status:'acknowledged'};});}
  async save(input:Partial<EventRow>&{expected?:Partial<EventRow>;creationId?:string;separateCreation?:boolean}) {
    if(!input.title?.trim()||!Number.isFinite(input.begin)||!Number.isFinite(input.end)||input.end!<=input.begin!||input.calendarId!=='local')throw Error('Review the event title, calendar and dates.');
    if(input.alert!==undefined&&input.alert!==null&&![0,10,60].includes(input.alert))throw Error('Choose an event alert.');
    if(input.who!==undefined&&(!Array.isArray(input.who)||input.who.length>100||input.who.some(id=>typeof id!=='string'||!id||id.length>128)))throw Error('Review the event attendees.');
    if(input.video!==undefined&&typeof input.video!=='boolean')throw Error('Invalid meeting option.');
    if(input.allDay!==undefined&&typeof input.allDay!=='boolean')throw Error('Invalid all-day setting.');
    if(input.timeZone!==undefined)new Intl.DateTimeFormat('en',{timeZone:input.timeZone});
    if(input.repeat!==undefined&&!['none','daily','weekdays','weekly'].includes(input.repeat))throw Error('Invalid event repeat rule.');
    let binding='';
    if(!input.id){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.creationId||''))throw Error('Calendar creation identity required');
      const fields=Object.fromEntries(Object.entries(input).filter(([name])=>!['creationId','separateCreation','expected','id'].includes(name)).sort(([a],[b])=>a.localeCompare(b)));
      binding=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    return calendarDocument.edit(initial,data=>{
      if(!input.id){
        const receipts=data.creations??={};const previous=receipts[input.creationId!];
        if(previous){if(previous.binding!==binding)throw Error('Calendar creation identity changed');return previous.result;}
        if(Object.values(receipts).some(row=>!row.acknowledged)&&input.separateCreation!==true)return {status:'pending-creation'};
        if(Object.keys(receipts).length>=1000)throw Error('Calendar creation receipt storage full');
      }
      const old=input.id?calendarRecord(data.events,input.id):undefined;
      if(input.id&&(!old||!matches(old,input.expected)))return {status:'conflict'};
      const allDay=input.allDay??old?.allDay??false;
      if(allDay&&(input.begin!%86400000!==0||input.end!%86400000!==0))throw Error('All-day events require whole calendar dates.');
      const row:EventRow={...old,id:old?.id||crypto.randomUUID(),calendarId:'local',title:input.title!.trim(),body:input.body||'',location:input.location||'',begin:input.begin!,end:input.end!,allDay,revision:revision(),timeZone:old?.timeZone||input.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone,repeat:old?.seriesId?'none':input.repeat||old?.repeat||'none',who:input.who?[...new Set(input.who)]:old?.who||[],video:input.video??old?.video??false,alert:input.alert===undefined?old?.alert??null:input.alert};
      if(row.responses)row.responses=Object.fromEntries(Object.entries(row.responses).filter(([person])=>row.who?.includes(person)));
      replaceCalendarRecord(data.events,row);
      const result={status:'saved' as const,id:row.repeat&&row.repeat!=='none'?calendarRange([row],{begin:row.begin,end:row.begin+8*86400000}).events[0].id:row.id,calendarId:'local',creationId:input.creationId||''};
      if(!input.id)data.creations![input.creationId!]={binding,result,acknowledged:false};
      return result;
    });
  }
  async inspect(input:{id:string;calendarId:string;expected?:Partial<EventRow>}) {const data=(await calendarDocument.read(initial)),row=calendarRecord(data.events,input.id);return row&&row.calendarId===input.calendarId&&matches(row,input.expected)?{status:'ready',revision:row.revision,sourceRevision:data.sourceRevision}:{status:'conflict'};}
  /** One review step, as on Android: the reviewed event is named and nothing is deleted on Cancel,
   * Back, hiding or locking. The removal below still requires the reviewed revision. */
  async remove(input:{id:string;calendarId:string;expected:Partial<EventRow>;revision:string}) {
    const state=await this.presentationState();if(!state)return {status:'cancelled'};
    const reviewed=calendarRecord(state.events,input.id);
    if(!reviewed||reviewed.calendarId!==input.calendarId||reviewed.revision!==input.revision||!matches(reviewed,input.expected))return {status:'conflict'};
    const when=reviewed.allDay?new Date(reviewed.begin).toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short',year:'numeric',month:'short',day:'numeric'})+' · All day':`${new Date(reviewed.begin).toLocaleString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${new Date(reviewed.end).toLocaleString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
    if(!await this.reviews.confirm('delete-event','Delete calendar event?',`${reviewed.title||'Untitled event'}\n${source.name}\n${when}\n\n${reviewed.seriesId?'Delete this one occurrence? Other dates in the series stay.':'Delete this one event?'} Deletion waits 10 seconds. You can Undo during that time.`,'Delete event'))return {status:'cancelled'};
    return calendarDocument.edit(initial,data=>{const row=calendarRecord(data.events,input.id);if(!row||row.calendarId!==input.calendarId||row.revision!==input.revision||!matches(row,input.expected))return {status:'conflict'};const deletion=stageCalendarDeletion(data,row,'event','manual:'+data.sourceRevision);return {status:'queued',deletion};});}
  async deletionReceipt(id:string){const data=await calendarDocument.read(initial);return data.deletions?.[id]||null;}
  async pendingDeletions(){const data=await calendarDocument.read(initial),clock=rendererDeletionClock();return Object.values(data.deletions||{}).filter(e=>!e.acknowledged&&['queued','paused','unknown','dispatching'].includes(e.phase)&&browserDeletionOwnerVisible(e.owner)).map(e=>({...e,kind:'calendar',window:e.phase==='queued'?deletionWindow(e.deadline,clock):undefined}));}
  async settleDeletions(){
    // Undo polling runs every 500ms. Only an expired queued deletion may change the
    // document; any other edit would replace the receipt held by recovery and editors.
    const raw=await calendarDocument.readRaw();if(raw===null)return;
    const data:State=JSON.parse(raw),clock=rendererDeletionClock();
    if(!Object.values(data.deletions||{}).some(entry=>entry.phase==='queued'&&deletionWindow(entry.deadline,clock)==='expired'))return;
    await calendarDocument.edit(initial,data=>settleCalendarDeletions(data,browserDeletionOwnerCurrent));
  }
  async dismissDeletion(id:string){return calendarDocument.edit(initial,data=>{const entry=data.deletions?.[id];if(!entry||!browserDeletionOwnerVisible(entry.owner)||!['unknown','dispatching'].includes(entry.phase))throw Error('Uncertain deletion is unavailable.');entry.acknowledged=true;return {status:'acknowledged'};});}
  async undoDeletion(id:string){return calendarDocument.edit(initial,data=>undoCalendarDeletion(data,id,browserDeletionOwnerVisible));}
  async readWorkflowRange(input:{calendarIds:string[];start:string;end:string;timeZone?:string;maximumEvents:number}) {
    const timeZone=input.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
    const op=parseWorkflowRead({type:'read_calendar_range',...input,timeZone});if(op.type!=='read_calendar_range')throw Error('Invalid Calendar range');
    if(op.calendarIds.some(id=>id!==source.id))return {status:'unavailable',events:[]};
    const data=await calendarDocument.read(initial),range=calendarRange(data.events,{begin:Date.parse(op.start)-86400000,end:Date.parse(op.end)+86400000});
    const events=range.events.filter(e=>op.calendarIds.includes(e.calendarId)).map(e=>({id:e.id,calendarId:e.calendarId,title:e.title,start:new Date(e.begin).toISOString(),end:new Date(e.end).toISOString(),allDay:!!e.allDay})).filter(e=>calendarEventOverlapsRange(op,e));
    if(range.truncated||events.length>op.maximumEvents)return {status:'overflow',events:[]};
    return {status:'ready',events};
  }
  async open(input?:{id?:string}){
    const state=input?.id?await this.presentationState():undefined;if(state===null)return {status:'cancelled'};
    const row=input?.id&&state?calendarRecord(state.events,input.id):undefined;
    if(input?.id&&!row)throw Error('This event no longer exists.');
    window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:'calendar'}));
    if(!row)return {status:'opened'};
    return new Promise<{status:'opened'|'cancelled'}>(resolve=>{const event=new CustomEvent('alpha:calendar-open',{cancelable:true,detail:{id:row.id,begin:row.begin,allDay:!!row.allDay,complete:(opened:boolean)=>resolve({status:opened?'opened':'cancelled'})}});window.dispatchEvent(event);if(!event.defaultPrevented)resolve({status:'cancelled'});});
  }
}
