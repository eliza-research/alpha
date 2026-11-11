import {waitFor} from './fixtures/wait-for.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import test from 'node:test';
import {eventEditorMutability,cancellationModeForEditorEvent} from '../.eliza/client-features/plugins/plugin-calendar/src/components/event-editor-policy.ts';
// Entire real controller, with only its external client/editor imports replaced.
// Reads and accepted writes use injected synthetic ports; zero provider/native I/O.
const text=readFileSync('apps/app/src/runtime/agent-calendar.ts','utf8');
const code=stripTypeScriptTypes(text.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
const unexpected=()=>{throw Error('Unexpected editor/default client dependency');};
const {AgentCalendar,calendarEventKey}=new Function('agentCalendarClient','eventEditorMutability','cancellationModeForEditorEvent',code+';return {AgentCalendar,calendarEventKey};')(unexpected,eventEditorMutability,cancellationModeForEditorEvent);
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
 const shown=f.calendar.state.feed;f.api.getLifeOpsCalendarFeed=async()=>{throw Error('Feed unavailable');};await f.calendar.refresh({});
 // A same-window re-read whose feed read fails keeps the shown feed, with the fixed owner text.
 assert.equal(f.calendar.state.feed,shown);assert.equal(f.calendar.state.status,'partial');assert.equal(f.calendar.state.error,'Calendar could not load. Try again.');assert.equal(f.calendar.state.nextFresh,false);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,false);f.retire();
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
test('foreign next event is refused with the fixed owner text and clears the feed',async()=>{
 const f=await fixture();f.next.event={...f.event,agentId:'another-agent'};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'error');assert.equal(f.calendar.state.error,'Calendar could not load. Try again.');assert.equal(f.calendar.state.feed,null);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(f.writes.length,0);f.retire();
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
 assert.equal(calendar.state.status,'ready','the trailing same-window read keeps the shown feed');assert.notEqual(calendar.state.feed,null);assert.equal(signals.length,2,'one trailing read set for both repeats');
 held[1]();await idle();assert.equal(calendar.state.status,'ready');assert.equal(calendar.state.nextFresh,true);
 const london=calendar.refresh({timeZone:'Europe/London'});await idle();const repeat=calendar.refresh({timeZone:'Europe/London'});await idle();
 const paris=calendar.refresh({timeZone:'Europe/Paris'});await idle();
 assert.equal(signals[2].aborted,true,'a changed window aborts feed, sources and next-context of the read it supersedes');
 held[3]();await Promise.all([london,repeat,paris]);await idle();
 assert.deepEqual(zones,[null,null,'Europe/London','Europe/Paris'],'the superseded window never runs as a trailing read');
 assert.equal(signals.length,4);assert.equal(calendar.state.status,'ready');calendar.retire();f.retire();
});
test('a same-window re-read never publishes a loading state or an empty feed',async()=>{
 const f=await fixture(),seen=[];const stop=f.calendar.subscribe(()=>seen.push({status:f.calendar.state.status,feed:f.calendar.state.feed,calendars:f.calendar.state.calendars.length}));
 await f.calendar.refresh({});stop();
 assert.ok(seen.length>0);for(const state of seen){assert.equal(state.status,'ready');assert.notEqual(state.feed,null);assert.equal(state.calendars,1);}
 assert.equal(f.calendar.state.nextFresh,true);f.retire();
});
test('a changed window still shows loading with a cleared feed',async()=>{
 const f=await fixture(),seen=[];const stop=f.calendar.subscribe(()=>seen.push(f.calendar.state.status));
 await f.calendar.refresh({timeZone:'Europe/London'});stop();assert.equal(seen[0],'loading');assert.equal(f.calendar.state.status,'ready');f.retire();
});
test('a next event that ended on the phone clock is dropped without failing the Calendar',async()=>{
 const f=await fixture(),feed=f.calendar.state.feed;f.api.getLifeOpsNextCalendarEventContext=async()=>({...f.next,event:{...f.event,endAt:new Date(Date.now()-500).toISOString()}});
 await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'ready');assert.equal(f.calendar.state.error,null);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);assert.notEqual(f.calendar.state.feed,null);assert.notEqual(f.calendar.state.feed,feed,'the fresh feed replaces the old one');f.retire();
});
test('a failed same-window re-read keeps the shown feed but drops the unverified next event',async()=>{
 const f=await fixture(),feed=f.calendar.state.feed;f.api.getLifeOpsCalendars=async()=>{throw Error('socket hang up');};
 await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'ready');assert.equal(f.calendar.state.feed,feed);assert.equal(f.calendar.state.calendars.length,1);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);
 assert.equal(f.calendar.state.error,'Calendar could not load. Try again.','transport text never reaches the owner');f.retire();
});
test('an integrity failure on a same-window re-read still clears the feed',async()=>{
 for(const fail of [f=>{f.api.getLifeOpsCalendarFeed=async()=>({state:'complete',events:[{...f.event,agentId:'other'}]});},f=>{f.api.getLifeOpsCalendarFeed=async()=>({state:'complete',timeMin:'2026-01-01T00:00:00Z',timeMax:'2026-02-01T00:00:00Z',events:[]});}]){
  const f=await fixture(),window={timeMin:'2026-01-02T00:00:00Z',timeMax:'2026-02-01T00:00:00Z'};f.api.getLifeOpsCalendarFeed=async()=>({state:'complete',...window,events:[]});await f.calendar.refresh(window);assert.equal(f.calendar.state.status,'ready');
  fail(f);await f.calendar.refresh(window);
  assert.equal(f.calendar.state.status,'error');assert.equal(f.calendar.state.feed,null);assert.deepEqual(f.calendar.state.calendars,[]);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.error,'Calendar could not load. Try again.');f.retire();
 }
});

