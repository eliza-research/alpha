import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes,createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const sdk='.eliza/client-features';
const {WebPlugin}=createRequire(import.meta.url)('@capacitor/core');
const read=p=>readFileSync(p,'utf8');
const code=source=>stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function evaluate(path,names,deps={}){return new Function(...Object.keys(deps),code(read(path))+';return {'+names+'};')(...Object.values(deps));}
// In-memory implementation of the normal transactional Documents port. All domain,
// browser adapter, initialization, preservation, controller and memo code is real.
class MemoryDocuments {
 rows=new Map();writes=0;
 async read(key){return structuredClone(this.rows.get(key));}
 async readOrCreate(key,raw){if(!this.rows.has(key))return this.compareExchange(key,undefined,raw);return this.read(key);}
 async compareExchange(key,expected,raw){assert.deepEqual(this.rows.get(key),expected);const next={revision:String(++this.writes),raw};this.rows.set(key,next);return structuredClone(next);}
 async edit(key,editor){const before=await this.read(key),next=await editor(before);await this.compareExchange(key,before,next.raw);return next.result;}
}
function fixture(){
 const documents=new MemoryDocuments(),events=new EventTarget(),localStorage={getItem:()=>null};
 const {BrowserDomainDocument}=evaluate('apps/app/src/browser/domain-document.ts','BrowserDomainDocument');
 const {revision}=evaluate('apps/app/src/browser/revision.ts','revision');
 const {guardPendingCalendarChanges}=evaluate('apps/app/src/browser/calendar-deletions.ts','guardPendingCalendarChanges');
 const {calendarDocument,prepareCalendarSource,initialCalendarState}=evaluate('apps/app/src/browser/calendar-store.ts','calendarDocument,prepareCalendarSource,initialCalendarState',{BrowserDomainDocument,browserDocuments:documents,localStorage,revision,guardPendingCalendarChanges,BroadcastChannel:undefined,window:events});
 const {BrowserReviews}=evaluate('apps/app/src/browser/review.ts','BrowserReviews',{browserScreenLocked:()=>{throw Error('No review permitted');}});
 const {calendarSource,calendarTarget}=evaluate(sdk+'/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts','calendarSource,calendarTarget');
 const {BrowserCalendar}=evaluate('apps/app/src/browser/calendar.ts','BrowserCalendar',{WebPlugin,BrowserReviews,calendarDocument,prepareCalendarSource});
 const browser=new BrowserCalendar();
 const {SingleFlightMemo}=evaluate(sdk+'/packages/core/src/runtime/single-flight-memo.ts','SingleFlightMemo');
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 const slice=ui.slice(ui.indexOf('type CalendarAgendaSourceObservation='),ui.indexOf('async function deviceCapabilities'));
 const observe=vm.runInNewContext(stripTypeScriptTypes(slice,{mode:'transform'})+';calendarAgendaObservation',{SingleFlightMemo,calendarSource,calendarTarget,window:events,Capacitor:{isNativePlatform:()=>false},registerPlugin:name=>{assert.equal(name,'AlphaCalendar');return browser;}});
 let valid=true;const markers=new Map();
 const {legacyCalendarPreservation}=evaluate('apps/app/src/runtime/legacy-calendar-preservation.ts','legacyCalendarPreservation',{calendarDocument});
 const preservation=legacyCalendarPreservation({has:async(owner,fingerprint)=>markers.get(owner)===fingerprint,retain:async(owner,fingerprint)=>{markers.set(owner,fingerprint);}});
 const unexpected=()=>{throw Error('No mutation/editor/default client allowed');};
 const {AgentCalendar}=evaluate('apps/app/src/runtime/agent-calendar.ts','AgentCalendar',{agentCalendarClient:unexpected,eventEditorMutability:unexpected,cancellationModeForEditorEvent:unexpected});
 const port={identity:{origin:'https://synthetic.invalid',ownerId:'synthetic-owner',agentId:'synthetic-agent'},sessionId:'synthetic-session',scope:'synthetic-scope',current:()=>valid};
 const api={getLifeOpsCalendarFeed:async()=>({state:'complete',events:[]}),getLifeOpsCalendars:async()=>({calendars:[]}),getLifeOpsNextCalendarEventContext:async()=>({event:null,calendarFeedState:'complete'})};
 const controller=new AgentCalendar(()=>port,preservation,()=>api);
 return{documents,calendarDocument,initialCalendarState,observe,preservation,controller,markers,retire:()=>{valid=false;}};
}
test('ordinary canonical browser send must not manufacture a legacy source or quarantine a fresh owner',async()=>{
 const f=fixture();assert.equal(await f.calendarDocument.readRaw(),null);assert.equal(f.documents.writes,0);
 await f.controller.refresh({});assert.equal(f.controller.state.status,'ready');
 const observed=await f.observe({supportsCalendarAgenda:true},{view:'calendar',revision:1,sensitive:false});assert.equal(observed,undefined);
 const raw=await f.calendarDocument.readRaw();assert.equal(raw,null);
 const capture=await f.preservation.capture(new AbortController().signal);
 await f.controller.refresh({});
 console.log('REPRO',JSON.stringify({beforeRaw:null,afterRawPresent:raw!==null,writes:f.documents.writes,capturePresent:capture.present,status:f.controller.state.status,sourceObservation:observed??null,retentionMarkers:f.markers.size}));
 assert.equal(f.controller.state.status,'ready','Canonical send capability observation must not create a saved-calendar transition');
});
test('real existing records remain protected and byte-identical without automatic approval',async()=>{
 const f=fixture(),record={id:'old-event',calendarId:'local',title:'Preserved synthetic event',begin:1000,end:2000,repeat:'none'};
 await f.calendarDocument.edit(f.initialCalendarState,data=>{data.events.push(record);});const before=await f.calendarDocument.capture();
 await f.controller.refresh({});assert.equal(f.controller.state.status,'transition-required');assert.deepEqual(f.controller.state.legacy.records,[record]);assert.equal(f.markers.size,0);
 await f.observe({supportsCalendarAgenda:true},{view:'calendar',revision:1,sensitive:false,selectedObject:{kind:'legacy-app-calendar-source',id:'legacy-app-calendar',accountId:'device-local-legacy',revision:'a'.repeat(64)}});assert.deepEqual(await f.calendarDocument.capture(),before);assert.equal(f.markers.size,0);
});
test('pending creations stay in recovery and cannot be confirmed away',async()=>{
 const f=fixture();await f.calendarDocument.edit(f.initialCalendarState,data=>{data.creations={pending:{acknowledged:false}};});const before=await f.calendarDocument.capture();
 await f.controller.refresh({});assert.equal(f.controller.state.status,'legacy-recovery');await assert.rejects(f.controller.confirmLegacyRetention(),/Saved app calendar changed/);assert.deepEqual(await f.calendarDocument.capture(),before);assert.equal(f.markers.size,0);
});
test('changed owner cannot approve genuine retained inventory',async()=>{
 const f=fixture();await f.calendarDocument.edit(f.initialCalendarState,data=>{data.events.push({id:'old',calendarId:'local',title:'Kept',begin:1,end:2});});await f.controller.refresh({});
 f.retire();await assert.rejects(f.controller.confirmLegacyRetention(),/owner or agent changed/);assert.equal(f.markers.size,0);
});

