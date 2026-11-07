import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
import test from 'node:test';
// Entire real controller, with only its external client/editor imports replaced.
// Reads and accepted writes use injected synthetic ports; zero provider/native I/O.
const text=readFileSync('apps/app/src/runtime/agent-calendar.ts','utf8');
const code=stripTypeScriptTypes(text.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const unexpected=()=>{throw Error('Unexpected editor/default client dependency');};
const {AgentCalendar}=new Function('agentCalendarClient','eventEditorMutability','cancellationModeForEditorEvent',code+';return {AgentCalendar};')(unexpected,unexpected,unexpected);
const view=readFileSync('apps/app/src/runtime/agent-calendar-view.ts','utf8');
const homeCode=stripTypeScriptTypes(view.slice(view.indexOf('export function canonicalHomeCalendar(')).replace(/^export /,''),{mode:'strip'});
const home=new Function(homeCode+';return canonicalHomeCalendar;')();
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function fixture(){
 let active=true,capture=async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]});
 const source={provider:'google',side:'owner',grantId:'grant',connectorAccountId:'account',accountEmail:null,calendarId:'primary',summary:'Owned calendar',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'UTC',selected:true,includeInFeed:true,selectionVersion:1};
 const event={id:'event',externalId:'event',agentId:'agent',provider:'google',side:'owner',grantId:'grant',connectorAccountId:'account',calendarId:'primary',title:'Owned event',description:'',location:'',status:'confirmed',startAt:'2999-01-01T09:00:00Z',endAt:'2999-01-01T10:00:00Z',timezone:'UTC',isAllDay:false,htmlLink:null,conferenceLink:null,organizer:{self:true},attendees:[],metadata:{}};
 const next={event,calendarFeedState:'complete',readScope:{timeMin:'2026-01-01',timeMax:'2999-01-02'}};
 const port={identity:{origin:'https://fixture.invalid',ownerId:'owner',agentId:'agent'},sessionId:'session',scope:'owner',current:()=>active};
 const reads=[],writes=[],api={getLifeOpsCalendarFeed:async()=>{reads.push('feed');return{state:'complete',events:[]};},getLifeOpsCalendars:async()=>({calendars:[source]}),getLifeOpsNextCalendarEventContext:async()=>next,createLifeOpsCalendarEvent:async x=>{writes.push(x);return{outcome:'accepted_without_readback'};}};
 const calendar=new AgentCalendar(()=>port,{capture:s=>capture(s),retainedReadOnly:async()=>true},()=>api);
 await calendar.refresh({});return{calendar,source,event,next,port,api,reads,writes,capture:fn=>capture=fn,retire:()=>{active=false;calendar.retire();}};
}
test('next read failure keeps a same-source cached event but never presents it as verified',async()=>{
 const f=await fixture();assert.equal(f.calendar.state.nextFresh,true);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,true);
 f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'ready');assert.equal(f.calendar.state.next,f.next);assert.equal(f.calendar.state.nextFresh,false);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,false);assert.match(f.calendar.state.error,/unverified/);f.retire();
});
test('partial coverage and feed failure never mark next as verified',async()=>{
 const f=await fixture();f.api.getLifeOpsCalendarFeed=async()=>({state:'partial',events:[]});await f.calendar.refresh({});assert.equal(f.calendar.state.nextFresh,false);
 f.api.getLifeOpsCalendarFeed=async()=>{throw Error('Feed unavailable');};await f.calendar.refresh({});assert.equal(f.calendar.state.feed,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,false);f.retire();
});
test('source failure, removed source and another agent cannot publish a verified next event',async()=>{
 const f=await fixture();f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};f.api.getLifeOpsCalendars=async()=>({calendars:[]});await f.calendar.refresh({});assert.equal(f.calendar.state.next,null);
 const g=await fixture();g.api.getLifeOpsCalendars=async()=>{throw Error('Sources unavailable');};await g.calendar.refresh({});assert.equal(g.calendar.state.next,null);
 const h=await fixture();h.api.getLifeOpsNextCalendarEventContext=async()=>({...h.next,event:{...h.event,agentId:'other'}});await h.calendar.refresh({});assert.equal(h.calendar.state.next,null);assert.equal(h.calendar.state.nextFresh,false);f.retire();g.retire();h.retire();
});
test('session and query changes cannot keep another binding cached after a failed read',async()=>{
 for(const sessionChange of [true,false]){const f=await fixture();if(sessionChange)f.port.sessionId='new-session';f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh(sessionChange?{}:{timeZone:'UTC'});assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);f.retire();}
});
test('all refresh triggers coalesce behind a pending mutation without aborting its signal',async()=>{
 const f=await fixture(),held=defer(),snapshot={fingerprint:'same',present:false,readable:true,pending:false,records:[]};let mutationSignal,captures=0;
 f.capture(async signal=>{if(++captures===1){mutationSignal=signal;return held.promise;}return snapshot;});
 const create=f.calendar.create(JSON.stringify([f.source.provider,f.source.side,f.source.grantId,f.source.connectorAccountId,f.source.calendarId]),{idempotencyKey:'one',title:'One'});create.catch(()=>{});
 try{
  assert.equal(f.calendar.state.mutating,true);const count=f.reads.length;
  await f.calendar.refresh({timeZone:'UTC'});await f.calendar.refresh({timeZone:'Europe/London'});assert.equal(f.reads.length,count);assert.equal(mutationSignal.aborted,false);
  held.resolve(snapshot);await create;await flush();assert.equal(f.writes.length,1);assert.equal(f.reads.length,count+1);
 }finally{held.resolve(snapshot);await Promise.allSettled([create]);f.retire();}
});
test('retirement drops delayed replies and pending reads',async()=>{
 const f=await fixture(),held=defer();f.api.getLifeOpsCalendarFeed=()=>held.promise;const read=f.calendar.refresh({});await flush();f.retire();held.resolve({state:'complete',events:[]});await read;assert.equal(f.calendar.state.ownerKey,null);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);
});
test('event end invalidates the cached card without I/O',async()=>{
 const f=await fixture(),count=f.reads.length;f.event.endAt='2000-01-01T00:00:00Z';f.calendar.invalidateNext();assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(f.reads.length,count);f.retire();
});
test('fresh opt-out clears a cached next event when the next read fails',async()=>{
 const f=await fixture();assert.equal(f.calendar.state.nextFresh,true);f.source.includeInFeed=false;f.source.selectionVersion=2;f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh({});assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);f.retire();
});
test('fresh next from an excluded or revoked source is never admitted, including an explicit hidden feed query',async()=>{
 for(const change of [s=>s.includeInFeed=false,s=>s.accessRole='freeBusyReader',s=>s.accessRole='none']){const f=await fixture();change(f.source);f.source.selectionVersion=2;await f.calendar.refresh({includeHiddenCalendars:true});assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);f.retire();}
});
test('a cached event is cleared when the source no longer grants readable event details',async()=>{
 const f=await fixture();f.source.accessRole='freeBusyReader';f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh({});assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);f.retire();
});
test('included readable source remains eligible; selectionVersion or provider selected flag is not feed opt-out',async()=>{
 const f=await fixture();f.source.selectionVersion=2;f.source.selected=false;f.source.accessRole='reader';f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh({});assert.equal(f.calendar.state.next,f.next);assert.equal(f.calendar.state.nextFresh,false);f.retire();
});
test('foreign next event keeps the specific owner refusal before the source/end-time guard',async()=>{
 const f=await fixture();f.next.event={...f.event,agentId:'another-agent'};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'error');assert.match(f.calendar.state.error,/another agent/);assert.equal(f.calendar.state.feed,null);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(f.writes.length,0);f.retire();
});
test('an identical refresh while reading queues one trailing read instead of aborting and stacking resident reads; a changed window still aborts all three',async()=>{
 // The resident keeps serving an aborted read (next-context ignores disconnect), so abort-and-restart of the
 // same query only stacks Cloud work. Each read set uses the client bound to its refresh signal, as agentCalendarClient does.
 const f=await fixture(),signals=[],held=[],zones=[],idle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};
 const client=(_port,signal)=>{signals.push(signal);return {...f.api,getLifeOpsCalendarFeed:async window=>{zones.push(window.timeZone??null);signal.throwIfAborted();return{state:'complete',events:[]};},getLifeOpsNextCalendarEventContext:()=>new Promise((resolve,reject)=>{held.push(()=>resolve(f.next));signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})};};
 const calendar=new AgentCalendar(()=>f.port,{capture:async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true},client);
 const first=calendar.refresh({});await idle();const repeats=[calendar.refresh({}),calendar.refresh({})];await idle();
 assert.equal(signals.length,1);assert.equal(signals[0].aborted,false);assert.equal(held.length,1);
 held[0]();await first;await Promise.all(repeats);await idle();
 assert.equal(calendar.state.status,'loading');assert.equal(signals.length,2,'one trailing read set for both repeats');
 held[1]();await idle();assert.equal(calendar.state.status,'ready');assert.equal(calendar.state.nextFresh,true);
 const london=calendar.refresh({timeZone:'Europe/London'});await idle();const repeat=calendar.refresh({timeZone:'Europe/London'});await idle();
 const paris=calendar.refresh({timeZone:'Europe/Paris'});await idle();
 assert.equal(signals[2].aborted,true,'a changed window aborts feed, sources and next-context of the read it supersedes');
 held[3]();await Promise.all([london,repeat,paris]);await idle();
 assert.deepEqual(zones,[null,null,'Europe/London','Europe/Paris'],'the superseded window never runs as a trailing read');
 assert.equal(signals.length,4);assert.equal(calendar.state.status,'ready');calendar.retire();f.retire();
});
