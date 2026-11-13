// One Calendar with Google connected: the Calendar intent asks Google once (Gmail read plus Calendar read and
// write), links the same Eliza Calendar through the existing select/resume control only after the grant readback,
// and reads Synced back instead of assuming it. Actual AgentCalendar, link helper and Google accounts panel;
// the agent port and Cloud client are synthetic. No Google, OAuth, provider write, backfill or disconnect runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mountGoogleAccountPanel} from './fixtures/google-account-panel.mjs';
import {tsImport} from './support/ts-import.mjs';
const load=path=>tsImport(new URL(path,import.meta.url).href,{parentURL:import.meta.url});
const {AgentCalendar}=await load('../apps/app/src/runtime/agent-calendar.ts');
const {assertAppRecordRequestAllowed}=await load('../apps/app/src/runtime/app-record-route-policy.ts');
const gmailGrants=await load('../apps/app/src/runtime/gmail-grants.ts');
const {cloudServiceName}=await load('../apps/app/src/runtime/cloud-protocol.ts');
const connectionReturn=await load('../apps/app/src/runtime/google-connection-return.ts');
const workspaceReturn=await load('../apps/app/src/runtime/google-workspace-return.ts');
/** The actual Google accounts callsite and disconnect helper, bundled as scripts/test-google-accounts.ts does. */
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
 const f={active:true,draft:false,fingerprint:'same',control:{revision:0,paused:true,destination:null,pendingDispatch:null,...control},sources,posts:[],attempts:[],reads:0,links:[],receipts:new Map(),lose:null,heldFeed:null,onCalendars:null,afterPost:null};
 const port={identity:{origin:'https://calendar.example',ownerId,agentId:'agent'},sessionId:'session',scope:'owner',current:()=>f.active,request:async(path,method,body)=>{
  assertAppRecordRequestAllowed(path,method,body);
  if(method==='GET')f.reads++;
  if(path.startsWith('/api/lifeops/calendar/calendars')){f.onCalendars?.();return {calendars:structuredClone(f.sources)};}
  if(path.startsWith('/api/lifeops/calendar/feed')){await f.heldFeed?.promise;return {state:'complete',events:[]};}
  if(path.startsWith('/api/lifeops/calendar/next-context'))return {event:null};
  if(path==='/api/lifeops/calendar/links?view=events')return {links:structuredClone(f.links)};
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
 for(const [accounts,message] of [[[account(OWNER,READ)],/^Read-only$/],[[],/^Not connected$/],[[{...account(OWNER,WRITE),connected:false}],/^Not connected$/]]){
  const result=await f.link(accounts);assert.equal(result.outcome,'needs-grant');assert.match(result.message,message);assert.doesNotMatch(result.message,/Synced/);
 }
 assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);f.calendar.retire();
});

test('a write grant links the same Eliza Calendar: select the unique primary, resume, then read Synced back',async()=>{
 const f=await agent(),result=await f.link();
 assert.equal(result.outcome,'synced');assert.equal(result.message,'Synced · owner@example.test');
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
 const resumed=await f.link();assert.equal(resumed.outcome,'synced');assert.equal(resumed.message,'Synced · Team');
 assert.deepEqual(f.posts.map(post=>[post.operation,post.expectedRevision]),[['resume',4]],'the reviewed destination and its mappings are not replaced by the primary');
 const g=await agent({control:{paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:'team'}}});
 assert.equal((await g.link()).outcome,'synced');assert.deepEqual(g.attempts,[]);
 f.calendar.retire();g.calendar.retire();
});

test('an ambiguous control write is never Synced; the retry reads back and keeps its per-operation key',async()=>{
 const f=await agent();f.lose='after'; // Committed, then the response was lost.
 const lost=await f.link();assert.equal(lost.outcome,'unconfirmed');assert.equal(lost.message,'Unconfirmed · Network connection was lost');
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
  [{control:{pendingDispatch:{linkId:'pending-link'}}},/^Waiting$/],
  [{control:{destination:{connectorAccountId:GRANT,providerCalendarId:'removed'}}},/^Calendar unavailable$/],
  [{sources:[source(GRANT,OWNER,{primary:true,accessRole:'reader'})]},/^Choose calendar$/],
  [{sources:twoPrimaries},/^Choose calendar$/,both],
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
  assert.equal(result.outcome,'not-linked');assert.equal(result.message,'Wrong account');
  assert.deepEqual(f.attempts,[],'a read-only or unnamed account is never resumed');assert.equal(f.control.paused,control.paused??true);f.calendar.retire();
 }
});