// A fresh controller models a renderer reload. Use the real bounded read cache;
// provider ports remain synthetic and no mutation is replayed from local storage.
async function savedFixture(){
 const {ServiceReadCache}=await import('../apps/app/src/runtime/service-read-cache.ts');
 let raw=null;
 const cache=new ServiceReadCache('verified-cloud-owner',{read:async()=>structuredClone(raw),compareExchange:async(before,value)=>{if(JSON.stringify(raw)!==JSON.stringify(before))return 'conflict';raw=structuredClone(value);return 'saved';}});
 const f=await fixture(),window={timeMin:'2998-12-01T00:00:00Z',timeMax:'2999-02-01T00:00:00Z',timeZone:'UTC'};
 f.event.metadata.etag='saved-revision';
 const feed={calendarId:'all',state:'complete',source:'synced',sources:[],...window,syncedAt:new Date().toISOString(),events:[f.event]};
 f.api.getLifeOpsCalendarFeed=async()=>feed;
 const preservation={capture:async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true};
 const cacheIdentity=crypto.randomUUID();
 const make=(api=f.api,store=cache,port=f.port,hold=preservation,identity=()=>cacheIdentity)=>new AgentCalendar(()=>typeof port==='function'?port():port,hold,()=>api,async()=>store,identity);
 const writer=make();await writer.refresh(window);await waitFor(()=>raw?.entries.some(entry=>entry.value?.feed?.events.length===1),{label:'saved Calendar commit'});
 assert.ok(raw?.entries.some(entry=>entry.value?.feed?.events.length===1),'completed live reads are persisted');writer.retire();
 return {...f,cache,window,feed,make,raw:()=>raw,replace:value=>{raw=value;}};
}
async function settleLocal(){for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));}
test('reload shows saved rows while provider reads are pending, never authorizing edits, then replaces them',async()=>{
 const f=await savedFixture(),held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:()=>held.promise});
 const pending=calendar.refresh(f.window);await waitFor(()=>calendar.state.savedAt!==null,{label:'saved Calendar restoration'});
 assert.equal(calendar.state.status,'loading');assert.equal(calendar.state.feed.events[0].title,f.event.title);assert.equal(calendar.state.nextFresh,false);assert.ok(calendar.state.savedAt);
 assert.equal(calendar.selection(JSON.stringify([f.event.provider,f.event.side,f.event.grantId,f.event.connectorAccountId,f.event.calendarId,f.event.externalId,f.event.id])),undefined);
 assert.equal(calendar.sourceSelection(JSON.stringify([f.source.provider,f.source.side,f.source.grantId,f.source.connectorAccountId,f.source.calendarId])),undefined);
 await assert.rejects(calendar.create(JSON.stringify([f.source.provider,f.source.side,f.source.grantId,f.source.connectorAccountId,f.source.calendarId]),{idempotencyKey:'do-not-write',title:'No'}),/current Calendar source/);
 assert.throws(()=>calendar.update(JSON.stringify([f.event.provider,f.event.side,f.event.grantId,f.event.connectorAccountId,f.event.calendarId,f.event.externalId,f.event.id]),'saved-revision',{}),/Refresh this event/);
 held.resolve({...f.feed,events:[]});await pending;assert.equal(calendar.state.savedAt,null);assert.deepEqual(calendar.state.feed.events,[]);assert.equal(f.writes.length,0);calendar.retire();f.retire();
});
test('failed refresh retains validated saved rows but does not mark them fresh',async()=>{
 const f=await savedFixture(),held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:()=>held.promise});
 const pending=calendar.refresh(f.window);await settleLocal();held.resolve(Promise.reject(Error('offline')));await pending;
 assert.ok(calendar.state.savedAt);assert.equal(calendar.state.feed.events.length,1);assert.equal(calendar.state.nextFresh,false);assert.match(calendar.state.error,/could not load/);calendar.retire();f.retire();
});
test('a late local read cannot replace a fresh provider result',async()=>{
 const f=await savedFixture(),held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:async()=>({...f.feed,events:[]})},{get:()=>held.promise,put:async()=>{}});
 await calendar.refresh(f.window);held.resolve({value:f.raw().entries[0].value,at:Date.now()});await settleLocal();
 assert.equal(calendar.state.savedAt,null);assert.deepEqual(calendar.state.feed.events,[]);calendar.retire();f.retire();
});
test('saved feed refuses foreign owners, windows, malformed rows and source ambiguity',async()=>{
 const f=await savedFixture(),baseline=structuredClone(f.raw());
 for(const corrupt of [v=>v.ownerKey='other',v=>v.query='other window',v=>v.feed.events[0].agentId='other',v=>v.feed.events[0].endAt='bad date',v=>v.feed.events[0].metadata=[],v=>v.calendars.push({...v.calendars[0]}),v=>v.calendars[0].grantId='other',v=>v.calendars[0].accessRole='none']){
  const document=structuredClone(baseline);corrupt(document.entries[0].value);f.replace(document);const held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:()=>held.promise});const pending=calendar.refresh(f.window);await settleLocal();
  assert.equal(calendar.state.savedAt,null);assert.equal(calendar.state.feed,null);calendar.retire();held.resolve(f.feed);await pending;
 }
 f.retire();
});
test('owner retirement, legacy review and provider revocation hide saved rows',async()=>{
 const f=await savedFixture(),held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:()=>held.promise});const pending=calendar.refresh(f.window);await settleLocal();calendar.retire();held.resolve(f.feed);await pending;assert.equal(calendar.state.feed,null);
 const gate=f.make(f.api,f.cache,f.port,{capture:async()=>({fingerprint:'legacy',present:true,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>false});await gate.refresh(f.window);assert.equal(gate.state.status,'transition-required');assert.equal(gate.state.feed,null);gate.retire();
 const revoked=defer(),read=f.make({...f.api,getLifeOpsCalendarFeed:()=>revoked.promise,getLifeOpsCalendars:async()=>({calendars:[]})});const refresh=read.refresh(f.window);await waitFor(()=>read.state.savedAt!==null,{label:'saved Calendar before source revocation'});assert.ok(read.state.savedAt);revoked.resolve(Promise.reject(Error('revoked')));await refresh;await settleLocal();assert.equal(read.state.feed,null);assert.equal(read.state.savedAt,null);assert.equal(f.raw().entries.find(entry=>entry.key.includes('calendar:feed:v1')).value,null);read.retire();f.retire();
});
test('an immediate transport failure still waits for the saved local read',async()=>{
 const f=await savedFixture(),held=defer(),calendar=f.make({...f.api,getLifeOpsCalendarFeed:async()=>{throw Error('offline');}},{get:()=>held.promise,put:async()=>{}});
 const pending=calendar.refresh(f.window);await settleLocal();held.resolve({value:f.raw().entries[0].value,at:Date.now()});await pending;
 assert.ok(calendar.state.savedAt);assert.equal(calendar.state.feed.events.length,1);assert.match(calendar.state.error,/could not load/);calendar.retire();f.retire();
});

