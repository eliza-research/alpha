import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Actual Calendar renderer + local provider geometry + Google display adapter.
// No browser, credentials, provider requests, or local Calendar writes.
const model=readFileSync('apps/app/src/prototype/model.js','utf8');
const calendar=model.slice(model.indexOf('/* ===== module: calendar ===== */'),model.indexOf('/* ===== module: browser ===== */'));
const source=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/google-calendar-view-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
// Day columns: one day, as on a phone, unless a test asks for more.
const calendarDays=stripTypeScriptTypes('const currentSurfaceLayout=()=>({split:false,calendarDays:globalThis.calendarDayColumnsUnderTest||1});\n'+readFileSync('apps/app/src/prototype/calendar-days.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
// Month, Schedule and Search builders the renderer and the provider adapter share.
const calendarViews=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-views.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const nativeSource=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const at=(day,hour)=>new Date(2026,9,day,hour).getTime();
const instant=at(13,12);
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
const SOURCE='google:grant:calendar';
const event=(patch={})=>({id:`${SOURCE}:event`,calendarId:SOURCE,providerEventId:'event',title:'Owned Google event',body:'Owned body',location:'',begin:at(13,12),end:at(13,13),allDay:false,timeZone:'UTC',revision:'synthetic',source:'google',
  writable:true,connectionId:'grant',providerCalendarId:'calendar',recurringEventId:null,htmlLink:null,conferenceLink:null,attendees:[],selfResponse:null,organizerSelf:true,...patch});
const calendarSource=(patch={})=>({id:SOURCE,name:'Owned Google calendar',account:'owner@example.test',connectionId:'grant',providerCalendarId:'calendar',timeZone:'UTC',primary:true,source:'google',accessRole:'owner',color:'#3366cc',textColor:null,selected:true,writable:true,...patch});
/** The outbox's display rule, reduced to what these tests use: pending changes applied, deletes hidden, creates added. */
function overlayForTest(rows,ops){
  let out=rows.map(row=>({...row,pending:false}));
  for(const op of ops){
    const mark={pending:op.phase!=='done'&&op.phase!=='failed',outboxId:op.id,outboxPhase:op.phase};
    if(op.kind==='create'){out.push(event({id:`${op.sourceId}:local:${op.id}`,calendarId:op.sourceId,providerEventId:'',title:op.fields.title,begin:Date.parse(op.fields.startAt),end:Date.parse(op.fields.endAt),localId:op.id,...mark}));continue;}
    const hit=out.filter(row=>row.calendarId===op.sourceId&&row.providerEventId===op.eventId);
    if(op.kind==='delete'&&op.phase!=='failed'){out=out.filter(row=>!hit.includes(row));continue;}
    for(const row of hit){if(op.fields?.title)row.title=op.fields.title;Object.assign(row,mark);}
  }
  return out;
}
async function harness(events,{day=0,personal=true,days=1,calendars=[calendarSource()],failing=[],grants=['google.calendar.read','google.calendar.write'],signedInToGoogle=true,outboxFails=0,cached=null}={}){
  let view='calendar',allowRead=signedInToGoogle,pendingRead=null,prefs={},confirmAnswer=true;
  const listeners=new EventTarget(),writes=[],toasts=[],started=[],committed=[],puts=[],cloud={client:{},sessionId:'session',credentialId:'credential'};
  const state={events:[],day,month:null,open:null,form:null,calPrefs:{personal:{on:personal}}};
  const localCalendar={async list(){return {status:'ready',events:[],calendars:[{id:'local',local:true,visible:personal,color:'acc'}]};},async pendingCreations(){return {status:'ready',creations:[]};},async requestAccess(){return {status:'denied'};}};
  // A stand-in outbox: records each change and shows it at once, like the real overlay.
  const outbox={ops:[],enqueued:[],calls:[],listeners:new Set(),
    get operations(){return this.ops;},
    subscribe(listener){this.listeners.add(listener);listener(this.ops);return()=>this.listeners.delete(listener);},
    notify(){for(const listener of this.listeners)listener(this.ops);},
    attach(){return()=>{};},async flush(){},async load(){return this.ops;},overlay(rows){return overlayForTest(rows,this.ops);},
    async enqueue(change){this.enqueued.push(change);const id=`op${this.ops.length+1}`;this.ops.push({id,kind:change.kind,sourceId:change.row?.calendarId??change.sourceId,eventId:change.row?.providerEventId,scope:change.scope??'this',fields:change.fields??{},response:change.response,phase:'queued'});this.notify();return {status:'queued',id,...(change.kind==='delete'?{undoUntil:instant+10000}:{})};},
    async undo(id){this.calls.push(['undo',id]);this.ops=this.ops.filter(op=>op.id!==id);this.notify();return true;},
    async resolveConflict(id,choice){this.calls.push(['conflict',id,choice]);return true;},async resolveUncertain(id,choice){this.calls.push(['uncertain',id,choice]);return true;},
    async resolvePaused(id,choice){this.calls.push(['paused',id,choice]);return true;},async dismiss(id){this.calls.push(['dismiss',id]);return true;}};
  const accounts=()=>allowRead?[{connected:true,connectionId:'grant',label:'owner@example.test',grantedCapabilities:grants}]:[];
  const ctx=vm.createContext({calendarDayColumnsUnderTest:days,Date:FixedDate,console,AbortController,DOMException,Intl,Event,crypto,setTimeout:()=>0,
    IC:{},CAL_SEED:[],PEOPLE:[],DAYS:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MONS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],copy:()=>({}),
    formatHours:value=>String(value),fmtT:value=>String(value),formatHoursRange:(a,b)=>`${a}–${b}`,formatHour:value=>String(value),formatShortDate:date=>date.toISOString().slice(0,10),formatMonthTitle:date=>String(date.getMonth()),weekdayName:(date,style)=>date.toLocaleDateString('en-US',{weekday:style}),
    registerView:(_key,value)=>{ctx.view=value;},window:Object.assign(listeners,{confirm:()=>confirmAnswer}),document:Object.assign(new EventTarget(),{hidden:false}),queueMicrotask,
    registerPlugin:()=>localCalendar,Capacitor:{getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>true},
    DailyApps:{async addListener(){return {remove(){}};}},
    openCalendarRecovery(){},openReminderRecovery(){},openReminderCreationRecovery(){},openReminderActionRecovery(){},
    connectionController:{getSnapshot:()=>({cloudAccount:{environment:'production',userId:'owned',organizationId:'owned'}}),getCloudClient:()=>cloud,subscribe:()=>()=>{},rejectCloudSession:()=>{}},
    serviceReadCache:async()=>({async get(){return cached?{value:cached,at:instant}:null;},async put(key,value){puts.push(value);},async clear(){}}),
    googleCalendarAccountKey:()=>({environment:'production',userId:'owned',organizationId:'owned'}),
    readGoogleCalendarPrefs:()=>prefs,
    googleCalendarVisible:(saved,calendar)=>saved[calendar.id]?.hidden===undefined?calendar.selected||calendar.primary:!saved[calendar.id].hidden,
    setGoogleCalendarVisible:(_owner,id,visible)=>{prefs={...prefs,[id]:{...prefs[id],hidden:!visible}};listeners.dispatchEvent(new Event('prefs'));return true;},
    GOOGLE_CALENDAR_PREFS_CHANGED:'prefs',GOOGLE_ACCOUNTS_CHANGED:'accounts',
    currentGoogleCalendarBinding:()=>({}),googleConnect:{start(){started.push(true);},getSnapshot:()=>'idle',subscribe:()=>()=>{}},googleConnectNote:()=>'',
    createGoogleAccounts:()=>({async list(){return accounts();}}),
    openGoogleCalendarOutbox:async()=>{if(outboxFails>0){outboxFails--;throw new Error('storage');}return outbox;},overlayGoogleCalendarRows:overlayForTest,
    GOOGLE_CALENDAR_WRITE_CAPABILITIES:{rsvp:false},DELETE_UNDO_MS:10000,CloudProtocolError:class extends Error{},
    startCalendarSyncHost:()=>()=>{},calendarSyncHost:{resume:async()=>{},linkedProviderEvents:async()=>new Set()},
    GoogleCalendarReader:class{invalidate(){}
      async listSources(){return allowRead?{status:'ready',calendars}:{status:'not-connected',message:'Disconnected'};}
      async readMany(ids){if(pendingRead)await pendingRead;return {status:'ready',calendars,results:ids.map(sourceId=>({sourceId,result:failing.includes(sourceId)?{status:'unavailable',message:'Unavailable'}:{status:'ready',events:events.filter(row=>row.calendarId===sourceId)}}))};}},
  });
  vm.runInContext(calendarDays+'\n'+calendarViews+'\n'+calendar+'\n{'+nativeSource+'\nglobalThis.installNative=installCalendarAdapter;}\n{'+source+'\nglobalThis.install=installGoogleCalendarViewAdapter;}',ctx);
  class Shell{live=true;S(){return {view};}vget(){return state;}vset(_key,patch){Object.assign(state,patch);}async refreshReminders(){}toast(text,opts){toasts.push({text,opts});}calendarFormCommitted(form){committed.push(form);}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){}}
  ctx.installNative(Shell,{calendar:ctx.view});ctx.install(Shell,{calendar:ctx.view});const shell=new Shell();shell.componentDidMount();shell.componentDidUpdate();
  const settle=async()=>{for(let i=0;i<48;i++)await Promise.resolve();};
  await settle();
  const api={now:new FixedDate(),get:key=>key==='calendar'?state:key==='contacts'?{list:[{id:'sam',name:'Sam Lee',email:'sam@example.test'}]}:{},set:patch=>{writes.push(patch);Object.assign(state,patch);},sw:()=>({}),track:()=>'',kx:()=>0,swallowed:()=>false,isActive:()=>view==='calendar',toast:(text,opts)=>toasts.push({text,opts}),person:()=>null};
  return {render:()=>ctx.view.render(state,api),state,writes,toasts,outbox,started,committed,puts,settle,prefs:()=>prefs,refuseConfirm(){confirmAnswer=false;},
    holdNextRead(){let release;pendingRead=new Promise(resolve=>{release=resolve;});return()=>{release();pendingRead=null;};},
    async startRefresh(){listeners.dispatchEvent(new Event('accounts'));for(let i=0;i<8;i++)await Promise.resolve();},leave(){view='home';shell.componentDidUpdate();},revoke(){allowRead=false;listeners.dispatchEvent(new Event('accounts'));},
    async returnToCalendar(){view='calendar';shell.componentDidUpdate();await settle();},close:()=>shell.componentWillUnmount()};
}
test('Google visibility is independent of the local Personal calendar toggle',async()=>{
  const h=await harness([event()],{personal:false});try{assert.equal(h.render().events.length,1);}finally{h.close();}
});
test('Google all-day dates render in the all-day area rather than outside the timeline',async()=>{
  const h=await harness([event({allDay:true,begin:Date.parse('2026-10-13T00:00:00Z'),end:Date.parse('2026-10-15T00:00:00Z')})]);
  try{const out=h.render();assert.equal(out.hasNativeAllDay,true);assert.equal(out.nativeAllDay[0].title,'Owned Google event');assert.equal(out.events.length,0);}finally{h.close();}
});
test('a multi-day Google all-day event remains visible on its second date',async()=>{
  const h=await harness([event({allDay:true,begin:Date.parse('2026-10-13T00:00:00Z'),end:Date.parse('2026-10-15T00:00:00Z')})],{day:1});
  try{assert.equal(h.render().hasNativeAllDay,true);}finally{h.close();}
});
test('Google events before 7am have visible timeline positions',async()=>{
  const h=await harness([event({begin:at(13,5),end:at(13,6)})]);
  try{const out=h.render();assert.equal(out.events.length,1);assert.ok(out.events[0].top>=0,`negative timeline position: ${out.events[0].top}`);}finally{h.close();}
});
test('Google events spanning midnight render on the following date',async()=>{
  const h=await harness([event({begin:at(13,23),end:at(14,2)})],{day:1});
  try{assert.equal(h.render().events.length,1);}finally{h.close();}
});
const plain=value=>JSON.parse(JSON.stringify(value));
test('a read-only Google calendar hides Edit and Delete, says nothing about it and never writes local events',async()=>{
  const h=await harness([event({writable:false})],{calendars:[calendarSource({writable:false,accessRole:'reader'})]});try{
    h.render().events[0].open();const detail=h.render();
    assert.equal(detail.ev.canEdit,false);assert.equal(detail.ev.busy,true);assert.equal(detail.ev.sourceNote,'');detail.ev.edit();detail.ev.del();
    assert.equal(h.state.form,null);assert.equal(h.outbox.enqueued.length,0);
    assert.deepEqual(h.state.events,[]);assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
  }finally{h.close();}
});
test('a calendar whose grant lacks Calendar write offers to allow changes',async()=>{
  const h=await harness([event({writable:false})],{calendars:[calendarSource({writable:false})],grants:['google.calendar.read']});try{
    h.render().events[0].open();const detail=h.render();
    assert.equal(detail.ev.busy,false);assert.equal(detail.ev.canEdit,true);assert.equal(detail.ev.sourceNote,'');detail.ev.edit();
    assert.equal(h.started.length,1);assert.equal(h.state.form,null);assert.equal(h.outbox.enqueued.length,0);
  }finally{h.close();}
});
test('every shown Google calendar is read, each under its own calendar, and one failing calendar never hides the others',async()=>{
  const work='google:grant:work',hidden='google:grant:hidden',broken='google:grant:broken';
  const h=await harness([event(),event({id:`${work}:standup`,calendarId:work,providerEventId:'standup',title:'Work standup',begin:at(13,9),end:at(13,10)}),event({id:`${hidden}:x`,calendarId:hidden,providerEventId:'x',title:'Hidden by Google'})],
    {calendars:[calendarSource(),calendarSource({id:work,name:'Work',providerCalendarId:'work',primary:false,color:'#0b8043'}),calendarSource({id:hidden,name:'Holidays',providerCalendarId:'hidden',primary:false,selected:false}),calendarSource({id:broken,name:'Broken',providerCalendarId:'broken',primary:false})],failing:[broken]});
  try{
    const out=h.render();
    assert.deepEqual(plain(out.events.map(e=>e.title)).sort(),['Owned Google event','Work standup']);
    assert.equal(out.googleCalendarNotice,'Broken couldn’t load.');
    // One switch per Google calendar, Google's own hidden calendar included (off).
    assert.deepEqual(plain(out.calToggles.filter(row=>row.id.startsWith('google:')).map(row=>[row.name,row.on])),[['Owned Google calendar',true],['Work',true],['Holidays',false],['Broken',true]]);
    // Hiding a calendar removes its rows at once and is saved as the owner's choice.
    out.calToggles.find(row=>row.id===work).toggle();
    assert.equal(h.prefs()[work].hidden,true);
    assert.deepEqual(plain(h.render().events.map(e=>e.title)),['Owned Google event']);
    assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
  }finally{h.close();}
});
test('a malformed Google row is skipped without hiding the rest',async()=>{
  const h=await harness([event(),event({id:`${SOURCE}:bad`,providerEventId:'bad',title:'Bad',begin:Number.NaN})]);
  try{assert.deepEqual(plain(h.render().events.map(e=>e.title)),['Owned Google event']);}finally{h.close();}
});
test('Connect shows on Calendar when no Google account grants Calendar',async()=>{
  const h=await harness([],{signedInToGoogle:false});
  try{const out=h.render();assert.equal(out.googleConnectOffered,true);assert.equal(out.googleConnectLabel,'Connect');out.connectGoogleCalendar();assert.equal(h.started.length,1);}finally{h.close();}
});
test('editing a Google event queues only the changed fields and shows the row as waiting to sync',async()=>{
  const h=await harness([event({attendees:[{email:'sam@example.test',displayName:'Sam',responseStatus:'accepted',self:false,organizer:false,optional:false}]})]);try{
    h.render().events[0].open();let detail=h.render();
    assert.equal(detail.ev.busy,false);assert.equal(detail.ev.guestNote,'Google won’t email guests about changes made here.');
    detail.ev.edit();
    assert.equal(h.state.form.googleEventId,'event');assert.equal(h.state.form.cal,SOURCE);assert.deepEqual(plain(h.state.form.googleBase),{revision:'synthetic',begin:at(13,12),end:at(13,13)});
    let out=h.render();
    assert.deepEqual(plain(out.f.cals.map(c=>c.name)),['Owned Google calendar']);assert.deepEqual(plain(out.f.alerts),[]);assert.deepEqual(plain(out.f.repeats),[]);
    // Empty Repeat and Alert rows, the video switch and the people picker are hidden, not shown dead.
    assert.equal(out.f.hasRepeats,false);assert.equal(out.f.hasAlerts,false);assert.equal(out.f.hasVideo,false);assert.equal(out.f.toggleVideo,undefined);
    assert.equal(out.f.canAddPeople,false);assert.equal(out.f.notPicking,false);assert.equal(out.f.picking,false);assert.equal(out.f.timeLocked,false);
    h.state.form={...h.state.form,title:'Renamed'};out=h.render();out.f.save();await h.settle();
    assert.equal(h.outbox.enqueued.length,1);
    const change=h.outbox.enqueued[0];
    assert.equal(change.kind,'update');assert.equal(change.scope,'this');assert.deepEqual(plain(change.fields),{title:'Renamed'});assert.equal(change.row.revision,'synthetic');
    assert.equal(h.state.form,null);assert.equal(h.committed.length,1);assert.equal(h.committed[0].googleEventId,'event');
    out=h.render();assert.equal(out.events[0].title,'Renamed');assert.equal(out.events[0].pending,true);
    detail=h.render();assert.equal(detail.ev.pending,true);
    assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
  }finally{h.close();}
});
test('a moved Google event sends its new start and end with a zone',async()=>{
  const h=await harness([event()]);try{
    h.render().events[0].open();h.render().ev.edit();
    h.state.form={...h.state.form,t:15};h.render().f.save();await h.settle();
    const fields=h.outbox.enqueued[0].fields;
    assert.equal(Date.parse(fields.startAt),at(13,15));assert.equal(Date.parse(fields.endAt),at(13,16));assert.equal(typeof fields.timeZone,'string');assert.equal(fields.title,undefined);
  }finally{h.close();}
});
test('a restored Google edit whose event changed in Google cannot be saved',async()=>{
  const h=await harness([event({revision:'newer'})]);try{
    h.state.form={id:`${SOURCE}:event`,title:'Mine',off:0,t:12,d:1,where:'',video:false,who:[],cal:SOURCE,repeat:'none',alert:null,notes:'',googleEventId:'event',googleScope:'this',googleBase:{revision:'synthetic',begin:at(13,12),end:at(13,13)}};
    const out=h.render();
    assert.equal(out.f.saveOff,true);assert.equal(out.editDraftStatus,'This event changed in Google Calendar. Reopen it to edit.');
    out.f.save();await h.settle();assert.equal(h.outbox.enqueued.length,0);assert.ok(h.state.form);
  }finally{h.close();}
});
test('deleting a Google event waits behind Undo, and Undo cancels it',async()=>{
  const h=await harness([event()]);try{
    h.render().events[0].open();h.render().ev.del();await h.settle();
    assert.equal(h.outbox.enqueued[0].kind,'delete');assert.equal(h.outbox.enqueued[0].scope,'this');
    assert.equal(h.state.open,null);assert.equal(h.render().events.length,0);
    const toast=h.toasts.at(-1);assert.equal(toast.text,'Owned Google event deleted');assert.equal(toast.opts.ms,10000);
    toast.opts.undo();await h.settle();
    assert.deepEqual(plain(h.outbox.calls),[['undo','op1']]);assert.equal(h.render().events.length,1);
  }finally{h.close();}
});
test('a repeating Google event asks this event or all events before deleting',async()=>{
  const h=await harness([event({recurringEventId:'series'})]);try{
    h.render().events[0].open();h.render().ev.del();
    assert.deepEqual(plain(h.state.deleteAsk.scopes),['this','all']);assert.equal(h.outbox.enqueued.length,0);
    const sheet=h.render().deleteSheet;assert.deepEqual(plain(sheet.options.map(o=>o.scope)),['this','all']);
    sheet.options[1].go();await h.settle();
    assert.equal(h.outbox.enqueued[0].scope,'all');assert.equal(h.state.deleteAsk,null);
  }finally{h.close();}
});
test('editing a repeating Google event offers this event or all events',async()=>{
  const h=await harness([event({recurringEventId:'series'})]);try{
    h.render().events[0].open();h.render().ev.edit();
    let out=h.render();assert.deepEqual(plain(out.f.repeats.map(r=>r.label)),['This event','All events']);assert.equal(out.f.hasRepeats,true);
    out.f.repeats[1].pick();h.state.form={...h.state.form,notes:'Series notes'};h.render().f.save();await h.settle();
    assert.equal(h.outbox.enqueued[0].scope,'all');assert.deepEqual(plain(h.outbox.enqueued[0].fields),{description:'Series notes'});
  }finally{h.close();}
});
test('an invitation shows its organizer but no reply pills while Cloud cannot record replies',async()=>{
  const h=await harness([event({selfResponse:'needsAction',organizerSelf:false,attendees:[{email:'jordan@example.test',displayName:'Jordan Park',responseStatus:'accepted',self:false,organizer:true,optional:false},{email:'owner@example.test',displayName:null,responseStatus:'needsAction',self:true,organizer:false,optional:false}]})]);
  try{
    h.render().events[0].open();const detail=h.render();
    assert.equal(detail.ev.isInvite,true);assert.equal(detail.ev.from,'JP');assert.deepEqual(plain(detail.ev.rsvp),[]);
    assert.equal(h.outbox.enqueued.length,0);
  }finally{h.close();}
});
test('a change Google made first shows Keep mine and Keep Google’s',async()=>{
  const h=await harness([event()]);try{
    h.render().events[0].open();h.render().ev.edit();h.state.form={...h.state.form,title:'Mine'};h.render().f.save();await h.settle();
    h.outbox.ops[0].phase='conflict';h.outbox.ops[0].remote={revision:'theirs',begin:at(13,12),end:at(13,13)};h.state.open=`${SOURCE}:event`;
    const conflict=h.render().ev.conflict;
    assert.equal(conflict.text,'Changed in Google Calendar.');assert.equal(conflict.mineLabel,'Keep mine');assert.equal(conflict.theirsLabel,'Keep Google’s');
    conflict.keepMine();conflict.keepTheirs();await h.settle();
    assert.deepEqual(plain(h.outbox.calls),[['conflict','op1','mine'],['conflict','op1','google']]);
  }finally{h.close();}
});
test('each sync problem names what its pills do',async()=>{
  const h=await harness([event()]);try{
    const failed=status=>{h.outbox.ops=[{id:'op1',kind:'update',sourceId:SOURCE,eventId:'event',scope:'this',fields:{title:'Mine'},phase:'failed',error:{status}}];h.outbox.calls=[];h.state.open=`${SOURCE}:event`;return h.render().ev.conflict;};
    let banner=failed('invalid');
    assert.equal(banner.text,'Google Calendar didn’t accept this change.');assert.equal(banner.mineLabel,'Try again');assert.equal(banner.theirsLabel,'Discard');
    banner.keepTheirs();await h.settle();assert.deepEqual(plain(h.outbox.calls),[['dismiss','op1']]);
    banner=failed('needs-permission');
    assert.equal(banner.mineLabel,'Allow');assert.equal(banner.theirsLabel,'Discard');banner.keepMine();await h.settle();assert.equal(h.started.length,1);
    // Google no longer has the event: one OK that dismisses.
    banner=failed('gone');
    assert.equal(banner.text,'This event is no longer in Google Calendar.');assert.equal(banner.mineLabel,'OK');assert.equal(banner.theirsLabel,'');assert.equal(banner.keepTheirs,undefined);
    banner.keepMine();await h.settle();assert.deepEqual(plain(h.outbox.calls),[['dismiss','op1']]);
    // An unconfirmed create: add it again, or discard it.
    h.outbox.ops=[{id:'op2',kind:'create',sourceId:SOURCE,scope:'this',fields:{title:'Lunch',startAt:new Date(at(13,15)).toISOString(),endAt:new Date(at(13,16)).toISOString()},phase:'uncertain'}];h.outbox.calls=[];
    h.state.open=`${SOURCE}:local:op2`;banner=h.render().ev.conflict;
    assert.equal(banner.text,'Google didn’t confirm this event was added.');assert.equal(banner.mineLabel,'Add again');assert.equal(banner.theirsLabel,'Discard');
    banner.keepMine();banner.keepTheirs();await h.settle();
    assert.deepEqual(plain(h.outbox.calls),[['uncertain','op2','send'],['uncertain','op2','drop']]);
  }finally{h.close();}
});
test('editing an event still waiting to be added saves quietly and never touches the retained form',async()=>{
  const h=await harness([]);try{
    h.render().newEvent();h.state.form={...h.state.form,title:'Lunch',off:1,t:12,d:1};h.render().f.save();await h.settle();
    assert.equal(h.committed.length,1);assert.ok(!h.committed[0].id);
    h.state.day=1;h.render().events[0].open();h.render().ev.edit();
    assert.equal(h.state.form.googleLocalId,'op1');assert.equal(h.state.form.googleEventId,undefined);
    // No changes: closes without a toast.
    h.render().f.save();await h.settle();
    assert.equal(h.state.form,null);assert.deepEqual(h.toasts,[]);assert.equal(h.committed.length,1);
    h.state.open=`${SOURCE}:local:op1`;h.render().ev.edit();h.state.form={...h.state.form,title:'Late lunch'};h.render().f.save();await h.settle();
    assert.equal(h.outbox.enqueued.at(-1).kind,'update');assert.deepEqual(plain(h.outbox.enqueued.at(-1).fields),{title:'Late lunch'});
    assert.equal(h.state.form,null);assert.deepEqual(h.toasts,[]);assert.equal(h.committed.length,1);
  }finally{h.close();}
});
test('editing an all-day Google event keeps its times locked',async()=>{
  const h=await harness([event({allDay:true,begin:Date.parse('2026-10-13T00:00:00Z'),end:Date.parse('2026-10-14T00:00:00Z')})]);try{
    h.state.open=`${SOURCE}:event`;h.render().ev.edit();
    const out=h.render();
    assert.equal(out.f.timeLocked,true);assert.equal(out.f.allDay,true);assert.equal(out.f.start,'All day');assert.equal(out.f.end,'');
    assert.equal(out.f.sMinus,undefined);assert.equal(out.f.sPlus,undefined);assert.equal(out.f.eMinus,undefined);assert.equal(out.f.ePlus,undefined);
    h.state.form={...h.state.form,notes:'Bring snacks'};h.render().f.save();await h.settle();
    assert.deepEqual(plain(h.outbox.enqueued[0].fields),{description:'Bring snacks'});assert.deepEqual(h.toasts,[]);
  }finally{h.close();}
});
test('changes waiting to sync that could not be read are tried again on return, with a notice meanwhile',async()=>{
  const h=await harness([event()],{outboxFails:1});try{
    h.render().events[0].open();let out=h.render();
    assert.equal(out.googleCalendarNotice,'Changes waiting to sync couldn’t be read.');assert.equal(out.ev.busy,true);
    // A reload never wipes the notice.
    await h.startRefresh();await h.settle();assert.equal(h.render().googleCalendarNotice,'Changes waiting to sync couldn’t be read.');
    h.leave();await h.returnToCalendar();
    out=h.render();assert.equal(out.googleCalendarNotice,'');assert.equal(out.ev.busy,false);assert.equal(out.ev.canEdit,true);
  }finally{h.close();}
});
test('a fresh saved read keeps the offer to allow changes',async()=>{
  const rows=[event({writable:false})],calendars=[calendarSource({writable:false})];
  const first=await harness(rows,{calendars,grants:['google.calendar.read']});
  let saved;try{saved=first.puts.at(-1);assert.deepEqual(plain(saved.noWrite),['grant']);}finally{first.close();}
  const h=await harness([],{calendars,grants:['google.calendar.read'],cached:plain(saved)});try{
    h.render().events[0].open();const detail=h.render();
    assert.equal(detail.ev.busy,false);assert.equal(detail.ev.canEdit,true);detail.ev.edit();assert.equal(h.started.length,1);
  }finally{h.close();}
  // A read saved before noWrite was kept is read again rather than trusted.
  const old=await harness(rows,{calendars,grants:['google.calendar.read'],cached:{sources:plain(calendars),read:[SOURCE],events:plain(rows)}});try{
    assert.equal(old.puts.length,1);old.render().events[0].open();assert.equal(old.render().ev.canEdit,true);
  }finally{old.close();}
});
test('a new event can be saved to a writable Google calendar, and + starts in the primary one',async()=>{
  const h=await harness([]);try{
    h.render().newEvent();
    assert.equal(h.state.form.cal,SOURCE);
    h.state.form={...h.state.form,title:'Lunch',off:1,t:12,d:1,who:['sam'],where:'Cafe'};
    const out=h.render();
    assert.ok(out.f.cals.some(c=>c.name==='Owned Google calendar'));assert.equal(out.f.insertHandoff,undefined);assert.equal(out.f.toggleAllDay,undefined);
    out.f.save();await h.settle();
    const change=h.outbox.enqueued[0];
    assert.equal(change.kind,'create');assert.equal(change.sourceId,SOURCE);assert.equal(change.calendarId,'calendar');assert.equal(change.connectionId,'grant');
    assert.equal(change.fields.title,'Lunch');assert.equal(change.fields.location,'Cafe');assert.deepEqual(plain(change.fields.attendees),['sam@example.test']);
    assert.equal(Date.parse(change.fields.startAt),at(14,12));assert.equal(Date.parse(change.fields.endAt),at(14,13));
    assert.equal(h.state.form,null);assert.equal(h.state.day,1);
    h.state.day=1;const shown=h.render().events;assert.equal(shown.length,1);assert.equal(shown[0].title,'Lunch');assert.equal(shown[0].pending,true);
    assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
  }finally{h.close();}
});
test('grant revocation outside Calendar clears cached events before returning',async()=>{const h=await harness([event()]);try{assert.equal(h.render().events.length,1);h.leave();h.revoke();assert.equal(h.render().events.length,0);await h.returnToCalendar();assert.equal(h.render().events.length,0);}finally{h.close();}});

