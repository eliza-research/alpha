// One Calendar with Google connected: the Calendar intent asks Google once (Gmail read plus Calendar read and
// write), links the same Eliza Calendar through the existing select/resume control only after the grant readback,
// and reads Synced back instead of assuming it. Actual AgentCalendar, link helper and Google accounts panel;
// the agent port and Cloud client are synthetic. No Google, OAuth, provider write, backfill or disconnect runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {buildSync,transformSync} from 'esbuild';
import {tsImport} from 'tsx/esm/api';
const load=path=>tsImport(new URL(path,import.meta.url).href,{parentURL:import.meta.url});
const {AgentCalendar}=await load('../apps/app/src/runtime/agent-calendar.ts');
const {assertAppRecordRequestAllowed}=await load('../apps/app/src/runtime/app-record-route-policy.ts');
const gmailGrants=await load('../apps/app/src/runtime/gmail-grants.ts');
const {cloudServiceName}=await load('../apps/app/src/runtime/cloud-protocol.ts');
const connectionReturn=await load('../apps/app/src/runtime/google-connection-return.ts');
const workspaceReturn=await load('../apps/app/src/runtime/google-workspace-return.ts');
/** The actual Google accounts callsite and disconnect helper, bundled as scripts/test-google-accounts.mjs does. */
const accountsBundle=buildSync({entryPoints:[new URL('../apps/app/src/runtime/google-accounts.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}}).outputFiles[0].text;
const googleAccounts=await import('data:text/javascript;base64,'+Buffer.from(accountsBundle).toString('base64'));
// The Calendar link and its disconnect lifecycle are part of the same Google accounts module.
const calendarLink=googleAccounts;

const OWNER='owner@example.test',SECOND='second@example.test',GRANT='alpha-google:'+'a'.repeat(64),OTHER='alpha-google:'+'b'.repeat(64);
const READ=['google.basic_identity','google.gmail.triage','google.calendar.read'],WRITE=[...READ,'google.calendar.write'];
const source=(grantId,calendarId,{primary=false,accessRole='owner',accountEmail=OWNER,summary=calendarId}={})=>({provider:'google',side:'owner',grantId,connectorAccountId:grantId,accountEmail,calendarId,summary,description:null,primary,accessRole,backgroundColor:null,foregroundColor:null,timeZone:null,selected:true,includeInFeed:true,selectionVersion:1});
const account=(label,grantedCapabilities,connectionId='11111111-1111-4111-8111-111111111111')=>({configured:true,connected:true,reason:'connected',connectionId,label,grantedCapabilities});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const operations=f=>f.posts.map(post=>post.operation);

/** The shared sync-control contract in miniature: expected-revision CAS, (key, body) replay, select then resume. */
async function agent({control={},sources=[source(GRANT,OWNER,{primary:true}),source(GRANT,'team',{accessRole:'writer',summary:'Team'}),source(GRANT,'holidays',{primary:false,accessRole:'reader',summary:'Holidays'})],ownerId='owner'}={}){
 const f={active:true,draft:false,fingerprint:'same',control:{revision:0,paused:true,destination:null,pendingDispatch:null,...control},sources,posts:[],attempts:[],reads:0,receipts:new Map(),lose:null,heldFeed:null,onCalendars:null,afterPost:null};
 const port={identity:{origin:'https://calendar.example',ownerId,agentId:'agent'},sessionId:'session',scope:'owner',current:()=>f.active,request:async(path,method,body)=>{
  assertAppRecordRequestAllowed(path,method,body);
  if(method==='GET')f.reads++;
  if(path.startsWith('/api/lifeops/calendar/calendars')){f.onCalendars?.();return {calendars:structuredClone(f.sources)};}
  if(path.startsWith('/api/lifeops/calendar/feed')){await f.heldFeed?.promise;return {state:'complete',events:[]};}
  if(path.startsWith('/api/lifeops/calendar/next-context'))return {event:null};
  assert.equal(path,'/api/lifeops/calendar/sync-control');
  if(method==='GET')return structuredClone(f.control);
  f.attempts.push(structuredClone(body));
  if(f.lose==='before'){f.lose=null;throw Error('Network connection was lost');}
  const replay=f.receipts.get(body.idempotencyKey);
  if(replay){assert.equal(replay.body,JSON.stringify(body),'a reused key always carries the identical operation');if(replay.revision!==f.control.revision)throw Error('A newer calendar review superseded this operation');return {...structuredClone(f.control),receipt:{replayed:true}};}
  if(body.expectedRevision!==f.control.revision)throw Error('Calendar sync changed; refresh its review.');
  if(body.operation==='select'){assert.equal(f.control.paused,true);f.control.destination=body.destination;}
  if(body.operation==='resume'){assert.ok(f.control.destination,'resume needs a selected destination');f.control.paused=false;}
  if(body.operation==='pause')f.control.paused=true;
  f.control.revision++;f.receipts.set(body.idempotencyKey,{body:JSON.stringify(body),revision:f.control.revision});f.posts.push(structuredClone(body));
  // The reply is the committed snapshot; afterPost is whatever happens next (another surface, the background push).
  const reply={...structuredClone(f.control),receipt:{replayed:false}};
  f.afterPost?.(body,reply);
  if(f.lose==='after'){f.lose=null;throw Error('Network connection was lost');}
  return reply;
 }};
 f.calendar=new AgentCalendar(()=>port,{capture:async()=>({fingerprint:f.fingerprint,present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true});
 await f.calendar.refresh({});assert.equal(f.calendar.state.status,'ready');f.reads=0;
 f.scope={calendar:f.calendar,current:()=>f.active,canChange:()=>!f.draft};
 f.link=(accounts=[account(OWNER,WRITE)],signal=new AbortController().signal)=>calendarLink.linkGoogleCalendar(f.scope,accounts,signal);
 return f;
}

test('without a verified Calendar write grant nothing is read, written or called Synced',async()=>{
 const f=await agent();
 for(const [accounts,message] of [[[account(OWNER,READ)],/read only, so Calendar is not synced/],[[],/not connected/],[[{...account(OWNER,WRITE),connected:false}],/not connected/]]){
  const result=await f.link(accounts);assert.equal(result.outcome,'needs-grant');assert.match(result.message,message);assert.doesNotMatch(result.message,/syncs with/);
 }
 assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);f.calendar.retire();
});

test('a write grant links the same Eliza Calendar: select the unique primary, resume, then read Synced back',async()=>{
 const f=await agent(),result=await f.link();
 assert.equal(result.outcome,'synced');assert.equal(result.message,'Calendar syncs with owner@example.test in Google.');
 assert.deepEqual(f.posts.map(post=>[post.operation,post.expectedRevision,post.destination?.connectorAccountId??null,post.destination?.providerCalendarId??null]),[['select',0,GRANT,OWNER],['resume',1,null,null]]);
 const [select,resume]=f.posts.map(post=>post.idempotencyKey);
 assert.match(select,/^alpha-calendar-connect:[0-9a-f]{64}$/);assert.notEqual(select,resume);
 assert.equal((await f.link()).outcome,'synced');assert.equal(f.posts.length,2,'Synced again is a readback, not another select or resume');
 // The same reviewed transition derives the same key for the same owner and another key for another owner.
 const g=await agent();await g.link();assert.deepEqual(g.posts.map(post=>post.idempotencyKey),[select,resume]);
 const h=await agent({ownerId:'other-owner'});await h.link();assert.notEqual(h.posts[0].idempotencyKey,select);
 for(const x of [f,g,h])x.calendar.retire();
});

test('a saved destination is kept: a paused link only resumes and an active one is already Synced',async()=>{
 const f=await agent({control:{revision:4,destination:{connectorAccountId:GRANT,providerCalendarId:'team'}}});
 const resumed=await f.link();assert.equal(resumed.outcome,'synced');assert.equal(resumed.message,'Calendar syncs with Team in Google.');
 assert.deepEqual(f.posts.map(post=>[post.operation,post.expectedRevision]),[['resume',4]],'the reviewed destination and its mappings are not replaced by the primary');
 const g=await agent({control:{paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:'team'}}});
 assert.equal((await g.link()).outcome,'synced');assert.deepEqual(g.attempts,[]);
 f.calendar.retire();g.calendar.retire();
});

test('an ambiguous control write is never Synced; the retry reads back and keeps its per-operation key',async()=>{
 const f=await agent();f.lose='after'; // Committed, then the response was lost.
 const lost=await f.link();assert.equal(lost.outcome,'unconfirmed');assert.match(lost.message,/^Network connection was lost\. Calendar sync was not confirmed/);
 assert.equal(f.control.paused,true);
 assert.equal((await f.link()).outcome,'synced');assert.deepEqual(operations(f),['select','resume'],'the select is applied once');
 const g=await agent();g.lose='before'; // Lost before it reached the agent.
 assert.equal((await g.link()).outcome,'unconfirmed');assert.deepEqual(g.posts,[]);
 assert.equal((await g.link()).outcome,'synced');assert.equal(g.attempts[0].idempotencyKey,g.attempts[1].idempotencyKey,'the retried select is the same operation');
 f.calendar.retire();g.calendar.retire();
});

test('a pending dispatch, an unavailable saved destination or no unique authorized primary stops without a control write',async()=>{
 const both=[account(OWNER,WRITE),account(SECOND,WRITE,'22222222-2222-4222-8222-222222222222')];
 const twoPrimaries=[source(GRANT,OWNER,{primary:true}),source(OTHER,SECOND,{primary:true,accountEmail:SECOND})];
 for(const [options,message,accounts] of [
  [{control:{pendingDispatch:{linkId:'pending-link'}}},/prior Calendar sync operation needs review/],
  [{control:{destination:{connectorAccountId:GRANT,providerCalendarId:'removed'}}},/saved Google sync calendar is unavailable/],
  [{sources:[source(GRANT,OWNER,{primary:true,accessRole:'reader'})]},/Choose the Google calendar to sync/],
  [{sources:twoPrimaries},/Choose the Google calendar to sync/,both],
 ]){const f=await agent(options),result=await f.link(accounts);assert.equal(result.outcome,'not-linked');assert.match(result.message,message);assert.deepEqual(f.attempts,[]);f.calendar.retire();}
 // A verified return names one account: only its primary is the unique authorized source.
 const f=await agent({sources:twoPrimaries});
 assert.equal((await f.link([both[1]])).outcome,'synced');assert.equal(f.posts[0].destination.connectorAccountId,OTHER);f.calendar.retire();
});

test('a saved destination is Synced or resumed only on an approved account, and only the returned one when Google names it',async()=>{
 const sources=[source(GRANT,OWNER,{primary:true}),source(OTHER,SECOND,{primary:true,accountEmail:SECOND})],second={connectorAccountId:OTHER,providerCalendarId:SECOND};
 const mixed=[account(OWNER,WRITE),account(SECOND,READ,'22222222-2222-4222-8222-222222222222')];
 for(const [control,accounts] of [[{revision:3,paused:false,destination:second},mixed],[{revision:3,destination:second},mixed],[{revision:3,destination:second},[account(OWNER,WRITE)]]]){
  const f=await agent({sources,control}),result=await f.link(accounts);
  assert.equal(result.outcome,'not-linked');assert.match(result.message,/not on the Google account approved for Calendar changes\. Review Calendar sync/);
  assert.deepEqual(f.attempts,[],'a read-only or unnamed account is never resumed');assert.equal(f.control.paused,control.paused??true);f.calendar.retire();
 }
});

test('a change made elsewhere between steps is kept: the link stops at the newer revision and the last step never writes',async()=>{
 // Another surface pauses right after our resume commits.
 const f=await agent();f.afterPost=body=>{if(body.operation==='resume'){f.control.paused=true;f.control.revision++;}};
 const paused=await f.link();assert.equal(paused.outcome,'not-linked');assert.match(paused.message,/^Calendar sync changed elsewhere\. Review Calendar sync/);
 assert.deepEqual(operations(f),['select','resume'],'the pause is not resumed again');assert.equal(f.control.paused,true);
 // Another surface pauses (a new revision) right after our select commits.
 const g=await agent();g.afterPost=body=>{if(body.operation==='select')g.control.revision++;};
 const held=await g.link();assert.equal(held.outcome,'not-linked');assert.deepEqual(operations(g),['select']);assert.equal(g.control.paused,true);
 // Even a reply that already shows that pause at our revision gets only a readback on the last step, never a write.
 const h=await agent();h.afterPost=(body,reply)=>{if(body.operation==='resume'){h.control.paused=true;h.control.revision++;Object.assign(reply,{paused:true,revision:h.control.revision});}};
 assert.equal((await h.link()).outcome,'unconfirmed');assert.deepEqual(operations(h),['select','resume']);assert.equal(h.control.paused,true);
 f.calendar.retire();g.calendar.retire();h.calendar.retire();
});

test('a committed write whose response is lost stays unconfirmed even if a draft or owner change follows',async()=>{
 for(const after of [f=>{f.draft=true;},f=>{f.active=false;}]){
  const f=await agent();f.lose='after';f.afterPost=()=>after(f);
  const lost=await f.link();assert.equal(lost.outcome,'unconfirmed');assert.match(lost.message,/^Network connection was lost\. Calendar sync was not confirmed/);
  assert.deepEqual(operations(f),['select']);f.calendar.retire();
 }
});

test('nothing sent is never called unconfirmed: a Calendar that is not ready says it is waiting',async()=>{
 const f=await agent();f.calendar.retire();
 const waiting=await f.link();assert.equal(waiting.outcome,'not-linked');assert.match(waiting.message,/^Waiting for Calendar\. Nothing was sent/);assert.doesNotMatch(waiting.message,/not confirmed/);assert.deepEqual(f.attempts,[]);
 const g=await agent();g.onCalendars=()=>{throw Error('Calendar list is unavailable');};
 const failed=await g.link();assert.equal(failed.outcome,'not-linked');assert.match(failed.message,/^Calendar list is unavailable\. Calendar sync was not finished; nothing was sent/);assert.deepEqual(g.attempts,[]);g.calendar.retire();
 // Once a write was sent, Calendar going away is unconfirmed, never "Nothing was sent".
 const h=await agent();h.afterPost=body=>{if(body.operation==='select')h.calendar.retire();};
 const gone=await h.link();assert.equal(gone.outcome,'unconfirmed');assert.doesNotMatch(gone.message,/Nothing was sent|Waiting for Calendar/);assert.deepEqual(operations(h),['select']);
});

test('an active control with a background dispatch reads Sync on, never Synced; a paused pending dispatch still needs review',async()=>{
 // Resume kicks the bootstrap drain, which holds a dispatch token without a new revision.
 const f=await agent();f.afterPost=body=>{if(body.operation==='resume')f.control.pendingDispatch={linkId:'bootstrap-create'};};
 const linked=await f.link();assert.equal(linked.outcome,'syncing');assert.equal(linked.message,'Sync on. Calendar is syncing with owner@example.test in Google.');
 assert.deepEqual(operations(f),['select','resume']);
 const g=await agent({control:{paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:{linkId:'in-flight'}}});
 const active=await g.link();assert.equal(active.outcome,'syncing');assert.doesNotMatch(active.message,/syncs with|Synced|caught up/);assert.deepEqual(g.attempts,[]);
 // The uncertain case stays reviewable: a paused control with a pending dispatch is never resumed or called on.
 const h=await agent({control:{revision:2,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:{linkId:'uncertain'}}});
 const held=await h.link();assert.equal(held.outcome,'not-linked');assert.match(held.message,/needs review/);assert.deepEqual(h.attempts,[]);
 f.calendar.retire();g.calendar.retire();h.calendar.retire();
});

test('a changeSync check that fails before its control write is not finished and says nothing was sent',async()=>{
 // The destination's selection changes between the review and changeSync's own fresh destination check.
 const f=await agent();let lists=0;f.onCalendars=()=>{if(++lists===2)f.sources[0].selectionVersion++;};
 const moved=await f.link();assert.equal(moved.outcome,'not-linked');
 assert.match(moved.message,/^Calendar destination changed; review sync again\. Calendar sync was not finished; nothing was sent/);assert.doesNotMatch(moved.message,/not confirmed/);assert.deepEqual(f.attempts,[]);
 // The saved app calendar changes after the review: changeSync's preservation check refuses before the write.
 const g=await agent();g.onCalendars=()=>{g.fingerprint='other';};
 const kept=await g.link();assert.equal(kept.outcome,'not-linked');assert.match(kept.message,/^Saved app calendar changed.*Calendar sync was not finished; nothing was sent/);assert.deepEqual(g.attempts,[]);
 f.calendar.retire();g.calendar.retire();
});

test('drafts, owner changes and cancellation stop before the next control write',async()=>{
 const f=await agent();f.draft=true;
 const draft=await f.link();assert.equal(draft.outcome,'not-linked');assert.match(draft.message,/Finish or close the Calendar draft/);assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);
 f.draft=false;f.afterPost=()=>{f.draft=true;};
 assert.notEqual((await f.link()).outcome,'synced');assert.deepEqual(operations(f),['select'],'a draft opened after the select holds the resume');f.calendar.retire();
 const g=await agent();g.onCalendars=()=>{g.active=false;};
 const changed=await g.link();assert.equal(changed.outcome,'not-linked');assert.deepEqual(g.attempts,[],'an owner change during the review sends nothing');g.calendar.retire();
 const h=await agent(),abort=new AbortController();abort.abort();
 assert.equal((await h.link(undefined,abort.signal)).outcome,'not-linked');assert.equal(h.reads,0);assert.deepEqual(h.attempts,[]);h.calendar.retire();
});

test('a foreground Calendar refresh is waited out, and cancelling the wait sends nothing',async()=>{
 const f=await agent();f.heldFeed=deferred();void f.calendar.refresh({});assert.equal(f.calendar.state.status,'loading');
 const linking=f.link();await flush();assert.deepEqual(f.attempts,[],'no review while the Calendar is loading');
 f.heldFeed.resolve();assert.equal((await linking).outcome,'synced');
 // A refresh deferred behind the review starts before the write: the write waits for it too.
 const d=await agent(),held=deferred();
 d.onCalendars=()=>{d.onCalendars=null;d.heldFeed=held;void d.calendar.refresh({});};
 const deferredLink=d.link();await flush();assert.equal(d.calendar.state.status,'loading');assert.deepEqual(d.attempts,[]);
 held.resolve();assert.equal((await deferredLink).outcome,'synced');assert.deepEqual(operations(d),['select','resume']);d.calendar.retire();
 const g=await agent(),abort=new AbortController();g.heldFeed=deferred();void g.calendar.refresh({});
 const waiting=g.link(undefined,abort.signal);await flush();abort.abort();
 assert.equal((await waiting).outcome,'not-linked');g.heldFeed.resolve();await flush();assert.deepEqual(g.attempts,[]);
 f.calendar.retire();g.calendar.retire();
});

const CONNECTION='11111111-1111-4111-8111-111111111111';
/** A linked Calendar whose destination carries the verified managed Google connection (the forthcoming official field). */
async function linkedForDisconnect(){
 const f=await agent({sources:[{...source(GRANT,OWNER,{primary:true}),managedGoogleConnectionId:CONNECTION}]});
 const linked=await f.link();assert.equal(linked.outcome,'synced');assert.ok(linked.review,'the last readback is kept as the captured review');
 return {f,linked,retained:new Map()};
}
/** The actual createGoogleAccounts callsite with a synthetic Cloud client; events record what each port saw. */
function cloudAccounts(retained,{revoke}={}){
 const events=[],client={
  async disconnectGmail(id,signal){events.push(['revoke',id,retained.size]);await revoke?.(signal);},
  async gmailAccounts(){events.push(['list',retained.size]);return [];},
  async initiateGoogle(){throw Error('Unexpected consent');},
 },binding={client,sessionId:'cloud-session',credentialId:'cloud-credential'};
 return {events,binding,accounts:lifecycle=>googleAccounts.createGoogleAccounts(binding,()=>binding,()=>events.push(['changed']),lifecycle)};
}

test('the Calendar disconnect lifecycle is synchronous snapshots of the captured review, with no network or second store',async()=>{
 const {f,linked,retained}=await linkedForDisconnect(),reads=f.reads;
 assert.equal(calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>undefined,()=>'cloud-binding',retained).capture(),null,'no captured review: privacy revoke only');
 const lifecycle=calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>linked.review,()=>'cloud-binding',retained);
 const captured=lifecycle.capture(),live=lifecycle.current();
 assert.equal(typeof captured.then,'undefined');assert.equal(f.reads,reads,'capture and current never read the agent');
 assert.deepEqual(captured.lease,{origin:'https://calendar.example',ownerId:'owner',agentId:'agent',sessionId:'session',credentialBinding:'cloud-binding',sourceGeneration:linked.review.binding});
 assert.deepEqual(captured.control,{revision:2,paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:null});
 assert.deepEqual(captured.sources,linked.review.sources);assert.deepEqual(live.lease,captured.lease);assert.deepEqual(live.sources,f.calendar.state.calendars,'current reads the Calendar sources it already holds');
 captured.control.revision=99;assert.equal(lifecycle.capture().control.revision,2,'a snapshot is a copy, never the review itself');
 // An owner, agent or Cloud change is a replacement: no snapshot.
 f.active=false;assert.equal(lifecycle.current(),null);f.active=true;
 assert.equal(calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>linked.review,()=>null,retained).current(),null);
 f.calendar.retire();assert.equal(lifecycle.current(),null);assert.equal(f.reads,reads);assert.equal(retained.size,0);
});