test('a change made elsewhere between steps is kept: the link stops at the newer revision and the last step never writes',async()=>{
 // Another surface pauses right after our resume commits.
 const f=await agent();f.afterPost=body=>{if(body.operation==='resume'){f.control.paused=true;f.control.revision++;}};
 const paused=await f.link();assert.equal(paused.outcome,'not-linked');assert.equal(paused.message,'Changed elsewhere');
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
  const lost=await f.link();assert.equal(lost.outcome,'unconfirmed');assert.equal(lost.message,'Unconfirmed · Network connection was lost');
  assert.deepEqual(operations(f),['select']);f.calendar.retire();
 }
});

test('nothing sent is never called unconfirmed: a Calendar that is not ready says it is waiting',async()=>{
 const f=await agent();f.calendar.retire();
 const waiting=await f.link();assert.equal(waiting.outcome,'not-linked');assert.equal(waiting.message,'Calendar not ready');assert.deepEqual(f.attempts,[]);
 const g=await agent();g.onCalendars=()=>{throw Error('Calendar list is unavailable');};
 const failed=await g.link();assert.equal(failed.outcome,'not-linked');assert.equal(failed.message,'Not synced · Calendar list is unavailable');assert.deepEqual(g.attempts,[]);g.calendar.retire();
 // Once a write was sent, Calendar going away is unconfirmed, never "Nothing was sent".
 const h=await agent();h.afterPost=body=>{if(body.operation==='select')h.calendar.retire();};
 const gone=await h.link();assert.equal(gone.outcome,'unconfirmed');assert.match(gone.message,/^Unconfirmed/);assert.deepEqual(operations(h),['select']);
});

test('a dispatch the resume started reads Sync on, never Synced; a paused pending dispatch is waiting',async()=>{
 // Resume kicks the bootstrap drain, which holds a dispatch token without a new revision.
 const f=await agent();f.afterPost=body=>{if(body.operation==='resume')f.control.pendingDispatch={linkId:'bootstrap-create'};};
 const linked=await f.link();assert.equal(linked.outcome,'syncing');assert.equal(linked.message,'Syncing · owner@example.test');
 assert.deepEqual(operations(f),['select','resume']);
 // The uncertain case stays reviewable: a paused control with a pending dispatch is never resumed or called on.
 const h=await agent({control:{revision:2,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:{linkId:'uncertain'}}});
 const held=await h.link();assert.equal(held.outcome,'not-linked');assert.match(held.message,/^Waiting$/);assert.deepEqual(h.attempts,[]);
 f.calendar.retire();h.calendar.retire();
});

test('a changeSync check that fails before its control write is not finished and says nothing was sent',async()=>{
 // The destination's selection changes between the review and changeSync's own fresh destination check.
 const f=await agent();let lists=0;f.onCalendars=()=>{if(++lists===2)f.sources[0].selectionVersion++;};
 const moved=await f.link();assert.equal(moved.outcome,'not-linked');
 assert.equal(moved.message,'Not synced · Calendar destination changed; review sync again');assert.deepEqual(f.attempts,[]);
 // The saved app calendar changes after the review: changeSync's preservation check refuses before the write.
 const g=await agent();g.onCalendars=()=>{g.fingerprint='other';};
 const kept=await g.link();assert.equal(kept.outcome,'not-linked');assert.match(kept.message,/^Not synced · Saved app calendar changed/);assert.deepEqual(g.attempts,[]);
 f.calendar.retire();g.calendar.retire();
});