test('leaving during a pending Google read allows automatic reload on return',async()=>{const h=await harness([event()]);try{const release=h.holdNextRead();await h.startRefresh();h.leave();release();for(let i=0;i<8;i++)await Promise.resolve();await h.returnToCalendar();assert.equal(h.render().events.length,1);}finally{h.close();}});

test('on a wide canvas each Google event is drawn in the column of its own day and opens that occurrence',async()=>{
  // Three columns lead with the day before the selected one: selecting tomorrow shows today to the day after.
  const h=await harness([event(),event({id:'google:grant:calendar:later',providerEventId:'later',title:'Later Google event',begin:at(15,9),end:at(15,10)})],{day:1,days:3});
  try{
    const out=h.render();
    assert.equal(out.multiDay,true);assert.equal(out.dayCount,3);assert.equal(out.events.length,0);
    assert.deepEqual(JSON.parse(JSON.stringify(out.dayColumns.map(column=>column.events.map(e=>e.title)))),[['Owned Google event'],[],['Later Google event']]);
    const later=out.dayColumns[2].events[0];
    assert.ok(Number(later.x)>=0&&Number(later.x)+Number(later.wp)<=100.001);
    later.open();
    assert.equal(h.state.open,'google:grant:calendar:later');assert.equal(h.state.openDay,2);
  }finally{h.close();}
});

