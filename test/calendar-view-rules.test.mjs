// Calendar, reminder and clock rules exercised on the shipped sources with synthetic rows, stores and
// timers only: no browser, Android, Cloud or provider access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const load=path=>stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const DAY=86400000;
// Friday 6 November 2026, 22:30 local time, unless a test moves it.
const start=new Date(2026,10,6,22,30).getTime();
function clock(now=start){const box={now};class FixedDate extends Date{constructor(...args){super(...(args.length?args:[box.now]));}static now(){return box.now;}}return {box,FixedDate};}
const settle=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
const plain=value=>JSON.parse(JSON.stringify(value));

const daysSource=load('apps/app/src/prototype/calendar-days.ts');
function days(time=clock()){
  const ctx=vm.createContext({Date:time.FixedDate,Intl,Map,Math,Number});
  vm.runInContext('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n'+daysSource+'\nglobalThis.api={msToLocalMidnight};',ctx);
  return ctx.api;
}

test('the next local midnight is measured from now',()=>{
  const {msToLocalMidnight}=days();
  assert.equal(msToLocalMidnight(start),90*60000);
  assert.equal(msToLocalMidnight(new Date(2026,10,6).getTime()),new Date(2026,10,7).getTime()-new Date(2026,10,6).getTime(),'exactly midnight waits a whole day');
  assert.equal(msToLocalMidnight(new Date(2026,10,6,23,59,59,999).getTime()),1);
});

const formSource=load('apps/app/src/prototype/calendar-form-draft-adapter.ts');
function formHarness(){
  const time=clock(),edits=[],state={form:null};
  class Controller{constructor(){this.state={message:'',conflict:false,error:false,savedText:''};}open(){return Promise.resolve();}edit(text){edits.push(text);}retire(){}consume(){return Promise.resolve();}}
  const ctx=vm.createContext({AssistantDraftController:Controller,assistantDraftStore:async()=>({}),Capacitor:{getPlatform:()=>'web'},openDomainRecovery(){},browserDevProfile:false,window:{confirm:()=>true},Intl,Date:time.FixedDate,JSON,Number,
    encodeCalendarForm:form=>JSON.stringify(form),decodeCalendarForm:text=>({form:JSON.parse(text),zone:'UTC'}),snapshotCalendarForm:form=>form});
  vm.runInContext(formSource+'\nglobalThis.install=installCalendarFormDraftAdapter;globalThis.rules={calendarFormDayShift,calendarFormRetained};',ctx);
  class Shell{live=true;vget(){return state;}vset(_key,patch){Object.assign(state,patch);}toast(){}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){}}
  ctx.install(Shell,{calendar:{render:()=>({})}});const shell=new Shell();shell.componentDidMount();
  return {time,edits,state,shell,rules:ctx.rules,update:()=>shell.componentDidUpdate({})};
}

test('a form no draft retains keeps its date when midnight passes',()=>{
  const h=formHarness();
  // A new reminder (no creationId) for tomorrow.
  h.state.form={id:null,title:'Call',off:1,t:9,d:1,cal:'alpha-reminders'};h.update();
  assert.equal(h.state.form.off,1);
  h.time.box.now=start+2*3600000;h.update();
  assert.equal(h.state.form.off,0,'tomorrow became today');
  h.update();assert.equal(h.state.form.off,0,'moved once');
  assert.deepEqual(h.edits,[],'still not retained');
  // A form opened after the date changed starts from its own day.
  h.state.form=null;h.update();h.time.box.now+=DAY;
  h.state.form={id:null,title:'',off:3,cal:'alpha-reminders'};h.update();
  assert.equal(h.state.form.off,3);
});

