// The unconfirmed-write hold on one device event, exercised on the shipped Calendar adapter with a
// synthetic provider: no browser, Android or provider access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const load=path=>stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const daysSource=load('apps/app/src/prototype/calendar-days.ts'),adapterSource=load('apps/app/src/prototype/calendar-adapter.ts');
// Friday 6 November 2026, 10:00 local time.
const start=new Date(2026,10,6,10).getTime(),HOUR=3600000;
const settle=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
const event=()=>({id:'7',calendarId:'local',title:'Standup',begin:start+HOUR,end:start+2*HOUR});

async function deviceCalendar(){
  let now=start;class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const calls=[],toasts=[],state={events:[],day:0,month:null,open:null,form:null,calPrefs:{}};
  const provider={events:[event()],removal:async()=>({status:'unknown'}),
    async requestAccess(){return {status:'granted'};},
    async list(range){calls.push('list');return {status:'ready',events:provider.events,calendars:[{id:'local',local:true,writable:true,account:'Alpha Phone',name:'Phone'}],truncated:false,range};},
    async pendingCreations(){return {status:'ready',creations:[]};},
    async inspect(){return {status:'ready',revision:'r1'};},
    async inspectDeletion(){calls.push('inspectDeletion');return {status:'ready',eventId:'7',sourceId:'local',sourceRevision:'s1',revision:'r1'};},
    async removeScoped(){calls.push('removeScoped');return provider.removal();},
    async prepareAgentSource(){return {status:'unavailable'};}};
  const ctx=vm.createContext({Date:FixedDate,Intl,JSON,Map,Math,Number,Object,Promise,console,queueMicrotask,crypto,
    setTimeout:()=>1,clearTimeout(){},
    window:Object.assign(new EventTarget(),{confirm:()=>true}),document:Object.assign(new EventTarget(),{hidden:false}),
    registerPlugin:()=>provider,Capacitor:{getPlatform:()=>'android',isNativePlatform:()=>true,isPluginAvailable:()=>true},
    DailyApps:{async addListener(){return {remove(){}};}},refreshDeletionViews(){},presentCalendarIntervals:()=>({}),
    openCalendarRecovery(){},openReminderRecovery(){},openReminderCreationRecovery(){},openReminderActionRecovery(){},
    reminderWallTime:(off,t)=>new FixedDate(new FixedDate(start).setHours(0,0,0,0)+off*24*HOUR+t*HOUR),
    calendarFormTimeProblem:()=>'',mapsEventOriginFor:()=>null,rememberNoteOrigin:async()=>true,forgetNoteOrigin:async()=>{},noteOriginSupported:()=>false,eventNoteOriginId:()=>undefined});
  vm.runInContext('const currentSurfaceLayout=()=>({split:false,calendarDays:1,agenda:false});\n'+daysSource+'\n{'+adapterSource+'\nglobalThis.install=installCalendarAdapter;}',ctx);
  class Shell{live=true;S(){return {view:'calendar'};}vget(){return state;}vset(_key,patch){Object.assign(state,patch);}async refreshReminders(){state.events=[...(this.nativeCalendarRows||[])];}toast(text){toasts.push(text);}calendarFormCommitted(){}componentDidMount(){}componentWillUnmount(){}}
  // The base renderer draws the open event; everything this adapter adds is layered on its output.
  const views={calendar:{render:current=>({hours:[],week:[],nowTop:0,events:[],calToggles:[],ev:current.open?{day:'',when:'',people:[]}:undefined})}};
  ctx.install(Shell,views);const shell=new Shell();shell.componentDidMount();await settle();
  const api={now:new FixedDate(),get:()=>state,set:patch=>Object.assign(state,patch),isActive:()=>true,toast:text=>toasts.push(text),open(){}};
  state.open=state.events[0].id;
  return {calls,toasts,state,shell,provider,detail:()=>views.calendar.render(state,api).ev,close:()=>shell.componentWillUnmount()};
}
async function unconfirmedDelete(h){
  h.detail().del();await settle();
  assert.deepEqual(h.calls.filter(name=>name==='removeScoped'),['removeScoped']);
  assert.equal(h.detail().uncertain,true);assert.equal(h.detail().busy,true);
  assert.equal(h.toasts.at(-1),'Unconfirmed');
}

test('an unconfirmed delete that did not happen is released by a refresh that still lists the event',async()=>{
  const h=await deviceCalendar();
  try{
    await unconfirmedDelete(h);
    // Held: a second delete is not dispatched before the event has been read again.
    h.detail().del();await settle();
    assert.equal(h.calls.filter(name=>name==='removeScoped').length,1);
    h.calls.length=0;h.detail().checkUncertain();await settle();
    assert.ok(h.calls.includes('list'),'the device calendars are read again');
    assert.equal(h.state.events.length,1,'the event is still listed');
    assert.equal(h.detail().uncertain,false);assert.equal(h.detail().busy,false);
    // The owner sees the event as it is and may delete it again.
    h.provider.removal=async()=>({status:'deleted'});h.provider.events=[];
    h.detail().del();await settle();
    assert.ok(h.calls.includes('removeScoped'));assert.equal(h.state.events.length,0);
  }finally{h.close();}
});

test('an unconfirmed delete whose answer was lost after dispatch is released the same way',async()=>{
  const h=await deviceCalendar();
  try{
    h.provider.removal=async()=>{throw Error('bridge closed');};
    await unconfirmedDelete(h);
    h.detail().checkUncertain();await settle();
    assert.equal(h.detail().uncertain,false);
  }finally{h.close();}
});

test('an unconfirmed delete that removed the event is released when the refresh no longer lists it',async()=>{
  const h=await deviceCalendar();
  try{
    await unconfirmedDelete(h);
    h.provider.events=[];h.detail().checkUncertain();await settle();
    assert.equal(h.shell.calendarWriteUncertain,undefined);assert.equal(h.state.events.length,0);
  }finally{h.close();}
});

test('a read that is not a requested refresh, or that fails, keeps the hold',async()=>{
  const h=await deviceCalendar();
  try{
    await unconfirmedDelete(h);
    // Loading another range is not a check of the outcome.
    h.calls.length=0;h.state.day=120;h.detail();await settle();
    h.state.day=0;h.detail();await settle();
    assert.ok(h.calls.filter(name=>name==='list').length>=2,'both ranges were loaded');
    assert.equal(h.shell.calendarWriteUncertain?.kind,'delete');
    const list=h.provider.list;h.provider.list=async()=>{throw Error('unavailable');};
    h.detail().checkUncertain();await settle();
    assert.equal(h.shell.calendarWriteUncertain?.kind,'delete');
    h.provider.list=list;await h.shell.refreshAgentCalendar();await settle();
    assert.equal(h.shell.calendarWriteUncertain,undefined);
  }finally{h.close();}
});