const context=(selection,patch={})=>({view:'calendar',revision:1,sensitive:false,...(selection?{selectedObject:selection}:{}),...patch});
const native=(revision='a'.repeat(64))=>({kind:'calendar-source',id:'local',revision,accountId:'local',sourceRevision:revision});
test('canonical/home/private/recovery/unknown selections never initialize the browser domain',async()=>{
 for(const ctx of [context(),context(undefined,{view:'home'}),context(native(),{sensitive:true}),context({kind:'canonical-calendar-source',id:'primary'}),context({kind:'canonical-calendar-event',id:'canonical'}),context({kind:'legacy-app-calendar-source',id:'legacy-app-calendar'}),context({kind:'unknown',id:'x'}),context({...native(),revision:'invalid'}),context({...native(),accountId:'other'}),context({...native(),id:'foreign',accountId:'foreign'})]){
  const f=fixture();assert.equal(await f.observe({supportsCalendarAgenda:true},ctx),undefined);assert.equal(f.documents.writes,0);assert.equal(await f.calendarDocument.readRaw(),null);
 }
});
test('valid explicit native source and event retain the existing read preparation path without modifying records',async()=>{
 const f=fixture();await f.calendarDocument.edit(f.initialCalendarState,data=>data);const before=await f.calendarDocument.capture(),revision=JSON.parse(before.raw).sourceRevision,actions={supportsCalendarAgenda:true};
 assert.equal((await f.observe(actions,context(native(revision)))).sourceRevision,revision);
 assert.equal((await f.observe(actions,context({kind:'calendar-event',id:'synthetic-event',revision:'b'.repeat(64),accountId:'local',sourceRevision:revision}))).sourceRevision,revision);
 assert.deepEqual(await f.calendarDocument.capture(),before);assert.equal(f.markers.size,0);
});
test('captured source identity cannot be replaced by context mutation or a cached different source',async()=>{
 const f=fixture();await f.calendarDocument.edit(f.initialCalendarState,data=>data);const revision=JSON.parse(await f.calendarDocument.readRaw()).sourceRevision,actions={supportsCalendarAgenda:true},ctx=context(native(revision));
 const pending=f.observe(actions,ctx);ctx.selectedObject=native('c'.repeat(64));assert.equal((await pending).sourceRevision,revision);
 assert.equal(await f.observe(actions,context()),undefined);
 assert.equal(await f.observe(actions,context(native('c'.repeat(64)))),undefined);
 assert.equal((await f.observe(actions,context(native(revision)))).sourceRevision,revision);
});
test('retired owner binding before queued initialization cannot create browser data',async()=>{
 const f=fixture();let current=true;const pending=f.observe({supportsCalendarAgenda:true},context(native()),()=>{if(!current)throw Error('Owner changed');});current=false;
 assert.equal(await pending,undefined);assert.equal(f.documents.writes,0);assert.equal(await f.calendarDocument.readRaw(),null);
});
