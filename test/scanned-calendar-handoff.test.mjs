import {buildSync} from 'esbuild';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import test from 'node:test';
import vm from 'node:vm';
import * as reminderJournal from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';

const helperBundle=buildSync({stdin:{contents: "export * from './apps/app/src/prototype/calendar-form-inputs';export {cancellationModeForEditorEvent} from './.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-policy';export {canonicalCalendarEditorTiming} from './apps/app/src/runtime/agent-calendar-view';export {calendarIntervalDetail} from './apps/app/src/prototype/calendar-interval-presentation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const helperModule={exports:{}};new Function('module','exports',helperBundle.outputFiles[0].text)(helperModule,helperModule.exports);
const helpers=helperModule.exports;

// Execute the complete adapter with only its platform/service dependencies
// replaced. No Calendar write API is supplied: handoff must only open a form.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
function fixture({status='ready',sources=1,authority='canonical',platform='web',form=null,provider='eliza',recordPort=null,pendingText=()=> 'Synthetic pending',testMocks=false,calendars=null,empty=false,events=[],error=null,row=e=>({id:e.id,title:e.title}),created=null,remembered=null}={}){
 const state={status,ownerKey:'owner-A',savedAt:null,error,feed:{events:events.map(event=>({attendees:[],...event}))},calendars:calendars??Array.from({length:sources},(_,i)=>({summary:`Source ${i}`,provider,side:'owner',grantId:provider==='eliza'?'eliza-calendar':'google-grant',calendarId:provider==='eliza'&&i===0?'primary':String(i),includeInFeed:true,accessRole:'owner'}))};
 const refreshes=[],creates=[],updates=[],listeners={};let published;
 class Calendar{state=state;subscribe(fn){published=fn;return()=>{};}refresh(window){refreshes.push(window);}create(sourceKey,input){creates.push({sourceKey,input});return {outcome:'created',event:created};}update(eventKey,providerVersion,input){updates.push({eventKey,providerVersion,input});return {outcome:'updated',event:null};}invalidateNext(){state.nextFresh=false;if(state.next?.event&&Date.parse(state.next.event.endAt)<=Date.now())state.next=null;}retire(){}selection(){}sourceHandle(key){return 'handle:'+key;}sourceKeyForHandle(handle){return handle.slice('handle:'.length);}}
 const connection={subscribe:()=>()=>{},getAppRecordClient:()=>recordPort,getSnapshot:()=>({cloudAccount:null,residentSavedCredential:false})};
 const install=new Function('AgentCalendar','Capacitor','connectionController','calendarSourceKey','presentCalendarIntervals','calendarFormCreate','getZonedDateParts','addDaysToLocalDate','calendarOwnerKey','agentPendingText','testMocksEnabled','canonicalCalendarRow','calendarRange','calendarEventKey','eventEditorMutability','calendarFormPatch','rememberNoteOrigin','calendarFormMinutes','browserCloudResidentEnabled','calendarDefaultEventStart','canonicalCalendarEditorTiming','calendarGuestEmail','calendarIntervalDetail','cancellationModeForEditorEvent',code+';return installAgentCalendarAdapter;')(Calendar,{getPlatform:()=>platform,isNativePlatform:()=>platform==='android'},connection,c=>c.calendarId,()=>{},draft=>draft,()=>({}),()=>({}),target=>target.fixtureOwnerKey??state.ownerKey,pendingText,testMocks,row,records=>({events:records}),event=>event.id,()=>({kind:'editable',providerVersion:'version-1'}),draft=>draft,async(...args)=>{remembered?.push(args);return true;},hours=>Math.round(Number(hours)*60),false,helpers.calendarDefaultEventStart,helpers.canonicalCalendarEditorTiming,helpers.calendarGuestEmail,helpers.calendarIntervalDetail,helpers.cancellationModeForEditorEvent);

 const opened=[];const calendar={calendarAuthority:authority,form};
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){}vget(){return calendar;}vset(_view,patch){Object.assign(calendar,patch);}openView(...args){opened.push(args);}setState(){}}
 const views={calendar:{render:state=>({empty,emptyText:'Free all day',renderedRows:state.events,...(state.open?{ev:{}}:{}),f:{cals:(state.canonicalCalendars??[]).map(c=>({...c,pick:()=>{}})),repeats:[{label:'Weekly'}],alerts:[{label:'10 min'}]}})}};install(Shell,views,{});
 const oldWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={hidden:false,addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type,fn){if(listeners[type]===fn)delete listeners[type];}};
 const shell=new Shell();try{shell.componentDidMount();}finally{globalThis.window=oldWindow;}
 return {shell,opened,state,calendar,views,refreshes,creates,updates,listeners,publish:()=>published()};
}
const draft={id:null,creationId:'scan-operation',title:'Reviewed event',notes:'Exact OCR text',off:2,t:18.5,d:1.5,where:'Main hall',cal:'native:local',repeat:'none',allDay:false};
test('scanned event binds to current canonical owner and source without saving',()=>{
 const f=fixture({recordPort:availablePort});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);
 const [view,payload]=f.opened[0];assert.equal(view,'calendar');
 assert.equal(payload.form.canonicalOwnerKey,'owner-A');assert.equal(payload.form.cal,'handle:primary');
 for(const field of ['title','notes','off','t','d','where','repeat','allDay'])assert.equal(payload.form[field],draft[field]);
 assert.notEqual(payload.form.creationId,draft.creationId);assert.equal(draft.cal,'native:local');
});
test('multiple authorized sources still default a new Alpha draft to the canonical Eliza primary',()=>{
 const f=fixture({recordPort:availablePort,sources:2});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form.cal,'handle:primary');
});
test('unavailable sources, preservation review and existing drafts retain camera review',()=>{
 for(const options of [{sources:0},{status:'disconnected'},{status:'transition-required'},{status:'legacy-recovery'},{authority:'legacy'},{form:{title:'Keep me'}}]){
  const f=fixture({recordPort:availablePort,...options});assert.equal(f.shell.reviewScannedCalendarDraft(draft),false,JSON.stringify(options));assert.deepEqual(f.opened,[]);
 }
});
test('a scan cannot open Calendar without its exact current owner',()=>{
 for(const recordPort of [null,{...availablePort,current:()=>false},{...availablePort,fixtureOwnerKey:'owner-B'}]){
  const f=fixture({recordPort});
  assert.equal(f.shell.reviewScannedCalendarDraft(draft),false);
  assert.deepEqual(f.opened,[]);
 }
});
test('Google sources never replace the canonical Eliza destination for a new Alpha draft',()=>{
 const source=(calendarId,includeInFeed,accessRole)=>({summary:calendarId,provider:'google',side:'owner',grantId:'google-grant',calendarId,includeInFeed,accessRole});
 const local={summary:'Calendar',provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId:'primary',includeInFeed:true,accessRole:'owner'};
 const f=fixture({recordPort:availablePort,calendars:[local,source('owner',true,'owner'),source('holidays',true,'reader'),source('birthdays',false,'owner')]});
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form.cal,'handle:primary');
 assert.deepEqual(f.views.calendar.displaySources().sources.map(row=>[row.name,row.on,row.writable]),[['Calendar',true,true],['owner',true,true],['holidays',true,false]]);
 const googleOnly=fixture({recordPort:availablePort,calendars:[source('owner',true,'owner')]});assert.equal(googleOnly.shell.reviewScannedCalendarDraft(draft),false,'no direct Google fallback');
});
test('a saved "Previously connected calendars" choice reopens the one merged Calendar',()=>{
 const f=fixture({recordPort:availablePort,authority:'legacy-google'});assert.equal(f.calendar.calendarAuthority,'canonical');
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].calendarAuthority,'canonical');
});
test('explicit Android Calendar handoff preserves the native draft',()=>{
 const f=fixture({authority:'android-native',platform:'android',status:'disconnected',sources:0});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form,draft);assert.equal(f.opened[0][1].calendarAuthority,'android-native');
});
test('Calendar is read again on return to the foreground and when the next event ends',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-27T09:00:00Z')});
 const f=fixture();assert.equal(f.refreshes.length,1);
 document.hidden=true;f.listeners.visibilitychange();assert.equal(f.refreshes.length,1,'nothing is read in the background');
 document.hidden=false;f.listeners.visibilitychange();assert.equal(f.refreshes.length,2);
 f.state.next={event:{endAt:'2026-10-27T09:30:00Z'}};f.publish();f.publish();
 t.mock.timers.tick(30*60_000+999);assert.equal(f.refreshes.length,2,'the agent may still count the event until its end');
 t.mock.timers.tick(1);assert.equal(f.refreshes.length,3,'one read a second after the Home card event ends');
 f.state.next={event:{endAt:'2026-10-27T09:00:00Z'}};f.publish();t.mock.timers.tick(24*3600_000);assert.equal(f.refreshes.length,3,'an ended event arms nothing');
 const listener=f.listeners.visibilitychange;globalThis.window={removeEventListener(){}};try{f.shell.componentWillUnmount();}finally{delete globalThis.window;}assert.equal(f.listeners.visibilitychange,undefined);listener();assert.equal(f.refreshes.length,3);
});
test('event end while hidden invalidates the card and waits for one foreground read',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-27T09:00:00Z')});
 const f=fixture();f.state.next={event:{endAt:'2026-10-27T09:01:00Z'}};f.state.nextFresh=true;f.publish();document.hidden=true;t.mock.timers.tick(61_000);
 assert.equal(f.refreshes.length,1);assert.equal(f.state.next,null);assert.equal(f.state.nextFresh,false);document.hidden=false;f.listeners.visibilitychange();assert.equal(f.refreshes.length,2);
 globalThis.window={removeEventListener(){}};try{f.shell.componentWillUnmount();}finally{delete globalThis.window;}
});
test('only supported sources offer Repeat and unsupported event-alert controls stay absent',()=>{
 for(const provider of ['eliza','google']){const f=fixture({provider}),out=f.views.calendar.render({form:{id:null,cal:provider==='eliza'?'handle:primary':'handle:0',canonicalOwnerKey:'owner-A',repeat:'none'}},{set(){},toast(){}});assert.deepEqual(out.f.repeats,provider==='eliza'?null:[{label:'Weekly'}]);assert.equal(out.f.alerts,null);}
});
test('unsupported retained recurrence refuses without saving or altering the draft; an existing Google event keeps the rule',async()=>{
 for(const provider of ['eliza','google']){
  const existing={id:'google-event',provider:'google',side:'owner',grantId:'google-grant',calendarId:'0',recurrence:['RRULE:FREQ=WEEKLY'],startAt:'2026-10-31T12:00:00Z',endAt:'2026-10-31T13:00:00Z'},f=fixture({provider,events:provider==='google'?[existing]:[]}),toasts=[];
  const form={id:provider==='google'?'google-event':null,cal:provider==='eliza'?'handle:primary':'handle:0',canonicalOwnerKey:'owner-A',canonicalEventKey:'google-event',expectedProviderVersion:'version-1',recurrenceScope:'series',creationId:'op',title:'Standup',off:0,t:9,d:1,zone:'UTC',canonicalTiming:[0,9,1,'UTC',false],repeat:'weekly',alert:null,who:[]},before=structuredClone(form);
  const out=f.views.calendar.render({form},{set(){},get:()=>({form}),toast:message=>toasts.push(message)});await out.f.save();assert.deepEqual(form,before);
  if(provider==='eliza'){assert.deepEqual(f.creates,[]);assert.deepEqual(toasts,["Agent Calendar can't repeat events. Remove the repeat to save."]);assert.equal(out.f.repeats[0].label,'No repeat');}
  else{assert.deepEqual(toasts,[]);assert.equal(f.creates.length,0);assert.deepEqual(f.updates.map(change=>change.input.recurrence),[['RRULE:FREQ=WEEKLY']]);assert.equal(f.updates[0].eventKey,'google-event');}
 }
});
test('the owner can explicitly remove a retained repeat before saving a once-only event',async()=>{
 const f=fixture(),original={id:null,cal:'handle:primary',canonicalOwnerKey:'owner-A',creationId:'op',title:'Standup',off:0,t:9,d:1,repeat:'weekly',alert:null,who:[]};let form=original;const toasts=[],api={set:patch=>form=patch.form,get:()=>({form}),toast:message=>toasts.push(message)};
 const review=f.views.calendar.render({form},api);assert.equal(f.creates.length,0);review.f.repeats[0].pick();assert.equal(original.repeat,'weekly');assert.equal(form.repeat,'none');const confirmed=f.views.calendar.render({form},api);assert.equal(confirmed.f.repeats,null);await confirmed.f.save();assert.deepEqual(toasts,[]);assert.equal(f.creates.length,1);assert.equal(f.creates[0].input.recurrence,undefined);
});
test('native Android Calendar keeps its own repeat and alert controls',()=>{
 const f=fixture({platform:'android',authority:'android-native'}),out=f.views.calendar.render({form:{repeat:'weekly'}},{set(){},toast(){}});assert.deepEqual(out.f.repeats,[{label:'Weekly'}]);assert.deepEqual(out.f.alerts,[{label:'10 min'}]);
});
test('New Event with no current port explains pending state and does not replace a retained draft',()=>{
 const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),pendingCode=stripTypeScriptTypes(source.slice(source.indexOf('export function residentPendingText('),source.indexOf('/** Passive surfaces')).replace(/^export /gm,''),{mode:'strip'});
 for(const [kind,expected] of [['starting',/starting/],['recovering',/stopped/],['offline',/^Calendar unavailable$/]])for(const recordPort of [null,{current:()=>false}]){
  const pendingText=new Function('state','residentAlwaysPresent','RESIDENT_RECOVERY_PENDING','PENDING_FALLBACK',pendingCode+';return agentPendingText;')({kind},kind!=='offline','Recovery review.','Unavailable.');
  const f=fixture({recordPort,pendingText}),before=structuredClone(f.calendar),toasts=[],api={get:()=>f.calendar,set:patch=>Object.assign(f.calendar,patch),toast:x=>toasts.push(x)};f.views.calendar.render(f.calendar,api).newEvent();assert.deepEqual(f.calendar,before);assert.deepEqual(f.creates,[]);assert.equal(toasts.length,1);assert.match(toasts[0],expected);
  f.calendar.form={title:'Keep my exact draft',repeat:'weekly',cal:'handle:0',canonicalOwnerKey:'owner-A'};const draft=f.calendar.form;f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form,draft);assert.match(toasts.at(-1),/^Finish current event$/);
 }
});
test('an available private Mac canonical port can open New Event and preserves an existing draft',()=>{
 const f=fixture({platform:'web',recordPort:{current:()=>true,identity:{origin:'http://localhost:5229',ownerId:'mac-owner',agentId:'mac-agent'}}}),toasts=[],api={get:()=>f.calendar,set:patch=>Object.assign(f.calendar,patch),toast:x=>toasts.push(x)};
 f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form.canonicalOwnerKey,'owner-A');assert.equal(f.creates.length,0);assert.deepEqual(toasts,[]);const draft=f.calendar.form;f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form,draft);assert.match(toasts.at(-1),/^Finish current event$/);
});
test('browser provider requires the test-mocks gate and a web platform',()=>{
 for(const options of [{testMocks:false,platform:'web'},{testMocks:true,platform:'android'}]){
  const f=fixture({...options,authority:'browser-local',status:'disconnected',sources:0});
  assert.equal(f.shell.reviewScannedCalendarDraft(draft),false);
  assert.deepEqual(f.opened,[]);
 }
 const f=fixture({testMocks:true,platform:'web',authority:'browser-local',status:'disconnected',sources:0});
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);
 assert.equal(f.opened[0][1].form,draft);
 assert.equal(f.opened[0][1].calendarAuthority,'browser-local');

});


