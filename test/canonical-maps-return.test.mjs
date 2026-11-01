import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {canonicalMapsEventOriginFor,mapsEventOriginOf,mapsEventReturnOffered,mapsEventStillThere} from '../apps/app/src/runtime/maps-event-return.ts';
const text=readFileSync('apps/app/src/runtime/agent-calendar.ts','utf8');
const code=stripTypeScriptTypes(text.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const unexpected=()=>{throw Error('Unexpected write or editor dependency');};
const {AgentCalendar,calendarEventKey}=new Function('agentCalendarClient','eventEditorMutability','cancellationModeForEditorEvent',code+';return {AgentCalendar,calendarEventKey};')(unexpected,unexpected,unexpected);
async function fixture(){
 const source={provider:'eliza',side:'owner',grantId:'eliza-calendar',connectorAccountId:'account',calendarId:'primary',summary:'Calendar',includeInFeed:true,accessRole:'owner',selectionVersion:1};
 const event={...source,id:'event',externalId:'event',agentId:'agent',title:'Owned event',startAt:'2026-10-31T12:00:00.000Z',endAt:'2026-10-31T13:00:00.000Z',status:'confirmed',metadata:{etag:'revision-one'}};
 let current=true;
 const port={identity:{origin:'https://fixture.invalid',ownerId:'owner',agentId:'agent'},sessionId:'session',scope:'owner',current:()=>current};
 const reads=[];
 const api={getLifeOpsCalendarFeed:async window=>{reads.push(window);return{state:'complete',events:[structuredClone(event)],timeMin:window.timeMin,timeMax:window.timeMax};},getLifeOpsCalendars:async()=>({calendars:[source]}),getLifeOpsNextCalendarEventContext:async()=>({event:null,calendarFeedState:'complete'})};
 const controller=new AgentCalendar(()=>port,{capture:async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true},()=>api);
 await controller.refresh({timeMin:'2026-10-01',timeMax:'2026-12-01'});
 const eventKey=calendarEventKey(event),selected=controller.selection(eventKey),input={eventKey,revision:selected.revision,sourceRevision:selected.sourceRevision,begin:Date.parse(event.startAt)};
 return {controller,api,source,event,port,reads,input,retire(){current=false;controller.retire();},check:()=>controller.verifyEventReturn(input,new AbortController().signal)};
}
test('canonical Maps return rereads exact start window and same revision without writing or replacing UI state',async()=>{
 const f=await fixture(),snapshot=structuredClone(f.controller.state);
 assert.equal(await f.check(),'found');
 assert.deepEqual(f.reads.at(-1),{timeMin:'2026-10-31T11:59:59.999Z',timeMax:'2026-10-31T12:00:00.001Z',timeZone:'UTC'});
 assert.deepEqual(f.controller.state,snapshot);
});
for(const [name,change] of [
 ['deleted',f=>f.api.getLifeOpsCalendarFeed=async w=>({state:'complete',events:[],timeMin:w.timeMin,timeMax:w.timeMax})],
 ['moved',f=>f.event.startAt='2026-10-31T12:30:00.000Z'],
 ['revised',f=>f.event.metadata.etag='revision-two'],
 ['cancelled',f=>f.event.status='cancelled'],
 ['unreadable source',f=>f.source.accessRole='none'],
 ['excluded source',f=>f.source.includeInFeed=false],
])test(`canonical Maps return refuses ${name} event`,async()=>{const f=await fixture();change(f);assert.equal(await f.check(),'missing');});
for(const [name,change] of [
 ['partial feed',f=>{const read=f.api.getLifeOpsCalendarFeed;f.api.getLifeOpsCalendarFeed=async w=>({...await read(w),state:'partial'});}],
 ['foreign agent',f=>f.event.agentId='other-agent'],
 ['ambiguous event',f=>{const read=f.api.getLifeOpsCalendarFeed;f.api.getLifeOpsCalendarFeed=async w=>{const out=await read(w);return{...out,events:[...out.events,...out.events]};};}],
 ['wrong coverage',f=>{const read=f.api.getLifeOpsCalendarFeed;f.api.getLifeOpsCalendarFeed=async w=>({...await read(w),timeMax:'2026-10-31T11:00:00Z'});}],
])test(`canonical Maps return keeps Maps on ${name}`,async()=>{const f=await fixture();change(f);assert.equal(await f.check(),'unknown');});
test('owner/session replacement during read cannot return to an old event',async()=>{
 const f=await fixture(),read=f.api.getLifeOpsCalendarFeed;
 f.api.getLifeOpsCalendarFeed=async w=>{const out=await read(w);f.port.sessionId='new-session';return out;};
 await assert.rejects(f.check(),/owner or agent changed/);
});
test('retirement and cancellation cannot complete a pending return',async()=>{
 for(const retire of [false,true]){const f=await fixture(),read=f.api.getLifeOpsCalendarFeed,abort=new AbortController();f.api.getLifeOpsCalendarFeed=async w=>{const out=await read(w);if(retire)f.retire();else abort.abort();return out;};await assert.rejects(f.controller.verifyEventReturn(f.input,abort.signal));}
});
test('canonical event origins keep exact scope and revision; legacy native matching remains separate',()=>{
 const row={id:'canonical-row',canonicalEventKey:'event-key',title:'Exact title',off:0,canonicalEvent:{id:'event',startAt:'2026-10-31T12:00:00Z'}};
 const origin=canonicalMapsEventOriginFor(row,0,'owner-session',{revision:'revision-one',sourceRevision:'a'.repeat(64)});
 assert.equal(origin.version,2);assert.equal(origin.revision,'revision-one');assert.equal(origin.binding,'owner-session');
 assert.deepEqual(mapsEventOriginOf(origin),origin);assert.deepEqual(mapsEventReturnOffered(origin,['calendar'],false),origin);
 assert.equal(mapsEventReturnOffered(origin,['notes'],false),undefined);
 assert.equal(mapsEventStillThere(origin,[{id:'event',begin:origin.begin}]),false);
 assert.equal(canonicalMapsEventOriginFor(row,0,'owner-session',undefined),undefined);
 assert.equal(mapsEventOriginOf({...origin,sourceRevision:'invalid'}),undefined);
});
test('a source without an optional connector id still verifies the same canonical event',async()=>{
 const f=await fixture();f.source.connectorAccountId=null;f.event.connectorAccountId=null;
 await f.controller.refresh({timeMin:'2026-10-01',timeMax:'2026-12-01'});
 const eventKey=calendarEventKey(f.event),selected=f.controller.selection(eventKey);
 assert.equal(await f.controller.verifyEventReturn({...f.input,eventKey,sourceRevision:selected.sourceRevision},new AbortController().signal),'found');
});