for(const method of ['getLifeOpsCalendarFeed','getLifeOpsCalendars'])for(const status of [401,403])test(`${method} HTTP ${status} immediately hides and invalidates saved rows`,async()=>{
 const f=await savedFixture(),denied=defer(),next=defer(),calendar=f.make({...f.api,[method]:()=>denied.promise,getLifeOpsNextCalendarEventContext:()=>next.promise});
 const pending=calendar.refresh(f.window);await waitFor(()=>calendar.state.savedAt!==null,{label:'saved Calendar before refusal'});assert.ok(calendar.state.savedAt);
 denied.resolve(Promise.reject(Object.assign(Error('Access refused'),{status})));await waitFor(()=>f.raw().entries.find(entry=>entry.key.includes('calendar:feed:v1')).value===null,{label:'refused Calendar persisted'});
 assert.equal(calendar.state.feed,null,'refusal hides rows without waiting for other provider reads');assert.deepEqual(calendar.state.calendars,[]);assert.equal(calendar.state.savedAt,null);assert.equal(calendar.state.next,null);
 assert.equal(f.raw().entries.find(entry=>entry.key.includes('calendar:feed:v1')).value,null,'refusal invalidates the persisted snapshot');
 next.resolve(f.next);await pending;calendar.retire();
 const reload=f.make({...f.api,getLifeOpsCalendarFeed:async()=>{throw Error('offline');}});await reload.refresh(f.window);
 assert.equal(reload.state.feed,null,'the next reload cannot restore refused rows');assert.equal(reload.state.savedAt,null);reload.retire();f.retire();
});