test('day columns that cross a month end and a daylight-saving change keep each event on its own wall-clock day',async()=>{
  const zone=process.env.TZ;process.env.TZ='America/Los_Angeles';
  try{
    // Oct 31 – Nov 2, 2026 in Los Angeles: the month ends and clocks fall back on Nov 1 (a 25-hour day).
    const local=(month,day,hour)=>new Date(2026,month,day,hour).getTime(),today=new Date(instant);
    const offset=(Date.UTC(2026,9,31)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000;
    const rows=[['halloween','Halloween dinner',9,31,18],['fallback','After fall-back',10,1,9],['monday','Monday standup',10,2,9]]
      .map(([id,title,month,day,hour])=>event({id:`google:grant:calendar:${id}`,providerEventId:id,title,begin:local(month,day,hour),end:local(month,day,hour+1)}));
    const h=await harness(rows,{day:offset+1,days:3});
    try{
      const out=h.render();
      assert.deepEqual(JSON.parse(JSON.stringify(out.dayColumns.map(column=>column.events.map(e=>e.title)))),[['Halloween dinner'],['After fall-back'],['Monday standup']]);
      // 9am on the 25-hour day sits at the same height as 9am on the next day.
      assert.equal(out.dayColumns[1].events[0].top,out.dayColumns[2].events[0].top);
      out.dayColumns[2].events[0].open();
      assert.equal(h.state.open,'google:grant:calendar:monday');assert.equal(h.state.openDay,offset+2);
    }finally{h.close();}
  }finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone;}
});