test('retained forms keep their own date handling',()=>{
  const h=formHarness(),{calendarFormRetained,calendarFormDayShift}=h.rules;
  assert.equal(calendarFormRetained({id:null,creationId:'c'}),true);
  assert.equal(calendarFormRetained({id:'calendar:1',alphaCalendarId:'1'}),true);
  assert.equal(calendarFormRetained({id:'reminder:r1',alphaReminderId:'r1'}),true);
  assert.equal(calendarFormRetained({id:null,creationId:'c',canonicalOwnerKey:'owner'}),true);assert.equal(calendarFormRetained({id:'agent:1',canonicalOwnerKey:'owner'}),true,'merged-calendar forms are moved by their own draft');
  assert.equal(calendarFormRetained({id:null}),false);assert.equal(calendarFormRetained({id:null,cal:'alpha-reminders',reminderCreationId:'r'}),false);assert.equal(calendarFormRetained(null),false);
  assert.equal(calendarFormDayShift(new Date(2026,10,6,23,59),new Date(2026,10,7,0,1)),-1);
  assert.equal(calendarFormDayShift(new Date(2026,10,6,1),new Date(2026,10,6,23)),0);
  h.state.form={id:null,creationId:'c1',title:'Trip',off:1};h.update();
  assert.equal(h.edits.length,1,'a creation draft is saved');
  h.time.box.now=start+2*3600000;h.update();
  assert.equal(h.state.form.off,0,'and re-anchored once by its own rule');
});

const reminderSource=load('apps/app/src/prototype/reminder-adapter.ts');
test('device calendar rows reach the view when the reminder store cannot be read',async()=>{
  const patches=[],toasts=[];let fail=true;
  const ctx=vm.createContext({console,Map,Object,JSON,Promise,
    reconcileReminderDeletions:async()=>{if(fail)throw new Error('Pending deletion store is full');return 0;},
    reminderCreations:async()=>({}),reconcileReminderCreations:async()=>0,
    reminderEvents:rows=>rows.map(row=>({id:'reminder:'+row.id,alphaReminderId:row.id,off:0})),
    Capacitor:{getPlatform:()=>'android',isNativePlatform:()=>true,isPluginAvailable:()=>true},
    DailyApps:{surfaceInfo:async()=>({reminderTodoVersion:1}),listReminders:async()=>({reminders:[{id:'fresh'}]})}});
  vm.runInContext(reminderSource+'\nglobalThis.install=installReminderAdapter;',ctx);
  class Shell{live=true;S(){return {view:'calendar'};}vset(_key,patch){patches.push(patch);}toast(text){toasts.push(text);}openView(){}componentDidMount(){}componentWillUnmount(){}}
  ctx.install(Shell,{calendar:{render:()=>({}),state:{}}});
  const shell=new Shell();
  // The device calendar read just finished for a new range; reminders were read earlier.
  shell.nativeCalendarRows=[{id:'calendar:7:1',alphaCalendarId:'7'}];shell.reminderRows=[{id:'earlier'}];
  await shell.refreshReminders();
  const failed=patches.at(-1);
  assert.equal(failed.reminderStale,true);
  assert.deepEqual(plain(failed.events).map(row=>row.id),['calendar:7:1','reminder:earlier'],'new device rows show with the reminders last read');
  assert.equal(toasts.length,1);
  // No reminders were ever read: the device rows still show.
  shell.reminderRows=undefined;shell.nativeCalendarRows=[{id:'calendar:8:1'}];await shell.refreshReminders();
  assert.deepEqual(plain(patches.at(-1).events).map(row=>row.id),['calendar:8:1']);
  fail=false;await shell.refreshReminders();
  assert.equal(patches.at(-1).reminderStale,false);assert.deepEqual(plain(patches.at(-1).events).map(row=>row.id),['calendar:8:1','reminder:fresh']);
});