test('drafts, owner changes and cancellation stop before the next control write',async()=>{
 const f=await agent();f.draft=true;
 const draft=await f.link();assert.equal(draft.outcome,'not-linked');assert.equal(draft.message,'Finish draft first');assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);
 f.draft=false;f.afterPost=()=>{f.draft=true;};
 assert.notEqual((await f.link()).outcome,'synced');assert.deepEqual(operations(f),['select'],'a draft opened after the select holds the resume');f.calendar.retire();
 const g=await agent();g.onCalendars=()=>{g.active=false;};
 const changed=await g.link();assert.equal(changed.outcome,'not-linked');assert.deepEqual(g.attempts,[],'an owner change during the review sends nothing');g.calendar.retire();
 const h=await agent(),abort=new AbortController();abort.abort();
 assert.equal((await h.link(undefined,abort.signal)).outcome,'not-linked');assert.equal(h.reads,0);assert.deepEqual(h.attempts,[]);h.calendar.retire();
});

test('a foreground Calendar refresh is waited out, and cancelling the wait sends nothing',async()=>{
 const f=await agent();f.heldFeed=deferred();void f.calendar.refresh({});assert.equal(f.calendar.state.status,'ready','same-window refresh preserves the displayed feed');
 const linking=f.link();await flush();assert.deepEqual(f.attempts,[],'no review while the Calendar is loading');
 f.heldFeed.resolve();assert.equal((await linking).outcome,'synced');
 // A refresh deferred behind the review starts before the write: the write waits for it too.
 const d=await agent(),held=deferred();
 d.onCalendars=()=>{d.onCalendars=null;d.heldFeed=held;void d.calendar.refresh({});};
 const deferredLink=d.link();await flush();assert.equal(d.calendar.state.status,'ready');assert.deepEqual(d.attempts,[]);
 held.resolve();assert.equal((await deferredLink).outcome,'synced');assert.deepEqual(operations(d),['select','resume']);d.calendar.retire();
 const g=await agent(),abort=new AbortController();g.heldFeed=deferred();void g.calendar.refresh({timeZone:'UTC'});
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

const panel=(rows,options,link=calendarLink)=>mountGoogleAccountPanel(rows,options,{cloudServiceName,connectionReturn,workspaceReturn,gmailGrants,calendarLink:link});

test('the Calendar intent asks Google once for Gmail read plus Calendar read and write, then links after the readback',async()=>{
 const f=await agent(),p=await panel([]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  assert.ok(p.button('Connect Google Calendar'));assert.equal(p.button('Connect Google account'),undefined,'one Connect for the Calendar intent');
  assert.match(p.text(),/Two-way sync\. Google gets event details and guests\./);
  assert.equal(p.lists,1);assert.equal(f.reads,0,'opening the panel never reads or links the Calendar');
  await p.act(()=>p.button('Connect Google Calendar').click());
  assert.deepEqual(p.consents,[['write','read']]);assert.equal(p.opens,1);assert.equal(f.reads,0,'no link before Google returns');
  p.rows=[account(OWNER,WRITE)];await p.returnFromGoogle();
  await p.until(()=>p.status()==='Synced · owner@example.test','linked from the verified readback');
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
  await p.until(()=>/^Read-only$/.test(p.status()));
  assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);
  // A connection-change notification requests a fresh read; only its returned grant completes the same intent.
  const reads=p.lists;
  p.rows=[account(OWNER,[...WRITE,'google.gmail.send'])];await p.dispatch('alpha:test-google-accounts');
  await p.until(()=>p.status()==='Synced · owner@example.test');
  assert.equal(p.lists,reads+1);assert.deepEqual(p.consents,[['write','send']],'a grant readback does not repeat consent');assert.deepEqual(operations(f),['select','resume']);
 }finally{await p.close();f.calendar.retire();}
});

test('an existing Calendar write grant links at once with no new consent',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));assert.equal(f.reads,0);
  await p.act(()=>p.button('Sync Calendar with Google').click());
  await p.until(()=>p.status()==='Synced · owner@example.test');
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
   assert.equal(p.status(),options.unreadable?'Edits unknown':'Edits off');
   assert.deepEqual(p.accessChanges,[],'never turned on without the tap');assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.deepEqual(p.consents,[]);
   await p.act(()=>p.button('Allow Calendar changes').click());
   // 3800a178e: an unreadable document is never written, even after the tap; the owner reviews device settings.
   if(options.unreadable){await p.until(()=>p.status()==='Couldn’t read');assert.deepEqual(p.accessChanges,[]);assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.deepEqual(p.consents,[]);continue;}
   await p.until(()=>p.status()==='Synced · owner@example.test');
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
  await p.until(()=>p.status()==='Synced · owner@example.test');assert.deepEqual(operations(f),['select','resume']);
 }finally{await p.close();f.calendar.retire();}
 const g=await agent(),q=await panel([account(OWNER,WRITE)],{calendarEdits:false,saveFails:true});
 try{
  await q.act(()=>q.controller.openCalendar(g.scope));await q.act(()=>q.button('Sync Calendar with Google').click());
  await q.until(()=>q.button('Allow Calendar changes'));await q.act(()=>q.button('Allow Calendar changes').click());
  await q.until(()=>q.status()==='Not saved');
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
  await p.until(()=>p.status()==='Synced · owner@example.test');
  assert.deepEqual(p.policy,[['residentGoogleCalendarAccess','cloud-credential',true]]);assert.equal(writes,0,'the host policy precedes the first control write');
  await p.act(()=>p.toggle('Edit events').click());
  assert.deepEqual(p.policy.at(-1),['residentGoogleCalendarAccess','cloud-credential',false]);assert.deepEqual(p.accessChanges,[{calendarEdits:true},{calendarEdits:false}],'explicit Connect persisted the loaded on choice; the toggle turned it off');
 }finally{await p.close();f.calendar.retire();}
 const g=await agent(),q=await panel([account(OWNER,WRITE)]); // Outside the browser Cloud stage there is no host call.
 try{
  await q.act(()=>q.controller.openCalendar(g.scope));await q.act(()=>q.button('Sync Calendar with Google').click());
  await q.until(()=>q.status()==='Synced · owner@example.test');await q.act(()=>q.toggle('Edit events').click());assert.deepEqual(q.policy,[]);
 }finally{await q.close();g.calendar.retire();}
});