const presentationEvent=(id,calendarId)=>({id,title:id,provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId,startAt:'2026-10-31T12:00:00Z',endAt:'2026-10-31T13:00:00Z'});
test('canonical feed ignores obsolete hidden preferences while preserving the saved bytes',()=>{
 const f=fixture({events:[presentationEvent('verified','primary'),presentationEvent('unverified','unknown')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.deepEqual(out.renderedRows.map(row=>row.id),['verified']);assert.equal(out.nativeStatusLabel,'Refresh Calendar');
 const prefs={'handle:primary':{on:false,color:'mut'}},saved=structuredClone(prefs),hidden=f.views.calendar.render({calPrefs:prefs},{});
 assert.deepEqual(hidden.renderedRows.map(row=>row.id),['verified']);assert.deepEqual(prefs,saved);assert.deepEqual(f.state,before);
});

const localSource={summary:'Calendar',provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId:'primary',includeInFeed:true,accessRole:'owner'};
const googleSource={summary:'Google',provider:'google',side:'owner',grantId:'google-grant',calendarId:'google',includeInFeed:true,accessRole:'owner'};
const availablePort={current:()=>true,identity:{origin:'http://localhost',ownerId:'owner',agentId:'agent'}};
const calendarApi=(f,toasts=[])=>({get:()=>f.calendar,set:patch=>Object.assign(f.calendar,patch),toast:text=>toasts.push(text)});
test('New Event selects Eliza even when Google is first and hides the redundant source picker',async()=>{
 const f=fixture({recordPort:availablePort,calendars:[googleSource,localSource]}),api=calendarApi(f);
 f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form.cal,'handle:primary');assert.equal(f.creates.length,0);
 const form=f.calendar.form;form.title='Local Alpha event';const rendered=f.views.calendar.render(f.calendar,api);assert.deepEqual(rendered.f.cals,[]);await rendered.f.save();
 assert.equal(f.creates.length,1);assert.equal(f.creates[0].sourceKey,'primary');assert.equal(f.creates[0].input.title,'Local Alpha event');
});
for(const [name,calendars]of [['missing',[googleSource]],['ambiguous',[localSource,{...localSource}]],['read only',[{...localSource,accessRole:'reader'}]],['excluded',[{...localSource,includeInFeed:false}]],['foreign side',[{...localSource,side:'counterparty'}]],['wrong grant',[{...localSource,grantId:'foreign'}]]])test(`new Alpha events refuse ${name} canonical authority without falling back to Google`,()=>{
 const f=fixture({recordPort:availablePort,calendars}),toasts=[],api=calendarApi(f,toasts);f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form,null);assert.equal(f.creates.length,0);assert.match(toasts[0],/^Not ready$/);assert.equal(f.shell.reviewScannedCalendarDraft(draft),false);
});
test('a retained Google new-event draft is preserved and cannot be silently created at Google',async()=>{
 const form={...draft,title:'Exact retained Google draft',cal:'handle:google',canonicalOwnerKey:'owner-A',alert:null,who:[]},f=fixture({recordPort:availablePort,form,calendars:[localSource,googleSource]}),toasts=[],api=calendarApi(f,toasts);
 await f.views.calendar.render(f.calendar,api).f.save();assert.equal(f.creates.length,0);assert.equal(f.calendar.form,form);assert.equal(form.cal,'handle:google');assert.match(toasts[0],/draft is kept/);
});
test('existing foreign event forms retain their source and recurrence choices',()=>{
 const form={...draft,id:'existing-google',cal:'handle:google',canonicalOwnerKey:'owner-A',repeat:'weekly'},f=fixture({form,calendars:[localSource,googleSource]});const out=f.views.calendar.render(f.calendar,calendarApi(f));assert.equal(form.cal,'handle:google');assert.equal(out.f.cals.length,2);assert.equal(out.f.repeats[0].label,'Weekly');assert.equal(f.creates.length,0);
});
test('backend-excluded Google sources stay excluded despite canonical visibility simplification',()=>{
 const event={...presentationEvent('excluded-google','google'),provider:'google',grantId:'google-grant'},f=fixture({calendars:[localSource,{...googleSource,includeInFeed:false}],events:[event]});const prefs={'handle:google':{on:true}},before=structuredClone(prefs);assert.deepEqual(f.views.calendar.render({calPrefs:prefs},{}).renderedRows,[]);assert.deepEqual(prefs,before);
});

test('a reader before Eliza cannot hide the retained-draft recovery choice or redirect its create',async()=>{
 const reader={...googleSource,summary:'Read-only calendar',calendarId:'reader',accessRole:'reader'},form={...draft,title:'Exact recovery draft',notes:'Keep these exact notes',cal:'handle:google',canonicalOwnerKey:'owner-A',alert:null,who:[]};
 const f=fixture({recordPort:availablePort,form,calendars:[reader,localSource,googleSource]}),toasts=[],api=calendarApi(f,toasts),out=f.views.calendar.render(f.calendar,api);
 assert.deepEqual(out.f.cals.map(choice=>choice.id),['handle:primary'],'writable filtering must not shift the canonical identity');assert.equal(f.calendar.form.cal,'handle:google');assert.equal(f.creates.length,0);
 out.f.cals[0].pick();assert.equal(f.calendar.form.cal,'handle:primary');assert.equal(f.calendar.form.title,'Exact recovery draft');assert.equal(f.calendar.form.notes,'Keep these exact notes');assert.equal(form.cal,'handle:google','the retained draft is not silently rewritten before the explicit choice');
 const recovered=f.views.calendar.render(f.calendar,api);assert.deepEqual(recovered.f.cals,[]);await recovered.f.save();assert.equal(f.creates.length,1);assert.equal(f.creates[0].sourceKey,'primary');assert.deepEqual(toasts,[]);
});

test('actual device and browser recovery choices preserve data and refuse an existing draft',()=>{
 for(const [authority,platform,testMocks]of [['android-native','android',false],['browser-local','web',true]]){
  const form={title:'Exact device draft',notes:'Do not lose'},f=fixture({authority,platform,testMocks,form}),toasts=[],api=calendarApi(f,toasts),events=[{id:'old-event'}],prefs={retained:{on:false}};f.calendar.events=events;f.calendar.calPrefs=prefs;
  f.views.calendar.render(f.calendar,api).calendarAuthorityChoices.find(c=>c.label==='Agent Calendar').go();assert.equal(f.calendar.calendarAuthority,authority);assert.equal(f.calendar.form,form);assert.match(toasts[0],/draft is kept/);
  f.calendar.form=null;f.views.calendar.render(f.calendar,api).calendarAuthorityChoices.find(c=>c.label==='Agent Calendar').go();assert.equal(f.calendar.calendarAuthority,'canonical');assert.equal(f.calendar.events,events);assert.equal(f.calendar.calPrefs,prefs);assert.equal(f.creates.length,0);assert.equal(f.updates.length,0);
 }
});

// Execute the REAL ReminderAdapter inner render, not a synthetic placeholder domain choice.
const realReminderCode=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/reminder-adapter.ts','utf8').replace(/^import .*?;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const reminderPresentationFile=readFileSync('apps/app/src/runtime/reminder-creations.ts','utf8');
const reminderPresentationCode=stripTypeScriptTypes(reminderPresentationFile.slice(reminderPresentationFile.indexOf('export function reminderEvents('),reminderPresentationFile.indexOf('/** Specific, stable reason')).replace(/^export /gm,''),{mode:'strip'});
function actualDomainFixture({withReminder=true,platform='android',calendars=[googleSource,localSource]}={}){
 const calendar={calendarAuthority:'canonical',form:null},calls={creates:[],nativeSchedules:0,destinationChanges:[]},state={ownerKey:'domain-owner',status:'ready',savedAt:null,feed:{events:[]},calendars};
 const cap={getPlatform:()=>platform,isNativePlatform:()=>platform==='android',isPluginAvailable:()=>true};
 class Canonical{state=state;subscribe(){return()=>{};}refresh(){}retire(){}invalidateNext(){}sourceHandle(key){return state.calendars.some(source=>source.calendarId===key)?'handle:'+key:undefined;}sourceKeyForHandle(handle){return handle?.slice('handle:'.length);}create(sourceKey,input){calls.creates.push({sourceKey,input});return {outcome:'created',event:null};}}
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){this.live=false;}vget(){return calendar;}vset(_,patch){Object.assign(calendar,patch);}setState(){}openView(){}goHome(){}back(){}toast(){}calendarFormDestinationChanged(original,next){calls.destinationChanges.push({original,next});return next;}}
 const views={calendar:{state:{},render:st=>({f:st.form?{cals:(st.canonicalCalendars??[]).map(c=>({...c,pick:()=>{}})),repeats:[],alerts:[]}:null})}};
 const connection={getSnapshot:()=>({open:true}),subscribe:()=>()=>{},getAppRecordClient:()=>({current:()=>true,identity:{origin:'http://localhost',ownerId:'owner',agentId:'agent'}})};
 const context={...helpers,Shell,views,AgentCalendar:Canonical,Capacitor:cap,connectionController:connection,calendarSourceKey:source=>source.calendarId,presentCalendarIntervals:()=>{},calendarFormCreate:form=>form,calendarFormMinutes:hours=>Math.round(Number(hours)*60),getZonedDateParts:()=>({year:2026,month:10,day:31}),addDaysToLocalDate:value=>value,calendarOwnerKey:()=>state.ownerKey,agentPendingText:()=>'',testMocksEnabled:platform==='web',canonicalCalendarRow:event=>({id:event.id,title:event.title}),calendarRange:records=>({events:records}),
  overdueReminders:reminderJournal.overdueReminders,undatedTodos:reminderJournal.undatedTodos,isUndatedReminder:reminderJournal.isUndatedReminder,dueOf:reminderJournal.reminderDueAt,
  reminderCreations:async()=>({}),reconcileReminderCreations:async()=>0,reconcileReminderDeletions:async()=>0,alphaClient:{getState:()=>({context:{sensitive:false}})},
  DailyApps:{surfaceInfo:async()=>({reminderTodoVersion:1}),listReminders:async()=>({reminders:[]}),addListener:async()=>({remove(){}}),scheduleReminder:async()=>{calls.nativeSchedules++;throw Error('No native scheduling in this composition test');}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},Date,crypto:globalThis.crypto,queueMicrotask,setTimeout,clearTimeout,AbortController,console,withReminder};
 vm.createContext(context);vm.runInContext(reminderPresentationCode+'\n'+realReminderCode+'\n'+code+`
if(withReminder)installReminderAdapter(Shell,views);
const actualInner=views.calendar.render;globalThis.lastReminderSave=null;views.calendar.render=function(st,api){const out=actualInner(st,api);if(st.form?.cal==='alpha-reminders')globalThis.lastReminderSave=out.f?.save;return out;};
installAgentCalendarAdapter(Shell,views,{});`,context);
 const shell=new Shell();shell.componentDidMount();const api={get:()=>calendar,set:patch=>Object.assign(calendar,patch),toast:()=>{},isActive:()=>true};
 return {calendar,calls,state,views,context,shell,api,render:()=>views.calendar.render(calendar,api),close:()=>shell.componentWillUnmount()};
}
test('real inner ReminderAdapter keeps Event and Reminder choices through the outer canonical adapter',async()=>{
 const main=readFileSync('apps/app/src/main.tsx','utf8');assert(main.indexOf('installReminderAdapter(Component')<main.indexOf('installAgentCalendarAdapter(Component'),'actual install order');
 const f=actualDomainFixture();
 try{
  f.render().newEvent();assert.equal(f.calendar.form.cal,'handle:primary');f.calendar.form.title='Exact product type draft';f.calendar.form.notes='Exact retained notes';const original=f.calendar.form,out=f.render();
  assert.deepEqual(Array.from(out.f.cals,choice=>choice.name),['Event','Reminders']);assert.equal(out.f.cals.some(choice=>choice.id==='handle:google'),false,'no Google backend choice');
  const reminder=out.f.cals.find(choice=>choice.domain==='reminders');assert(reminder,'actual inner adapter generated this domain choice');reminder.pick();
  assert.equal(f.calendar.form.cal,'alpha-reminders');assert.equal(f.calendar.form.title,original.title);assert.equal(f.calendar.form.notes,original.notes);assert.equal(f.calls.destinationChanges.length,1);assert.equal(f.calls.creates.length,0);assert.equal(f.calls.nativeSchedules,0);
  const nativeForm=f.render();assert.equal(nativeForm.f.save,f.context.lastReminderSave,'outer adapter must preserve the actual reminder save and draft fences');
 }finally{f.close();}
 const event=actualDomainFixture();try{event.render().newEvent();event.calendar.form.title='One Eliza event';await event.render().f.save();assert.equal(event.calls.creates.length,1);assert.equal(event.calls.creates[0].sourceKey,'primary');assert.equal(event.calls.nativeSchedules,0);}finally{event.close();}
});
test('a new Event without an exposed reminder domain still hides its backend picker',async()=>{
 const f=actualDomainFixture({withReminder:false,platform:'web'});try{f.render().newEvent();assert.equal(f.calendar.form.cal,'handle:primary');assert.equal(f.render().f.cals.length,0);assert.equal(f.calls.creates.length,0);}finally{f.close();}
});

