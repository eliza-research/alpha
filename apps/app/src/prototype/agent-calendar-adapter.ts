import {canonicalMapsEventOriginFor,type CanonicalMapsEventOrigin} from '../runtime/maps-event-return';
import {homeCalendarSelection} from '../runtime/home-calendar-selection';
import {browserDocuments} from '../browser/documents';
import {presentCalendarIntervals} from './calendar-interval-presentation';
import {calendarRange} from '../browser/calendar-records';
import {Capacitor} from '@capacitor/core';
import {testMocksEnabled} from '../build-flags';
import {connectionController,agentPendingText} from '../runtime/connection-ui';

import {legacyCalendarPreservation} from '../runtime/legacy-calendar-preservation';
import {AgentCalendar,calendarOwnerKey,calendarEventKey,calendarSourceKey,type CalendarPreservation} from '../runtime/agent-calendar';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
import {canonicalCalendarRow,calendarFormCreate,calendarFormPatch,type CanonicalCalendarForm} from '../runtime/agent-calendar-view';
import {agentReminderLead,homeCalendarValues,overdueAgendaNext,presentHomeAgendaCard,presentHomeAgendaFeed,type HomeAgendaCardInput} from './home-cards';
import {getZonedDateParts,addDaysToLocalDate} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time';
import {eventEditorMutability} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-policy';
import {calendarDayObservation} from '../runtime/calendar-day-observation';
type Bag=Record<string,any>;
export const nativeCalendarScope=(shell:Bag|undefined)=>!!shell&&Capacitor.getPlatform()==='android'&&shell.vget('calendar').calendarAuthority==='android-native';
export const browserCalendarScope=(shell:Bag|undefined)=>testMocksEnabled&&!!shell&&Capacitor.getPlatform()==='web'&&shell.vget('calendar').calendarAuthority==='browser-local';
export const deviceCalendarScope=(shell:Bag|undefined)=>nativeCalendarScope(shell)||browserCalendarScope(shell);
/** Presentation adapter only: ordinary app records and all manual operations use CalendarService. */
export function installAgentCalendarAdapter(Component:any,views:Bag,preservation?:CalendarPreservation){
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render,renderVals=p.renderVals,selection=p.calendarSelection,displaySources=views.calendar.displaySources;
 let owner:Bag|undefined,controller:AgentCalendar|undefined,requestKey='',boundKey='',invalidating=false,nextEnded:ReturnType<typeof setTimeout>|undefined;
 const mapBinding=(target:AppRecordPort)=>JSON.stringify([calendarOwnerKey(target),target.sessionId,target.scope]);
 const originalApi=p.api;
 p.api=function(key:string){const api=originalApi.call(this,key);if(key!=='maps')return api;return {...api,checkCanonicalCalendarReturn:async(origin:CanonicalMapsEventOrigin,signal:AbortSignal)=>{const target=port();if(owner!==this||!this.live||!controller||!target?.current()||mapBinding(target)!==origin.binding||deviceCalendarScope(this))return 'unknown';return controller.verifyEventReturn(origin,signal);}};};
 // Source selection is made in Settings and survives the existing view reset.
 views.calendar.persist=Array.from(new Set([...(views.calendar.persist??[]),'calendarAuthority']));
 const markerKey=async(ownerKey:string)=>'alpha.calendar.retention.v1.'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ownerKey)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const retention=preservation??legacyCalendarPreservation({
  has:async(ownerKey,fingerprint,signal)=>{
   const key=await markerKey(ownerKey);signal.throwIfAborted();
   const saved=await browserDocuments.read(key,signal);signal.throwIfAborted();
   const value=saved?.raw==null?null:JSON.parse(saved.raw);
   return value?.version===1&&value.disposition==='retained-read-only'&&value.fingerprint===fingerprint;
  },
  retain:async(ownerKey,fingerprint,signal)=>{
   const shell=owner;
   const current=()=>{signal.throwIfAborted();if(!shell?.live||owner!==shell||controller?.state.ownerKey!==ownerKey)throw Error('Calendar owner changed');};
   current();const key=await markerKey(ownerKey);current();
   const before=await browserDocuments.read(key,signal);current();
   const raw=JSON.stringify({version:1,disposition:'retained-read-only',fingerprint});
   if(before?.raw!==raw)await browserDocuments.compareExchange(key,before,raw,signal);
   const confirmed=await browserDocuments.read(key,signal);current();
   if(confirmed?.raw!==raw)throw Error('Calendar retention review was not saved');
  },
 });

 const port=()=>typeof (connectionController as any).getAppRecordClient==='function'?(connectionController as unknown as {getAppRecordClient():AppRecordPort|null}).getAppRecordClient():null;
 const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const range=(state:Bag)=>{const today=new Date(),day=new Date(today.getFullYear(),today.getMonth(),today.getDate()+Number(state.day||0));day.setMonth(day.getMonth()+Number(state.month||0));return{side:'owner' as const,timeMin:new Date(day.getFullYear(),day.getMonth()-1,1).toISOString(),timeMax:new Date(day.getFullYear(),day.getMonth()+2,1).toISOString(),timeZone:zone()};};
 const invalidate=(sessionId:string)=>{const target=port();if(!target?.current()||target.sessionId!==sessionId||invalidating)return;invalidating=true;queueMicrotask(()=>{invalidating=false;const current=port();if(owner?.live&&current?.current()&&current.sessionId===sessionId)refresh(true);});};
 const refresh=(force=false)=>{if(!owner?.live||!controller)return;const target=port(),window=range(owner.S?.()?.view==='calendar'?owner.vget('calendar'):{}),key=JSON.stringify([target?.identity,target?.scope,window]);if(!force&&requestKey===key)return;requestKey=key;void controller.refresh(window);};
 // One end-time wake plus foreground events; no polling or background reads.
 const readNext=()=>{if(!owner?.live||!controller)return;controller.invalidateNext();if(document.hidden)return;refresh(true);};
 const watchNextEnd=()=>{clearTimeout(nextEnded);const end=Date.parse(controller?.state.next?.event?.endAt??'');if(end>Date.now())nextEnded=setTimeout(readNext,Math.min(end-Date.now(),2147483647));};
 const resumed=()=>{if(!document.hidden&&owner?.live){readNext();}};
 p.componentDidMount=function(){mount.call(this);owner=this;
  // The read-only "Previously connected calendars" source is gone: Google calendars are part of the one Calendar.
  if(this.vget('calendar').calendarAuthority==='legacy-google')this.vset('calendar',{calendarAuthority:'canonical'});
  controller=new AgentCalendar(port,retention);this.agentCalendar=controller;this.canonicalCalendarDispose=controller.subscribe(()=>{if(owner!==this)return;watchNextEnd();if(this.live)this.setState({});});this.canonicalCalendarConnection=connectionController.subscribe(()=>{const target=port(),key=JSON.stringify([target?.identity,target?.scope]);if(key!==boundKey){boundKey=key;controller?.retire();requestKey='';refresh();}});this.canonicalCalendarInvalidated=(event:Event)=>{const sessionId=(event as CustomEvent<{sessionId?:unknown}>).detail?.sessionId;if(typeof sessionId==='string')invalidate(sessionId);};window.addEventListener('alpha:canonical-calendar-invalidated',this.canonicalCalendarInvalidated);document.addEventListener('visibilitychange',resumed);refresh();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);if(owner===this)refresh();};
 p.componentWillUnmount=function(){this.canonicalCalendarConnection?.();window.removeEventListener('alpha:canonical-calendar-invalidated',this.canonicalCalendarInvalidated);this.canonicalCalendarDispose?.();if(owner===this){clearTimeout(nextEnded);document.removeEventListener('visibilitychange',resumed);controller?.retire();controller=undefined;owner=undefined;}unmount.call(this);};
 // A Calendar connection belongs to the exact app-record session that opened it.
 p.calendarConnectionScope=function(){
  const shell=this,calendar=controller,target=port(),ownerKey=calendar?.state.ownerKey;
  const binding=target?JSON.stringify([calendarOwnerKey(target),target.sessionId,target.scope]):'';
  const current=()=>{const now=port();if(!now)return false;return owner===shell&&shell.live&&shell.agentCalendar===calendar&&controller===calendar&&!!now?.current()&&JSON.stringify([calendarOwnerKey(now),now.sessionId,now.scope])===binding&&calendar?.state.ownerKey===ownerKey&&!['android-native','browser-local','legacy','legacy-google'].includes(shell.vget('calendar').calendarAuthority);};
  const canChange=()=>!shell.vget('calendar').form&&!shell.canonicalDraftText&&!shell.canonicalDraftInvalid&&!shell.canonicalDraft?.state.opening&&!shell.canonicalDraft?.state.consuming;
  if(!calendar||!ownerKey||!target?.current()||calendarOwnerKey(target)!==ownerKey||!current()){shell.toast('Return to Calendar and finish checking saved events before connecting Google.');return null;}
  if(!canChange()){shell.toast('Finish or keep your current draft before connecting Google Calendar.');return null;}
  return{calendar,current,canChange};
 };
 p.calendarSelection=function(){
  if(deviceCalendarScope(this))return selection?.call(this);
  const state=this.vget('calendar'),model=this.agentCalendar as AgentCalendar|undefined;
  if(state.calendarAuthority==='legacy'||model&&['transition-required','legacy-recovery'].includes(model.state.status))return{kind:'legacy-app-calendar-source',id:'legacy-app-calendar',accountId:'device-local-legacy',revision:model?.state.legacy?.fingerprint};
  if(state.open?.startsWith('canonical-calendar:'))return model?.selection(state.open.slice('canonical-calendar:'.length));
  const key=model?.sourceKeyForHandle(state.form?.cal);return key?model?.sourceSelection(key):undefined;
 };
 // One merged Calendar: the sources in the agent's feed, which are the built-in calendar and every calendar the
 // owner shows in Google. Hiding one here is a display preference on this device (calPrefs), as in Calendar.
 const sourceRows=()=>controller?.state.calendars.filter(c=>c.includeInFeed===true).map(c=>({id:controller!.sourceHandle(calendarSourceKey(c)),name:c.summary,sub:c.accountEmail??c.provider,account:c.accountEmail??undefined,color:'acc',on:true,writable:['owner','writer'].includes(c.accessRole)}))??[];
 const writableRows=()=>sourceRows().filter(c=>c.writable);
 // Alpha creates once in its own Calendar; Google receives the existing linked projection.
 const newEventSource=()=>{const sources=controller?.state.calendars.filter(source=>source.provider==='eliza'&&source.side==='owner'&&source.grantId==='eliza-calendar'&&source.calendarId==='primary'&&source.includeInFeed===true&&['owner','writer'].includes(source.accessRole))??[];return sources.length===1?sources[0]:undefined;};
 p.calendarDayObservation=function(){
  const shell=this.S(),connection=connectionController.getSnapshot(),target=port(),model=controller?.state;
  return calendarDayObservation({live:owner===this&&this.live,view:shell.view||'home',screen:shell.screen||'home',hidden:document.hidden,pageSuspended:this.pageSuspended===true,secure:shell.secure===true,shade:!!shell.shade,connectionOpen:connection.open,recovery:!!connection.residentRecoveryReason||!!connection.residentRecovery,clockDraft:!!this.clockSelection?.(),ownerCurrent:!!target?.current(),ownerKey:model?.ownerKey??null,expectedOwnerKey:target?calendarOwnerKey(target):null,status:model?.status??'disconnected',mutating:model?.mutating===true,calendar:this.vget('calendar')},zone());
 };
 views.calendar.displaySources=()=>{
  if(deviceCalendarScope(owner))return displaySources?.();
  const shell=owner,prefs=shell?.vget('calendar').calPrefs??{},colors=['acc','fg','mut'];
  const sources=sourceRows().map(source=>{const id=source.id,preference=id?prefs[id]??{}:{},on=preference.on!==false,color=preference.color??source.color;
   return{...source,on:true,color,change:(action:'visibility'|'color')=>{if(!id||owner!==shell||!shell?.live)return;const latest=shell.vget('calendar').calPrefs??{};shell.vset('calendar',{calPrefs:{...latest,[id]:{...latest[id],...(action==='visibility'?{on:!on}:{color:colors[(colors.indexOf(color)+1)%colors.length]})}}});}};});
  return{native:false,canonical:true,status:controller?.state.status??'disconnected',ready:controller?.state.status==='ready',loading:controller?.state.status==='loading',error:controller?.state.status==='error',sources,retry:()=>refresh(true)};
 };
 function newForm(api:Bag){
  const state=api.get('calendar');if(state.form){api.toast('Keep or finish the current form before creating another event.');return;}
  const target=port();if(!target?.current()){api.toast(agentPendingText(undefined,'Calendar is unavailable for this agent connection. Check Settings › Agent connection.'));return;}
  const model=controller?.state,source=newEventSource();if(!model?.ownerKey||model.ownerKey!==calendarOwnerKey(target)||!['ready','partial','unavailable'].includes(model.status)){api.toast('Wait for the agent Calendar source and preservation review.');return;}
  if(!source){api.toast('Calendar is not ready to create an event. Your saved events are unchanged.');return;}
  api.set({open:null,form:{id:null,canonicalOwnerKey:model.ownerKey,creationId:crypto.randomUUID(),title:'',notes:'',where:'',off:state.day||0,t:17,d:1,zone:zone(),who:[],video:false,repeat:'none',alert:null,cal:controller!.sourceHandle(calendarSourceKey(source))}});
 }
 // A scan is only a draft. Admit it to the current source without writing or
 // replacing an existing form; refusal leaves the camera review intact.
 p.reviewScannedCalendarDraft=function(draft:Bag){
  if(owner!==this||!this.live)return false;
  const state=this.vget('calendar');if(state.form)return false;
  if(deviceCalendarScope(this)){
   this.openView('calendar',{calendarAuthority:nativeCalendarScope(this)?'android-native':'browser-local',form:draft,open:null,month:null,day:draft.off},'hidden');return true;
  }
  const model=controller?.state,source=newEventSource();
  if(state.calendarAuthority==='legacy'||!model?.ownerKey||!['ready','partial','unavailable'].includes(model.status)||!source)return false;
  this.openView('calendar',{calendarAuthority:'canonical',form:{...draft,canonicalOwnerKey:model.ownerKey,creationId:crypto.randomUUID(),cal:controller!.sourceHandle(calendarSourceKey(source)),zone:zone()},open:null,month:null,day:draft.off},'hidden');return true;
 };
 function typedForm(f:Bag):CanonicalCalendarForm{
  const model=controller!.state;if(f.canonicalOwnerKey!==model.ownerKey)throw Error('This retained draft belongs to another owner or agent');
  const sourceKey=controller!.sourceKeyForHandle(f.cal);if(!sourceKey)throw Error('Choose a current authorized Calendar source');
  const selectedSource=controller!.state.calendars.find(c=>calendarSourceKey(c)===sourceKey);
  if(!f.id){const source=newEventSource();if(!source)throw Error('Calendar is not ready to create an event. Your draft is kept.');if(calendarSourceKey(source)!==sourceKey)throw Error('Choose Calendar for this new event. Your draft is kept.');}
  if(selectedSource?.provider==='eliza'&&f.repeat!=='none')throw Error('Agent Calendar does not support repeating events. Your draft is kept. Choose another Calendar or explicitly remove the requested repeat.');
  if(f.video||f.alert!==null)throw Error('Meeting rooms and reminders use their own canonical actions; this event draft was kept');
  const day=addDaysToLocalDate(getZonedDateParts(new Date(),zone()),Number(f.off));
  const rules:Record<string,string[]>={none:[],daily:['RRULE:FREQ=DAILY'],weekdays:['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],weekly:['RRULE:FREQ=WEEKLY']};if(f.repeat==='preserve'&&!f.id||f.repeat!=='preserve'&&!Object.hasOwn(rules,f.repeat))throw Error('Review the original recurrence before saving');
  let allDayRange=f.canonicalAllDay;
  if(f.allDay&&(!allDayRange||f.off!==f.canonicalTiming?.[0])){const days=allDayRange?Math.max(1,Math.round((Date.parse(allDayRange.endDateExclusive)-Date.parse(allDayRange.startDate))/86400000)):1,end=addDaysToLocalDate(day,days),ymd=(d:Bag)=>`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;allDayRange={startDate:ymd(day),endDateExclusive:ymd(end)};}
  const attendees=(f.who??[]).map((id:string)=>{const contact=owner!.api('calendar').person(id);if(!contact?.email)throw Error('Choose an explicit email for each guest');return{email:contact.email};});
  return{ownerKey:f.canonicalOwnerKey,operationKey:f.creationId,sourceKey,date:day,startMinutes:Number(f.t)*60,durationMinutes:Number(f.d)*60,timeZone:f.zone||zone(),title:String(f.title).trim(),notes:f.notes||'',location:f.where||'',...(f.allDay?{allDay:allDayRange}:{}),...(f.repeat==='preserve'?{}:f.id||f.repeat!=='none'?{recurrence:rules[f.repeat]}:{}),...(f.recurrenceScope?{recurrenceScope:f.recurrenceScope}:{}),...(attendees.length?{attendees}:{})};
 }
 const choices=(state:Bag,api:Bag)=>{const model=controller?.state;
  const chooseAuthority=(authority:string)=>{if(state.form){api.toast('The current draft is kept. Finish it or return to its source before switching.');return;}api.set({calendarAuthority:authority,open:null});};
  return [{label:'Agent Calendar',go:()=>chooseAuthority('canonical')},...(model?.legacy?.present?[{label:'Saved app calendar · Read only',go:()=>chooseAuthority('legacy')}]:[]),...(Capacitor.getPlatform()==='android'?[{label:'Android calendars',go:()=>chooseAuthority('android-native')}]:[]),...(testMocksEnabled&&Capacitor.getPlatform()==='web'?[{label:'Browser calendar (development)',go:()=>chooseAuthority('browser-local')}]:[])];
 };
 views.calendar.render=function(state:Bag,api:Bag){
  if(deviceCalendarScope(owner)){const out=render(state,api);out.calendarAuthorityChoices=choices(state,api);out.calendarSourceLabel=testMocksEnabled&&browserCalendarScope(owner)?'Browser calendar (development)':'Android calendars';return out;}
  const model=controller?.state,legacy=state.calendarAuthority==='legacy'||model&&['transition-required','legacy-recovery'].includes(model.status);
  let unresolvedCalendarSources=0;
  const rows:Bag[]=legacy?(model?.legacy?.readable?calendarRange(model.legacy.records as any[],{begin:Date.parse(range(state).timeMin),end:Date.parse(range(state).timeMax)}).events:[]).map((e:any)=>({id:'legacy-calendar:'+e.id,title:e.title,notes:e.body||'',where:e.location||'',off:Math.floor((new Date(e.begin).setHours(0,0,0,0)-new Date().setHours(0,0,0,0))/86400000),t:new Date(e.begin).getHours()+new Date(e.begin).getMinutes()/60,d:(e.end-e.begin)/3600000,cal:'legacy',who:[],repeat:'none',alert:null,legacyRecord:e,calendarInterval:true,calendarIntervalData:{begin:e.begin,end:e.end},allDay:!!e.allDay,allDayEndOff:Math.floor((e.end-new Date().setHours(0,0,0,0))/86400000)})):model?.feed?.events.flatMap(e=>{const row=canonicalCalendarRow(e,zone());const source=controller!.state.calendars.find(c=>c.provider===e.provider&&c.side===e.side&&c.grantId===e.grantId&&c.calendarId===e.calendarId);if(!source){unresolvedCalendarSources++;return [];}return[{...row,calendarInterval:true,calendarIntervalData:{begin:Date.parse(e.startAt),end:Date.parse(e.endAt)},cal:controller!.sourceHandle(calendarSourceKey(source))}];})??[];
  const reminderRows=(state.events??[]).filter((row:Bag)=>!!row.alphaReminderId).map((row:Bag)=>({...row,cal:'alpha-reminders'}));
  rows.push(...reminderRows);
  const cals=legacy?[{id:'legacy',name:'Saved app calendar · Legacy · Read only',sub:'Kept on this device',color:'mut',on:true}]:sourceRows();
  // Presentation domains are not Calendar write destinations. These rows
  // already came from the existing reminder read; no reminder/provider read here.
  const presentationSources=[...cals,...(reminderRows.length?[{id:'alpha-reminders',name:'Reminders',sub:'On this device',color:'acc',on:true}]:[])].map(source=>{const preference=source.id?state.calPrefs?.[source.id]:undefined;return{...source,on:source.on!==false&&(!legacy&&source.id!=='alpha-reminders'||preference?.on!==false),color:preference?.color??source.color};});
  const visibleRows=rows.filter(row=>presentationSources.some(source=>source.id===row.cal&&source.on));
  const presentation={...state,add:null,events:visibleRows,canonicalCalendars:cals,calendarPresentationSources:presentationSources};
  const out=render(presentation,api);
  presentCalendarIntervals(render,presentation,api,out,legacy?!!model?.legacy?.readable:!!model?.feed);
  out.calendarSourceLabel=legacy?'Saved app calendar · Read only':'Agent Calendar';out.calendarSourceText=!legacy&&model?.status==='unavailable'?'Calendar is unavailable. Retry to load your schedule.':model?.error??(!model?.ownerKey?'Connect to view Agent Calendar.':model?.status==='loading'?'Loading Agent Calendar…':unresolvedCalendarSources?'Some event sources could not be verified. Reminders remain separate.':model?.status==='partial'?'Some Calendar sources could not be verified. The shown schedule may be incomplete.':model?.status==='transition-required'?'Saved app records are kept unchanged. Review the transition before using Agent Calendar.':model?.status==='legacy-recovery'?'Saved calendar data needs review. Nothing was imported or reset.':'Uses the same Calendar service as your active agent.');
  out.nativeStatusLabel=model?.status==='ready'&&!unresolvedCalendarSources?'':out.calendarSourceText;out.nativeStatusRetry=()=>refresh(true);out.newEvent=out.addAt=()=>legacy?api.toast('Choose Agent Calendar to create an event.'):newForm(api);
  out.calendarAuthorityChoices=choices(state,api);
  out.canConfirmCalendarTransition=model?.status==='transition-required';out.confirmCalendarTransition=async()=>{try{await controller?.confirmLegacyRetention();refresh(true);}catch(error){api.toast(String(error));}};
  const chosen=rows.find((e:any)=>e.id===state.open);
  if(chosen&&out.ev&&(chosen.legacyRecord||chosen.canonicalEvent)){
   if(chosen.legacyRecord){out.ev.edit=out.ev.del=()=>api.toast('These records are retained read only. Agent Calendar was not changed.');out.ev.busy=true;out.ev.readOnly=true;out.ev.readOnlyLabel='Saved app calendar · Read only';}
   else{const target=port(),selected=controller?.selection(chosen.canonicalEventKey),origin=target?.current()?canonicalMapsEventOriginFor(chosen,state.openDay??state.day??chosen.off,mapBinding(target),selected):undefined;
    if(chosen.where&&origin)out.ev.goWhere=()=>{const now=port(),current=controller?.selection(chosen.canonicalEventKey);if(!now?.current()||mapBinding(now)!==origin.binding||current?.revision!==origin.revision||current.sourceRevision!==origin.sourceRevision){api.toast('This Calendar event changed. Open it again before viewing its location.');return;}api.open('maps',{query:chosen.where,fromEvent:origin});};
    const e=chosen.canonicalEvent,policy=eventEditorMutability(e),sourceReadOnly=(cals as Bag[]).find(c=>c.id===chosen.cal)?.writable===false;out.ev.calName=cals.find(c=>c.id===chosen.cal)?.name??'Agent Calendar';out.ev.notes=e.description;out.ev.hasNotes=!!e.description;if(e.isAllDay){out.ev.when='All day';const options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'},start=new Date(e.startAt).toLocaleDateString(undefined,options),end=new Date(Date.parse(e.endAt)-86400000).toLocaleDateString(undefined,options);out.ev.day=start+(start===end?'':' – '+end);}out.ev.readOnly=policy.kind!=='editable'||sourceReadOnly;out.ev.readOnlyLabel=sourceReadOnly?`${out.ev.calName} · Read only`:'Calendar event · Read only';const deleteScope=state.canonicalDeleteScope?.eventKey===calendarEventKey(e)?state.canonicalDeleteScope.scope:undefined;out.ev.recurrenceScopes=e.recurringEventId||e.recurrence?.length?['instance','this_and_following','series'].map(scope=>({label:scope==='instance'?'This occurrence':scope==='series'?'Entire series':'This and following',selected:deleteScope===scope,pick:()=>api.set({canonicalDeleteScope:{eventKey:calendarEventKey(e),scope}})})):[];out.ev.edit=()=>{if(policy.kind!=='editable'||sourceReadOnly){api.toast(sourceReadOnly?'This calendar is read only.':'This provider event is read only.');return;}api.set({form:{id:chosen.id,canonicalOwnerKey:model!.ownerKey,canonicalEventKey:calendarEventKey(e),expectedProviderVersion:policy.providerVersion,creationId:crypto.randomUUID(),title:e.title,notes:e.description,where:e.location,off:chosen.off,t:chosen.t,d:chosen.d||1,zone:zone(),who:[],video:false,repeat:e.recurringEventId||e.recurrence?.length?'preserve':'none',alert:null,cal:chosen.cal,allDay:e.isAllDay,canonicalAllDay:e.isAllDay?{startDate:e.startAt.slice(0,10),endDateExclusive:e.endAt.slice(0,10)}:undefined,canonicalTiming:[chosen.off,chosen.t,chosen.d||1,zone(),!!e.isAllDay],recurrenceScope:undefined}});};out.ev.del=async()=>{if(policy.kind!=='editable'||sourceReadOnly){api.toast(sourceReadOnly?'This calendar is read only.':'This provider event is read only.');return;}if((e.recurringEventId||e.recurrence?.length)&&!deleteScope){api.toast('Choose which occurrences to delete before continuing.');return;}if(!window.confirm('Delete or decline this event through your agent Calendar?'))return;try{await controller!.delete(calendarEventKey(e),policy.providerVersion,crypto.randomUUID(),deleteScope);api.set({open:null,canonicalDeleteScope:null});refresh(true);}catch(error){api.toast(String(error));}};}
  }
  if(state.form&&state.form.cal!=='alpha-reminders'&&out.f){const f=state.form;
   const reminderSource=out.f.cals?.filter((c:Bag)=>c.domain==='reminders')??[];out.f.cals=[...cals.filter((c:Bag)=>c.writable).map(c=>({...c,pick:()=>api.set({form:{...f,cal:c.id}})})),...reminderSource];out.f.alerts=null;out.f.video=false;out.f.toggleVideo=()=>api.toast('Use a meeting action to create a video room.');
   const original=model?.feed?.events.find(e=>calendarEventKey(e)===f.canonicalEventKey),recurring=!!(original?.recurringEventId||original?.recurrence?.length);
   out.f.allDay=!!f.allDay;out.f.allDayTrack='background: '+(f.allDay?'var(--acc)':'var(--s3)');out.f.allDayKx=f.allDay?20:0;out.f.toggleAllDay=()=>api.set({form:{...f,allDay:!f.allDay}});
   out.f.recurrenceScopes=recurring?['instance','this_and_following','series'].map(scope=>({label:scope==='instance'?'This occurrence':scope==='series'?'Entire series':'This and following',selected:f.recurrenceScope===scope,pick:()=>api.set({form:{...f,recurrenceScope:scope}})})):[];
   if(recurring)out.f.repeats=[{label:'Keep existing repeat',pick:()=>api.set({form:{...f,repeat:'preserve'}})},...out.f.repeats];
   const selectedSourceKey=controller?.sourceKeyForHandle(f.cal),selectedSource=controller?.state.calendars.find(c=>calendarSourceKey(c)===selectedSourceKey);
   if(!f.id){const source=newEventSource(),key=source?calendarSourceKey(source):null,eventHandle=key===null?undefined:controller?.sourceHandle(key),reminders=out.f.cals.filter((choice:Bag)=>choice.domain==='reminders'),events=out.f.cals.filter((choice:Bag)=>!!eventHandle&&choice.id===eventHandle);out.f.cals=reminders.length?[...events.map((choice:Bag)=>({...choice,name:'Event',dot:'var(--acc)',css:f.cal===choice.id?'background:var(--fg);color:var(--bg)':'background:var(--bg)'})),...reminders]:selectedSourceKey===key?[]:events;}
   // Unsupported retained intent stays in the draft until the owner removes it.
   if((original??selectedSource)?.provider==='eliza')out.f.repeats=f.repeat==='none'?null:[{label:'Remove requested repeat',pick:()=>api.set({form:{...f,repeat:'none'}})}];
   out.f.saveOff=!!model?.mutating||!model||!['ready','partial','unavailable'].includes(model.status)||f.canonicalOwnerKey!==model.ownerKey||f.canonicalUncertain===true;out.f.save=async()=>{try{
    const draft=typedForm(f);if(f.id&&recurring&&draft.recurrence!==undefined&&f.recurrenceScope!=='series')throw Error('Choose entire-series scope to replace or remove recurrence');let saved:any;
    if(f.id){const event=model?.feed?.events.find(e=>calendarEventKey(e)===f.canonicalEventKey);if(!event)throw Error('Refresh this event before saving');const timing=JSON.stringify(f.canonicalTiming)!==JSON.stringify([f.off,f.t,f.d,f.zone,!!f.allDay]);saved=await controller!.update(f.canonicalEventKey,f.expectedProviderVersion,calendarFormPatch(draft,event,{timing,zone:f.zone!==f.canonicalTiming?.[3]}));}
    else saved=await controller!.create(draft.sourceKey,calendarFormCreate(draft));
    owner?.calendarFormCommitted?.(f);const latest=api.get('calendar').form;
    if(latest===f)api.set({form:null});
    else if(latest?.canonicalOwnerKey===f.canonicalOwnerKey&&latest.creationId===f.creationId){
      if(saved.event){const policy=eventEditorMutability(saved.event),row=canonicalCalendarRow(saved.event,zone());api.set({form:{...latest,id:row.id,canonicalEventKey:calendarEventKey(saved.event),expectedProviderVersion:policy.kind==='editable'?policy.providerVersion:undefined,canonicalTiming:[row.off,row.t,row.d||1,zone(),!!saved.event.isAllDay],creationId:crypto.randomUUID()}});api.toast('Saved the earlier version. Your newer edits are kept.');}
      else{api.set({form:{...latest,canonicalUncertain:true}});api.toast('The source accepted the earlier version without readback. Newer edits are kept; inspect the source before another save.');}
    }
    if(saved.outcome==='accepted_without_readback')api.toast('Event accepted. This source does not provide readback.');refresh(true);
   }catch(error){api.toast(String(error));}};
  }
  if(out.empty&&!legacy&&!model?.feed)out.emptyText=out.calendarSourceText;
  else if(!rows.length)out.emptyText=model?.status==='ready'?'No events in this Calendar window':out.calendarSourceText;
  // An incomplete window cannot establish that the selected day is free, even if verified rows exist on other days.
  if(out.empty&&!legacy&&(unresolvedCalendarSources>0||model?.status==='partial'||model?.status==='unavailable')&&out.nativeStatusLabel)out.emptyText=out.nativeStatusLabel;
  // The header already owns this warning and its retry action; do not repeat it in the grid.
  if(out.empty&&out.nativeStatusLabel&&out.emptyText===out.nativeStatusLabel)out.empty=false;
  return out;
 };
 p.renderVals=function(){const out=renderVals.call(this);
  // Home's agenda reads the calendar the owner chose: Agent Calendar unless device calendars were
  // chosen explicitly in Calendar, whose read Home then shows with its own states and read times.
  if(deviceCalendarScope(this))return out;
  // Canonical feed visibility is authoritative. Keep old device preferences stored, but do not hide its events.
  const now=Date.now(),hidden=new Set<string>();
  const target=port(),model=target?.current()&&controller?.state.ownerKey===calendarOwnerKey(target)?controller.state:undefined;
  const home=homeCalendarSelection(model,zone(),hidden,new Date(now)),event=home.event;
  // Shared daily-overview states for the agent calendar feed: reading, not connected, failed, stale and fresh.
  // Only a current complete feed may supply an item or a real empty state.
  const failed=model?.status==='error'||model?.status==='unavailable',unverified=model?.status==='partial';
  const feed=failed||unverified?presentHomeAgendaFeed({status:model!.status,hasItem:!!event,feedState:model?.feed?.state??null,asOf:Date.parse(model?.feed?.syncedAt??'')||null,error:model?.error??null,now,source:'Agent Calendar',emptyLabel:home.emptyLabel}):{state:home.verified?'ready':'pending',read:'',description:'',stale:false,title:home.emptyLabel};
  const provenance={origin:'',read:feed.read,description:feed.description};
  // The agent's next event as an agenda item; an all-day event starts at local midnight of its first day.
  const day=(at:string)=>{const d=new Date(at);return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()).getTime();};
  const item=event?{title:String(event.title||''),begin:event.isAllDay?day(event.startAt):Date.parse(event.startAt),end:event.isAllDay?day(event.endAt):Date.parse(event.endAt),allDay:!!event.isAllDay,video:!!event.conferenceLink}:null;
  // An overdue reminder keeps Home's own selection and source; the Next line shows whichever comes
  // first of the agent's next event and Home's own next item (an upcoming reminder on this phone).
  if(out.homeCalendarOverdue===true&&out.homeAgendaInput){const input=out.homeAgendaInput as HomeAgendaCardInput;return{...out,...homeCalendarValues(presentHomeAgendaCard(overdueAgendaNext(input,out.homeAgendaNextReminder===true,item?{item,provenance}:null)))};}
  // A reminder saved on this phone that comes before the agent's next event leads the card with the
  // reminder store's own source, as it does with device calendars.
  const local=out.homeAgendaInput as HomeAgendaCardInput|undefined;
  // A failed or out-of-date agent read stays visible above it, and opening the card reads it again.
  if(out.homeAgendaReminder===true&&local?.item&&(!item||local.item.begin<item.begin)){const retry=feed.state==='error'||feed.state==='stale';
   return{...out,...homeCalendarValues(presentHomeAgendaCard(agentReminderLead(local,feed))),...(retry&&typeof out.goCalendar==='function'?{goCalendar:()=>{refresh(true);out.goCalendar();}}:{})};}
  return{...out,...homeCalendarValues(presentHomeAgendaCard({now,item,provenance,stale:feed.stale,emptyTitle:feed.title,sourceName:'Agent Calendar'})),
   goCalendar:()=>{if(feed.state==='error'||feed.state==='stale')refresh(true);this.openView('calendar',{calendarAuthority:'canonical',...(event?{open:'canonical-calendar:'+calendarEventKey(event),day:canonicalCalendarRow(event,zone()).off}:{} )});}};
 };
}
