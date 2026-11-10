// Real calendar adapter state transitions with a controlled native boundary.
// The native confirmation/provider assertions require CalendarCrudInstrumentedTest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CalendarFixtureShell, installCalendarFixture} from './fixtures/calendar-adapter.ts';
import type {CalendarFixtureState, CalendarFixtureApi, CalendarFixtureView} from './fixtures/calendar-adapter.ts';
import {mapsEventOriginFor} from '../apps/app/src/runtime/maps-event-return.ts';
// The adapter imports reminderWallTime through runtime/reminder-creations, which re-exports the shared journal's.
import {reminderWallTime} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(12,0,0,0);
// creationId: the pinned reader returns it on events Alpha created (elizaOS/eliza#35912); note links use it.
const creation='0f8fad5b-d9cb-469f-a165-70867728950e';
const event={id:'71',creationId:creation,calendarId:'19',title:'Reviewed local fixture',body:'Original',location:'Here',begin:tomorrow.getTime(),end:tomorrow.getTime()+3600000,allDay:false,recurring:false};
let exists=true,removeStatus='cancelled',inspectStatus='ready',listReads=0;
let holdInspect: Promise<{status: string; revision: string}> | undefined;
const calendarEvents=new EventTarget();
const calls: [method: string, ...args: unknown[]][] = [];
const toasts: string[] = [], opened: [string, unknown][] = [], forgotten: [string, string][] = [];
const calendar = {
 pendingCreations: async () => ({status: 'ready', creations: []}),
 list: async () => {
  listReads++;
  return {status: 'ready', calendars: [{id:'19', name:'On this phone', local:true, account:'Alpha Phone', writable:true}], events: exists ? [event] : []};
 },
 inspect: async (args: unknown) => {
  calls.push(['inspect', structuredClone(args)]);
  return holdInspect ?? {status: inspectStatus, revision: 'reviewed-revision'};
 },
 inspectDeletion: async (args: unknown) => {
  calls.push(['inspectDeletion', structuredClone(args)]);
  return holdInspect ?? {status: inspectStatus, revision: 'reviewed-revision', eventId:'delete2:71:event', sourceId:'19', sourceRevision:'reviewed-source'};
 },
 remove: async (args: unknown) => {
  calls.push(['remove', structuredClone(args)]);
  if (removeStatus === 'deleted') exists = false;
  return {status: removeStatus};
 },
 removeScoped: async (args: unknown) => {
  calls.push(['removeScoped', structuredClone(args)]);
  if (removeStatus === 'deleted') exists = false;
  return {status: removeStatus};
 },
 open: async () => calls.push(['open']),
 requestAccess: async () => ({status: 'granted'}),
 save: async (args: unknown) => {
  calls.push(['save', structuredClone(args)]);
  return {status: 'conflict'};
 },
};
const state: CalendarFixtureState = {day:1,month:null,events:[]};
const views: {calendar: CalendarFixtureView} = {calendar:{render:()=>({events:[],hours:[],week:[],mdays:[],ev:{},f:state.form?{cals:[]}:null})}};
const api: CalendarFixtureApi = {now:Date.now(),open:(view,patch)=>opened.push([view,structuredClone(patch)]),isActive:()=>true,track:()=>'',kx:()=>0,toast:text=>toasts.push(text),set:patch=>Object.assign(state,patch),get:()=>state};
class Shell extends CalendarFixtureShell {
 vget(){return state;}
 vset(_view: string,patch: Partial<CalendarFixtureState>){Object.assign(state,patch);}
 async refreshReminders(){state.events=this.nativeCalendarRows??[];}
}
assert.match(fs.readFileSync(new URL('../apps/app/src/prototype/calendar-adapter.ts',import.meta.url),'utf8'),/^import \{reminderWallTime\} from '\.\.\/runtime\/reminder-creations';$/m,'The adapter takes its wall time from the runtime reminder module');
assert.match(fs.readFileSync(new URL('../apps/app/src/runtime/reminder-creations.ts',import.meta.url),'utf8'),/export \{[^}]*\breminderWallTime\b[^}]*\} from '[^']*\/plugin-assistant\/src\/services\/device-actions\/reminder-journal\.ts';/,'The runtime reminder module re-exports the shared journal wall time the harness injects');
installCalendarFixture({
 Shell, views, calendar, window:calendarEvents, mapsEventOriginFor, reminderWallTime,
 noteOriginSupported:(kind: string)=>kind==='event'||kind==='reminder',
 eventNoteOriginId:(value: {creationId?: unknown} | undefined)=>typeof value?.creationId==='string'?value.creationId:undefined,
 rememberNoteOrigin:async()=>{throw Error('Native events are not linked to notes');},
 forgetNoteOrigin:async(kind: string,id: string)=>{forgotten.push([kind,id]);},
});
const shell=new Shell();shell.componentDidMount();await new Promise(r=>setTimeout(r,0));
const select=()=>{
 state.open=state.events[0].id;
 const rendering=views.calendar.render(state,api), detail=rendering.ev;
 assert.ok(detail?.edit && detail.del && detail.goWhere && detail.checkUncertain, 'Expected event review controls');
 return {...rendering,ev:{...detail,edit:detail.edit,del:detail.del,goWhere:detail.goWhere,checkUncertain:detail.checkUncertain}};
};
state.reminderStale=true;assert.equal(select().reminderRecovery,false,'Native reminders do not offer browser document recovery');delete state.reminderStale;
select().ev.goWhere();assert.deepEqual(opened,[['maps',{query:'Here',fromEvent:{version:1,id:'71',begin:event.begin,rowId:state.events[0].id,day:1,title:event.title}}]],'The location hand-off names exactly the open event and carries only its identity');
await select().ev.edit();assert.ok(state.form?.expected);assert.equal(state.form.expected.revision,'reviewed-revision');assert.equal(state.form.expected.title,event.title);state.form=null;
await select().ev.del();assert.equal(exists,true);const removal=calls.at(-1);assert.ok(removal);assert.equal(removal[0],'removeScoped');assert.deepEqual(removal[1],{eventId:'delete2:71:event',sourceId:'19',sourceRevision:'reviewed-source',revision:'reviewed-revision'});assert.equal(calls.filter(c=>c[0]==='remove').length,0,'Native deletion never reaches the legacy remove method');assert.equal(state.open,state.events[0].id);
inspectStatus='conflict';const before=calls.filter(c=>c[0]==='removeScoped').length;await select().ev.del();assert.equal(calls.filter(c=>c[0]==='removeScoped').length,before,'Stale selection cannot reach mutation');
inspectStatus='external';const openedBefore=calls.filter(c=>c[0]==='open').length;await select().ev.del();assert.equal(calls.filter(c=>c[0]==='open').length,openedBefore+1,'External scope opens exactly one reviewed handoff despite concurrent metadata inspection');assert.equal(calls.filter(c=>c[0]==='removeScoped').length,before,'Unsupported scope uses explicit handoff');
inspectStatus='ready';removeStatus='unknown';await select().ev.del();assert.deepEqual({...shell.calendarWriteUncertain},{eventId:'71',kind:'delete',begin:event.begin});await select().ev.del();assert.equal(calls.filter(c=>c[0]==='removeScoped').length,before+1,'Unknown outcome blocks repeat until refresh');
assert.equal(select().ev.busy,true);assert.equal(select().ev.uncertain,true,'The open event says its last change is unconfirmed');
await select().ev.checkUncertain();await new Promise(r=>setTimeout(r,0));assert.equal(select().ev.uncertain,true,'A read that still finds the event keeps an unknown delete held');
exists=false;await shell.refreshAgentCalendar();assert.equal(shell.calendarWriteUncertain,undefined,'A forced read without the event clears an unknown delete');exists=true;await shell.refreshAgentCalendar();assert.equal(select().ev.busy,false);
assert.deepEqual(forgotten,[],'Cancelled, stale, external and unknown deletions keep any note link');
removeStatus='deleted';await select().ev.del();assert.equal(exists,false);assert.equal(state.open,null);assert.equal(state.events.length,0);assert.deepEqual(forgotten,[['event',creation]],'A confirmed deletion drops only that event link, keyed by its creationId (never the reusable row id)');
const draft={title:'Unsent calendar draft',notes:'Keep this text',cal:'native:local'},beforeRefresh=listReads;state.form=draft;
exists=true;calendarEvents.dispatchEvent(new Event('alpha:calendar-committed'));await new Promise(r=>setTimeout(r,0));
assert.equal(listReads,beforeRefresh+1,'Native committed receipt refreshes the existing provider list');assert.equal(state.events.length,1);assert.equal(state.events[0].alphaCalendarId,event.id);assert.equal(state.form,draft,'Receipt refresh preserves the current unsaved form');
state.form=null;
const openRow=select().ev&&state.open;await new Promise(r=>setTimeout(r,0));assert.equal(shell.calendarSelection()?.id,'71');
calendarEvents.dispatchEvent(new CustomEvent('alpha:calendar-committed',{detail:{eventId:'72'}}));await new Promise(r=>setTimeout(r,0));
assert.equal(state.open,openRow,'A background commit to another event keeps the open detail');assert.equal(shell.calendarSelection()?.id,'71','and its agent selection');
calendarEvents.dispatchEvent(new CustomEvent('alpha:calendar-committed',{detail:{eventId:'71'}}));await new Promise(r=>setTimeout(r,0));assert.equal(state.open,null,'A commit to the open event closes it');
exists=true;shell.componentWillUnmount();const second=new Shell();second.componentDidMount();await new Promise(r=>setTimeout(r,0));let release: ((value: {status: string; revision: string}) => void) | undefined;holdInspect=new Promise(resolve=>{release=resolve;});const pending=select().ev.del();second.componentWillUnmount();const closedReads=listReads;calendarEvents.dispatchEvent(new Event('alpha:calendar-committed'));await new Promise(r=>setTimeout(r,0));assert.equal(listReads,closedReads,'Unmount removes the committed receipt listener');const count=calls.filter(c=>c[0]==='removeScoped').length;assert.ok(release);release({status:'ready',revision:'late'});await pending;assert.equal(calls.filter(c=>c[0]==='removeScoped').length,count,'Unmounted selection cannot show delete confirmation');
console.log('PASS actual Calendar adapter: revision-bound edit/delete, cancellation, conflict, external handoff, unknown no-repeat, deletion refresh, native committed receipt refresh with retained draft, commits close only their own event, unknown delete held until a read shows it, unmount cancellation. Native provider acceptance separate.');