test('a Calendar-scoped disconnect retains the key first, pauses through the canonical control and revokes once',async()=>{
 const {f,linked,retained}=await linkedForDisconnect(),cloud=cloudAccounts(retained);
 const lifecycle=calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>linked.review,()=>'cloud-binding',retained);
 f.afterPost=body=>{if(body.operation==='pause')cloud.events.push(['pause',retained.size]);};
 const result=await cloud.accounts(lifecycle).disconnect(CONNECTION,new AbortController().signal);
 assert.equal(result.outcome,'disconnected');assert.equal(result.calendarLifecycle.calendarPause,'confirmed');
 const [context]=retained.values();
 assert.deepEqual({connectionId:context.connectionId,status:context.status,control:context.review.control},{connectionId:CONNECTION,status:'unknown',control:linked.review.control});
 assert.deepEqual(f.posts.at(-1),{operation:'pause',expectedRevision:2,idempotencyKey:context.pauseKey},'the canonical changeSync pause with the retained key');
 assert.deepEqual(operations(f),['select','resume','pause']);assert.equal(f.control.paused,true);
 const seen=cloud.events.filter(([kind])=>kind!=='changed');
 assert.deepEqual(seen.map(([kind])=>kind).sort(),['list','pause','revoke'],'one pause, one revoke and its readback');
 assert.ok(seen.every(event=>event.at(-1)===1),'the key and UNKNOWN context were retained before the pause and the revoke');
 f.calendar.retire();
});