const adapterSource=load('apps/app/src/prototype/calendar-adapter.ts');
async function deviceCalendar({}={}){
  const time=clock(),timers=[],cleared=[],calls=[],toasts=[],reminderRefreshes=[];
  const state={events:[],day:0,month:null,open:null,form:null,calPrefs:{}};
  const provider={events:[],saveResult:null,
    async requestAccess(){calls.push('requestAccess');return {status:'granted'};},
    async list(range){calls.push('list');return {status:'ready',events:provider.events,calendars:[{id:'local',local:true,writable:true,account:'Alpha Phone',name:'Phone'}],truncated:false,range};},
    async pendingCreations(){return {status:'ready',creations:[]};},
    async save(request){calls.push('save');return {status:'saved',id:'9',creationId:request.creationId};},
    async acknowledgeCreation(){return {status:'acknowledged'};},
    async prepareAgentSource(){return {status:'unavailable'};}};
  const ctx=vm.createContext({Date:time.FixedDate,Intl,JSON,Map,Math,Number,Object,Promise,console,queueMicrotask,crypto,
    setTimeout:(run,ms)=>{timers.push({run,ms});return timers.length;},clearTimeout:id=>cleared.push(id),
    window:Object.assign(new EventTarget(),{confirm:()=>true}),document:Object.assign(new EventTarget(),{hidden:false}),
    registerPlugin:()=>provider,Capacitor:{getPlatform:()=>'android',isNativePlatform:()=>true,isPluginAvailable:()=>true},
    DailyApps:{async addListener(){return {remove(){}};}},refreshDeletionViews(){},presentCalendarIntervals(){},
    reminderEvents:rows=>rows.map(row=>({id:'reminder:'+row.id,alphaReminderId:row.id,off:0})),
    openCalendarRecovery(){},openReminderRecovery(){},openReminderCreationRecovery(){},openReminderActionRecovery(){},
    calendarFormTimeProblem:()=>'',mapsEventOriginFor:()=>null,rememberNoteOrigin:async()=>true,forgetNoteOrigin:async()=>{},noteOriginSupported:()=>false,eventNoteOriginId:()=>undefined});
  vm.runInContext('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n'+daysSource+'\n{'+adapterSource+'\nglobalThis.install=installCalendarAdapter;}',ctx);
  class Shell{live=true;S(){return {view:'calendar'};}vget(){return state;}vset(_key,patch){Object.assign(state,patch);}async refreshReminders(){reminderRefreshes.push(time.box.now);state.events=[...(this.nativeCalendarRows||[])];}toast(text){toasts.push(text);}calendarFormCommitted(){}componentDidMount(){}componentWillUnmount(){}}
  // The base renderer draws the form; everything this adapter adds is layered on its output.
  const views={calendar:{render:current=>({hours:[],week:[],nowTop:0,events:current.events,calToggles:[],f:current.form?{cals:[]}:undefined})}};
  ctx.install(Shell,views);const shell=new Shell();shell.componentDidMount();await settle();
  const api={now:new time.FixedDate(),get:()=>state,set:patch=>Object.assign(state,patch),isActive:()=>true,toast:text=>toasts.push(text)};
  return {time,timers,cleared,calls,toasts,reminderRefreshes,state,shell,provider,render:()=>views.calendar.render(state,api),displaySources:()=>views.calendar.displaySources(),close:()=>shell.componentWillUnmount()};
}

test('a ready device Calendar range is published while creation and reminder reads remain pending',async()=>{
  const h=await deviceCalendar();
  const at=new Date(2026,10,6,9).getTime();
  const event=(id,begin)=>({id,calendarId:'local',title:id,begin,end:begin+3600000});
  let releaseCreation,releaseReminder;
  let reads=0;
  const creation=new Promise(resolve=>{releaseCreation=resolve;});
  const reminder=new Promise(resolve=>{releaseReminder=resolve;});
  const initialCreations=h.provider.pendingCreations,initialReminders=h.shell.refreshReminders;
  try{
    h.shell.reminderRows=[{id:'last-known'}];
    h.provider.events=[event('current',at)];
    h.provider.pendingCreations=()=>creation;
    h.shell.refreshReminders=async()=>{reads++;await reminder;};
    const first=h.shell.refreshAgentCalendar();
    await settle();
    assert.equal(reads,1,'the reminder read does not wait for the creation journal');
    assert.equal(h.displaySources().ready,true);
    assert.equal(h.state.nativeCalendarReadAt,h.time.box.now);
    assert.deepEqual(plain(h.render().events).map(row=>row.id),['calendar:current:'+at,'reminder:last-known']);

    // The older recovery work still waits when another Calendar range completes.
    h.shell.reminderRows=undefined;
    h.provider.pendingCreations=initialCreations;
    h.shell.refreshReminders=initialReminders;
    h.provider.events=[event('next-range',at+30*DAY)];
    h.state.month=1;
    h.render();
    await settle();
    assert.equal(h.displaySources().ready,true);
    assert.deepEqual(plain(h.render().events).map(row=>row.id),['calendar:next-range:'+(at+30*DAY)]);
    releaseCreation({status:'ready',creations:[]});
    releaseReminder();
    await first;
    assert.deepEqual(plain(h.render().events).map(row=>row.id),['calendar:next-range:'+(at+30*DAY)]);
  }finally{releaseCreation({status:'ready',creations:[]});releaseReminder();h.close();}
});

