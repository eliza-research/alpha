import type {ServiceReadCache} from '../runtime/service-read-cache';
import {serviceReadCache} from '../runtime/service-read-cache-store';
import {calendarSyncHost,startCalendarSyncHost} from '../runtime/calendar-sync-host';
import {connectionController} from '../runtime/connection-ui';
import {CloudProtocolError,type GoogleCalendarRange} from '../runtime/cloud-protocol';
import {GoogleCalendarReader,type GoogleCalendarRead,type GoogleCalendarRecord,type GoogleCalendarSource} from '../runtime/google-calendar';
import {GOOGLE_ACCOUNTS_CHANGED,createGoogleAccounts} from '../runtime/google-accounts';
import {googleCalendarAccountKey,currentGoogleCalendarBinding} from '../runtime/google-connection-ui';
import {readGoogleCalendarPrefs,googleCalendarVisible,setGoogleCalendarVisible,GOOGLE_CALENDAR_PREFS_CHANGED} from '../runtime/google-calendar-selection';
import {googleConnect,googleConnectNote} from '../runtime/google-connect-flow';
import {openGoogleCalendarOutbox,overlayGoogleCalendarRows,type GoogleCalendarChange,type GoogleCalendarEnqueueResult,type GoogleCalendarOutbox,type GoogleCalendarOutboxOp,type GoogleCalendarOverlayRow} from '../runtime/google-calendar-outbox';
import {GOOGLE_CALENDAR_WRITE_CAPABILITIES,type GoogleCalendarRsvp,type GoogleCalendarScope,type GoogleCalendarWriteClient,type GoogleCalendarWriteFields} from '../runtime/google-calendar-writer';
import {DELETE_UNDO_MS} from '../runtime/deletion-window';
import {calendarLoadRange} from './calendar-days';
import {calendarOptionEvent} from './calendar-adapter';
type Bag=Record<string,any>;
/** A Google row as read, or as the outbox overlay shows it (pending changes applied). */
type Row=GoogleCalendarRecord&Partial<Pick<GoogleCalendarOverlayRow,'pending'|'outboxId'|'outboxPhase'|'localId'>>;
const DAY=86400000;
const civil=(date:Date,utc=false)=>Date.UTC(utc?date.getUTCFullYear():date.getFullYear(),utc?date.getUTCMonth():date.getMonth(),utc?date.getUTCDate():date.getDate());
/** Day offset, start hour and length the Calendar form uses for an event (device time; all-day by its UTC date). */
export function googleCalendarFormTimes(begin:number,end:number,allDay:boolean,today=new Date()){
 const start=new Date(begin);
 return {off:(civil(start,allDay)-civil(today))/DAY,t:allDay?0:start.getHours()+start.getMinutes()/60,d:allDay?24:Math.min(168,Math.max(.25,(end-begin)/3600000))};
}
/** One Google row as the Calendar renderer draws it, in its own calendar (`cal` is the calendar's
 * source id). Changes go through the Google outbox, never the local or device Calendar writers. */