test('retention precedes a failed revoke; a stale pause request or no captured review sends no Calendar write',async()=>{
 const {f,linked,retained}=await linkedForDisconnect(),abort=new AbortController();
 const failing=cloudAccounts(retained,{revoke:async()=>{abort.abort();abort.signal.throwIfAborted();}});
 const lifecycle=calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>linked.review,()=>'cloud-binding',retained);
 await assert.rejects(failing.accounts(lifecycle).disconnect(CONNECTION,abort.signal));
 assert.equal(retained.size,1,'an aborted revoke keeps the UNKNOWN context for review');assert.equal(failing.events.find(([kind])=>kind==='revoke')[2],1);
 await flush();const writes=f.attempts.length;
 await assert.rejects(lifecycle.pause({operation:'pause',expectedRevision:99,idempotencyKey:'stale'},new AbortController().signal),/review Calendar sync/);
 assert.equal(f.attempts.length,writes,'a request for another revision is refused before changeSync');
 const plain=new Map(),absent=cloudAccounts(plain);
 const result=await absent.accounts(calendarLink.googleCalendarDisconnectLifecycle(f.scope,()=>undefined,()=>'cloud-binding',plain)).disconnect(CONNECTION,new AbortController().signal);
 assert.equal(result.calendarLifecycle.calendarPause,'unavailable');assert.equal(plain.size,0);assert.equal(f.attempts.length,writes);
 f.calendar.retire();
});