test('a browser host without the Calendar operation says sync is not available yet and never links or reads Synced',async()=>{
 for(const host of ['missing','wrong']){
  const f=await agent({control:{paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER}}}),p=await panel([account(OWNER,WRITE)],{browser:true,host});
  try{
   await p.act(()=>p.controller.openCalendar(f.scope));await p.act(()=>p.button('Sync Calendar with Google').click());
   await p.until(()=>p.status()==='Sync unavailable');
   assert.equal(p.policy.length,1);assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.doesNotMatch(p.text(),/Synced|Syncing/);
  }finally{await p.close();f.calendar.retire();}
 }
});

test('a panel opened from Calendar passes its disconnect lifecycle and keeps an unknown pause for review; a plain panel passes none',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  await p.act(()=>p.button('Sync Calendar with Google').click());await p.until(()=>p.status()==='Synced · owner@example.test');
  // Like Codex's callsite: retain before any dispatch, then report the pause outcome (unknown here).
  p.onDisconnect=(calendar,connectionId)=>{const review=calendar.capture();calendar.retain({connectionId,pauseKey:'pause-key',review,status:'unknown'});return {calendarPause:'unknown',callbackRetirement:'confirmed',providerDrain:'unavailable',pauseRequest:{operation:'pause',expectedRevision:review.control.revision,idempotencyKey:'pause-key'}};};
  await p.act(()=>p.button('Disconnect Google account owner@example.test').click());await p.act(()=>p.button('Confirm disconnect Google account').click());
  const [{calendar}]=p.disconnects;
  assert.deepEqual(calendar.capture().control,{revision:2,paused:false,destination:{connectorAccountId:GRANT,providerCalendarId:OWNER},pendingDispatch:null},'the review the link read back');
  assert.equal(p.status(),'Disconnect disconnected. · Sync pause unconfirmed');
  assert.equal(p.controller.calendar().retained.get('pause-key').status,'unknown','the unknown pause stays retained');
  await p.act(()=>p.controller.close());p.onDisconnect=null;await p.act(()=>p.controller.open());
  await p.act(()=>p.button('Disconnect Google account owner@example.test').click());await p.act(()=>p.button('Confirm disconnect Google account').click());
  assert.equal(p.disconnects.length,2);assert.equal(p.disconnects[1].calendar,undefined,'without a Calendar scope the disconnect is privacy revoke only');
 }finally{await p.close();f.calendar.retire();}
});

