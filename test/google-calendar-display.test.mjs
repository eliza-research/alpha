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
const nativeSource=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const at=(day,hour)=>new Date(2026,9,day,hour).getTime();
const instant=at(13,12);
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
const event=(patch={})=>({id:'google:grant:calendar:event',calendarId:'google:grant:calendar',providerEventId:'event',title:'Owned Google event',body:'Owned body',location:'',begin:at(13,12),end:at(13,13),allDay:false,timeZone:'UTC',revision:'synthetic',source:'google',readOnly:true,...patch});
async function harness(events,{day=0,personal=true,days=1}={}){
  let view='calendar',allowRead=true,pendingRead=null;
  let selected={connectionId:'grant',sourceId:'google:grant:calendar',name:'Owned Google calendar',account:'owner@example.test'};
  const listeners=new EventTarget(),writes=[],cloud={client:{},sessionId:'session',credentialId:'credential'};
  const state={events:[],day,month:null,open:null,form:null,calPrefs:{personal:{on:personal}}};
  const localCalendar={async list(){return {status:'ready',events:[],calendars:[{id:'local',local:true,visible:personal,color:'acc'}]};},async pendingCreations(){return {status:'ready',creations:[]};}};
  const ctx=vm.createContext({calendarDayColumnsUnderTest:days,Date:FixedDate,console,AbortController,DOMException,Intl,Event,
    IC:{},CAL_SEED:[],PEOPLE:[],DAYS:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MONS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],copy:()=>({}),
    formatHours:value=>String(value),fmtT:value=>String(value),formatHoursRange:(a,b)=>`${a}–${b}`,formatHour:value=>String(value),formatShortDate:date=>date.toISOString().slice(0,10),formatMonthTitle:date=>String(date.getMonth()),
    registerView:(_key,value)=>{ctx.view=value;},window:listeners,document:Object.assign(new EventTarget(),{hidden:false}),queueMicrotask,
    registerPlugin:()=>localCalendar,Capacitor:{getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>true},
    DailyApps:{async addListener(){return {remove(){}};}},
    openCalendarRecovery(){},openReminderRecovery(){},openReminderCreationRecovery(){},openReminderActionRecovery(){},
    connectionController:{getSnapshot:()=>({cloudAccount:null}),getCloudClient:()=>cloud,subscribe:()=>()=>{},rejectCloudSession:()=>{}},
    googleCalendarAccountKey:()=>({environment:'production',userId:'owned',organizationId:'owned'}),readGoogleCalendarSelection:()=>selected,
    currentGoogleCalendarBinding:()=>({}),googleConnectionController:{open(){}},GOOGLE_ACCOUNTS_CHANGED:'accounts',GOOGLE_CALENDAR_SELECTION_CHANGED:'selection',
    startCalendarSyncHost:()=>()=>{},calendarSyncHost:{resume:async()=>{},linkedProviderEvents:async()=>new Set()},
    GoogleCalendarReader:class{invalidate(){}selectSource(){}async listSources(){return allowRead?{status:'ready',calendars:[{id:selected.sourceId}]}:{status:'not-connected',message:'Disconnected'};}async read(){if(pendingRead)await pendingRead;return {status:'ready',events};}},
  });
  vm.runInContext(calendarDays+'\n'+calendar+'\n{'+nativeSource+'\nglobalThis.installNative=installCalendarAdapter;}\n{'+source+'\nglobalThis.install=installGoogleCalendarViewAdapter;}',ctx);
  class Shell{live=true;S(){return {view};}vget(){return state;}vset(_key,patch){Object.assign(state,patch);}async refreshReminders(){}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){}}
  ctx.installNative(Shell,{calendar:ctx.view});ctx.install(Shell,{calendar:ctx.view});const shell=new Shell();shell.componentDidMount();shell.componentDidUpdate();
  for(let i=0;i<24;i++)await Promise.resolve();
  const api={now:new FixedDate(),get:key=>key==='calendar'?state:{},set:patch=>{writes.push(patch);Object.assign(state,patch);},sw:()=>({}),track:()=>'',kx:()=>0,swallowed:()=>false,toast:()=>{},person:()=>null};
  return {render:()=>ctx.view.render(state,api),state,writes,holdNextRead(){let release;pendingRead=new Promise(resolve=>{release=resolve;});return()=>{release();pendingRead=null;};},async startRefresh(){listeners.dispatchEvent(new Event('accounts'));for(let i=0;i<8;i++)await Promise.resolve();},leave(){view='home';},revoke(){allowRead=false;listeners.dispatchEvent(new Event('accounts'));},async returnToCalendar(){view='calendar';shell.componentDidUpdate();for(let i=0;i<24;i++)await Promise.resolve();},clear(){selected=null;listeners.dispatchEvent(new Event('selection'));},close:()=>shell.componentWillUnmount()};
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
test('Google detail blocks writes and clearing its selection removes it without writing local events',async()=>{
  const h=await harness([event()]);try{
    const out=h.render();out.events[0].open();const detail=h.render();
    assert.equal(detail.ev.readOnly,true);assert.equal(detail.ev.busy,true);detail.ev.edit();detail.ev.del();
    assert.deepEqual(h.state.events,[]);assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
    h.clear();assert.equal(h.render().events.length,0);
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