test('device calendar rows and reminders are read again just after local midnight',async()=>{
  const h=await deviceCalendar();
  try{
    assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,90*60000+1000);
    const tomorrow=new Date(2026,10,7,9).getTime();
    h.provider.events=[{id:'7',calendarId:'local',title:'Standup',begin:tomorrow,end:tomorrow+3600000}];
    h.shell.nativeCalendarRows=[{id:'calendar:7:'+tomorrow,off:1}];h.calls.length=0;h.reminderRefreshes.length=0;
    // The date changes with Calendar left open.
    h.time.box.now=new Date(2026,10,7,0,0,1).getTime();h.timers[0].run();await settle();
    assert.ok(h.calls.includes('list'),'the provider is read again');
    assert.equal(h.shell.nativeCalendarRows[0].off,0,'tomorrow is today now');
    assert.ok(h.reminderRefreshes.length>=1);
    assert.equal(h.timers.length,2,'armed for the following midnight');assert.equal(h.timers[1].ms,DAY-1000+1000);
  }finally{h.close();}
  assert.deepEqual(h.cleared,[2],'the timer stops with the view');
  const stale=h.timers.length;h.timers[1].run();await settle();
  assert.equal(h.timers.length,stale,'a timer that fires after unmount does nothing');
});

test('the browser alarm poll runs only while the page is visible',async()=>{
  const intervals=[],stopped=[];
  const document=Object.assign(new EventTarget(),{hidden:true,documentElement:{dataset:{}}}),window=new EventTarget();
  const ctx=vm.createContext({window,document,Event,navigator:{},performance,JSON,Promise,
    setInterval:(run,ms)=>{intervals.push({run,ms});return intervals.length;},clearInterval:id=>{if(id!==undefined)stopped.push(id);},
    BrowserAlertAudio:class{stop(){}play(){}},testMocksEnabled:false,browserScreenLocked:()=>false,layoutBrowserDialog(){},
    alertSoundDocument:{read:async initial=>initial(),edit:async()=>false}});
  vm.runInContext(load('apps/app/src/browser/clock.ts')+'\nglobalThis.BrowserClock=BrowserClock;',ctx);
  let reads=0;
  new ctx.BrowserClock({listReminders:async()=>{reads++;return {reminders:[]};}},{list:async()=>({items:[]})});
  assert.equal(intervals.length,0,'a page opened in the background does not poll');
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await settle();
  assert.equal(intervals.length,1);assert.equal(intervals[0].ms,1000);
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(intervals.length,1,'one poll, however often the page reports visible');
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(stopped,[1],'the poll stops when the page is hidden');
  const before=reads;intervals[0].run();await settle();assert.equal(reads,before,'and a late tick reads nothing');
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(intervals.length,2,'it starts again when the page returns');
});

test('a repeating browser event whose skipped date maps to the next day is emitted once',()=>{
  const begin=Date.UTC(2026,10,1,9),skipped='2026-11-03';
  const ctx=vm.createContext({Date,Number,Math,Set,Error,
    calendarWall:instant=>new Date(instant).toISOString().slice(0,-1),
    // The zone has no 3 November: its wall time resolves to the same instant as 4 November's.
    calendarInstant:wall=>Date.parse((wall.startsWith(skipped)?wall.replace(skipped,'2026-11-04'):wall)+'Z')});
  vm.runInContext(load('apps/app/src/browser/calendar-recurrence.ts')+'\nglobalThis.expand=expandCalendarSeries;',ctx);
  const row={id:'series',begin,end:begin+3600000,timeZone:'UTC',repeat:'daily'};
  const {events,truncated}=ctx.expand(row,{begin:Date.UTC(2026,10,1),end:Date.UTC(2026,10,8)});
  assert.equal(truncated,false);
  assert.deepEqual(Array.from(events,event=>new Date(event.begin).toISOString().slice(0,10)),['2026-11-01','2026-11-02','2026-11-04','2026-11-05','2026-11-06','2026-11-07']);
  assert.equal(new Set(Array.from(events,event=>event.id)).size,events.length);
  const year=ctx.expand(row,{begin:Date.UTC(2026,10,1),end:Date.UTC(2027,10,1)},400);
  assert.equal(year.events.length,364);assert.equal(new Set(Array.from(year.events,event=>event.begin)).size,364);
  assert.equal(ctx.expand(row,{begin:Date.UTC(2026,10,1),end:Date.UTC(2027,10,1)},10).truncated,true);
});