test('Connect Google Calendar starts no consent until this load verified the account list',async()=>{
 const f=await agent(),p=await panel([account(OWNER,[...READ,'google.gmail.send'])]);
 try{
  p.listFails=true;await p.act(()=>p.controller.openCalendar(f.scope));
  assert.equal(p.status(),'Couldn’t verify');
  await p.act(()=>p.button('Connect Google Calendar').click());
  assert.deepEqual(p.consents,[],'an unknown Gmail tier never asks Google for less');assert.equal(p.opens,0);assert.match(p.status(),/Couldn’t verify/);
  // Reopening performs the canonical account read after the failed load. No retired Check button is required.
  const reads=p.lists;
  await p.act(()=>p.button('Close Google accounts').click());p.listFails=false;
  await p.act(()=>p.controller.openCalendar(f.scope));
  assert.equal(p.lists,reads+1);assert.deepEqual(p.consents,[]);assert.equal(f.reads,0);
  await p.act(()=>p.button('Connect Google Calendar').click());assert.deepEqual(p.consents,[['write','send']]);
 }finally{await p.close();f.calendar.retire();}
});

test('a failed replacement account read retires consent waiting on Calendar access',async()=>{
 const f=await agent(),p=await panel([account(OWNER,[...READ,'google.gmail.send'])]);
 const capture=deferred();let waiting=false;
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  p.onCapture=()=>{waiting=true;return capture.promise;};
  await p.act(()=>p.button('Connect Google Calendar').click());
  await p.until(()=>waiting,'the consent is waiting on the Calendar permission read');
  p.listFails=true;await p.dispatch('alpha:test-google-accounts');
  assert.match(p.status(),/Couldn’t verify/);
  await p.act(()=>capture.resolve());
  assert.deepEqual(p.consents,[],'a verified row from an older load cannot authorize consent');
  assert.equal(p.opens,0);
  assert.match(p.status(),/Couldn’t verify/);
 }finally{capture.resolve();await p.close();f.calendar.retire();}
});

test('after a disconnect with no account readback, Connect Google Calendar starts no consent',async()=>{
 const f=await agent(),modify=[...READ,'google.gmail.send','google.gmail.drafts','google.gmail.mailbox'];
 const p=await panel([account(OWNER,modify),account(SECOND,READ,'22222222-2222-4222-8222-222222222222')]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));
  p.disconnectResult={outcome:'unconfirmed'};
  await p.act(()=>p.button(`Disconnect Google account ${SECOND}`).click());
  await p.act(()=>p.button('Confirm disconnect Google account').click());
  assert.equal(p.disconnects.length,1);
  await p.act(()=>p.button('Connect Google Calendar').click());
  assert.deepEqual(p.consents,[],'an unknown Gmail tier never asks Google for less');assert.match(p.status(),/Couldn’t verify/);
 }finally{await p.close();f.calendar.retire();}
});

test('Add Google account asks for the Gmail tier the connected accounts hold, like the switches',async()=>{
 const modify=[...READ,'google.gmail.send','google.gmail.drafts','google.gmail.mailbox'];
 for(const [rows,tier] of [[[account(OWNER,modify)],'modify'],[[account(OWNER,READ)],'send'],[[],'send']]){
  const p=await panel(rows);
  try{
   await p.act(()=>p.controller.open());
   await p.act(()=>p.button(rows.length?'Add account':'Connect Google account').click());
   assert.deepEqual(p.consents,[['write',tier]]);
  }finally{await p.close();}
 }
});

