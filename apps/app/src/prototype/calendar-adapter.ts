import {presentCalendarIntervals} from './calendar-interval-presentation';
import {refreshDeletionViews} from '../runtime/deletions';
import {openReminderRecovery,openReminderCreationRecovery,openReminderActionRecovery} from '../browser/reminder-recovery';
import {openCalendarRecovery} from '../browser/calendar-recovery';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import {calendarFormTimeProblem} from '../runtime/calendar-form-draft';
import {calendarAgenda,calendarAgendaRows,calendarDayColumns,calendarDayCount,calendarDayLabel,calendarReturnDay,visibleCalendarDays} from './calendar-days';
import {mapsEventOriginFor} from '../runtime/maps-event-return';
import {rememberNoteOrigin,forgetNoteOrigin,noteOriginSupported,eventNoteOriginId} from './note-origin-adapter';
import {reminderWallTime} from '../runtime/reminder-creations';
type Bag = Record<string, any>;
const calendar = registerPlugin<any>('AlphaCalendar');
const DAY=86400000;
const civilDay=(date:Date,utc=false)=>Date.UTC(utc?date.getUTCFullYear():date.getFullYear(),utc?date.getUTCMonth():date.getMonth(),utc?date.getUTCDate():date.getDate());

/** Instant of a civil wall time in an IANA zone; undefined when it does not exist or occurs twice. */
export function zonedInstant(date:{year:number;month:number;day:number},minutes:number,zone:string):number|undefined{
  const wall=(instant:number)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));};
  const base=Date.UTC(date.year,date.month-1,date.day,0,minutes),found=new Set<number>();
  for(const probe of [base-86400000,base,base+86400000]){const offset=wall(probe)-Math.floor(probe/60000)*60000,instant=base-offset;if(wall(instant)===base)found.add(instant);}
  return found.size===1?[...found][0]:undefined;
}
/** IANA zones offered for a timed event: the device zone first, then a short common list. */
export function calendarZoneChoices(deviceZone:string,selected?:string):string[]{
  const common=['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Sao_Paulo','Europe/London','Europe/Paris','Europe/Berlin','Africa/Lagos','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];
  return [...new Set([deviceZone,...(selected?[selected]:[]),...common])];
}
const RRULES:Record<string,string>={daily:'FREQ=DAILY',weekdays:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',weekly:'FREQ=WEEKLY'};
/** Guests, video calls and alerts are completed in Android Calendar through the insert handoff. */
export const calendarNeedsHandoff=(form:Bag)=>!!(form.video||form.who?.length||form.alert!=null);
/** All-day, a non-device zone or a repeat uses the 0041 direct save (creation only). */
export const calendarUsesOptions=(form:Bag,deviceZone:string)=>!!form.allDay||(!!form.zone&&form.zone!==deviceZone)||(form.repeat&&form.repeat!=='none');
/**
 * Provider fields for the 0041 direct save. All-day events are one UTC date (CalendarContract
 * all-day rule); timed events take the wall time in the chosen IANA zone. Throws a user message.
 */
export function calendarOptionEvent(form:Bag,deviceZone:string,now=new Date()):{title:string;body:string;location:string;begin:number;end:number;allDay:boolean;timeZone:string;rrule:string}{
  const day=new Date(now.getFullYear(),now.getMonth(),now.getDate()+Number(form.off||0),12);
  const date={year:day.getFullYear(),month:day.getMonth()+1,day:day.getDate()};
  const rrule=form.repeat&&form.repeat!=='none'?RRULES[form.repeat]:'';
  if(rrule===undefined)throw Error('Choose a supported repeat. Nothing was saved.');
  const base={title:String(form.title||'').trim(),body:form.notes||'',location:form.where||'',rrule};
  if(form.allDay){const begin=Date.UTC(date.year,date.month-1,date.day);return {...base,begin,end:begin+DAY,allDay:true,timeZone:'UTC'};}
  const zone=form.zone||deviceZone,start=Math.round(Number(form.t)*60),length=Math.round(Number(form.d)*60);
  if(!Number.isFinite(start)||!Number.isFinite(length)||length<=0)throw Error('Choose a start and end time. Nothing was saved.');
  const begin=zonedInstant(date,start,zone),end=zonedInstant(date,start+length,zone);
  if(begin===undefined||end===undefined||end<=begin)throw Error(`That time does not exist or occurs twice in ${zone} because the clocks change. Choose another time. Nothing was saved.`);
  return {...base,begin,end,allDay:false,timeZone:zone};
}

/** Android CalendarProvider data in the original calendar presentation. */
export function installCalendarAdapter(Component: any, views: Bag, options:{active?:(shell:any)=>boolean}={}) {
  const active=(shell:any)=>options.active?.(shell)??true;
  const p=Component.prototype, mount=p.componentDidMount, unmount=p.componentWillUnmount;
  const render=views.calendar.render;
  let owner:any, calendars:Bag[]=[], status='Not connected', loading=false, generation=0, loadFailed=false;
  let creationPending:Bag[]|null=null,creationRecoveryFailed=false,creationDraftEpoch=0,creationReadEpoch=0;
  async function readCreations(){if(!owner||!active(owner))return [];const token=++creationReadEpoch,readingOwner=owner,draftEpoch=creationDraftEpoch;const value=await calendar.pendingCreations();if(value.status!=='ready'||!Array.isArray(value.creations))throw Error('Calendar creation recovery unavailable');if(owner===readingOwner&&draftEpoch===creationDraftEpoch&&token===creationReadEpoch){creationPending=value.creations;creationRecoveryFailed=false;}return value.creations as Bag[];}
  let agentSelection:Bag|undefined,agentSelectionKey='',agentSelectionEpoch=0;
  p.calendarSelection=function(){if(!active(this))return;const state=this.vget('calendar');if(agentSelection?.kind==='calendar-source')return state.form?.cal===agentSelection.formCal?{kind:'calendar-source',id:agentSelection.id,revision:agentSelection.revision,accountId:agentSelection.id,sourceRevision:agentSelection.revision}:undefined;return agentSelection&&state.open===agentSelection.open?{kind:'calendar-event',id:agentSelection.id,revision:agentSelection.revision,accountId:agentSelection.accountId,sourceRevision:agentSelection.sourceRevision}:undefined;};
  type Range={begin:number;end:number;key:string};
  const rangeFor=(state:Bag):Range=>{const today=new Date(),date=new Date(today.getFullYear(),today.getMonth(),today.getDate()+Number(state.day||0));date.setDate(1);if(state.month!=null)date.setMonth(date.getMonth()+Number(state.month||0));const begin=new Date(date.getFullYear(),date.getMonth()-1,1).getTime(),end=new Date(date.getFullYear(),date.getMonth()+2,1).getTime();return {begin:Math.max(0,begin),end,key:`${begin}:${end}`};};
  let desired:Range|undefined,loadedKey='',attemptedKey='',scheduled=false,runningToken=0,truncated=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(owner&&!loading&&desired?.key!==attemptedKey)void refresh();});};
  const mapEvent=(event:Bag)=>{
    const begin=new Date(event.begin),end=new Date(event.end),today=new Date(),allDay=!!event.allDay;
    const off=(civilDay(begin,allDay)-civilDay(today))/DAY;
    return {id:`calendar:${event.id}:${event.begin}`,alphaCalendarId:event.id,nativeEvent:event,
      off,t:allDay?0:begin.getHours()+begin.getMinutes()/60,
      d:allDay?0:Math.max(.25,(civilDay(end)-civilDay(begin))/DAY*24+end.getHours()+end.getMinutes()/60-begin.getHours()-begin.getMinutes()/60),
      nativeAllDayEndOff:allDay?off+Math.max(1,Math.ceil((event.end-event.begin)/DAY)):undefined,
      title:event.title||'Untitled event',notes:event.body||'',where:event.location||'',
      cal:'personal',who:event.who||[],video:event.video?'Local meeting room':false,repeat:'none',alert:event.alert??null,allDay};
  };
  async function refresh(request=false, force=false) {
    if(!owner||!active(owner)||(loading&&!force))return;
    if (Capacitor.getPlatform() === 'web' && !Capacitor.isPluginAvailable('AlphaCalendar')) {
      desired=rangeFor(owner.vget('calendar'));attemptedKey=desired.key;
      status='Device calendars are available in the Android app.';
      owner.vset('calendar',{nativeCalendarStatus:status});return;
    }
    agentSelection=undefined;agentSelectionKey='';agentSelectionEpoch++;
    // When the provider read completed: Home's calendar card shows this, not when it first drew the rows.
    let readAt:number|null=null;
    const currentOwner=owner,range=desired||rangeFor(owner.vget('calendar')), token=++generation;desired=range;attemptedKey=range.key;runningToken=token;loading=true;loadFailed=false;status='Loading calendars…';currentOwner.vset('calendar',{nativeCalendarStatus:status});
    try {
      if(request) {const permission=await calendar.requestAccess();if(owner!==currentOwner||token!==generation||!active(currentOwner))return;if(permission.status!=='granted'){loadedKey='';status='Calendar access denied';calendars=[];currentOwner.nativeCalendarRows=[];await currentOwner.refreshReminders();return;}}
      const result=await calendar.list({begin:range.begin,end:range.end});
      if(owner!==currentOwner||token!==generation||!active(currentOwner))return;
      if(result.status==='ready')readAt=Date.now();
      if(result.status!=='ready'){loadedKey='';status='Connect device calendars';calendars=[];currentOwner.nativeCalendarRows=[];await currentOwner.refreshReminders();return;}
      try{await readCreations();}catch{if(owner===currentOwner&&token===generation){creationPending=null;creationRecoveryFailed=true;}}
      if(owner!==currentOwner||token!==generation||!active(currentOwner))return;
      loadedKey=range.key;truncated=!!result.truncated;calendars=result.calendars;status=result.truncated?'Calendar range limited to 2,000 events':Capacitor.isNativePlatform()?(calendars.length?'Device calendar access allowed':'No device calendars found'):'Local calendar ready';
      currentOwner.nativeCalendarRows=result.events.map(mapEvent);
      await currentOwner.refreshReminders();
      if(request)currentOwner.calendarWriteUncertain=false;
    }catch{if(owner===currentOwner&&token===generation){loadedKey='';loadFailed=true;status=Capacitor.isNativePlatform()?'Calendar range could not be loaded. Open device calendars to retry.':'App calendar could not be loaded. Retry or open Calendar recovery.';}}
    finally{if(runningToken===token){loading=false;if(token!==generation&&attemptedKey===range.key)attemptedKey='';}if(owner===currentOwner){currentOwner.vset('calendar',{nativeCalendarStatus:status,...(token===generation?{nativeCalendarReadAt:loadedKey===range.key?readAt:null}:{})});if(desired?.key!==attemptedKey)schedule();}}
  }
  // One presentation seam over the existing display sources/preferences. These
  // controls never create native agent read grants or change source identities.
  views.calendar.displaySources=()=>{
    const currentOwner=owner,native=Capacitor.isNativePlatform();
    const current=()=>owner===currentOwner&&!!currentOwner?.live&&active(currentOwner)&&!document.hidden;
    return {native,loading,status,error:loadFailed,ready:!!loadedKey&&loadedKey===desired?.key&&!loadFailed&&!loading,truncated,
      connect:()=>{if(current()&&!loading)void refresh(true);},
      // Reads the current range again after a failed read. It requests no new access.
      retry:()=>{if(current()&&!loading&&loadFailed)void refresh();},
      sources:(loadFailed?[]:calendars).map(c=>({id:c.id,name:!native&&c.local?'In this app':c.name||'Unnamed calendar',account:!native&&c.local?'Saved on this device':c.account||'Device calendar',on:c.visible!==false,color:c.color,
        change:async(action:'visibility'|'color')=>{if(!current()||loading||!calendars.includes(c)||native)return;try{await calendar.changePreferences({action});}catch{if(current())currentOwner.toast('Calendar settings could not be saved. Try again.');}}
      }))};
  };
  let navigationEpoch=0;
  const openCalendarEvent=(event:Event)=>{
    const request=(event as CustomEvent).detail,currentOwner=owner,epoch=++navigationEpoch;
    if(!currentOwner||!active(currentOwner)||typeof request?.id!=='string'||!Number.isFinite(request.begin)||typeof request.complete!=='function')return;
    event.preventDefault();
    void (async()=>{let opened=false;try{
      const day=(civilDay(new Date(request.begin),request.allDay)-civilDay(new Date()))/DAY;
      // Cover the day list until the event opens, so a deep link never flashes the full calendar.
      currentOwner.vset('calendar',{day,month:null,open:null,openDay:null,form:null,deepOpening:request.id});desired=rangeFor({day});
      await refresh(false,true);
      if(owner!==currentOwner||epoch!==navigationEpoch||document.hidden||currentOwner.S().view!=='calendar'||currentOwner.vget('calendar').day!==day)return;
      const row=currentOwner.nativeCalendarRows?.find((row:Bag)=>row.alphaCalendarId===request.id);
      if(!row)return;
      currentOwner.vset('calendar',{open:row.id,openDay:day,deepOpening:null,deepOpened:row.id});opened=true;
    }finally{if(!opened&&owner===currentOwner&&epoch===navigationEpoch)currentOwner.vset('calendar',{deepOpening:null});request.complete(opened);}})();
  };
  const calendarCommitted=()=>{if(owner&&active(owner)){owner.vset('calendar',{open:null,openDay:null});void refresh(false,true);}};
  p.refreshAgentCalendar=function(){return refresh(false,true);};
  p.componentDidMount=function(){mount.call(this);owner=this;void refresh();window.addEventListener('alpha:calendar-committed',calendarCommitted);this.calendarPreferenceChanged=(event:Event)=>{if(event.type==='storage'){const e=event as StorageEvent;if(e.key!=='alpha.browser.calendar.v1')return;try{if(JSON.stringify(JSON.parse(e.oldValue||'{}').preferences)===JSON.stringify(JSON.parse(e.newValue||'{}').preferences))return;}catch{return;}}void refresh(false,true);};window.addEventListener('alpha:calendar-document-changed',this.calendarPreferenceChanged);if(!Capacitor.isNativePlatform()){window.addEventListener('alpha:calendar-open',openCalendarEvent);window.addEventListener('alpha:calendar-preferences',this.calendarPreferenceChanged);window.addEventListener('storage',this.calendarPreferenceChanged);}this.calendarResume=DailyApps.addListener('appResumed',()=>void refresh()).catch(()=>null);};
  p.componentWillUnmount=function(){if(owner===this){agentSelection=undefined;agentSelectionKey='';agentSelectionEpoch++;owner=null;++creationReadEpoch;creationPending=null;creationRecoveryFailed=false;loading=false;calendars=[];status='Not connected';desired=undefined;loadedKey='';attemptedKey='';++generation;}void this.calendarResume?.then((l:any)=>l?.remove());window.removeEventListener('alpha:calendar-committed',calendarCommitted);window.removeEventListener('alpha:calendar-document-changed',this.calendarPreferenceChanged);if(!Capacitor.isNativePlatform()){++navigationEpoch;window.removeEventListener('alpha:calendar-open',openCalendarEvent);window.removeEventListener('alpha:calendar-preferences',this.calendarPreferenceChanged);window.removeEventListener('storage',this.calendarPreferenceChanged);}unmount.call(this);};
  views.calendar.render=(state:Bag,api:Bag)=>{
    if(!owner||!active(owner))return render(state,api);
    const range=rangeFor(state);
    if(desired?.key!==range.key){desired=range;++generation;status='Loading calendars…';schedule();}
    const rangeReady=loadedKey===range.key,reminderStale=!!state.reminderStale||!!owner?.reminderRefreshFailed;
    if(!rangeReady)state={...state,events:(state.events||[]).filter((e:Bag)=>!e.alphaCalendarId)};
    const providerState=state;
    const browserCalendar=!Capacitor.isNativePlatform()?calendars.find(c=>c.id==='local'):undefined;
    if(browserCalendar){state={...state,calPrefs:{...state.calPrefs,personal:{on:browserCalendar.visible!==false,color:browserCalendar.color||'acc'}},events:browserCalendar.visible===false?(state.events||[]).filter((e:Bag)=>!e.alphaCalendarId):state.events};}
    const out=render(state,api);
    // The cover stays under a deep-linked event while it fades in and is open, so the day list never shows through.
    out.deepOpening=!!state.deepOpening&&!state.open||!!state.open&&state.open===state.deepOpened;
    // While the open still waits for its read, only Back to apps sits above that cover: the owner can leave,
    // and the other header actions stay covered until the event is shown.
    out.openingBackCss=!!state.deepOpening&&!state.open?'position:relative;z-index:5':'';
    if(browserCalendar?.visible===false&&state.open){const detail=render(providerState,api);out.ev=detail.ev;out.detail=detail.detail;}
    out.emptyText=rangeReady?(truncated?'Calendar results incomplete. Some events may be missing.':reminderStale?'Reminders unavailable. Retry before relying on this schedule.':'No visible events or reminders for this day.'+(Capacitor.isNativePlatform()?' Only calendars stored in Android Calendar on this phone appear here.':'')):status;
    // Source disclosure: Android CalendarProvider calendars only. Connected Google calendars need OAuth (not yet available).
    out.calendarSourceLabel=Capacitor.isNativePlatform()?'On-device calendars':'Browser calendar';
    out.calendarSourceText=Capacitor.isNativePlatform()?'Shows calendars stored in Android Calendar on this phone, including accounts synced by Android. Connected Google calendars are not shown here yet.':'Shows the calendar stored in this browser.';
    out.nativeStatusLabel=[rangeReady&&truncated?'Calendar results incomplete. Some events may be missing.':'',reminderStale?'Reminders may be out of date. Tap to retry.':''].filter(Boolean).join(' ');
    out.nativeStatusRetry=()=>{void refresh(false,true);void owner?.refreshReminders();};
    out.browserRecovery=!Capacitor.isNativePlatform()&&loadFailed&&!loading;out.openBrowserRecovery=openCalendarRecovery;
    out.reminderRecovery=!Capacitor.isNativePlatform()&&reminderStale;out.openReminderRecovery=openReminderRecovery;out.openReminderCreationRecovery=openReminderCreationRecovery;out.openReminderActionRecovery=openReminderActionRecovery;
    if(!rangeReady&&!state.open&&!state.form)out.empty=true;
    presentCalendarIntervals(render,{...state,events:(state.events||[]).map((e:Bag)=>e.alphaCalendarId||e.googleCalendarRecord?{...e,calendarInterval:true,calendarIntervalData:e.nativeEvent,allDayEndOff:e.nativeAllDayEndOff}:e)},api,out,rangeReady);
    const newEvent=async(separateCreation=false)=>{
      const activeOwner=owner,now=new Date(),day=Number(state.day||0),hour=now.getHours()+now.getMinutes()/60;
      const draft={id:null,creationId:crypto.randomUUID(),separateCreation,title:'',off:day,t:day===0?Math.min(21,Math.ceil(hour+.01)):10,d:1,where:'',video:false,who:[],cal:'native:local',repeat:'none',alert:null,notes:''};
      ++creationDraftEpoch;api.set({month:null,form:draft});
      const token=++agentSelectionEpoch;agentSelection=undefined;agentSelectionKey='';
      const current=()=>owner===activeOwner&&!document.hidden&&api.isActive()&&api.get('calendar').form?.creationId===draft.creationId;
      try{const permission=await calendar.requestAccess();if(permission.status!=='granted'||!current())return;const source=await calendar.prepareAgentSource();if(current()&&token===agentSelectionEpoch&&source.status==='ready'&&api.get('calendar').form?.cal==='native:local'){agentSelection={kind:'calendar-source',id:source.sourceId,revision:source.sourceRevision,formCal:'native:local'};api.set({nativeAgentSourceRevision:source.sourceRevision});}}catch{if(current())api.toast('Calendar source unavailable for agent actions.');}
    };
    out.newEvent=()=>newEvent();
    out.creationRecovery=creationRecoveryFailed||Boolean(creationPending?.length);
    out.creationRecoveryText=creationRecoveryFailed?'Calendar creation receipts could not be checked. Nothing was retried.':`${creationPending?.length||0} previous event creation(s) need review. Refresh never retries them.`;
    out.checkCreations=async()=>{
      const recoveryOwner=owner,recoveryForm=api.get('calendar').form,epoch=creationDraftEpoch;
      const current=()=>owner===recoveryOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch&&api.get('calendar').form===recoveryForm;
      try{
        const receipts=await readCreations();if(!current())return;const confirmed=receipts.filter(row=>row.status==='saved');
        for(const row of confirmed){if(!current())return;const result=await calendar.acknowledgeCreation({creationId:row.creationId});if(result.status!=='acknowledged')throw Error('Receipt acknowledgement unavailable');}
        if(!current())return;
        if(confirmed.length)api.toast('Previous event creation confirmed. No event was recreated.');
        await refresh(false,true);
        if(current()&&creationPending?.some(row=>row.status!=='saved'))api.toast('A previous event may exist. Check Calendar; it will not be retried.');
      }catch{if(current()){creationRecoveryFailed=true;api.toast('Calendar creation recovery unavailable. Nothing was retried.');api.set({});}}
    };
    out.separateCreation=()=>{
      if(!window.confirm('A previous event may already exist. Create a separate event with a new identity? The previous request will remain in recovery history.'))return;
      return newEvent(true);
    };
    if(out.f&&state.form){
      const f=state.form;
      const reviewedDate=reminderWallTime(Number(f.off||0),12);
      // Android events have no stable identity for a note link yet, so say so before Save rather than drop it silently.
      // An event Android Calendar saves (the guests, video or alert hand-off) carries no Alpha creationId,
      // so it cannot be linked back to its note.
      out.f.noteLinkNotice=f.origin&&!f.alphaReminderId&&f.cal!=='alpha-reminders'&&(!noteOriginSupported('event')||Capacitor.isNativePlatform()&&calendarNeedsHandoff(f))?'This event will not link back to the note on this phone.':'';
      out.f.nativeReviewDate=reviewedDate?reviewedDate.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}):'Choose a valid local date';
      const destinations=[{id:'local',name:(Capacitor.isNativePlatform()?'On this phone':'In this app')},...calendars.filter(c=>c.writable&&!c.local).map(c=>({id:c.id,name:c.name}))];
      out.f.cals=f.alphaCalendarId ? [{name:(Capacitor.isNativePlatform()?'On this phone':'In this app'),dot:'var(--acc)',css:'background:var(--fg);color:var(--bg)',pick:()=>{}}] : [...out.f.cals.filter((c:Bag)=>c.name==='Reminders'),...destinations.map(c=>({name:c.name,dot:'var(--acc)',css:f.cal===`native:${c.id}`?'background:var(--fg);color:var(--bg)':'background:var(--bg)',pick:()=>api.set({form:{...api.get('calendar').form,cal:`native:${c.id}`,alert:null}})}))];
      const deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
      const nativeOptions=Capacitor.isNativePlatform()&&!f.alphaCalendarId&&!!f.cal?.startsWith('native:');
      out.f.optionsAvailable=nativeOptions;
      out.f.allDay=!!f.allDay;out.f.zone=f.zone||deviceZone;
      out.f.toggleAllDay=()=>{const form=api.get('calendar').form;if(form)api.set({form:{...form,allDay:!form.allDay}});};
      out.f.zoneChoices=calendarZoneChoices(deviceZone,f.zone).map(zone=>({zone,label:zone===deviceZone?`${zone} (this phone)`:zone,on:(f.zone||deviceZone)===zone,pick:()=>{const form=api.get('calendar').form;if(form)api.set({form:{...form,zone}});}}));
      out.f.setZone=(event:Bag)=>{const zone=typeof event==='string'?event:event?.target?.value;const form=api.get('calendar').form;if(form&&calendarZoneChoices(deviceZone,form.zone).includes(zone))api.set({form:{...form,zone}});};
      // One tap to Android Calendar, prefilled; its editor owns the save.
      out.f.insertHandoff=async()=>{
        const current=api.get('calendar').form;if(!current?.title?.trim()||!Capacitor.isNativePlatform())return;
        let event;try{event=calendarOptionEvent({...current,repeat:current.repeat||'none'},deviceZone);}catch(error){api.toast((error as Error).message);return;}
        const guests=(current.who||[]).filter((who:unknown)=>typeof who==='string'&&/^[^\s@,;<>]+@[^\s@,;<>]+$/.test(who));
        try{
          const result=await calendar.insertHandoff({event:{...event,attendees:guests,alerts:current.alert!=null?[Number(current.alert)]:[]}});
          if(result.status==='opened'){owner&&(owner.calendarHandoffPending=true);api.toast(result.alertsPrefilled===false?'Opened in Android Calendar. Add the alert there, then save. Alpha cannot confirm the event was saved.':'Opened in Android Calendar. Save it there; Alpha cannot confirm the event was saved.');}
          else api.toast(result.status==='unavailable'?'No Android Calendar editor is installed. Nothing was saved.':'Android Calendar could not open this draft. Nothing was saved.');
        }catch{api.toast('Android Calendar could not open this draft. Nothing was saved.');}
      };
      // 0041 direct save: all-day, chosen zone or repeat, with provider readback of each field.
      const saveOptions=async(current:Bag,currentOwner:Bag)=>{
        let event;try{event=calendarOptionEvent(current,deviceZone);}catch(error){api.toast((error as Error).message);return;}
        const epoch=creationDraftEpoch;let submittedForm=current;
        const ownsForm=()=>owner===currentOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch&&api.get('calendar').form===submittedForm;
        currentOwner.calendarSaving=true;
        try{
          const permission=await calendar.requestAccess();if(!ownsForm())return;if(permission.status!=='granted'){api.toast('Calendar access was not granted. Nothing was saved.');return;}
          const previous=await readCreations();if(!ownsForm())return;
          if(previous.length&&!current.separateCreation){api.toast('Check previous event creation receipts before saving, or explicitly create a separate event.');api.set({});return;}
          const creationId=current.creationId||crypto.randomUUID();
          if(!current.creationId){submittedForm={...current,creationId};api.set({form:submittedForm});}
          const result=await calendar.saveOptions({creationId,separateCreation:current.separateCreation===true,calendarId:current.cal.slice(7),event});
          if(!ownsForm())return;
          if(result.status==='pending-creation'){await readCreations();api.toast('Another creation needs recovery. Nothing was retried.');api.set({});return;}
          if(result.status==='read-only'){api.toast('This calendar is read-only. Choose another calendar. Nothing was saved.');return;}
          if(result.status!=='saved'||result.creationId!==creationId)throw Error('Unconfirmed calendar write');
          const readback=await calendar.readOptions({id:result.id});
          if(readback.status!=='ready'||readback.allDay!==event.allDay||readback.timeZone!==event.timeZone||readback.rrule!==event.rrule)throw Error('Calendar readback mismatch');
          const targetDay=Number(current.off||0);
          currentOwner.calendarFormCommitted?.(api.get('calendar').form);
          api.set({form:null,open:null,day:targetDay,month:null});
          if(current.origin&&noteOriginSupported('event'))void rememberNoteOrigin('event',creationId,current.origin).then(linked=>{if(!linked&&owner===currentOwner&&currentOwner.live)api.toast('Event saved. The link to its note could not be saved.');});
          const ack=await calendar.acknowledgeCreation({creationId});if(ack.status!=='acknowledged')throw Error('Unconfirmed receipt acknowledgement');
          desired=rangeFor({...currentOwner.vget('calendar'),day:targetDay,month:null});await refresh(false,true);
          const saved=currentOwner.nativeCalendarRows?.find((e:Bag)=>e.alphaCalendarId===result.id);
          if(saved&&owner===currentOwner&&!document.hidden&&api.isActive()&&!api.get('calendar').form)api.set({open:saved.id,day:saved.off,openDay:saved.off});
          api.toast(event.allDay?'All-day event saved and verified in Android Calendar.':event.rrule?'Repeating event saved and verified in Android Calendar.':`Event saved in ${event.timeZone} and verified in Android Calendar.`);
        }catch{try{await readCreations();}catch{if(owner===currentOwner&&creationDraftEpoch===epoch){creationPending=null;creationRecoveryFailed=true;}}if(owner===currentOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch)api.toast('The calendar write was not confirmed. Check creation receipts before creating another event.');}
        finally{currentOwner.calendarSaving=false;if(owner===currentOwner)api.set({});}
      };
      if(f.cal?.startsWith('native:'))out.f.save=async()=>{
        if(owner?.calendarSaving)return;
        if(owner?.calendarWriteUncertain&&api.get('calendar').form?.alphaCalendarId){api.toast('Refresh device calendars and check the previous event before saving again.');return;}
        const current=api.get('calendar').form,currentOwner=owner;
        if(!current?.title?.trim()||!currentOwner)return;
        if(!Capacitor.isNativePlatform()&&current.allDay){api.toast('All-day events are saved in the Android app. Turn off All day and enter a start time to save here. Nothing was saved.');return;}
        if(Capacitor.isNativePlatform()&&calendarNeedsHandoff(current)){if(window.confirm('Guests, video calls and alerts are added in Android Calendar. Open it with this event filled in?'))await out.f.insertHandoff();return;}
        if(Capacitor.isNativePlatform()&&calendarUsesOptions(current,deviceZone)){
          if(current.alphaCalendarId){api.toast('Edit all-day, time-zone and repeating events in Android Calendar.');return;}
          await saveOptions(current,currentOwner);return;
        }
        const date=reminderWallTime(Number(current.off||0),Number(current.t)),end=reminderWallTime(Number(current.off||0),Number(current.t)+Number(current.d));
        const timeProblem=calendarFormTimeProblem(date,end,Number(current.d));if(timeProblem||!date||!end){api.toast(timeProblem);return;}
        const epoch=creationDraftEpoch;let submittedForm=current;
        const ownsForm=()=>owner===currentOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch&&api.get('calendar').form===submittedForm;
        currentOwner.calendarSaving=true;
        try{
          const permission=await calendar.requestAccess();if(!ownsForm())return;if(permission.status!=='granted'){api.toast('Calendar access was not granted. Nothing was saved.');return;}
          let creationId:string|undefined;
          if(!current.alphaCalendarId){
            const previous=await readCreations();
            if(!ownsForm())return;
            if(previous.length&&!current.separateCreation){api.toast('Check previous event creation receipts before saving, or explicitly create a separate event.');api.set({});return;}
            creationId=current.creationId||crypto.randomUUID();
            if(!current.creationId){submittedForm={...current,creationId};api.set({form:submittedForm});}
          }
          const result=await calendar.save({creationId,separateCreation:current.separateCreation===true,id:current.alphaCalendarId || '',expected:current.expected,calendarId:current.cal.slice(7),title:current.title.trim(),body:current.notes||'',location:current.where||'',begin:date.getTime(),end:end.getTime(),...(!Capacitor.isNativePlatform()?{repeat:current.repeat,who:current.who||[],video:!!current.video,alert:current.alert??null,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}:{})});
          if(!ownsForm())return;
          if(result.status==='pending-creation'){await readCreations();api.toast('Another creation needs recovery. Nothing was retried.');api.set({});return;}
          if(result.status==='conflict'){api.toast('This event changed. Reload it before editing. Nothing was overwritten.');return;}
          if(result.status!=='saved')throw Error('Unconfirmed calendar write');
          if(creationId&&result.creationId!==creationId)throw Error('Mismatched creation receipt');
          // A new event from a note draft keeps a link to that note, keyed by its creationId on Android
          // (provider row ids can be reused) and by its id in the browser calendar. The event is
          // already saved either way.
          if(creationId&&current.origin&&noteOriginSupported('event'))void rememberNoteOrigin('event',Capacitor.isNativePlatform()?creationId:String(result.id),current.origin).then(linked=>{if(!linked&&owner===currentOwner&&currentOwner.live)api.toast('Event saved. The link to its note could not be saved.');});
          const targetDay=Number(current.off||0);
          // Retire only this exact submitted draft before an acknowledgement can be lost.
          currentOwner.calendarFormCommitted?.(api.get('calendar').form);
          api.set({form:null,open:null,day:targetDay,month:null});
          const ownsCompletion=()=>owner===currentOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch&&!api.get('calendar').form&&!api.get('calendar').open&&Number(api.get('calendar').day||0)===targetDay&&api.get('calendar').month==null;
          // Edits have not yielded since ownsForm: React may not have committed form:null yet.
          // Creation acknowledgement yields, so recheck its completion before starting refresh.
          if(creationId){const ack=await calendar.acknowledgeCreation({creationId});if(ack.status!=='acknowledged')throw Error('Unconfirmed receipt acknowledgement');if(!ownsCompletion())return;}
          desired=rangeFor({...currentOwner.vget('calendar'),day:targetDay,month:null});await refresh(false,true);
          if(!ownsCompletion())return;
          const saved=currentOwner.nativeCalendarRows?.find((e:Bag)=>e.alphaCalendarId===result.id);
          if(saved)api.set({open:saved.id,day:saved.off,openDay:saved.off});
          api.toast(Capacitor.isNativePlatform()?'Event saved and verified in Android Calendar.':'Event saved.');
        }catch{if(current.alphaCalendarId)currentOwner.calendarWriteUncertain=true;else{try{await readCreations();}catch{if(owner===currentOwner&&creationDraftEpoch===epoch){creationPending=null;creationRecoveryFailed=true;}}}if(owner===currentOwner&&!document.hidden&&api.isActive()&&creationDraftEpoch===epoch)api.toast('The calendar write was not confirmed. Check creation receipts before creating another event.');}
        finally{currentOwner.calendarSaving=false;if(owner===currentOwner)api.set({});}
      };
    }
    const selected=providerState.events?.find((e:Bag)=>e.id===state.open);
    if(selected?.alphaCalendarId&&out.ev){
      const key=JSON.stringify([selected.id,selected.nativeEvent]);
      if(agentSelectionKey!==key){agentSelectionKey=key;agentSelection=undefined;const token=++agentSelectionEpoch,currentOwner=owner,event=selected.nativeEvent;queueMicrotask(async()=>{try{const request={id:event.id,calendarId:event.calendarId,expected:{title:event.title||'',body:event.body||'',location:event.location||'',begin:event.begin,end:event.end}};let value=await calendar.inspect(request);if(Capacitor.isNativePlatform()&&value.status!=='ready')value=await calendar.inspectDeletion(request);if(owner===currentOwner&&token===agentSelectionEpoch&&api.get('calendar').open===selected.id&&value.status==='ready'){agentSelection={kind:'calendar-event',id:value.eventId||event.id,open:selected.id,revision:value.revision,accountId:event.calendarId,sourceRevision:value.sourceRevision};api.set({nativeAgentRevision:value.revision});}}catch{}});}
      out.ev.close=()=>{agentSelection=undefined;agentSelectionKey='';agentSelectionEpoch++;api.set({open:null,openDay:null,day:calendarReturnDay(Number(state.day||0),state.openDay??state.day??selected.off)});};
      if(selected.allDay){
        out.ev.when='All day';
        const options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'};
        const first=new Date(selected.nativeEvent.begin).toLocaleDateString(undefined,options),last=new Date(selected.nativeEvent.end-DAY).toLocaleDateString(undefined,options);
        out.ev.day=first===last?first:`${first} – ${last}`;
      }
      if(!selected.allDay){
        const begin=new Date(selected.nativeEvent.begin),end=new Date(selected.nativeEvent.end);
        const crossDate=civilDay(begin)!==civilDay(end),offsetChanged=begin.getTimezoneOffset()!==end.getTimezoneOffset();
        const time=(date:Date)=>date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
        const date=(value:Date)=>value.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
        const offset=(value:Date)=>{const minutes=-value.getTimezoneOffset();return `UTC${minutes<0?'-':'+'}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')}:${String(Math.abs(minutes)%60).padStart(2,'0')}`;};
        // Never derive a provider event's end from a clamped layout duration.
        const distortedEnd=Math.round((selected.t+selected.d)*60)%1440!==end.getHours()*60+end.getMinutes();
        if(crossDate||offsetChanged||distortedEnd)out.ev.when=`${time(begin)}${offsetChanged?' '+offset(begin):''} – ${time(end)}${offsetChanged?' '+offset(end):''}`;
        if(crossDate)out.ev.day=`${date(begin)} – ${date(end)}`;
      }
      out.ev.calName=calendars.find(c=>c.id===selected.nativeEvent.calendarId)?.name||'Android Calendar';
      // The location hand-off names this event so Maps can offer an explicit way back to it.
      if(selected.where&&selected.where!=='Phone'){const fromEvent=mapsEventOriginFor(selected,state.openDay??state.day??selected.off);out.ev.goWhere=()=>api.open('maps',{query:selected.where,...(fromEvent?{fromEvent}:{})});}
      const external=()=>void calendar.open({id:selected.alphaCalendarId,begin:selected.nativeEvent.begin,end:selected.nativeEvent.end}).catch(()=>api.toast('Android Calendar could not open this event.'));
      // Complex edits keep their native recurrence and account semantics.
      out.ev.edit=async()=>{
        const event=selected.nativeEvent,source=calendars.find(c=>c.id===event.calendarId);
        const begin=new Date(event.begin),end=new Date(event.end);
        const representedBegin=reminderWallTime(selected.off,selected.t),representedEnd=reminderWallTime(selected.off,selected.t+selected.d);
        const complex=civilDay(begin)!==civilDay(end)||begin.getTimezoneOffset()!==end.getTimezoneOffset()||representedBegin?.getTime()!==event.begin||representedEnd?.getTime()!==event.end;
        if(!Capacitor.isNativePlatform()&&(event.seriesId||event.allDay||complex)){
          try{const result=await calendar.edit({id:event.id,revision:event.revision,people:out.attendeeChoices||[]});if(result.status==='saved'){api.set({open:null,openDay:null});await refresh(false,true);api.toast('Event saved.');}}catch{api.toast('This event changed or could not be opened. Refresh and try again.');}return;
        }
        if(!source?.local||source.account!=='Alpha Phone'||event.recurring||event.allDay||complex){
          api.toast('Edit this event in Android Calendar to preserve its dates and time zone.');external();return;
        }
        const expected={title:event.title||'',body:event.body||'',location:event.location||'',begin:event.begin,end:event.end};
        const currentOwner=owner;
        try {
          const inspected=await calendar.inspect({id:event.id,calendarId:event.calendarId,expected});
          if(owner!==currentOwner||api.get('calendar').open!==selected.id)return;
          if(inspected.status==='external'){api.toast('Edit this event in Android Calendar.');external();return;}
          if(inspected.status!=='ready'){api.toast('This event changed or access is unavailable. Refresh before editing.');await refresh(false,true);return;}
          api.set({form:{...selected,id:selected.id,alphaCalendarId:event.id,expected:{...expected,revision:inspected.revision},cal:`native:${event.calendarId}`,video:!Capacitor.isNativePlatform()&&!!event.video,who:!Capacitor.isNativePlatform()?event.who||[]:[],repeat:'none',alert:!Capacitor.isNativePlatform()?event.alert??null:null}});
        }catch{api.toast('Calendar review unavailable. Nothing was changed.');}
      };
      if(!Capacitor.isNativePlatform()&&selected.nativeEvent.seriesId){
        out.ev.day+=' · Repeating event · edits and deletion apply to this occurrence';out.ev.browserSeries=true;
        const seriesAction=async(remove:boolean)=>{try{const event=selected.nativeEvent;const result=await (remove?calendar.removeSeries({id:event.id,revision:event.revision}):calendar.editSeries({id:event.id,revision:event.revision,people:out.attendeeChoices||[]}));if(result.status==='queued'){api.set({open:null,openDay:null});refreshDeletionViews();api.toast('Deletion queued. Undo is available for 10 seconds.');}else if(result.status==='saved'||result.status==='deleted'){api.set({open:null,openDay:null});await refresh(false,true);}else if(result.status==='conflict')api.toast('This series changed. Refresh and try again.');}catch{api.toast('The series could not be changed. Refresh and try again.');}};
        out.ev.editSeries=()=>void seriesAction(false);out.ev.deleteSeries=()=>void seriesAction(true);
      }
      if(!Capacitor.isNativePlatform())out.ev.people=(out.ev.people||[]).map((person:Bag,index:number)=>{const event=selected.nativeEvent,id=event.who?.[index],labels:Record<string,string>={added:'Added',invited:'Invited',yes:'Going',maybe:'Maybe',no:'Declined'};return {...person,st:labels[event.responses?.[id]||'added'],canRespond:true,response:async()=>{try{const result=await calendar.editResponse({id:event.id,revision:event.revision,person:id,name:person.name});if(result.status==='saved')await refresh(false,true);}catch{api.toast('This guest list changed. Reopen the event.');}}};});
      if(!Capacitor.isNativePlatform()&&selected.nativeEvent.video)out.ev.join=()=>void calendar.joinMeeting({id:selected.nativeEvent.id,revision:selected.nativeEvent.revision,people:(out.ev.people||[]).map((person:Bag)=>person.name)}).catch(()=>api.toast('This meeting changed. Reopen the event.'));
      out.ev.busy=Boolean(owner?.calendarSaving||owner?.calendarWriteUncertain);
      const deleteSelection=async(scope?:'series')=>{
        if(!owner||owner.calendarSaving||owner.calendarWriteUncertain)return;
        const currentOwner=owner,event=selected.nativeEvent,expected={title:event.title||'',body:event.body||'',location:event.location||'',begin:event.begin,end:event.end};
        currentOwner.calendarSaving=true;api.set({});let dispatched=false;
        try{
          const inspected=await (Capacitor.isNativePlatform()?calendar.inspectDeletion({id:event.id,calendarId:event.calendarId,expected,...(scope?{scope}:{})}):calendar.inspect({id:event.id,calendarId:event.calendarId,expected}));
          if(owner!==currentOwner||api.get('calendar').open!==selected.id)return;
          if(inspected.status==='external'){api.toast('Manage deletion and recurrence in Android Calendar. No event was deleted here.');external();return;}
          if(inspected.status!=='ready'){api.toast('This event changed or access is unavailable. Refresh before deleting.');await refresh(false,true);return;}
          dispatched=true;
          const result=await (Capacitor.isNativePlatform()?calendar.removeScoped({eventId:inspected.eventId,sourceId:inspected.sourceId,sourceRevision:inspected.sourceRevision,revision:inspected.revision}):calendar.remove({id:event.id,calendarId:event.calendarId,expected,revision:inspected.revision}));
          if(owner!==currentOwner)return;
          if(result.status==='queued'){const current=api.get('calendar');if(!document.hidden&&api.isActive()&&current.open===selected.id&&!current.form){api.set({open:null,openDay:null});api.toast('Deletion queued. Undo is available for 10 seconds.');}refreshDeletionViews();}
          else if(result.status==='deleted'){
            const linked=Capacitor.isNativePlatform()?eventNoteOriginId(event):!event.seriesId&&!/:occ:-?\d+$/.test(String(event.id))?String(event.id):undefined;
            if(linked)void forgetNoteOrigin('event',linked);
            // The receipt belongs to the deleted event, not a newer detail or draft.
            const current=api.get('calendar');
            if(!document.hidden&&api.isActive()&&current.open===selected.id&&!current.form){
              api.set({open:null,openDay:null});api.toast('Local event deleted and verified.');
            }
            await refresh(false,true);
          }
          else if(result.status==='conflict'){api.toast('This event changed. Nothing was deleted.');await refresh(false,true);}
          else if(result.status==='unknown'){currentOwner.calendarWriteUncertain=true;api.toast('Deletion could not be confirmed. Refresh and check before another change.');}
          else if(result.status!=='cancelled')api.toast('Calendar deletion unavailable. Nothing was deleted.');
        }catch{if(dispatched){currentOwner.calendarWriteUncertain=true;api.toast('Deletion could not be confirmed. Refresh and check before another change.');}else api.toast('Calendar review unavailable. Nothing was changed.');}
        finally{currentOwner.calendarSaving=false;if(owner===currentOwner)api.set({});}
      };
      out.ev.del=()=>deleteSelection();
      if(Capacitor.isNativePlatform()&&selected.nativeEvent.recurring){out.ev.browserSeries=true;out.ev.day+=' · Repeating event · deletion applies to this occurrence';out.ev.deleteSeries=()=>deleteSelection('series');out.ev.editSeries=()=>{api.toast('Edit recurrence in Android Calendar.');external();};}
    }
    return out;
  };
}