test('missing canonical authority never relabels the real Reminder choice as an Event fallback',()=>{
 const f=actualDomainFixture({calendars:[googleSource]});try{
  const form={id:null,title:'Exact retained Google draft',notes:'Do not retarget',cal:'handle:google',canonicalOwnerKey:f.state.ownerKey,repeat:'none',alert:null,who:[]};f.calendar.form=form;const out=f.render();
  assert.deepEqual(Array.from(out.f.cals,choice=>choice.name),['Reminders']);assert.equal(out.f.cals.some(choice=>choice.name==='Event'||choice.id==='handle:google'),false);assert.equal(f.calendar.form,form);assert.equal(form.cal,'handle:google');assert.equal(f.calls.creates.length,0);assert.equal(f.calls.nativeSchedules,0);
 }finally{f.close();}
});

// Ported from f728e137 (d47ec3c1 #767 sidefile) onto this fixture: the shared presentationEvent above
// and the canonical Eliza source id 'primary'. Its 'unverified rows ... display preferences are retained'
// test is not ported; 'canonical feed ignores obsolete hidden preferences' above supersedes it.
// Canonical warning presentation stays in the header, which keeps its retry action.
test('an empty partial Calendar offers refresh once without claiming no events',()=>{
 const f=fixture({status:'partial',empty:true}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'Refresh Calendar');
 assert.equal(typeof out.nativeStatusRetry,'function');
 assert.equal(out.empty,false);
 assert.doesNotMatch(out.emptyText,/No events/);
 assert.deepEqual(f.state,before);
 const template=readFileSync('apps/app/src/prototype/template.html','utf8');
 assert.ok(template.includes('aria-label="Retry calendar and reminders" aria-description="{{calendar.nativeStatusLabel}}"'));
 assert.ok(!template.includes('aria-label="{{calendar.nativeStatusLabel}} Retry calendar and reminders"'));
});
test('a verified empty Calendar retains its ordinary empty state',()=>{
 const f=fixture({status:'ready',empty:true}),out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'');assert.equal(out.empty,true);
 assert.equal(out.emptyText,'No events');
});
test('ready with an unverified event source offers refresh once and does not claim verified empty',()=>{
 const f=fixture({status:'ready',empty:true,events:[presentationEvent('unverified','unknown')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'Refresh Calendar');
 assert.deepEqual(out.renderedRows,[]);assert.equal(out.empty,false);
 assert.doesNotMatch(out.emptyText,/No events|Free all day/);assert.deepEqual(f.state,before);
});
test('unavailable uses natural recovery copy once and retry uses the existing refresh',()=>{
 const f=fixture({status:'unavailable',empty:true,error:'Implementation-only fallback'}),before=structuredClone(f.state),reads=f.refreshes.length;
 const out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'Unavailable');
 assert.equal(out.empty,false);assert.doesNotMatch(out.emptyText,/Implementation-only|Free all day|No events/);
 out.nativeStatusRetry();assert.equal(f.refreshes.length,reads+1);assert.deepEqual(f.state,before);
});
test('partial empty selected day cannot claim free even when another day has a verified event',()=>{
 const f=fixture({status:'partial',empty:true,events:[presentationEvent('verified elsewhere','primary')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({day:2},{});
 assert.deepEqual(out.renderedRows.map(row=>row.id),['verified elsewhere']);
 assert.equal(out.nativeStatusLabel,'Refresh Calendar');
 assert.doesNotMatch(out.emptyText,/Free all day|Free on these days|Nothing scheduled|No events/);
 assert.equal(out.empty,false);assert.deepEqual(f.state,before);
});
test('explicit legacy and transition recovery retain their existing empty-day presentation and actions',()=>{
 for(const options of [{authority:'legacy',status:'partial'},{authority:'legacy',status:'unavailable',error:'Saved calendar recovery detail'},{authority:'canonical',status:'transition-required'}]){
  const f=fixture({...options,empty:true});
  f.state.legacy={present:true,readable:true,records:[{id:'retained',title:'Retained event',begin:Date.parse('2026-10-31T12:00:00Z'),end:Date.parse('2026-10-31T13:00:00Z')} ]};
  const before=structuredClone(f.state),reads=f.refreshes.length,toasts=[];
  // Render the same persisted Calendar authority that the shell selected.
  const out=f.views.calendar.render(f.calendar, {toast:message=>toasts.push(message)});
  assert.equal(out.calendarSourceLabel,'Saved · Read only');
  if(options.error)assert.equal(out.nativeStatusLabel,options.error,'legacy recovery detail is retained');
  assert.equal(out.empty,true);assert.equal(out.emptyText,'Free all day','existing legacy renderer presentation is unchanged');
  assert.deepEqual(out.renderedRows.map(row=>row.id),['legacy-calendar:retained']);
  const canReview=options.status==='transition-required';
  assert.equal(out.canConfirmCalendarTransition,canReview);
  assert.equal(typeof out.confirmCalendarTransition,canReview?'function':'undefined');
  out.newEvent();assert.deepEqual(toasts,['Agent Calendar only']);
  assert.equal(f.refreshes.length,reads);assert.deepEqual(f.state,before);assert.deepEqual(f.creates,[]);
 }
});

// A note's Review event draft, admitted like a scan, saves to Agent Calendar and links the created event.
const noteOrigin={version:2,noteId:'note-1',revision:'a'.repeat(64)};
const noteDraft={id:null,title:'Venue plan',off:1,t:9,d:1,where:'',video:false,who:[],repeat:'none',notes:'Book the venue',origin:noteOrigin,creationId:'note-operation',separateCreation:false,cal:'native:local',alert:null};
test('a note event draft is admitted to Agent Calendar, saves, and links the created event to its note',async()=>{
 const remembered=[],created={id:'created-event',provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId:'primary'};
 const f=fixture({recordPort:availablePort,remembered,created});assert.equal(f.shell.reviewScannedCalendarDraft(noteDraft),true);
 const form=f.opened[0][1].form;assert.equal(form.canonicalOwnerKey,'owner-A');assert.equal(form.cal,'handle:primary');assert.deepEqual(form.origin,noteOrigin);
 f.calendar.form=form;const toasts=[],out=f.views.calendar.render(f.calendar,calendarApi(f,toasts));
 assert.equal(out.f.saveOff,false);await out.f.save();await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(toasts,[]);assert.equal(f.creates.length,1);assert.equal(f.calendar.form,null);
 assert.deepEqual(remembered,[['event','created-event',noteOrigin]],'linked by the same event key the note-origin lookup reads');
});
test('a tap on a disabled Save says why and writes nothing',async()=>{
 const f=fixture({remembered:[]}),toasts=[];f.calendar.form={...noteDraft,cal:'handle:primary'};
 const out=f.views.calendar.render(f.calendar,calendarApi(f,toasts));assert.equal(out.f.saveOff,true);
 await out.f.save();assert.deepEqual(toasts,['Other account']);assert.equal(f.creates.length,0);
});
const managedGrant='alpha-google:'+'b'.repeat(64);
const managedSource={summary:'Work',provider:'google',side:'owner',grantId:managedGrant,calendarId:'work',includeInFeed:true,accessRole:'owner'};
const managedEvent={id:'standup',provider:'google',side:'owner',grantId:managedGrant,calendarId:'work',title:'Standup',description:'',recurringEventId:'series-1',startAt:'2026-11-06T15:00:00Z',endAt:'2026-11-06T15:30:00Z'};
const detailRow=e=>({id:'canonical-calendar:'+e.id,canonicalEvent:e,canonicalEventKey:e.id,off:0,t:15,d:.5,title:e.title});
test('a managed Google event keeps Delete unavailable in the event menu',()=>{
 const template=readFileSync('apps/app/src/prototype/template.html','utf8');
 assert.match(template,/<sc-if value="\{\{calendar\.ev\.del\}\}"><button aria-label="\{\{calendar\.ev\.deleteLabel\}\}"/);
 assert.doesNotMatch(template,/\{\{calendar\.ev\.providerNotice\}\}/);
 for(const event of [managedEvent,{...managedEvent,recurringEventId:undefined}]){
  const f=fixture({calendars:[localSource,managedSource],events:[event],row:detailRow}),out=f.views.calendar.render({open:'canonical-calendar:standup'},calendarApi(f));
  assert.equal(out.ev.del,null);assert.equal(out.ev.providerNotice,'Open in Google');assert.deepEqual(out.ev.recurrenceScopes,[]);
 }
 // Other Google grants keep Delete and every series scope.
 const other={...managedEvent,grantId:'google-grant'},f=fixture({calendars:[localSource,{...managedSource,grantId:'google-grant'}],events:[other],row:detailRow}),out=f.views.calendar.render({open:'canonical-calendar:standup'},calendarApi(f));
 assert.equal(typeof out.ev.del,'function');assert.equal(out.ev.providerNotice,undefined);assert.deepEqual(out.ev.recurrenceScopes.map(scope=>scope.label),['This occurrence','This and following','Entire series']);
});
test('a repeating event chooses its occurrences in the delete action itself',()=>{
 const template=readFileSync('apps/app/src/prototype/template.html','utf8');
 // The single Delete is replaced by one action per scope; no separate scope row remains in the detail.
 assert.match(template,/<sc-if value="\{\{calendar\.ev\.singleDelete\}\}"><sc-if value="\{\{calendar\.ev\.del\}\}">/);
 assert.match(template,/<sc-if value="\{\{calendar\.ev\.scopedDelete\}\}"><sc-for list="\{\{calendar\.ev\.recurrenceScopes\}\}" as="scope"><button aria-label="\{\{scope\.deleteLabel\}\}" disabled="\{\{calendar\.ev\.busy\}\}" onClick="\{\{scope\.del\}\}">/);
 assert.doesNotMatch(template,/Repeating event action scope/);
 // An empty list is truthy to sc-if, so the form's scope group has its own flag.
 assert.match(template,/<sc-if value="\{\{calendar\.f\.hasRecurrenceScopes\}\}"><div role="group" aria-label="Save changes to"/);
 assert.match(readFileSync('apps/app/src/prototype/model.js','utf8'),/deleteText:'Delete',singleDelete:true/);
 const series={...managedEvent,grantId:'google-grant'},sources=[localSource,{...managedSource,grantId:'google-grant'}];
 const recurring=fixture({calendars:sources,events:[series],row:detailRow}).views.calendar.render({open:'canonical-calendar:standup'},{}).ev;
 assert.equal(recurring.scopedDelete,true);assert.equal(recurring.singleDelete,false);
 assert.deepEqual(recurring.recurrenceScopes.map(scope=>scope.deleteText),['Delete this occurrence','Delete this and following','Delete entire series']);
 assert.ok(recurring.recurrenceScopes.every(scope=>typeof scope.del==='function'&&scope.deleteLabel===scope.deleteText));
 const single=fixture({calendars:sources,events:[{...series,recurringEventId:undefined}],row:detailRow}).views.calendar.render({open:'canonical-calendar:standup'},{}).ev;
 assert.equal(single.scopedDelete,false);assert.equal(single.singleDelete,true);assert.equal(typeof single.del,'function');
 // A managed Google series offers no delete action of either kind.
 const managed=fixture({calendars:[localSource,managedSource],events:[managedEvent],row:detailRow}).views.calendar.render({open:'canonical-calendar:standup'},{}).ev;
 assert.equal(managed.del,null);assert.equal(managed.scopedDelete,false);
});
test('Save without a title says why and writes nothing',async()=>{
 const f=fixture({recordPort:availablePort,remembered:[]}),toasts=[];f.calendar.form={...noteDraft,canonicalOwnerKey:'owner-A',cal:'handle:primary',title:'  '};
 const out=f.views.calendar.render(f.calendar,calendarApi(f,toasts));assert.equal(out.f.saveOff,true);
 await out.f.save();assert.deepEqual(toasts,['Add a title']);assert.equal(f.creates.length,0);
});
test('a managed recurring Google event edits only this occurrence and hides the repeat editor',async()=>{
 const f=fixture({calendars:[localSource,managedSource],events:[managedEvent],row:detailRow}),api=calendarApi(f);
 f.views.calendar.render({open:'canonical-calendar:standup'},api).ev.edit();
 const form=f.calendar.form;assert.equal(form.recurrenceScope,'instance');assert.equal(form.repeat,'preserve');
 const out=f.views.calendar.render(f.calendar,api);assert.deepEqual(out.f.recurrenceScopes.map(scope=>scope.label),['This occurrence']);assert.equal(out.f.repeats,null);
 await out.f.save();assert.equal(f.updates.length,1);assert.equal(f.updates[0].input.recurrenceScope,'instance');assert.equal(f.updates[0].input.recurrence,undefined);
});
test('Calendar refusals show owner text without an "Error: " prefix',async()=>{
 for(const [thrown,shown] of [[Error('Calendar owner or agent changed'),'Changed'],[Error('Retain this draft operation key'),'Can’t save'],[Error('Review recurring-series changes in Calendar'),'Edit in Google'],[Error('Some host text.'),'Some host text.'],[{},'Couldn’t update']]){
  const f=fixture({recordPort:availablePort}),toasts=[];f.shell.agentCalendar.create=async()=>{throw thrown;};
  f.views.calendar.render(f.calendar,calendarApi(f,toasts)).newEvent();f.calendar.form.title='Lunch';
  await f.views.calendar.render(f.calendar,calendarApi(f,toasts)).f.save();assert.deepEqual(toasts,[shown]);
 }
});
// Legacy rows count civil days. The zone is fixed per process, so each case runs in its own child.
const legacyDays=readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8');
const legacyDayCode=stripTypeScriptTypes(legacyDays.slice(legacyDays.indexOf('const DAY=86400000;'),legacyDays.indexOf('export const nativeCalendarScope')).replace(/^export /gm,''),{mode:'strip'});
const inZone=(zone,expression)=>JSON.parse(execFileSync(process.execPath,['-e',`const legacyDayOffset=new Function(${JSON.stringify(legacyDayCode+';return legacyDayOffset;')})();console.log(JSON.stringify(${expression}))`],{env:{...process.env,TZ:zone},encoding:'utf8'}));
test('legacy rows keep their day across a spring DST change and for UTC-midnight all-day records',()=>{
 // New York, viewed on 1 March: an event at 09:00 on 10 March (after the 8 March change) is nine days ahead.
 assert.deepEqual(inZone('America/New_York',"[legacyDayOffset(new Date(2026,2,10,9).getTime(),false,new Date(2026,2,1,12)),legacyDayOffset(new Date(2026,2,10,10).getTime(),false,new Date(2026,2,1,12))]"),[9,9]);
 // Los Angeles: an all-day record for 10 March is stored as 2026-03-10T00:00Z and still shows on 10 March.
 assert.deepEqual(inZone('America/Los_Angeles',"[legacyDayOffset(Date.UTC(2026,2,10),true,new Date(2026,2,1,12)),legacyDayOffset(Date.UTC(2026,2,11),true,new Date(2026,2,1,12))]"),[9,10]);
});

test('canonical guest edits accept typed email, retain existing guest metadata and explicitly clear only reviewed lists',async()=>{
 const guest={email:'old@example.org',displayName:'Existing Guest',optional:true,self:false,organizer:false,responseStatus:'accepted'};
 for(const mode of ['unchanged','legacy-empty','clear','add']){
  const event={id:'guest-event',provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId:'primary',title:'Guests',description:'',location:'',startAt:'2027-06-10T13:00Z',endAt:'2027-06-10T14:00Z',isAllDay:false,attendees:[guest]},f=fixture({recordPort:availablePort,events:[event]}),timing=helpers.canonicalCalendarEditorTiming(event,'UTC');
  const form={id:'canonical-calendar:guest-event',canonicalOwnerKey:'owner-A',canonicalEventKey:event.id,expectedProviderVersion:'version-1',creationId:'guest-edit',title:'Guest metadata edit',notes:'',where:'',off:timing.off,t:timing.t,d:timing.d,zone:'UTC',canonicalTiming:[timing.off,timing.t,timing.d,'UTC',false],cal:'handle:primary',who:mode==='clear'||mode==='legacy-empty'?[]:mode==='add'?['old@example.org','NEW@example.org','new@example.org']:['old@example.org'],canonicalGuestsReviewed:mode!=='legacy-empty',repeat:'none',alert:null,video:false};
  f.calendar.form=form;const toasts=[],api=calendarApi(f,toasts);await f.views.calendar.render(f.calendar,api).f.save();assert.deepEqual(toasts,[],mode);assert.equal(f.updates.length,1,mode);
  const attendees=f.updates[0].input.attendees;
  if(mode==='unchanged'||mode==='legacy-empty')assert.equal(attendees,undefined,mode);
  else if(mode==='clear')assert.deepEqual(attendees,[]);
  else assert.deepEqual(attendees,[{email:'old@example.org',displayName:'Existing Guest',optional:true},{email:'NEW@example.org'}]);
 }
});