test('closing cancels the intent: a later return never links, and plain Google connect is unchanged',async()=>{
 const f=await agent(),p=await panel([]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));await p.act(()=>p.button('Connect Google Calendar').click());
  await p.act(()=>p.button('Close Google accounts').click());assert.equal(p.controller.calendar(),null);
  p.rows=[account(OWNER,WRITE)];await p.act(()=>p.controller.open());
  assert.ok(p.button('Add account'),'without the Calendar intent the generic connect remains');assert.equal(p.button('Sync Calendar with Google'),undefined);
  const reads=p.lists;
  await p.returnFromGoogle();assert.equal(p.lists,reads,'closing retired the armed consent return');
  await p.dispatch('alpha:test-google-accounts');assert.equal(p.lists,reads+1,'the plain panel still revalidates changed accounts');
  assert.equal(p.button('Check Google connections'),undefined);
  assert.equal(f.reads,0);assert.deepEqual(f.attempts,[]);assert.equal(p.status(),'Calendar includes the calendars you show in Google.');
 }finally{await p.close();f.calendar.retire();}
});

test('a Cloud account change during the link stops before the next control write',async()=>{
 const f=await agent(),p=await panel([account(OWNER,WRITE)]);
 try{
  await p.act(()=>p.controller.openCalendar(f.scope));f.afterPost=()=>p.changeCloud();
  await p.act(()=>p.button('Sync Calendar with Google').click());await p.until(()=>p.button('Sync Calendar with Google')?.disabled===false);
  assert.deepEqual(operations(f),['select']);assert.doesNotMatch(p.status(),/Synced/);
 }finally{await p.close();f.calendar.retire();}
});

async function heldLinkPanel(options = {}) {
  const links = [];
  const p = await panel([account(OWNER, WRITE)], {...options, observeAdmission: true}, {
    ...calendarLink,
    linkGoogleCalendar(scope, rows, signal) {
      const task = {...deferred(), scope, rows, signal};
      links.push(task);
      return task.promise;
    },
  });
  await p.act(() => p.controller.openCalendar({calendar: {}, current: () => true, canChange: () => true}));
  const clickLink = () => p.act(() => {
    const button = p.button('Sync Calendar with Google');
    assert.ok(button && !button.disabled);
    button.click();
  });
  return {p, links, clickLink, close: async () => {
    await p.act(() => p.controller.close());
    await p.act(() => {
      for (const task of links) task.resolve({outcome: 'not-linked', message: 'Fixture retired'});
    });
    await p.close();
  }};
}

test('a retired Calendar link cannot overwrite the replacement Cloud review in the same intent', async () => {
  const f = await heldLinkPanel();
  try {
    const intent = f.p.controller.calendar();
    await f.clickLink();
    await f.p.act(f.p.replaceCloud);
    assert.equal(f.links[0].signal.aborted, true);
    assert.equal(f.p.controller.calendar(), intent);
    await f.clickLink();
    const current = {binding: 'current', control: {revision: 2}, sources: [], visibleLocalEventIds: []};
    await f.p.act(() => f.links[1].resolve({outcome: 'synced', message: 'Current owner synced', review: current}));
    assert.equal(intent.review, current);
    const retired = {...current, binding: 'retired', control: {revision: 1}};
    await f.p.act(() => f.links[0].resolve({outcome: 'unconfirmed', message: 'Retired link result', review: retired}));
    assert.equal(f.p.status(), 'Current owner synced');
    assert.equal(intent.review, current, 'the retained review keeps the replacement result identity');
  } finally {await f.close();}
});

test('a retired Calendar link cannot clear the replacement account read busy state', async () => {
  const f = await heldLinkPanel(), currentList = deferred();
  try {
    await f.clickLink();
    f.p.onList = () => currentList.promise;
    await f.p.act(f.p.replaceCloud);
    assert.equal(f.links[0].signal.aborted, true);
    assert.equal(f.p.inspectAdmission().busy, true);
    await f.p.act(() => f.links[0].resolve({outcome: 'not-linked', message: 'Retired link result'}));
    assert.equal(f.p.inspectAdmission().busy, true);
    assert.equal(f.p.button('Connect Google Calendar').disabled, true,'the actual primary action stays disabled during the replacement read');
    assert.equal(f.p.button('Sync Calendar with Google'),undefined,'the retired grant cannot supply an action');
    assert.equal(f.p.button('Disconnect Google account owner@example.test'),undefined,'the retired account is no longer shown');
    await f.p.act(() => currentList.resolve([account(OWNER, WRITE)]));
    assert.equal(f.p.inspectAdmission().busy, false);
    assert.equal(f.p.button('Sync Calendar with Google').disabled,false,'only the replacement grant enables the primary action');
    assert.equal(f.links.length,1,'the replacement read does not reuse the retired link intent');
  } finally {
    currentList.resolve([account(OWNER, WRITE)]);
    await f.close();
  }
});