test('an immediate authorization refusal cannot be undone by a late local read',async()=>{
 const f=await savedFixture(),local=defer(),next=defer(),snapshot=structuredClone(f.raw().entries[0]);
 const store={get:()=>local.promise,put:(...args)=>f.cache.put(...args)};
 const calendar=f.make({...f.api,getLifeOpsCalendarFeed:async()=>{throw Object.assign(Error('Access refused'),{status:403});},getLifeOpsNextCalendarEventContext:()=>next.promise},store);
 const pending=calendar.refresh(f.window);await settleLocal();
 assert.equal(calendar.state.status,'error');assert.equal(calendar.state.feed,null);
 local.resolve({value:snapshot.value,at:snapshot.at});await settleLocal();assert.equal(calendar.state.feed,null);assert.equal(calendar.state.savedAt,null);
 next.resolve(f.next);await pending;calendar.retire();f.retire();
});

test('authorization refusal also suppresses older saved windows on reload',async()=>{
 const f=await savedFixture(),entry=structuredClone(f.raw().entries[0]),window={...f.window,timeMin:'2998-11-01T00:00:00Z'};
 const key=JSON.parse(entry.key);key[3]=JSON.stringify(window);entry.value.query=key[3];entry.value.feed.timeMin=window.timeMin;
 await f.cache.put(JSON.stringify(key),entry.value,Date.now()-1000);
 const refused=f.make({...f.api,getLifeOpsCalendars:async()=>{throw Object.assign(Error('Access refused'),{status:403});}});
 await refused.refresh(f.window);refused.retire();
 const reload=f.make({...f.api,getLifeOpsCalendarFeed:async()=>{throw Error('offline');}});await reload.refresh(window);
 assert.equal(reload.state.feed,null);assert.equal(reload.state.savedAt,null);reload.retire();f.retire();
});

test('saved Calendar bootstraps before a resident port exists and survives its delayed handoff',async()=>{
 const f=await savedFixture(),today=new Date(),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const window={side:'owner',timeMin:new Date(today.getFullYear(),today.getMonth()-1,1).toISOString(),timeMax:new Date(today.getFullYear(),today.getMonth()+2,1).toISOString(),timeZone:zone};
 const tomorrow=new Date(today.getTime()+86400000);f.event.startAt=tomorrow.toISOString();f.event.endAt=new Date(tomorrow.getTime()+3600000).toISOString();Object.assign(f.feed,window);
 const writer=f.make();await writer.refresh(window);await waitFor(()=>f.raw().entries.some(entry=>entry.value?.query===JSON.stringify(window)),{label:'current Calendar window saved'});writer.retire();
 let active=null;const calendar=f.make(f.api,f.cache,()=>active),reads=f.reads.length;
 await calendar.restoreSaved(window,f.cache,()=>true,async()=>true);
 assert.equal(f.reads.length,reads,'restoration never requests the agent or providers');assert.equal(calendar.state.feed.events[0].title,f.event.title);assert.ok(calendar.state.savedAt);assert.equal(calendar.selection(JSON.stringify([f.event.provider,f.event.side,f.event.grantId,f.event.connectorAccountId,f.event.calendarId,f.event.externalId,f.event.id])),undefined);
 await assert.rejects(calendar.create(JSON.stringify([f.source.provider,f.source.side,f.source.grantId,f.source.connectorAccountId,f.source.calendarId]),{idempotencyKey:'no-bootstrap-write',title:'No'}),/current Calendar source/);assert.equal(f.writes.length,0);
 const shown=calendar.state.feed,states=[];calendar.subscribe(()=>states.push(calendar.state.feed));const held=defer();f.api.getLifeOpsCalendarFeed=()=>held.promise;active=f.port;
 const fresh=calendar.refresh(window);await settleLocal();assert.equal(calendar.state.feed,shown);assert.ok(states.every(feed=>feed===shown),'agent arrival never blanks the saved event');
 held.resolve({...f.feed,events:[]});await fresh;assert.equal(calendar.state.savedAt,null);assert.deepEqual(calendar.state.feed.events,[]);calendar.retire();f.retire();
});

