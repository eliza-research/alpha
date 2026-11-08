// Actual Calendar adapter with a deliberately delayed provider boundary.
// Host lifecycle proof only; native CalendarProvider acceptance remains separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const pending=[],calls=[];
const calendar={list:range=>{calls.push(range);return new Promise(resolve=>pending.push(resolve));}};
const DailyApps={addListener:async()=>({remove(){}})};
const views={calendar:{render:()=>({events:[],hours:[],week:[],mdays:[]})}};
let state={day:0,month:null,events:[]},shell;
const api={now:Date.now(),track:()=>'',kx:()=>0,toast(){},set:patch=>Object.assign(state,patch)};
class Shell {
 live=true;
 componentDidMount(){} componentWillUnmount(){}
 vget(){return state;}
 vset(view,patch){Object.assign(state,patch);views.calendar.render(state,api);}
 async refreshReminders(){state.events=this.nativeCalendarRows||[];}
}
const calendarDaysSource=stripTypeScriptTypes('const currentSurfaceLayout=()=>({split:false,calendarDays:1});\n'+fs.readFileSync(new URL('../apps/app/src/prototype/calendar-days.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const intervalSource=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/prototype/calendar-interval-presentation.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
let source=fs.readFileSync(new URL('../apps/app/src/prototype/calendar-adapter.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace("const calendar = registerPlugin<any>('AlphaCalendar');",'').replace(/^export /gm,'');
source=stripTypeScriptTypes(source);
vm.runInNewContext(calendarDaysSource+'\n{'+intervalSource+'\nglobalThis.presentCalendarIntervals=presentCalendarIntervals;}\n'+source+'\ninstallCalendarAdapter(Shell,views);',{window:new EventTarget(),document:{hidden:false},openCalendarRecovery:()=>{throw Error('Browser recovery must not open in native fixture');},openReminderRecovery:()=>{throw Error('Browser reminder recovery must not open in native fixture');},openReminderActionRecovery:()=>{throw Error('Browser action recovery must not open in native fixture');},openReminderCreationRecovery:()=>{throw Error('Browser reminder creation recovery must not open in native fixture');},Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true},calendar,DailyApps,Shell,views,Date,queueMicrotask,console,mapsEventOriginFor:()=>undefined,noteOriginSupported:()=>false,rememberNoteOrigin:async()=>false,forgetNoteOrigin:async()=>{},eventNoteOriginId:()=>undefined});
shell=new Shell();shell.componentDidMount();
assert.equal(calls.length,1);const initial=calls[0];
// Change the real adapter's visible range away and back before A settles.
state={...state,month:1};views.calendar.render(state,api);
state={...state,month:null};views.calendar.render(state,api);
pending.shift()({status:'ready',calendars:[],events:[],truncated:false});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls.length,2,'Invalidated A must be queried again after A→B→A');
assert.equal(calls[1].begin,initial.begin);assert.equal(calls[1].end,initial.end);
const begin=Date.now();
pending.shift()({status:'ready',calendars:[{id:'fixture',name:'Fixture calendar',account:'Fixture account'}],events:[{id:'fixture-current',calendarId:'fixture',title:'Current range',begin,end:begin+60000}],truncated:false});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(state.events.length,1);assert.equal(state.events[0].alphaCalendarId,'fixture-current');
const sourceDisplay=views.calendar.displaySources();
assert.equal(sourceDisplay.native,true);assert.equal(sourceDisplay.ready,true);assert.equal(sourceDisplay.loading,false);assert.equal(sourceDisplay.error,false);assert.equal(sourceDisplay.status,'Device calendar access allowed');
assert.equal(sourceDisplay.sources.length,1);assert.equal(sourceDisplay.sources[0].id,'fixture');assert.equal(sourceDisplay.sources[0].name,'Fixture calendar');assert.equal(sourceDisplay.sources[0].account,'Fixture account');
await sourceDisplay.sources[0].change('visibility');
assert.equal(calls.length,2,'Reading display sources and the native read-only row must not issue another range query');
shell.componentWillUnmount();
console.log('PASS real Calendar adapter delayed A→B→A discards stale result then loads current range. Host boundary fixture only.');