/** The actual Google accounts panel. Only the Cloud account list, consent URL and browser open are synthetic. */
async function panel(rows,{calendarEdits=true,gmailChanges=true,unreadable=false,saveFails=false,browser=false,host='current'}={}){
 const dom=new JSDOM('<div class="os" style="--bg:#121212;--fg:#fff;--acct:#95a0ff;--acc:#0000ff"></div><div id="root"></div>',{url:'https://alpha.invalid'});
 let hidden=false;Object.defineProperty(dom.window.document,'hidden',{configurable:true,get:()=>hidden});
 const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client');
 const access={gmailChanges,calendarEdits},p={rows,access,unreadable,revision:0,consents:[],opens:0,lists:0,accessChanges:[],policy:[],onPolicy:null,disconnects:[],onDisconnect:null};
 let cloud={client:{},sessionId:'cloud-session',credentialId:'cloud-credential'};
 const snapshot={cloudAccount:{environment:'production',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'}};
 const live=binding=>{if(binding.credentialId!==cloud.credentialId)throw new DOMException('The Cloud account changed.','AbortError');};
 const modules={
  './cloud-protocol':{cloudServiceName},'./google-connection-return':connectionReturn,'./google-workspace-return':workspaceReturn,'./gmail-grants':gmailGrants,
  '../daily':{DailyApps:{addListener:async()=>({remove(){}})}},'../native':{isAndroid:false},
  // The browser Cloud stage's same-origin bridge: 'current' answers like Codex's proposed host, 'missing' like today's host.
  './browser-cloud-resident':{browserCloudResidentEnabled:browser,browserResidentCall:async(...call)=>{p.policy.push(call);p.onPolicy?.();if(host==='missing')throw Error('Cloud resident binding unavailable');return host==='wrong'?{}:{calendarEdits:call[2]};}},
  './gmail-background':{gmailBackgroundStatus:async()=>({}),gmailBackgroundMessage:()=>'',GMAIL_BACKGROUND_CHANGED:'alpha:test-gmail-background'},
  './modal-inert':{holdPhoneInert:()=>()=>{}},
  './connection-ui':{connectionController:{subscribe:()=>()=>{},getSnapshot:()=>snapshot,getCloudClient:()=>cloud,rejectCloudSession:()=>{},openCloudAccount:()=>{throw Error('Unexpected sign-in');}}},
  // The actual Calendar link and disconnect lifecycle; only the Cloud account calls are synthetic.
  './google-accounts':{GOOGLE_ACCOUNTS_CHANGED:'alpha:test-google-accounts',googleDisconnectConfirmation:()=>'',googleDisconnectMessage:outcome=>`Disconnect ${outcome}.`,linkGoogleCalendar:calendarLink.linkGoogleCalendar,googleCalendarDisconnectLifecycle:calendarLink.googleCalendarDisconnectLifecycle,createGoogleAccounts:(binding,current,changed,calendar)=>({
   list:async()=>{live(binding);p.lists++;return structuredClone(p.rows);},
   connect:async(signal,calendarPermission,gmailPermission)=>{live(binding);p.consents.push([calendarPermission,gmailPermission]);return 'https://accounts.google.com/o/oauth2/v2/auth';},
   // No Cloud disconnect runs: only what the panel hands the callsite is recorded.
   disconnect:async connectionId=>{live(binding);p.disconnects.push({connectionId,calendar});return {outcome:'disconnected',accounts:[],calendarLifecycle:p.onDisconnect?.(calendar,connectionId)??{calendarPause:'unavailable',callbackRetirement:'confirmed',providerDrain:'unavailable',pauseRequest:null}};},
  })},
  './google-calendar-selection':{clearGoogleCalendarSelectionForConnection:()=>{}},
  './native-connection':{openConnectionBrowser:async()=>{p.opens++;},googleWorkspaceReturnPort:undefined},
  // Like 3800a178e's google-agent-access: a fresh capture with a revision receipt, and a guarded save that rechecks it.
  './google-agent-access':{googleAgentAccess:()=>({...access}),publishGoogleAgentAccess:async()=>{},captureGoogleCalendarAccess:async()=>p.unreadable?undefined:{calendarEdits:access.calendarEdits,receipt:{revision:p.revision}},setGoogleAgentAccess:async(change,guard)=>{if(saveFails)throw Error('Settings could not be saved');if(guard&&(!guard.current()||access.calendarEdits!==guard.expectedCalendarEdits||guard.receipt.revision!==p.revision))throw Error('Calendar choice changed. Review it again.');p.accessChanges.push({...change});Object.assign(access,change);p.revision++;p.unreadable=false;dom.window.dispatchEvent(new dom.window.Event('alpha:device-settings'));}},
 };
 const compiled=transformSync(readFileSync(new URL('../apps/app/src/runtime/google-connection-ui.tsx',import.meta.url),'utf8'),{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 vm.runInContext(compiled,vm.createContext({module,exports:module.exports,require:name=>name==='react'||name==='react/jsx-runtime'?require(name):modules[name]??(()=>{throw Error('Unexpected import '+name);})(),window:dom.window,document:dom.window.document,getComputedStyle:dom.window.getComputedStyle,HTMLElement:dom.window.HTMLElement,AbortController,DOMException,Event:dom.window.Event}));
 const {GoogleConnectionsPanel,googleConnectionController}=module.exports;
 const root=createRoot(dom.window.document.getElementById('root'));
 const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
 const act=async(action)=>React.act(async()=>{await action?.();for(let i=0;i<4;i++)await tick();});
 Object.assign(p,{controller:googleConnectionController,act,
  button:name=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===name||button.getAttribute('aria-label')===name),
  toggle:name=>dom.window.document.querySelector(`input[role="switch"][aria-label="${name}"]`),
  status:()=>dom.window.document.querySelector('[role="status"]')?.textContent??'',
  text:()=>dom.window.document.querySelector('[role="dialog"]')?.textContent??'',
  until:async(check,label)=>{for(let i=0;i<100&&!check();i++)await act();assert.ok(check(),label);},
  changeCloud:()=>{cloud={...cloud,credentialId:'other-credential'};},
  dispatch:name=>act(()=>dom.window.dispatchEvent(new dom.window.Event(name))),
  /** Google's consent screen took the app to the background; coming back is the only return signal. */
  returnFromGoogle:()=>act(()=>{for(const state of [true,false]){hidden=state;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));}}),
  close:async()=>{await act(()=>googleConnectionController.close());await act(()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
 });
 await act(()=>root.render(React.createElement(GoogleConnectionsPanel)));
 return p;
}

test('the Calendar intent asks Google once for Gmail read plus Calendar read and write, then links after the readback',async()=>{
 const f=await agent(),p=await panel([]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  assert.ok(p.button('Connect Google Calendar'));assert.equal(p.button('Connect Google account'),undefined,'one Connect for the Calendar intent');
  assert.match(p.text(),/syncs both ways with your Google calendar\. All eligible saved Eliza events are sent, including dates outside the current view\. Google receives event details and guest email addresses/);
  assert.equal(p.lists,1);assert.equal(f.reads,0,'opening the panel never reads or links the Calendar');
  await p.act(()=>p.button('Connect Google Calendar').click());
  assert.deepEqual(p.consents,[['write','read']]);assert.equal(p.opens,1);assert.equal(f.reads,0,'no link before Google returns');
  p.rows=[account(OWNER,WRITE)];await p.returnFromGoogle();
  await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.','linked from the verified readback');
  assert.equal(p.lists,2);assert.deepEqual(operations(f),['select','resume']);assert.equal(f.control.paused,false);
 }finally{await p.close();f.calendar.retire();}
});

test('an existing read-only Calendar grant takes the normal consent, keeps Gmail send and is never called Synced',async()=>{
 const f=await agent(),p=await panel([account(OWNER,[...READ,'google.gmail.send'])]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  await p.act(()=>p.button('Connect Google Calendar').click());
  assert.deepEqual(p.consents,[['write','send']],'Calendar consent never narrows the Gmail access already granted');
  await p.returnFromGoogle(); // Google returned without Calendar changes approved.
  await p.until(()=>/read only, so Calendar is not synced/.test(p.status()));
  assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);
  // The same intent completes from a later readback that shows the write grant.
  p.rows=[account(OWNER,[...WRITE,'google.gmail.send'])];await p.act(()=>p.button('Check Google connections').click());
  await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');assert.deepEqual(operations(f),['select','resume']);
 }finally{await p.close();f.calendar.retire();}
});

test('an existing Calendar write grant links at once with no new consent',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));assert.equal(f.reads,0);
  await p.act(()=>p.button('Sync Calendar with Google').click());
  await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');
  assert.deepEqual(p.consents,[]);assert.equal(p.opens,0);assert.deepEqual(operations(f),['select','resume']);
 }finally{await p.close();f.calendar.retire();}
});