test('pre-agent bootstrap rejects stale identity metadata, changed credentials, refusal and late owner reads',async()=>{
 const f=await savedFixture(),baseline=structuredClone(f.raw());
 const attempt=async(check=()=>true,verify=async()=>true)=>{const calendar=f.make(f.api,f.cache,null);await calendar.restoreSaved(f.window,f.cache,check,verify);assert.equal(calendar.state.feed,null);calendar.retire();};
 for(const mutate of [
  d=>d.entries.find(e=>e.key==='calendar:owner:v1').value.ownerKey='not json',
  d=>d.entries.find(e=>e.key==='calendar:owner:v1').value.ownerKey=JSON.stringify(['https://user:secret@fixture.invalid','owner','agent']),
  d=>d.entries.find(e=>e.key==='calendar:owner:v1').value.ownerKey=JSON.stringify(['https://fixture.invalid','other-owner','agent']),
  d=>d.entries.find(e=>e.key==='calendar:owner:v1').value.scope='another-scope',
 ]){const d=structuredClone(baseline);mutate(d);f.replace(d);await attempt();}
 f.replace(structuredClone(baseline));await attempt(()=>true,async()=>false);
 const descriptor=baseline.entries.find(e=>e.key==='calendar:owner:v1').value;await f.cache.put(JSON.stringify(['calendar:access-refused:v1',descriptor.ownerKey,descriptor.scope]),Date.now());await attempt();
 f.replace(structuredClone(baseline));const held=defer(),calendar=f.make(f.api,f.cache,null);let current=true;
 const restore=calendar.restoreSaved(f.window,{get:async key=>{await held.promise;return f.cache.get(key);},put:()=>{throw Error('restore never writes');}},()=>current,async()=>true);
 current=false;calendar.retire();held.resolve();await restore;assert.equal(calendar.state.feed,null);f.retire();
});