test('a retired Calendar host permission result cannot start the link helper', async () => {
  const f = await heldLinkPanel({browser: true});
  try {
    f.p.onPolicy = f.p.changeCloud;
    await f.clickLink();
    assert.equal(f.p.policy.length, 1);
    assert.equal(f.links.length, 0);
  } finally {await f.close();}
});

const replacementAccount = grants => account(SECOND, grants, '22222222-2222-4222-8222-222222222222');
const allowChoice = p => p.button('Allow Calendar changes');

test('a retired Calendar access choice cannot authorize a replacement read-only account', async () => {
  const f = await heldLinkPanel({calendarEdits: false});
  try {
    await f.clickLink();
    assert.ok(allowChoice(f.p));
    f.p.rows = [replacementAccount(READ)];
    await f.p.act(f.p.replaceCloud);
    assert.ok(f.p.button('Connect Google Calendar'));
    assert.equal(!!allowChoice(f.p), false, 'the retired write-grant choice is withdrawn');
    assert.deepEqual(f.p.accessChanges, []);
    assert.equal(f.links.length, 0);

    await f.p.act(() => f.p.button('Connect Google Calendar').click());
    assert.ok(allowChoice(f.p), 'the current read-only account can request its own consent');
    assert.equal(f.links.length, 0);
    assert.deepEqual(f.p.accessChanges, []);

    f.p.rows = [replacementAccount(WRITE)];
    await f.p.dispatch('alpha:test-google-accounts');
    assert.equal(!!allowChoice(f.p), false, 'even this owner needs a choice from the latest exact review');
    await f.clickLink();
    await f.p.act(() => allowChoice(f.p).click());
    assert.equal(f.links.length, 1);
    assert.deepEqual(f.links[0].rows.map(row => row.connectionId), [replacementAccount(WRITE).connectionId]);
    await f.p.act(() => f.links[0].resolve({outcome: 'synced', message: 'Replacement account synced'}));
    assert.equal(f.p.status(), 'Replacement account synced');
  } finally {await f.close();}
});

test('a newer same-owner account read retires an Allow tap waiting on the device receipt', async () => {
  const f = await heldLinkPanel({calendarEdits: false}), capture = deferred();
  try {
    await f.clickLink();
    f.p.onCapture = () => capture.promise;
    await f.p.act(() => allowChoice(f.p).click());
    f.p.rows = [account(OWNER, READ)];
    await f.p.dispatch('alpha:test-google-accounts');
    f.p.onCapture = null;
    await f.p.act(() => capture.resolve());
    assert.deepEqual(f.p.accessChanges, [], 'the retired Allow tap cannot persist native access');
    assert.equal(f.links.length, 0);
    assert.ok(f.p.button('Connect Google Calendar'));
  } finally {capture.resolve(); await f.close();}
});

test('a held access read cannot display a choice for a replacement Cloud binding', async () => {
  const f = await heldLinkPanel({calendarEdits: false}), capture = deferred();
  try {
    f.p.onCapture = () => capture.promise;
    await f.clickLink();
    f.p.rows = [replacementAccount(READ)];
    await f.p.act(f.p.replaceCloud);
    f.p.onCapture = null;
    await f.p.act(() => capture.resolve());
    assert.equal(!!allowChoice(f.p), false);
    assert.deepEqual(f.p.accessChanges, []);
    assert.equal(f.links.length, 0);
  } finally {capture.resolve(); await f.close();}
});
