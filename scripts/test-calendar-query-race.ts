// Actual Calendar adapter with a deliberately delayed provider boundary.
// Host lifecycle proof only; native CalendarProvider acceptance remains separate.
import assert from 'node:assert/strict';
import {CalendarFixtureShell, installCalendarFixture} from './fixtures/calendar-adapter.ts';
import type {CalendarFixtureState, CalendarFixtureApi, CalendarFixtureView} from './fixtures/calendar-adapter.ts';

type Range = {begin: number; end: number};
type ProviderResult = {
 status: string;
 calendars: {id: string; name: string; account: string}[];
 events: (Range & {id: string; calendarId: string; title: string})[];
 truncated: boolean;
};
const pending: ((value: ProviderResult) => void)[] = [];
const calls: Range[] = [];
const calendar = {list: (range: Range) => {
 calls.push(range);
 return new Promise<ProviderResult>(resolve=>pending.push(resolve));
}};
const views: {calendar: CalendarFixtureView} = {calendar:{render:()=>({events:[],hours:[],week:[],mdays:[]})}};
let state: CalendarFixtureState = {day:0,month:null,events:[]};
const api: CalendarFixtureApi = {now:Date.now(),track:()=>'',kx:()=>0,toast(){},set:patch=>Object.assign(state,patch)};
class Shell extends CalendarFixtureShell {
 live=true;
 vget(){return state;}
 vset(_view: string,patch: Partial<CalendarFixtureState>){Object.assign(state,patch);views.calendar.render(state,api);}
 async refreshReminders(){state.events=this.nativeCalendarRows??[];}
}
installCalendarFixture({Shell, views, calendar});
const shell=new Shell();shell.componentDidMount();
const resolveRead = (value: ProviderResult) => {
 const resolve = pending.shift();
 assert.ok(resolve, 'Expected a pending provider range');
 resolve(value);
};
assert.equal(calls.length,1);const initial=calls[0];
// Change the real adapter's visible range away and back before A settles.
state={...state,month:1};views.calendar.render(state,api);
state={...state,month:null};views.calendar.render(state,api);
resolveRead({status:'ready',calendars:[],events:[],truncated:false});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls.length,2,'Invalidated A must be queried again after A→B→A');
assert.equal(calls[1].begin,initial.begin);assert.equal(calls[1].end,initial.end);
const begin=Date.now();
resolveRead({status:'ready',calendars:[{id:'fixture',name:'Fixture calendar',account:'Fixture account'}],events:[{id:'fixture-current',calendarId:'fixture',title:'Current range',begin,end:begin+60000}],truncated:false});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(state.events.length,1);assert.equal(state.events[0].alphaCalendarId,'fixture-current');
assert.ok(views.calendar.displaySources);
const sourceDisplay=views.calendar.displaySources();
assert.equal(sourceDisplay.native,true);assert.equal(sourceDisplay.ready,true);assert.equal(sourceDisplay.loading,false);assert.equal(sourceDisplay.error,false);assert.equal(sourceDisplay.status,'Device calendar access allowed');
assert.equal(sourceDisplay.sources.length,1);assert.equal(sourceDisplay.sources[0].id,'fixture');assert.equal(sourceDisplay.sources[0].name,'Fixture calendar');assert.equal(sourceDisplay.sources[0].account,'Fixture account');
await sourceDisplay.sources[0].change('visibility');
assert.equal(calls.length,2,'Reading display sources and the native read-only row must not issue another range query');
shell.componentWillUnmount();
console.log('PASS real Calendar adapter delayed A→B→A discards stale result then loads current range. Host boundary fixture only.');