test('a saved Calendar edits off or unreadable switch is never flipped: the owner taps Allow Calendar changes and Gmail is unchanged',async()=>{
 for(const options of [{calendarEdits:false},{unreadable:true}]){
  const f=await agent(),p=await panel([account(OWNER,WRITE)],{...options,gmailChanges:false});
  try{
   await p.act(()=>p.controller.openCalendar(f.scope));
   await p.act(()=>p.button('Sync Calendar with Google').click());
   await p.until(()=>p.button('Allow Calendar changes'),'the choice is shown');
   assert.match(p.status(),options.unreadable?/^Calendar edits could not be read\./:/^Calendar edits are off\./);
   assert.deepEqual(p.accessChanges,[],'never turned on without the tap');assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.deepEqual(p.consents,[]);
   await p.act(()=>p.button('Allow Calendar changes').click());
   // 3800a178e: an unreadable document is never written, even after the tap; the owner reviews device settings.
   if(options.unreadable){await p.until(()=>/^Calendar edits could not be read\. Review device settings, then try again\./.test(p.status()));assert.deepEqual(p.accessChanges,[]);assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.deepEqual(p.consents,[]);continue;}
   await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');
   // The tap saves Calendar edits on; the explicit Connect then persists the loaded on choice under its revision fence (3800a178e).
   assert.deepEqual(p.accessChanges,[{calendarEdits:true},{calendarEdits:true}],'only Calendar edits, through the saved switch');assert.equal(p.access.gmailChanges,false,'Gmail changes stay off');
   assert.equal(p.button('Allow Calendar changes'),undefined);assert.deepEqual(operations(f),['select','resume']);
  }finally{await p.close();f.calendar.retire();}
 }
});