test('Month and Schedule show Google rows on every day they cover, all-day first',async()=>{
  const h=await harness([event({id:'google:grant:calendar:trip',providerEventId:'trip',title:'Google trip',allDay:true,begin:Date.parse('2026-10-14T00:00:00Z'),end:Date.parse('2026-10-16T00:00:00Z')}),event({id:'google:grant:calendar:late',providerEventId:'late',title:'Overnight',begin:at(13,22),end:at(14,2)})]);
  try{
    Object.assign(h.state,{view:'month',month:0});let out=h.render();
    const chips=off=>JSON.parse(JSON.stringify(out.monthCells.find(cell=>cell.off===off).chips.map(chip=>chip.title)));
    assert.deepEqual(chips(0),['Overnight']);assert.deepEqual(chips(1),['Google trip','Overnight']);assert.deepEqual(chips(2),['Google trip']);assert.deepEqual(chips(3),[]);
    // The all-day strip is the timeline's: Month and Schedule never repeat the selected day's all-day rows above their own.
    h.state.day=1;assert.equal(h.render().hasNativeAllDay,false);
    Object.assign(h.state,{view:'schedule',month:null});assert.equal(h.render().hasNativeAllDay,false);
    Object.assign(h.state,{view:'day'});assert.equal(h.render().hasNativeAllDay,true);h.state.day=0;
    Object.assign(h.state,{view:'schedule',month:null});out=h.render();
    assert.deepEqual(JSON.parse(JSON.stringify(out.scheduleRows.map(row=>[row.off,row.items.map(item=>item.title)]))),[[0,['Overnight']],[1,['Google trip','Overnight']],[2,['Google trip']]]);
    out.scheduleRows[1].items[0].open();assert.equal(h.state.open,'google:grant:calendar:trip');assert.equal(h.state.openDay,1);
  }finally{h.close();}
});