// Mount the real adapter/controller with resident startup deliberately absent.
// Local credential and document ports are synthetic; no Cloud or agent request runs.
async function mountedSavedCalendar(){
 const f=await savedFixture(),today=new Date(),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const window={side:'owner',timeMin:new Date(today.getFullYear(),today.getMonth()-1,1).toISOString(),timeMax:new Date(today.getFullYear(),today.getMonth()+2,1).toISOString(),timeZone:zone};
 f.event.startAt=new Date(Date.now()+3600000).toISOString();f.event.endAt=new Date(Date.now()+7200000).toISOString();Object.assign(f.feed,window);
 const writer=f.make();await writer.refresh(window);await waitFor(()=>f.raw().entries.some(entry=>entry.value?.query===JSON.stringify(window)),{label:'current Calendar window saved'});writer.retire();const reads=f.reads.length;
 let active=null,credential={credentialId:'saved-key-generation',userId:'cloud-owner',organizationId:'cloud-org'},snapshot={startupResolved:false,cloudAccount:null,residentSavedCredential:true};const subscribers=new Set(),documentListeners=new Map();let writesFail=false;const readCache={get:key=>f.cache.get(key),put:(...args)=>writesFail?Promise.reject(Error('local write failed')):f.cache.put(...args)};let readCredential=async()=>credential?({...credential}):null;
 const preservation={capture:async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true};
 const dependencies={
  AgentCalendar:class extends AgentCalendar{constructor(port,hold,_client,cache,identity){super(port,hold,()=>f.api,cache,identity);}},
  connectionController:{getSnapshot:()=>snapshot,getAppRecordClient:()=>active,getCloudClient:()=>null,subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}},
  Capacitor:{getPlatform:()=> 'web',isNativePlatform:()=>false},testMocksEnabled:false,browserCloudResidentEnabled:true,browserCloudResidentEnvironment:'production',
  cloudCredentialStore:{read:()=>readCredential()},serviceReadCache:async owner=>{assert.equal(owner.credentialId,credential.credentialId);return owner.userId==='cloud-owner'?readCache:{get:async()=>null,put:async()=>{}};},
  calendarOwnerKey:p=>JSON.stringify([new URL(p.identity.origin).origin,p.identity.ownerId,p.identity.agentId]),calendarSourceKey:s=>JSON.stringify([s.provider,s.side,s.grantId,s.connectorAccountId,s.calendarId]),calendarEventKey:e=>e.id,
  homeCalendarSelection:model=>({event:model?.feed?.events[0]??null,verified:false,emptyLabel:'Calendar'}),homeReadIsStale:()=>false,presentHomeAgendaFeed:()=>({state:'pending',read:'',description:'',stale:false,title:'Calendar'}),
  presentHomeAgendaCard:input=>input,homeCalendarValues:card=>({homeCalendarTitle:card.item?.title??'',homeCalendarSource:card.provenance.read,homeCalendarDescription:card.provenance.description}),canonicalCalendarRow:()=>({off:0}),
 };
 const adapter=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
 const install=new Function(...Object.keys(dependencies),adapter+';return installAgentCalendarAdapter;')(...Object.values(dependencies));
 const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={hidden:false,addEventListener(name,fn){documentListeners.set(name,fn);},removeEventListener(name){documentListeners.delete(name);}};
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){}renderVals(){return{};}vget(){return{calendarAuthority:'canonical'};}S(){return{view:'home'};}setState(){}}
 const views={calendar:{render:()=>({})}};install(Shell,views,preservation);const shell=new Shell();

 shell.componentDidMount();await waitFor(()=>shell.renderVals().homeCalendarTitle===f.event.title,{label:'saved Calendar mounted'});
 return {f,shell,reads,get active(){return active;},get credential(){return credential;},
  setCacheWritesFail(value){writesFail=value;},setCredential(value){credential=value;},setReadCredential(read){readCredential=read;},
  setSnapshot(value){snapshot={...snapshot,...value};for(const fn of subscribers)fn();},
  setPort(value){active=value;for(const fn of subscribers)fn();},
  foreground(){documentListeners.get('visibilitychange')?.();},
  close(){shell.componentWillUnmount();globalThis.window=oldWindow;globalThis.document=oldDocument;f.retire();}};
}

test('Home shows a locally bound saved event before resident startup with no visible refresh prose',async()=>{
 const m=await mountedSavedCalendar();try{
  assert.equal(m.active,null);assert.equal(m.f.reads.length,m.reads);
  const card=m.shell.renderVals();assert.equal(card.homeCalendarTitle,m.f.event.title);assert.equal(card.homeCalendarSource,'');assert.match(card.homeCalendarDescription,/Saved.*Not yet checked/);
  const shown=m.shell.agentCalendar.state.feed;m.setSnapshot({cloudAccount:{...m.credential,environment:'production'}});await settleLocal();assert.equal(m.shell.agentCalendar.state.feed.events[0].title,shown.events[0].title);
  m.setCredential({...m.credential,userId:'another-owner'});m.setSnapshot({cloudAccount:{...m.credential,environment:'production'}});await settleLocal();assert.equal(m.shell.renderVals().homeCalendarTitle,'','another current account cannot display the previous owner');
 }finally{m.close();}
});

for(const change of ['removed','expired'])test(`pre-agent ${change} credential clears the displayed saved event on foreground`,async()=>{
 const m=await mountedSavedCalendar();try{
  assert.equal(m.shell.renderVals().homeCalendarTitle,m.f.event.title);
  m.setCredential(change==='removed'?null:{...m.credential,expiresAt:Date.now()-1});m.foreground();await settleLocal();
  assert.equal(m.shell.agentCalendar.state.feed,null);assert.equal(m.shell.renderVals().homeCalendarTitle,'');
 }finally{m.close();}
});