export function googleCalendarDisplayRecord(event:Row){
 const begin=new Date(event.begin),today=new Date();
 const off=(civil(begin,!!event.allDay)-civil(today))/DAY;
 return {id:event.id,googleCalendarRecord:event,nativeEvent:event,off,t:event.allDay?0:begin.getHours()+begin.getMinutes()/60,d:event.allDay?0:Math.max(.25,(event.end-event.begin)/3600000),nativeAllDayEndOff:event.allDay?off+Math.max(1,Math.ceil((event.end-event.begin)/DAY)):undefined,title:event.title,notes:event.body,where:event.location,cal:event.calendarId,pendingSync:!!event.pending,who:[],video:false,repeat:'none',alert:null,allDay:!!event.allDay};
}
const UNSUPPORTED:Record<string,string>={following:'Change following events in Google Calendar.','series-time':'Change the time of every event in Google Calendar.','all-day':'Change all-day events in Google Calendar.',rsvp:'Answer in Google Calendar.','event-id':'Change this event in Google Calendar.'};
/** Why a change was not queued, in a few words. */
export function googleCalendarChangeProblem(result:GoogleCalendarEnqueueResult):string{
 if(result.status==='unsupported')return UNSUPPORTED[result.reason]||'Change this event in Google Calendar.';
 if(result.status==='full')return 'Too many changes are waiting to sync. Try again later.';
 if(result.status==='busy')return 'This event is still syncing. Try again in a moment.';
 return 'Google Calendar can’t take this change.';
}
const FAILED:Record<string,string>={'needs-permission':'Google didn’t allow this change.',gone:'This event is no longer in Google Calendar.',invalid:'Google Calendar didn’t accept this change.',unsupported:'Make this change in Google Calendar.'};
const validRow=(e:any)=>e?.source==='google'&&typeof e.id==='string'&&typeof e.calendarId==='string'&&typeof e.providerEventId==='string'&&typeof e.writable==='boolean'&&typeof e.revision==='string'&&Array.isArray(e.attendees)&&Number.isFinite(e.begin)&&Number.isFinite(e.end);
const validSource=(s:any)=>s?.source==='google'&&typeof s.id==='string'&&typeof s.name==='string'&&typeof s.connectionId==='string'&&typeof s.writable==='boolean';
/** A saved read of every shown calendar; one bad saved row is dropped, never the rest. */
function cachedCalendars(value:any):{sources:GoogleCalendarSource[];read:string[];events:GoogleCalendarRecord[];noWrite:string[]}|null{
 // A read saved before `noWrite` was kept is read again, so "allow changes" is never lost.
 if(!value||!Array.isArray(value.sources)||!Array.isArray(value.read)||!Array.isArray(value.events)||!Array.isArray(value.noWrite))return null;
 const sources=value.sources.filter(validSource),ids=new Set(sources.map((s:GoogleCalendarSource)=>s.id));
 return {sources,read:value.read.filter((id:unknown)=>typeof id==='string'),events:value.events.filter((e:any)=>validRow(e)&&ids.has(e.calendarId)),noWrite:value.noWrite.filter((id:unknown)=>typeof id==='string')};
}
const initials=(name:string)=>name.split(/[\s@.]+/).filter(Boolean).slice(0,2).map(part=>part[0]!.toUpperCase()).join('');
const iso=(instant:number)=>new Date(instant).toISOString();
export function installGoogleCalendarViewAdapter(Component:any,views:Bag){
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render;
 let owner:any,abort:AbortController|undefined,epoch=0,attempted='',loaded='',rows:GoogleCalendarRecord[]=[],sources:GoogleCalendarSource[]=[],message='',cachedRead=false,lastReadAt=0,reading=false;
 let readers:GoogleCalendarReader[]=[],calendarCache:ServiceReadCache|null=null;
 /** Signed in, checked, and no connected Google account grants Calendar: offer Connect on this screen. */
 let connectOffered=false;
 /** Connections whose grant lacks Calendar write although a calendar's role allows changes. */
 let readOnlyGrants=new Set<string>();
 let outbox:GoogleCalendarOutbox|null=null,outboxKey='',outboxRelease:(()=>void)|null=null,outboxOpen=0;
 /** Why changes waiting to sync could not be read; kept until a later open succeeds (a reload never clears it). */
 let outboxProblem='';
 /** Events with a change being queued, and paused deletes already offered again. */
 const busy=new Set<string>(),pausedOffered=new Set<string>();
 /** The calendar the + button starts in, while its form is being created. */
 let defaultCal='';
 const deviceZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
 const cacheOwnerKey=()=>{const account=connectionController.getSnapshot().cloudAccount,cloud=connectionController.getCloudClient();return account&&cloud?JSON.stringify([account.environment,account.userId,account.organizationId,cloud.credentialId]):null;};
 const prefs=()=>{const key=googleCalendarAccountKey();return key?readGoogleCalendarPrefs(key):{};};
 const identityKey=()=>{const cloud=connectionController.getCloudClient();return JSON.stringify([googleCalendarAccountKey(),cloud?.sessionId,cloud?.credentialId]);};
 const loadKeyFor=(state:Bag)=>JSON.stringify([identityKey(),calendarLoadRange(state).key]);
 const changed=()=>{if(owner?.live)owner.vset('calendar',{});};
 const reset=()=>{++epoch;abort?.abort();abort=undefined;for(const reader of readers)reader.invalidate();readers=[];attempted='';loaded='';rows=[];sources=[];message='';cachedRead=false;lastReadAt=0;connectOffered=false;readOnlyGrants=new Set();if(owner)owner.googleCalendarRows=[];changed();};

 // The outbox keeps the first caller's client and reader for the account, so both resolve the
 // signed-in Cloud session at the moment of each request.
 const liveClient=()=>{const cloud=connectionController.getCloudClient();if(!cloud)throw new CloudProtocolError('credentials-missing');return cloud.client;};
 const writeClient:GoogleCalendarWriteClient={
  googleCalendarCreateEvent:(grant,calendar,input,signal)=>liveClient().googleCalendarCreateEvent(grant,calendar,input,signal),
  googleCalendarUpdateEvent:(grant,calendar,event,patch,signal)=>liveClient().googleCalendarUpdateEvent(grant,calendar,event,patch,signal),
  googleCalendarDeleteEvent:(grant,calendar,event,signal)=>liveClient().googleCalendarDeleteEvent(grant,calendar,event,signal),
 };
 /** Reads one calendar so the outbox can check a change is still current before sending it. */
 const readOne=async(sourceId:string,range:GoogleCalendarRange,signal:AbortSignal):Promise<GoogleCalendarRead>=>{
  const match=/^google:([^:]+):/.exec(sourceId),connectionId=match?decodeURIComponent(match[1]!):'';
  const many=await new GoogleCalendarReader(liveClient(),()=>currentGoogleCalendarBinding(connectionId)).readMany([sourceId],range,signal);
  if(many.status!=='ready')return many;
  return many.results[0]?.result??{status:'permission-required',message:'Google Calendar is unavailable.'};
 };
 function ensureOutbox(){
  const account=connectionController.getSnapshot().cloudAccount;
  const key=account?.organizationId?JSON.stringify([account.environment,account.userId,account.organizationId]):'';
  if(key===outboxKey)return;
  outboxRelease?.();outboxRelease=null;outbox=null;outboxKey=key;outboxProblem='';pausedOffered.clear();
  const token=++outboxOpen;
  if(!account?.organizationId)return;
  void openGoogleCalendarOutbox({environment:account.environment,userId:account.userId,organizationId:account.organizationId},{client:writeClient,read:readOne}).then(box=>{
   // Only the latest open attaches (an unmount and remount while one is pending starts another).
   if(token!==outboxOpen||outboxKey!==key||!owner)return;
   outboxRelease?.();outbox=box;outboxProblem='';const unsubscribe=box.subscribe(()=>{offerPaused();changed();}),detach=box.attach();
   outboxRelease=()=>{unsubscribe();detach();};changed();
  },()=>{
   // Forget the key so the next account change or return to Calendar opens it again.
   if(token!==outboxOpen||outboxKey!==key)return;
   outboxKey='';outboxProblem='Changes waiting to sync couldn’t be read.';changed();
  });
 }
 /** A delete whose Undo window could not be timed across a restart: offer Undo again for a full
  * window, then send it. Leaving Calendar first keeps it waiting. */
 function offerPaused(){
  const box=outbox,shell=owner;if(!box||!shell?.live||shell.S().view!=='calendar')return;
  const op=box.operations.find(item=>item.kind==='delete'&&item.phase==='paused'&&!pausedOffered.has(item.id));if(!op)return;
  pausedOffered.add(op.id);
  const title=rows.find(row=>row.calendarId===op.sourceId&&row.providerEventId===op.eventId)?.title||'Event';
  let kept=false;
  shell.toast?.(`${title} deleted`,{undo:()=>{kept=true;void box.resolvePaused(op.id,'keep').catch(()=>{});},ms:DELETE_UNDO_MS});
  setTimeout(()=>{if(!kept&&outbox===box&&owner===shell&&shell.live&&shell.S().view==='calendar')void box.resolvePaused(op.id,'send').then(sent=>{if(sent)void box.flush().catch(()=>{});},()=>{});else pausedOffered.delete(op.id);},DELETE_UNDO_MS);
 }

 async function refresh(force=false){
  if(!owner?.live||owner.S().view!=='calendar')return;
  const cloud=connectionController.getCloudClient(),accountKey=googleCalendarAccountKey();if(!cloud||!accountKey){connectOffered=false;return;}
  const state=owner.vget('calendar'),dates=calendarLoadRange(state),identity=identityKey(),saved=prefs();
  const request=JSON.stringify([identity,dates.key,saved]),loadKey=JSON.stringify([identity,dates.key]);if(!force&&attempted===request)return;
  abort?.abort();for(const reader of readers)reader.invalidate();readers=[];
  const signal=(abort=new AbortController()).signal,token=++epoch,shell=owner;attempted=request;reading=true;if(loaded!==loadKey){loaded='';rows=[];shell.googleCalendarRows=[];}message='';changed();
  const current=()=>!signal.aborted&&owner===shell&&shell.live&&shell.S().view==='calendar'&&!document.hidden&&token===epoch&&identityKey()===identity;
  const range={timeMin:new Date(dates.begin).toISOString(),timeMax:new Date(dates.end).toISOString(),timeZone:deviceZone()};
  // Events copied to this phone by linked sync show once, as the device copy.
  const unlinked=async(list:GoogleCalendarRecord[])=>{let linked=new Set<string>();try{linked=await calendarSyncHost.linkedProviderEvents();}catch{/* Keep both readable copies when link metadata cannot be verified. */}return list.filter(event=>!linked.has(event.providerEventId));};
  try{
   const account=connectionController.getSnapshot().cloudAccount;
   const cache=account?.organizationId?await serviceReadCache({environment:account.environment,userId:account.userId,organizationId:account.organizationId,credentialId:cloud.credentialId}).catch(()=>null):null;
   if(!current())return;calendarCache=cache;
   // One saved read per account and range (the cache itself is per account).
   const cacheKey=JSON.stringify(['google-calendars',dates.key]);
   const stored=force?null:await cache?.get<unknown>(cacheKey).catch(()=>null);if(!current())return;
   const cachedValue=stored?cachedCalendars(stored.value):null;
   if(stored&&cachedValue){
    const shownRows=await unlinked(cachedValue.events);if(!current())return;
    sources=cachedValue.sources;rows=shownRows;readOnlyGrants=new Set(cachedValue.noWrite);loaded=loadKey;shell.googleCalendarRows=rows;cachedRead=true;connectOffered=false;changed();
    const covered=sources.filter(source=>googleCalendarVisible(saved,source)).every(source=>cachedValue.read.includes(source.id));
    if(covered&&Date.now()-stored.at<300000){lastReadAt=stored.at;return;}
   }
   const accounts=(await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).list(signal)).filter(row=>row.connected&&row.connectionId&&row.grantedCapabilities.includes('google.calendar.read'));
   if(!current())return;
   if(!accounts.length){void cache?.clear().catch(()=>{});connectOffered=true;sources=[];rows=[];loaded=loadKey;shell.googleCalendarRows=[];cachedRead=false;lastReadAt=Date.now();changed();return;}
   connectOffered=false;
   const nextSources:GoogleCalendarSource[]=[],nextRows:GoogleCalendarRecord[]=[],read:string[]=[],failed:string[]=[],noWrite=new Set<string>();
   let accountFailure:{status:string;message:string}|null=null,answered=0;
   for(const google of accounts){
    const connectionId=google.connectionId!;
    const reader=new GoogleCalendarReader(cloud.client,()=>current()?currentGoogleCalendarBinding(connectionId):null);readers.push(reader);
    const list=await reader.listSources(signal);if(!current())return;
    if(list.status!=='ready'){accountFailure=list;continue;}
    // Every calendar the owner shows (Google's own choice unless changed here); at most 100 per account.
    const wanted=list.calendars.filter(source=>googleCalendarVisible(saved,source)).slice(0,100).map(source=>source.id);
    let calendars=list.calendars;
    if(wanted.length){
     const many=await reader.readMany(wanted,range,signal);if(!current())return;
     if(many.status!=='ready'){accountFailure=many;continue;}
     calendars=many.calendars;
     for(const {sourceId,result} of many.results){
      if(result.status==='ready'){read.push(sourceId);nextRows.push(...result.events);}
      else failed.push(calendars.find(source=>source.id===sourceId)?.name||'Google Calendar');
     }
    }
    answered++;nextSources.push(...calendars);
    if(!google.grantedCapabilities.includes('google.calendar.write')&&calendars.some(source=>['writer','owner'].includes(source.accessRole)))noWrite.add(connectionId);
   }
   if(!answered&&accountFailure){
    // Unavailable keeps what is shown; a lost grant clears it and offers Connect again.
    if(accountFailure.status!=='unavailable'){void cache?.clear().catch(()=>{});loaded='';rows=[];sources=[];shell.googleCalendarRows=[];connectOffered=true;message='';}
    else message=accountFailure.message;
    changed();return;
   }
   const shownRows=await unlinked(nextRows);if(!current())return;
   sources=nextSources;rows=shownRows;readOnlyGrants=noWrite;loaded=loadKey;shell.googleCalendarRows=rows;cachedRead=false;lastReadAt=Date.now();
   message=accountFailure||failed.length>1?'Some calendars couldn’t load.':failed.length?`${failed[0]} couldn’t load.`:'';
   void cache?.put(cacheKey,{sources:nextSources,read,events:nextRows,noWrite:[...noWrite]}).catch(()=>{});changed();
  }catch(error){if(current()){message='Google Calendar couldn’t load.';connectionController.rejectCloudSession(cloud.sessionId,error);changed();}}
  finally{if(token===epoch){reading=false;changed();}if(token===epoch&&!current()){attempted='';for(const reader of readers)reader.invalidate();}}
 }

 /** Rows as the owner should see them. A delete Google changed first stays visible so it can be resolved. */
 const overlayRows=():Row[]=>{
  const ops=outbox?.operations??[];
  return ops.length?overlayGoogleCalendarRows(rows,ops.filter(op=>!(op.kind==='delete'&&op.phase==='conflict'))):rows.map(row=>({...row,pending:false}));
 };
 const rawFor=(event:Row):Row=>event.localId?event:rows.find(row=>row.id===event.id)??event;
 const opFor=(event:Row):GoogleCalendarOutboxOp|undefined=>{
  const ops=outbox?.operations??[];
  return (event.outboxId?ops.find(op=>op.id===event.outboxId):undefined)??ops.find(op=>op.kind==='delete'&&op.phase==='conflict'&&op.sourceId===event.calendarId&&op.eventId===event.providerEventId);
 };
 async function queue(change:GoogleCalendarChange,api:Bag,id:string){
  const box=outbox;if(!box){api.toast('Google Calendar isn’t ready yet. Try again.');return null;}
  if(busy.has(id))return null;busy.add(id);changed();
  try{const result=await box.enqueue(change);if(result.status!=='queued'&&result.status!=='cancelled')api.toast(googleCalendarChangeProblem(result));return result;}
  catch{api.toast('Couldn’t save this change. Try again.');return null;}
  finally{busy.delete(id);changed();}
 }
 async function remove(event:Row,scope:GoogleCalendarScope,api:Bag){
  const box=outbox,result=await queue({kind:'delete',row:rawFor(event),scope},api,event.id);
  if(!result||(result.status!=='queued'&&result.status!=='cancelled')){api.set({deleteAsk:null});return;}
  api.set({deleteAsk:null,open:null,openDay:null});
  if(result.status==='cancelled'||!box){api.toast(`${event.title} deleted`);return;}
  // Nothing is sent before the Undo window closes.
  api.toast(`${event.title} deleted`,{undo:()=>void box.undo(result.id).then(undone=>{if(!undone)api.toast('Already sent to Google Calendar.');},()=>api.toast('Couldn’t undo. Try again.')),ms:DELETE_UNDO_MS});
 }
 async function answer(event:Row,response:GoogleCalendarRsvp,api:Bag){
  if(!GOOGLE_CALENDAR_WRITE_CAPABILITIES.rsvp){api.toast('Answer in Google Calendar.');return;}
  await queue({kind:'rsvp',row:rawFor(event),response},api,event.id);
 }
 const resolved=(work:Promise<boolean>,api:Bag)=>void work.then(()=>void outbox?.flush().catch(()=>{}),()=>api.toast('Couldn’t save this change. Try again.'));
 async function retry(op:GoogleCalendarOutboxOp,event:Row,api:Bag){
  const box=outbox;if(!box)return;
  if(op.error?.status==='gone'){resolved(box.dismiss(op.id),api);return;}
  if(op.error?.status==='needs-permission'){void googleConnect.start();return;}
  const raw=rawFor(event);
  const change:GoogleCalendarChange=op.kind==='create'?{kind:'update',row:event,scope:'this',fields:{title:op.fields.title??event.title}}
   :op.kind==='delete'?{kind:'delete',row:raw,scope:op.scope}:op.kind==='rsvp'&&op.response?{kind:'rsvp',row:raw,response:op.response}:{kind:'update',row:raw,scope:op.scope,fields:op.fields};
  const result=await queue(change,api,event.id);
  if(result?.status==='queued'&&result.id!==op.id)resolved(box.dismiss(op.id),api);else void box.flush().catch(()=>{});
 }
 /** The banner for a change that needs the owner: Google changed first, a create went unconfirmed, or it failed.
  * Each pill says what it does; a change Google no longer has offers one OK. */
 function conflictFor(op:GoogleCalendarOutboxOp|undefined,event:Row,api:Bag){
  const box=outbox;if(!op||!box)return null;
  const dismiss=()=>resolved(box.dismiss(op.id),api);
  if(op.phase==='conflict')return {text:op.kind==='delete'?'Changed in Google Calendar after you deleted it.':op.remote===null?'Deleted in Google Calendar.':'Changed in Google Calendar.',mineLabel:'Keep mine',theirsLabel:'Keep Google’s',keepMine:()=>resolved(box.resolveConflict(op.id,'mine'),api),keepTheirs:()=>resolved(box.resolveConflict(op.id,'google'),api)};
  if(op.phase==='uncertain')return {text:'Google didn’t confirm this event was added.',mineLabel:'Add again',theirsLabel:'Discard',keepMine:()=>resolved(box.resolveUncertain(op.id,'send'),api),keepTheirs:()=>resolved(box.resolveUncertain(op.id,'drop'),api)};
  if(op.phase==='failed'){
   const status=op.error?.status??'',text=FAILED[status]||'This change didn’t sync.';
   if(status==='gone')return {text,mineLabel:'OK',theirsLabel:'',keepMine:dismiss,keepTheirs:undefined};
   return {text,mineLabel:status==='needs-permission'?'Allow':'Try again',theirsLabel:'Discard',keepMine:()=>void retry(op,event,api),keepTheirs:dismiss};
  }
  return null;
 }
 function edit(event:Row,api:Bag){
  if(owner?.calendarEditDraftText&&!window.confirm('Replace the retained unsaved edits with a fresh editor?'))return;
  const times=googleCalendarFormTimes(event.begin,event.end,!!event.allDay);
  api.set({form:{id:event.id,title:event.title,...times,where:event.location||'',video:false,who:[],cal:event.calendarId,repeat:'none',alert:null,notes:event.body||'',
   ...(event.localId?{googleLocalId:event.localId}:{googleEventId:event.providerEventId,googleScope:'this',googleBase:{revision:event.revision,begin:event.begin,end:event.end}})}});
 }
 /** The row a Google edit form changes: the loaded event, or the unsent create it was opened from. */
 const editTarget=(form:Bag)=>form.googleLocalId?overlayRows().find(row=>row.localId===form.googleLocalId&&row.calendarId===form.cal)
  :rows.find(row=>row.calendarId===form.cal&&row.providerEventId===form.googleEventId);
 /** A restored or long-open edit is saved only while Google still has the version it started from. */
 const editStale=(form:Bag)=>{if(form.googleLocalId)return !editTarget(form);const target=editTarget(form);return !target||target.revision!==form.googleBase?.revision;};
 /** Clears the retained form; an edit of an unsent create (googleLocalId) is never retained. */
 const committed=(form:Bag)=>{if(form.googleLocalId&&!form.googleEventId)return;owner?.calendarFormCommitted?.(form);};
 async function saveEdit(form:Bag,api:Bag){
  const target=editTarget(form);
  if(!target||editStale(form)){api.toast('This event changed in Google Calendar. Reopen it to edit.');return;}
  const title=String(form.title||'').trim();if(!title)return;
  if(form.who?.length){api.toast('Add guests in Google Calendar.');return;}
  if(form.video){api.toast('Add video links in Google Calendar.');return;}
  // Changed fields only, against what the owner saw (pending changes included).
  const shown=overlayRows().find(row=>row.id===target.id)??target,fields:GoogleCalendarWriteFields={};
  if(title!==shown.title)fields.title=title;
  if((form.notes||'')!==(shown.body||''))fields.description=form.notes||'';
  if((form.where||'')!==(shown.location||''))fields.location=form.where||'';
  const before=googleCalendarFormTimes(shown.begin,shown.end,!!shown.allDay);
  if(form.off!==before.off||form.t!==before.t||form.d!==before.d){
   let when;try{when=calendarOptionEvent({...form,allDay:!!shown.allDay,repeat:'none'},deviceZone());}catch(error){api.toast(error instanceof Error?error.message:'Choose another time.');return;}
   fields.startAt=iso(when.begin);fields.endAt=iso(when.end);fields.timeZone=when.timeZone;
  }
  if(!Object.keys(fields).length){committed(form);api.set({form:null});return;}
  const result=await queue({kind:'update',row:rawFor(target),scope:form.googleScope==='all'?'all':'this',fields},api,target.id);
  if(result?.status!=='queued')return;
  committed(form);
  if(api.get('calendar').form===form)api.set({form:null,day:form.off,openDay:form.off});
 }
 async function saveCreate(form:Bag,api:Bag){
  const source=sources.find(item=>item.id===form.cal&&item.writable);
  if(!source){api.toast('Choose a calendar you can change.');return;}
  const title=String(form.title||'').trim();if(!title)return;
  if(form.video){api.toast('Add video links in Google Calendar.');return;}
  let when;try{when=calendarOptionEvent({...form,repeat:'none'},deviceZone());}catch(error){api.toast(error instanceof Error?error.message:'Choose another time.');return;}
  const contacts:Bag[]=api.get('contacts')?.list||[],attendees:string[]=[];
  for(const id of form.who||[]){const person=contacts.find(row=>row.id===id)??api.person?.(id),email=typeof person?.email==='string'?person.email.trim():'';if(!email){api.toast(`Add an email for ${person?.name||id} first.`);return;}attendees.push(email);}
  const result=await queue({kind:'create',sourceId:source.id,connectionId:source.connectionId,calendarId:source.providerCalendarId,
   fields:{title,startAt:iso(when.begin),endAt:iso(when.end),timeZone:when.timeZone,...(form.notes?{description:form.notes}:{}),...(form.where?{location:form.where}:{}),...(attendees.length?{attendees}:{})},...(form.allDay?{allDay:true}:{})},api,`create:${form.creationId||''}`);
  if(result?.status!=='queued')return;
  committed(form);
  if(api.get('calendar').form===form)api.set({form:null,open:null,day:form.off,month:null});
 }

 p.componentDidMount=function(){
  mount.call(this);owner=this;this.googleConnectUnsubscribe=googleConnect.subscribe(changed);this.calendarSyncDispose=startCalendarSyncHost();ensureOutbox();
  let previous=identityKey(),previousOwner=cacheOwnerKey();
  const accountChanged=(event:Event)=>{previous=identityKey();reset();const account=connectionController.getSnapshot().cloudAccount,cloud=connectionController.getCloudClient();if(event.type===GOOGLE_ACCOUNTS_CHANGED&&account?.organizationId&&cloud)void serviceReadCache({environment:account.environment,userId:account.userId,organizationId:account.organizationId,credentialId:cloud.credentialId}).then(cache=>cache.clear()).catch(()=>{}).finally(()=>void refresh(true));else void refresh(true);};
  this.googleCalendarUnsubscribe=connectionController.subscribe(()=>{ensureOutbox();const nextOwner=cacheOwnerKey();if(previousOwner&&nextOwner!==previousOwner)void calendarCache?.clear().catch(()=>{});previousOwner=nextOwner;const next=identityKey();if(next!==previous){previous=next;reset();void refresh();}});
  this.googleCalendarResume=()=>{if(!document.hidden&&!reading&&lastReadAt>0&&Date.now()-lastReadAt>=300000)void refresh(true);};document.addEventListener('visibilitychange',this.googleCalendarResume);
  this.googleCalendarChanged=accountChanged;window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountChanged);
  // Showing or hiding a calendar reads what is newly shown; rows already loaded stay.
  this.googleCalendarPrefsChanged=()=>{changed();void refresh();};window.addEventListener(GOOGLE_CALENDAR_PREFS_CHANGED,this.googleCalendarPrefsChanged);
 };
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);const entered=this.S().view==='calendar'&&this.calendarSyncPreviousView!=='calendar';this.calendarSyncPreviousView=this.S().view;if(entered){void calendarSyncHost.resume();ensureOutbox();void outbox?.flush().catch(()=>{});offerPaused();void refresh(lastReadAt>0&&Date.now()-lastReadAt>=300000);}else void refresh();};
 p.componentWillUnmount=function(){this.googleConnectUnsubscribe?.();document.removeEventListener('visibilitychange',this.googleCalendarResume);this.calendarSyncDispose?.();this.googleCalendarUnsubscribe?.();window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleCalendarChanged);window.removeEventListener(GOOGLE_CALENDAR_PREFS_CHANGED,this.googleCalendarPrefsChanged);if(owner===this){const previous=owner;outboxRelease?.();outboxRelease=null;outbox=null;outboxKey='';owner=null;reset();previous.googleCalendarRows=[];}unmount.call(this);};

 views.calendar.render=(state:Bag,api:Bag)=>{
  const ready=loaded===loadKeyFor(state),saved=prefs(),accountKey=googleCalendarAccountKey();
  const shown=new Set(sources.filter(source=>googleCalendarVisible(saved,source)).map(source=>source.id));
  // A row that cannot be drawn is skipped; it never hides the others.
  const display=ready?overlayRows().filter(row=>shown.has(row.calendarId)&&Number.isFinite(row.begin)&&Number.isFinite(row.end)&&row.end>=row.begin).flatMap(row=>{try{return [googleCalendarDisplayRecord(row)];}catch{return [];}}):[];
  const merged=[...(state.events||[]),...display];
  const colorOf=(source:GoogleCalendarSource)=>saved[source.id]?.color||source.color||'acc';
  const calPrefs:Bag={...state.calPrefs};for(const source of sources)calPrefs[source.id]={on:shown.has(source.id),color:colorOf(source)};
  // New events start in the primary Google calendar when there is one (the + button only).
  const renderApi=Object.create(api);
  renderApi.set=(patch:Bag)=>{if(defaultCal&&patch?.menu===false&&patch.form&&!patch.form.id&&typeof patch.form.cal==='string'&&patch.form.cal.startsWith('native:'))patch={...patch,form:{...patch.form,cal:defaultCal,alert:null}};return api.set(patch);};
  const out=render({...state,googleCalendars:sources.map(source=>({id:source.id,name:source.name,color:colorOf(source),account:source.account})),events:merged,calPrefs},renderApi);
  const dotOf=(id:string)=>(out.calToggles||[]).find((row:Bag)=>row.id===id)?.dot||'var(--acct)';
  if(Array.isArray(out.calToggles)&&accountKey)out.calToggles=out.calToggles.map((row:Bag)=>!sources.some(source=>source.id===row.id)?row:{...row,toggle:()=>{if(!setGoogleCalendarVisible(accountKey,row.id,!shown.has(row.id)))api.toast('Couldn’t save. Try again.');}});
  const primary=sources.find(source=>source.primary&&source.writable&&shown.has(source.id));
  if(primary&&outbox&&typeof out.newEvent==='function'){const inner=out.newEvent;out.newEvent=(...args:any[])=>{defaultCal=primary.id;try{return inner(...args);}finally{defaultCal='';}};}
  const signedIn=!!connectionController.getCloudClient();
  out.canRefreshGoogleCalendar=signedIn&&sources.length>0;out.googleCalendarRefreshing=reading&&sources.length>0;out.googleCalendarNotice=message||outboxProblem;
  out.googleConnectOffered=signedIn&&connectOffered;out.googleConnecting=googleConnect.getSnapshot()==='waiting';out.googleConnectLabel=out.googleConnecting?'Connecting…':'Connect';out.connectGoogleCalendar=()=>void googleConnect.start();if(out.googleConnectOffered&&googleConnectNote())out.googleCalendarNotice=googleConnectNote();out.refreshGoogleCalendar=()=>void refresh(true);
  if(ready&&(out.events?.length||out.hasNativeAllDay))out.empty=false;
  if(!ready&&!state.open&&!state.form&&message)out.emptyText=message;

  // Delete scope sheet for a repeating Google event.
  const asked=state.deleteAsk?merged.find((row:Bag)=>row.id===state.deleteAsk.id&&row.googleCalendarRecord):null;
  if(asked&&out.deleteSheet?.options)out.deleteSheet={...out.deleteSheet,options:out.deleteSheet.options.map((option:Bag)=>({...option,go:()=>void remove(asked.googleCalendarRecord,option.scope,api)}))};

  const chosen=merged.find((row:Bag)=>row.id===state.open&&row.googleCalendarRecord);
  if(chosen&&out.ev){
   const event=chosen.googleCalendarRecord as Row,source=sources.find(item=>item.id===event.calendarId),evDay=state.openDay??chosen.off;
   const options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric',year:'numeric',...(event.allDay?{timeZone:'UTC'}:{})};const begin=new Date(event.begin),end=new Date(event.allDay?event.end-DAY:event.end);out.ev.day=begin.toLocaleDateString(undefined,options)+(begin.toLocaleDateString(undefined,options)!==end.toLocaleDateString(undefined,options)?' – '+end.toLocaleDateString(undefined,options):'');out.ev.when=event.allDay?'All day':begin.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+' – '+new Date(event.end).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
   out.ev.calName=source?.name||'Google Calendar';out.ev.notes=event.body;out.ev.hasNotes=!!event.body;out.ev.share=()=>api.toast('Share this event from Google Calendar.');
   const writable=event.writable&&!!outbox,canAllow=!event.writable&&readOnlyGrants.has(event.connectionId)&&['writer','owner'].includes(source?.accessRole||'');
   const allow=()=>{if(window.confirm('Allow Alpha to change your Google Calendar?'))void googleConnect.start();};
   // A calendar Alpha cannot change shows no Edit or Delete (and no note saying so).
   out.ev.pending=!!event.pending;out.ev.sourceNote='';out.ev.canEdit=writable||canAllow;
   out.ev.busy=busy.has(event.id)||(!writable&&!canAllow);
   out.ev.edit=writable?()=>edit(event,api):canAllow?allow:()=>{};
   out.ev.del=writable?()=>{if(event.recurringEventId&&!event.localId)api.set({deleteAsk:{id:chosen.id,off:evDay,scopes:['this','all']}});else void remove(event,'this',api);}:canAllow?allow:()=>{};
   out.ev.conflict=conflictFor(opFor(event),event,api);
   // Cloud sends no guest updates, so say so before the owner changes an event with guests.
   out.ev.guestNote=writable&&event.attendees.some(guest=>!guest.self)?'Google won’t email guests about changes made here.':'';
   const invited=event.selfResponse!==null&&!event.organizerSelf;out.ev.isInvite=invited;
   if(invited){
    const organizer=event.attendees.find(guest=>guest.organizer);out.ev.from=initials(organizer?.displayName||organizer?.email||'');
    const reply=(response:GoogleCalendarRsvp,label:string,status:string)=>({label,css:event.selfResponse===status?(status==='declined'?'background:var(--fg);color:var(--bg)':'background:var(--acc);color:#fff'):'background:var(--s2)',go:()=>void answer(event,response,api)});
    // Replies show only once Cloud can record them; until then the organizer row stays, with no dead pills.
    out.ev.rsvp=GOOGLE_CALENDAR_WRITE_CAPABILITIES.rsvp?[reply('yes','Going','accepted'),reply('maybe','Maybe','tentative'),reply('no','No','declined')]:[];
   }
  }

  // The form for a Google calendar: create in a writable calendar, or edit one event.
  if(out.f&&state.form){
   const f=state.form,editing=!!(f.googleEventId||f.googleLocalId),google=typeof f.cal==='string'&&f.cal.startsWith('google:');
   const writableSources=sources.filter(source=>source.writable&&shown.has(source.id));
   if(editing){const source=sources.find(item=>item.id===f.cal);out.f.cals=[{name:source?.name||'Google Calendar',dot:dotOf(f.cal),css:'background:var(--fg);color:var(--bg)',pick:()=>{}}];}
   else if(!f.id&&!f.alphaCalendarId&&!f.alphaReminderId&&outbox&&writableSources.length)out.f.cals=[...(out.f.cals||[]),...writableSources.map(source=>({name:source.name,dot:dotOf(source.id),css:f.cal===source.id?'background:var(--fg);color:var(--bg)':'background:var(--bg)',pick:()=>{const form=api.get('calendar').form;if(form)api.set({form:{...form,cal:source.id,alert:null,repeat:'none',allDay:undefined,video:false}});}}))];
   if(google){
    // Google takes title, time, place, notes and (when creating) guests; repeats, alerts and video stay in Google Calendar.
    out.f.alerts=[];out.f.insertHandoff=undefined;out.f.optionsAvailable=false;out.f.toggleAllDay=undefined;
    // No video switch for Google (it could never turn on), and guests are added only when creating.
    out.f.toggleVideo=undefined;
    if(editing){out.f.picking=false;out.f.notPicking=false;out.f.openPick=undefined;}
    out.f.noteLinkNotice=f.origin?'This event won’t link back to the note.':'';
    const target=editing?editTarget(f):undefined;
    // An all-day Google event keeps its times: the form says All day and its time steppers do nothing.
    if(target?.allDay){out.f.timeLocked=true;out.f.allDay=true;out.f.start='All day';out.f.end='';out.f.dur='';out.f.sMinus=out.f.sPlus=out.f.eMinus=out.f.ePlus=undefined;}
    out.f.repeats=target?.recurringEventId?[['this','This event'],['all','All events']].map(([scope,label])=>({label,css:(f.googleScope||'this')===scope?'background:var(--fg);color:var(--bg)':'background:var(--bg)',pick:()=>{const form=api.get('calendar').form;if(form)api.set({form:{...form,googleScope:scope}});}})):[];
    const stale=editing&&(!ready||editStale(f));
    if(stale){out.f.saveOff=true;out.f.saveCss='background:var(--s2);color:var(--mut)';if(ready)out.editDraftStatus='This event changed in Google Calendar. Reopen it to edit.';}
    out.f.save=()=>{const form=api.get('calendar').form;if(!form||!String(form.title||'').trim())return;void (editing?saveEdit(form,api):saveCreate(form,api));};
   }
   // Rows the form shows only when they hold something to choose (the template gates them on these).
   out.f.hasRepeats=Array.isArray(out.f.repeats)&&out.f.repeats.length>0;out.f.hasAlerts=Array.isArray(out.f.alerts)&&out.f.alerts.length>0;
   out.f.hasVideo=!google;out.f.canAddPeople=!(google&&editing);out.f.timeLocked=!!out.f.timeLocked;
  }
  if(out.ev&&out.ev.canEdit===undefined)out.ev.canEdit=true;
  return out;
 };
}