test('Allow Calendar changes comes before Google consent, is asked again if turned off before the return, and a failed save links nothing',async()=>{
 const f=await agent(),p=await panel([],{calendarEdits:false});
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));await p.act(()=>p.button('Connect Google Calendar').click());
  await p.until(()=>p.button('Allow Calendar changes'));assert.deepEqual(p.consents,[]);assert.equal(p.opens,0);
  await p.act(()=>p.button('Allow Calendar changes').click());
  assert.deepEqual(p.accessChanges,[{calendarEdits:true},{calendarEdits:true}],'the tap, then the explicit Connect persisting the loaded choice');assert.deepEqual(p.consents,[['write','read']]);
  p.access.calendarEdits=false;p.rows=[account(OWNER,WRITE)];await p.returnFromGoogle(); // Turned off elsewhere meanwhile.
  await p.until(()=>p.button('Allow Calendar changes'));assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);
  await p.act(()=>p.button('Allow Calendar changes').click());
  await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');assert.deepEqual(operations(f),['select','resume']);
 }finally{await p.close();f.calendar.retire();}
 const g=await agent(),q=await panel([account(OWNER,WRITE)],{calendarEdits:false,saveFails:true});
 try{
  await q.act(()=>q.controller.openCalendar(g.scope));await q.act(()=>q.button('Sync Calendar with Google').click());
  await q.until(()=>q.button('Allow Calendar changes'));await q.act(()=>q.button('Allow Calendar changes').click());
  await q.until(()=>/^Calendar access changed or could not be saved\. Review Calendar edits, then try again\./.test(q.status()));
  assert.equal(g.reads,0);assert.deepEqual(g.attempts,[]);assert.deepEqual(q.consents,[]);
 }finally{await q.close();g.calendar.retire();}
});