test('a late missing credential read cannot clear a newer credential or live resident',async()=>{
 for(const replacement of ['credential','resident']){
  const m=await mountedSavedCalendar(),old=defer();try{
   let first=true;m.setReadCredential(()=>first?(first=false,old.promise):Promise.resolve({...m.credential}));m.foreground();
   if(replacement==='credential'){m.setCredential({...m.credential,credentialId:'replacement-generation'});m.setSnapshot({cloudAccount:{...m.credential,environment:'production'}});}else m.setPort(m.f.port);
   await waitFor(()=>m.shell.agentCalendar.state.feed!==null,{label:'replacement Calendar feed restored'});const current=m.shell.agentCalendar.state.feed;assert.ok(current);
   old.resolve(null);await settleLocal();assert.deepEqual(m.shell.agentCalendar.state.feed,current);
  }finally{old.resolve(null);m.close();}
 }
});

test('a known authorization refusal survives failed cache writes and resident retirement',async()=>{
 const f=await savedFixture(),store={get:key=>f.cache.get(key),put:async()=>{throw Error('local store unavailable');}};let active=f.port;
 const api={...f.api,getLifeOpsCalendarFeed:async()=>{throw Object.assign(Error('denied'),{status:403});}},calendar=f.make(api,store,()=>active);
 await calendar.refresh(f.window);assert.equal(calendar.state.feed,null);assert.ok(f.raw().entries.find(entry=>entry.key.includes('calendar:feed:v1')).value);
 active=null;calendar.retire();await calendar.restoreSaved(f.window,store,()=>true,async()=>true);assert.equal(calendar.state.feed,null,'failed persistence must not resurrect known refused data');
 const remounted=f.make(api,store,null);await remounted.restoreSaved(f.window,store,()=>true,async()=>true);assert.equal(remounted.state.feed,null,'the in-memory refusal also survives a controller remount');remounted.retire();
 active=f.port;api.getLifeOpsCalendarFeed=async()=>f.feed;await calendar.refresh(f.window);
 active=null;calendar.retire();await calendar.restoreSaved(f.window,store,()=>true,async()=>true);assert.ok(calendar.state.savedAt,'a later complete authorized read permits saved restoration again');calendar.retire();f.retire();
});


test('adapter keeps refused rows hidden after failed cache writes and resident loss, without fencing a new credential',async()=>{
 const m=await mountedSavedCalendar();try{
  m.setSnapshot({cloudAccount:{...m.credential,environment:'production'}});await settleLocal();
  m.setCacheWritesFail(true);m.f.api.getLifeOpsCalendarFeed=async()=>{throw Object.assign(Error('denied'),{status:401});};
  m.setPort(m.f.port);await waitFor(()=>m.shell.agentCalendar.state.feed===null,{label:'Calendar refusal visible'});assert.equal(m.shell.agentCalendar.state.feed,null);
  m.setPort(null);await settleLocal();assert.equal(m.shell.agentCalendar.state.feed,null,'same credential cannot restore the unchanged denied snapshot');
  m.setCredential({...m.credential,credentialId:'new-key-generation'});m.setSnapshot({cloudAccount:{...m.credential,environment:'production'}});await waitFor(()=>m.shell.renderVals().homeCalendarTitle===m.f.event.title,{label:'new credential Calendar restoration'});
  assert.equal(m.shell.renderVals().homeCalendarTitle,m.f.event.title,'the new credential has its own supplied cache and is not fenced by the old credential');
 }finally{m.close();}
});

test('verified deletion stays absent across a lagging feed, but a newly restored revision is visible',async()=>{
 const f=await fixture();f.event.metadata.etag='version-1';
 f.api.getLifeOpsCalendarFeed=async()=>({state:'complete',events:[f.event]});
 f.api.deleteLifeOpsCalendarEvent=async()=>({outcome:'deleted',cancellationMode:'organizer_cancel',event:null});
 await f.calendar.refresh({});
 await f.calendar.delete(calendarEventKey(f.event),'version-1','one-delete');
 assert.equal(f.calendar.state.feed.events.length,0);assert.equal(f.calendar.state.next,null);
 await f.calendar.refresh({});assert.equal(f.calendar.state.feed.events.length,0);assert.equal(f.calendar.state.next,null);
 f.event.metadata.etag='restored-version-2';
 await f.calendar.refresh({});assert.equal(f.calendar.state.feed.events.length,1);
 assert.equal(f.calendar.state.next.event.metadata.etag,'restored-version-2');f.retire();
});