test('Week view puts Google events in their own weekday column',async()=>{
  const h=await harness([event({id:'google:grant:calendar:fri',providerEventId:'fri',title:'Friday review',begin:at(16,10),end:at(16,11)})]);
  try{
    h.state.view='week';const out=h.render();
    // Tuesday 13 October 2026: the week runs Monday 12 to Sunday 18.
    assert.deepEqual(JSON.parse(JSON.stringify(out.dayColumns.map(column=>column.off))),[-1,0,1,2,3,4,5]);
    assert.deepEqual(JSON.parse(JSON.stringify(out.dayColumns.map(column=>column.events.map(e=>e.title)))),[[],[],[],[],['Friday review'],[],[]]);
    assert.ok(out.dayColumns[4].events[0].showTime===false,'week blocks are compact');
  }finally{h.close();}
});

test('Search waits for its wider read instead of saying No results, and closing it keeps the loaded days',async()=>{
  const h=await harness([event()]);
  try{
    assert.equal(h.render().emptyText,'Nothing scheduled');
    h.state.search='nothing like this';let out=h.render();
    assert.equal(out.searchEmpty,false,'no "No results" before the wide read');assert.equal(out.searchLoading,'Loading calendars…');
    await h.settle();out=h.render();
    assert.equal(out.searchLoading,'');assert.equal(out.searchEmpty,true);
    // The year-long read covers the shown months, so closing Search neither blanks nor waits.
    h.state.search=null;out=h.render();
    assert.notEqual(out.emptyText,'Loading calendars…');assert.equal(out.events.length,1);
  }finally{h.close();}
});