test('the browser Cloud stage asks its host for Calendar writes only after the confirmed intent and before any control write; off sends false',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)],{browser:true});
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));await p.dispatch('alpha:device-settings');
  assert.deepEqual(p.policy,[],'opening the panel or loading settings never enables the host policy');
  let writes;p.onPolicy=()=>{writes=f.attempts.length;};
  await p.act(()=>p.button('Sync Calendar with Google').click());
  await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');
  assert.deepEqual(p.policy,[['residentGoogleCalendarAccess','cloud-credential',true]]);assert.equal(writes,0,'the host policy precedes the first control write');
  await p.act(()=>p.toggle('Calendar edits').click());
  assert.deepEqual(p.policy.at(-1),['residentGoogleCalendarAccess','cloud-credential',false]);assert.deepEqual(p.accessChanges,[{calendarEdits:true},{calendarEdits:false}],'explicit Connect persisted the loaded on choice; the toggle turned it off');
 }finally{await p.close();f.calendar.retire();}
 const g=await agent(),q=await panel([account(OWNER,WRITE)]); // Outside the browser Cloud stage there is no host call.
 try{
  await q.act(()=>q.controller.openCalendar(g.scope));await q.act(()=>q.button('Sync Calendar with Google').click());
  await q.until(()=>q.status()==='Calendar syncs with owner@example.test in Google.');await q.act(()=>q.toggle('Calendar edits').click());assert.deepEqual(q.policy,[]);
 }finally{await q.close();g.calendar.retire();}
});

test('a browser host without the Calendar operation says sync is not available yet and never links or reads Synced',async()=>{
 for(const host of ['missing','wrong']){
  const f=await agent({control:{paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER}}}),p=await panel([account(OWNER,WRITE)],{browser:true,host});
  try{
   await p.act(()=>p.controller.openCalendar(f.scope));await p.act(()=>p.button('Sync Calendar with Google').click());
   await p.until(()=>/^Calendar sync is not available on this host yet, so Calendar is not synced\./.test(p.status()));
   assert.equal(p.policy.length,1);assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.doesNotMatch(p.text(),/syncs with|Sync on/);
  }finally{await p.close();f.calendar.retire();}
 }
});

test('a panel opened from Calendar passes its disconnect lifecycle and keeps an unknown pause for review; a plain panel passes none',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  await p.act(()=>p.button('Sync Calendar with Google').click());await p.until(()=>p.status()==='Calendar syncs with owner@example.test in Google.');
  // Like Codex's callsite: retain before any dispatch, then report the pause outcome (unknown here).
  p.onDisconnect=(calendar,connectionId)=>{const review=calendar.capture();calendar.retain({connectionId,pauseKey:'pause-key',review,status:'unknown'});return {calendarPause:'unknown',callbackRetirement:'confirmed',providerDrain:'unavailable',pauseRequest:{operation:'pause',expectedRevision:review.control.revision,idempotencyKey:'pause-key'}};};
  await p.act(()=>p.button('Disconnect Google account owner@example.test').click());await p.act(()=>p.button('Confirm disconnect Google account').click());
  const [{calendar}]=p.disconnects;
  assert.deepEqual(calendar.capture().control,{revision:2,paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:null},'the review the link read back');
  assert.match(p.status(),/^Disconnect disconnected\. Calendar sync pause was not confirmed\. Review Calendar sync/);
  assert.equal(p.controller.calendar().retained.get('pause-key').status,'unknown','the unknown pause stays retained');
  await p.act(()=>p.controller.close());p.onDisconnect=null;await p.act(()=>p.controller.open());
  await p.act(()=>p.button('Disconnect Google account owner@example.test').click());await p.act(()=>p.button('Confirm disconnect Google account').click());
  assert.equal(p.disconnects.length,2);assert.equal(p.disconnects[1].calendar,undefined,'without a Calendar scope the disconnect is privacy revoke only');
 }finally{await p.close();f.calendar.retire();}
});

test('the saved Calendar edits switch is read fresh: saved off is off and an unreadable document is unknown, never on',async()=>{
 const compiled=transformSync(readFileSync(new URL('../apps/app/src/runtime/google-agent-access.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
 let read;const module={exports:{}},modules={'../browser/device-preferences':{cachedDevicePreferences:()=>({agentGmailChanges:true,agentCalendarEdits:true}),readDevicePreferences:()=>read(),editDevicePreferences:async()=>{},initializeDevicePreferences:()=>{}},'./local-agent':{browserLocalAgentEnabled:false}};
 vm.runInContext(compiled,vm.createContext({module,exports:module.exports,require:name=>modules[name]}));
 for(const [document,expected] of [[async()=>({agentCalendarEdits:false}),false],[async()=>({agentCalendarEdits:true}),true],[async()=>{throw Error('Device settings need recovery.');},undefined]]){read=document;assert.equal(await module.exports.savedGoogleCalendarEdits?.(),expected);}
});

test('closing cancels the intent: a later return never links, and plain Google connect is unchanged',async()=>{
 const f=await agent(),p=await panel([]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));await p.act(()=>p.button('Connect Google Calendar').click());
  await p.act(()=>p.button('Close Google accounts').click());assert.equal(p.controller.calendar(),null);
  p.rows=[account(OWNER,WRITE)];await p.act(()=>p.controller.open());
  assert.ok(p.button('Add Google account'),'without the Calendar intent the generic connect remains');assert.equal(p.button('Sync Calendar with Google'),undefined);
  await p.returnFromGoogle();await p.act(()=>p.button('Check Google connections').click());
  assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.equal(p.status(),'Calendar includes the calendars you show in Google.');
 }finally{await p.close();f.calendar.retire();}
});

test('a Cloud account change during the link stops before the next control write',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));f.afterPost=()=>p.changeCloud();
  await p.act(()=>p.button('Sync Calendar with Google').click());await p.until(()=>p.button('Sync Calendar with Google')?.disabled===false);
  assert.deepEqual(operations(f),['select']);assert.doesNotMatch(p.status(),/syncs with/);
 }finally{await p.close();f.calendar.retire();}
});
