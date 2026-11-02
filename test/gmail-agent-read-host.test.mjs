import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
if(!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createGmailAgentReadHost}=await import('../scripts/gmail-agent-read-host.ts');
const {cloudStorageNamespace}=await import('../apps/app/src/runtime/cloud-deployment.generated.ts');
const owner='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',grant='33333333-3333-4333-8333-333333333333';
const account={configured:true,connected:true,reason:'connected',connectionId:grant,grantedCapabilities:['google.gmail.triage']};
const message={externalId:'mail1',threadId:'thread1',subject:'A &amp; B',from:'Sender',to:[],snippet:'Hello',receivedAt:'2026-10-15T00:00:00Z',isUnread:true};
async function fixture(){
 const profile=await mkdtemp(join(tmpdir(),'alpha-gmail-reader-'));
 const scoped=join(profile,cloudStorageNamespace.replaceAll(':','-'));await mkdir(scoped,{mode:0o700});
 const credential={credentialReference:'browser-cloud-reference:44444444-4444-4444-8444-444444444444',credentialId:grant,userId:owner,organizationId:org,token:'synthetic-only'};
 const save=()=>writeFile(join(scoped,'credentials.json'),JSON.stringify({production:credential}),{mode:0o600});await save();
 const calls=[],sends=new Map();let beforeOwner=async()=>{},feedStatus=0,loseDispatch=false,accounts=()=>[account],afterRead=async()=>{},pages=()=>({messages:[message],syncedAt:message.receivedAt}),calendars=()=>[{calendarId:'primary',summary:'Owned calendar',primary:true,selected:true,accessRole:'owner'}];
 const original=globalThis.fetch;globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);calls.push(u);
  if(u.pathname==='/api/v1/user'){await beforeOwner();return Response.json({success:true,data:{id:owner,organization_id:org}});}
  if(u.pathname.endsWith('/accounts'))return Response.json(accounts());
  if(u.pathname.includes('/inbox-v1/operations')){
   const body=init.body?JSON.parse(init.body):null;
   if(init.method==='POST'&&u.pathname.endsWith('/operations')){
    const review={from:'owned@example.invalid',...body.proposal},reviewDigest=createHash('sha256').update(JSON.stringify(review)).digest('hex');
    const receipt={requestId:body.requestId,kind:body.proposal.kind,state:'prepared',reviewDigest,providerResult:null,rejectionCode:null};sends.set(body.requestId,{receipt,proposal:body.proposal});return Response.json({version:1,providerExactlyOnce:false,receipt,review});
   }
   const id=u.pathname.split('/').at(init.method==='POST'?-2:-1),saved=sends.get(id);
   if(!saved)return Response.json({error:'Operation not found'},{status:404});
   if(init.method==='POST'){
    if(JSON.stringify(body.proposal)!==JSON.stringify(saved.proposal)||body.reviewDigest!==saved.receipt.reviewDigest)return Response.json({error:'Review changed'},{status:409});
    saved.receipt={...saved.receipt,state:'succeeded',providerResult:saved.proposal.kind==='send'?{messageId:'accepted-mail'}:{messageId:saved.proposal.messageId,labelIds:saved.proposal.kind==='trash'?['TRASH']:saved.proposal.kind==='mark-unread'?['INBOX','UNREAD']:saved.proposal.kind==='mark-read'?['INBOX']:[],unread:saved.proposal.kind==='mark-unread',historyId:'h2'}};
    if(loseDispatch)throw Error('Lost dispatch response');
   }
   return Response.json({version:1,providerExactlyOnce:false,receipt:saved.receipt});
  }
  if(u.pathname.endsWith('/calendars'))return Response.json(calendars(u));
  if(u.pathname.endsWith('/feed')){if(feedStatus)return Response.json({error:'Refused'},{status:feedStatus});await afterRead();return Response.json({calendarId:'primary',events:[],syncedAt:message.receivedAt});}
  if(u.pathname.endsWith('/search')){const data=pages(u);await afterRead();return Response.json(data);}
  if(u.pathname.endsWith('/read')){await afterRead();return Response.json({message:{...message,metadata:{historyId:'h1'}},bodyText:'Exact synthetic body'});}
  throw Error('Unexpected route');
 };
 let reader;try{reader=createGmailAgentReadHost(profile);}finally{globalThis.fetch=original;}
 return {reader,calls,credential,save,sends,setAccounts:fn=>accounts=fn,setAfterRead:fn=>afterRead=fn,setPages:fn=>pages=fn,setCalendars:fn=>calendars=fn,setBeforeOwner:fn=>beforeOwner=fn,setFeedStatus:status=>feedStatus=status,loseDispatch:()=>{loseDispatch=true;},close:()=>rm(profile,{recursive:true,force:true})};
}
const sendAccount={...account,grantedCapabilities:['google.gmail.triage','google.gmail.send']};
const email=()=>({requestId:randomUUID(),to:['self@example.invalid'],subject:'Synthetic QA',bodyText:'No real email is sent by this fixture.'});
test('managed Gmail prepares an exact review and sends only once after matching dispatch',async()=>{
 const f=await fixture();try{f.setAccounts(()=>[sendAccount]);const content=email(),prepared=await f.reader.prepareSend(content);
 assert.equal(prepared.review.subject,content.subject);assert.equal(f.calls.some(u=>u.pathname.endsWith('/dispatch')),false);
 const input={...content,id:prepared.id,reviewDigest:prepared.reviewDigest};const sent=await f.reader.dispatchSend(input);assert.equal(sent.state,'succeeded');assert.equal(sent.providerResult.messageId,'accepted-mail');
 assert.equal((await f.reader.dispatchSend(input)).state,'succeeded');assert.equal(f.calls.filter(u=>u.pathname.endsWith('/dispatch')).length,1);
 }finally{await f.close();}
});
test('send grants, review content and credential generation cannot be crossed',async()=>{
 const f=await fixture();try{const content=email();await assert.rejects(f.reader.prepareSend(content));assert.equal(f.calls.some(u=>u.pathname.endsWith('/operations')),false);
 f.setAccounts(()=>[sendAccount]);const prepared=await f.reader.prepareSend(content),input={...content,id:prepared.id,reviewDigest:prepared.reviewDigest};
 await assert.rejects(f.reader.dispatchSend({...input,reviewDigest:'f'.repeat(64)}),/reviewed email changed/);
 await assert.rejects(f.reader.dispatchSend({...input,bodyText:'Changed after review'}));
 f.credential.credentialReference='browser-cloud-reference:'+randomUUID();await f.save();const before=f.calls.length;
 await assert.rejects(f.reader.dispatchSend(input),/another account or credential/);assert.equal(f.calls.slice(before).some(u=>u.pathname.endsWith('/dispatch')),false);
 }finally{await f.close();}
});
test('a lost dispatch response is resolved by receipt without a second provider dispatch',async()=>{
 const f=await fixture();try{f.setAccounts(()=>[sendAccount]);const content=email(),prepared=await f.reader.prepareSend(content),input={...content,id:prepared.id,reviewDigest:prepared.reviewDigest};f.loseDispatch();
 await assert.rejects(f.reader.dispatchSend(input));assert.equal((await f.reader.sendReceipt(prepared.id)).state,'succeeded');assert.equal((await f.reader.dispatchSend(input)).state,'succeeded');
 assert.equal(f.calls.filter(u=>u.pathname.endsWith('/dispatch')).length,1);
 }finally{await f.close();}
});
test('owner-scoped Gmail IDs read exact bodies and cannot cross credential generations',async()=>{
 const f=await fixture();try{const rows=await f.reader.list({});assert.equal(rows[0].threadTopic,'A & B');assert.equal((await f.reader.message(rows[0].id)).bodyText,'Exact synthetic body');
 f.credential.credentialReference='browser-cloud-reference:55555555-5555-4555-8555-555555555555';await f.save();const before=f.calls.filter(u=>u.pathname.endsWith('/read')).length;
 await assert.rejects(f.reader.message(rows[0].id),/current owner/);assert.equal(f.calls.filter(u=>u.pathname.endsWith('/read')).length,before);
 }finally{await f.close();}
});
test('Gmail grant revocation during a read prevents content delivery',async()=>{
 const f=await fixture();try{f.setAfterRead(async()=>f.setAccounts(()=>[]));await assert.rejects(f.reader.list({}),/permission changed/);}finally{await f.close();}
});
test('multiple readable Gmail accounts refuse before any mailbox read',async()=>{
 const f=await fixture();try{f.setAccounts(()=>[account,{...account,connectionId:owner}]);await assert.rejects(f.reader.list({}),/More than one/);assert.equal(f.calls.some(u=>u.pathname.endsWith('/search')),false);}finally{await f.close();}
});
test('paged Gmail reads reject a mailbox revision change',async()=>{
 const f=await fixture();try{f.setPages(u=>({messages:[message],syncedAt:message.receivedAt,mailboxHistoryId:u.searchParams.has('pageToken')?'2':'1',nextPageToken:u.searchParams.has('pageToken')?null:'next'}));await assert.rejects(f.reader.list({limit:25}),/mailbox changed/);}finally{await f.close();}
});

test('Calendar reads bind the current grant and refuse a revoked source before returning its feed',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[{...account,label:'owned@example.invalid',grantedCapabilities:['google.calendar.read']}]);
  const sources=await f.reader.calendarSources();assert.equal(sources[0].summary,'Owned calendar');assert.match(sources[0].grantId,/^alpha-google:[a-f0-9]{64}$/);
  const input={grantId:sources[0].grantId,calendarId:'primary',timeMin:'2026-10-14T00:00:00Z',timeMax:'2026-10-16T00:00:00Z',timeZone:'UTC'};
  assert.equal((await f.reader.calendarFeed(input)).state,'complete');
  await assert.rejects(f.reader.calendarFeed({...input,grantId:'alpha-google:'+'f'.repeat(64)}),/current owner/);
  f.setAfterRead(async()=>f.setAccounts(()=>[]));await assert.rejects(f.reader.calendarFeed(input),/permission changed/);
 }finally{await f.close();}
});

const calendarAccount={...account,label:'owned@example.invalid',grantedCapabilities:['google.calendar.read']};
const calendarInput=grantId=>({grantId,calendarId:'primary',timeMin:'2026-10-14T00:00:00Z',timeMax:'2026-10-16T00:00:00Z',timeZone:'UTC'});
const until=async ready=>{while(!ready())await new Promise(resolve=>setTimeout(resolve,1));};
const ownerCalls=f=>f.calls.filter(u=>u.pathname==='/api/v1/user').length;
/** One normal read: the service lists sources, then reads each feed. */
async function calendarTurn(f){const sources=await f.reader.calendarSources();await f.reader.calendarFeed(calendarInput(sources[0].grantId));return sources;}

test('One Calendar read checks the owner once, and every read of sources is fresh',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);
  await calendarTurn(f);
  const calls=()=>f.calls.map(u=>u.pathname.split('/').at(-1));
  assert.deepEqual(calls(),['user','accounts','calendars','accounts','feed','accounts']);
  f.calls.length=0;await calendarTurn(f);
  assert.deepEqual(calls(),['user','accounts','calendars','accounts','feed','accounts']);
 }finally{await f.close();}
});

test('A revoked account leaves the next source list at once, with no refusal',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);await calendarTurn(f);
  f.setAccounts(()=>[]);
  assert.deepEqual(await f.reader.calendarSources(),[]);
 }finally{await f.close();}
});

test('Disconnecting one of two accounts keeps the healthy calendars',async()=>{
 const f=await fixture();try{
  const second={...calendarAccount,connectionId:'55555555-5555-4555-8555-555555555555'};
  f.setAccounts(()=>[calendarAccount,second]);await f.reader.calendarSources();
  f.setAccounts(()=>[second]);
  assert.deepEqual([...new Set((await f.reader.calendarSources()).map(row=>row.managedGoogleConnectionId))],[second.connectionId]);
 }finally{await f.close();}
});

test('A feed revoked during its read returns nothing, and the failure drops the shared lookups',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await calendarTurn(f);
  f.setAfterRead(async()=>f.setAccounts(()=>[]));
  await assert.rejects(f.reader.calendarFeed(calendarInput(source.grantId)),/permission changed/);
  f.setAfterRead(async()=>{});f.calls.length=0;
  await assert.rejects(f.reader.calendarFeed(calendarInput(source.grantId)),/current owner/);
  assert.ok(f.calls.some(u=>u.pathname==='/api/v1/user'),'the next feed verified the owner again');
 }finally{await f.close();}
});

test('An account connected just after a read joins the next source list',async()=>{
 const f=await fixture();try{
  const second={...calendarAccount,connectionId:'55555555-5555-4555-8555-555555555555'};
  f.setAccounts(()=>[]);assert.deepEqual(await f.reader.calendarSources(),[]);
  f.setAccounts(()=>[calendarAccount,second]);
  assert.equal(new Set((await f.reader.calendarSources()).map(row=>row.managedGoogleConnectionId)).size,2);
 }finally{await f.close();}
});

test('A calendar added after the source step is still readable',async()=>{
 const f=await fixture();try{
  const owned={calendarId:'primary',summary:'Owned calendar',primary:true,selected:true,accessRole:'owner'};
  f.setAccounts(()=>[calendarAccount]);f.setCalendars(()=>[{...owned,calendarId:'team',summary:'Team'}]);
  const [source]=await f.reader.calendarSources();
  f.setCalendars(()=>[{...owned,calendarId:'team',summary:'Team'},owned]);
  assert.equal((await f.reader.calendarFeed(calendarInput(source.grantId))).calendarId,'primary');
 }finally{await f.close();}
});

test('A feed step reuses an owner check for seconds only, however often reads repeat',async()=>{
 const f=await fixture(),now=performance.now;let clock=now.call(performance);performance.now=()=>clock;try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await f.reader.calendarSources();
  const input=calendarInput(source.grantId);
  for(let read=0;read<4;read++){clock+=2000;await f.reader.calendarFeed(input);}
  assert.equal(f.calls.filter(u=>u.pathname==='/api/v1/user').length,2,'renewed by a verified lookup, never by a re-check');
 }finally{performance.now=now;await f.close();}
});

test('A read cannot join an owner check older than the step window',async()=>{
 const f=await fixture(),now=performance.now;let clock=now.call(performance),release;performance.now=()=>clock;try{
  f.setAccounts(()=>[calendarAccount]);f.setBeforeOwner(()=>new Promise(resolve=>{release=resolve;}));
  const slow=f.reader.calendarSources();await until(()=>release);
  clock+=6000;f.setBeforeOwner(async()=>{});await f.reader.calendarSources();
  assert.equal(ownerCalls(f),2);
  release();await slow;
 }finally{performance.now=now;await f.close();}
});

test('A late failed lookup leaves the newer one in place',async()=>{
 const f=await fixture(),now=performance.now;let clock=now.call(performance),fail;performance.now=()=>clock;try{
  f.setAccounts(()=>[calendarAccount]);f.setBeforeOwner(()=>new Promise((_,reject)=>{fail=reject;}));
  const stale=f.reader.calendarSources();await until(()=>fail);
  clock+=6000;f.setBeforeOwner(async()=>{});const [source]=await f.reader.calendarSources();
  fail(Error('Lost'));await assert.rejects(stale);
  const verified=ownerCalls(f);await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(ownerCalls(f),verified);
 }finally{performance.now=now;await f.close();}
});

test('A feed step counts time the phone slept, and a wall clock moved back cannot extend it',async()=>{
 const f=await fixture(),wall=Date.now,monotonic=performance.now;let wallClock=wall(),clock=monotonic.call(performance);Date.now=()=>wallClock;performance.now=()=>clock;try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await f.reader.calendarSources();
  wallClock+=6000;await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(ownerCalls(f),2,'a suspended phone verifies again though its monotonic clock stood still');
  await f.reader.calendarSources();const verified=ownerCalls(f);
  wallClock-=3600000;clock+=6000;await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(ownerCalls(f),verified+1,'a wall clock moved back does not hold the lookup open');
 }finally{Date.now=wall;performance.now=monotonic;await f.close();}
});

test('Finished lookups are dropped when their window ends',async()=>{
 const f=await fixture(),timer=globalThis.setTimeout,drops=[];
 globalThis.setTimeout=(run,ms,...rest)=>{if(ms===5000){drops.push(run);return {unref(){}};}return timer(run,ms,...rest);};
 try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await f.reader.calendarSources();
  assert.ok(drops.length>=2,'the owner and calendar lookups each schedule their removal');
  drops.splice(0).forEach(run=>run());
  const verified=ownerCalls(f);await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(ownerCalls(f),verified+1);
 }finally{globalThis.setTimeout=timer;await f.close();}
});

test('Changing the Cloud credential drops every lookup of the old one',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await f.reader.calendarSources();
  const original=f.credential.credentialId;
  f.credential.credentialId='66666666-6666-4666-8666-666666666666';await f.save();await f.reader.calendarSources();
  f.credential.credentialId=original;await f.save();
  const verified=ownerCalls(f);await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(ownerCalls(f),verified+1,'returning to the old credential verifies again');
 }finally{await f.close();}
});

test('Concurrent Calendar reads share one lookup, and a joiner reads for itself when the leader ends',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);
  const [a,b]=await Promise.all([f.reader.calendarSources(),f.reader.calendarSources()]);assert.deepEqual(a,b);
  assert.equal(f.calls.filter(u=>u.pathname==='/api/v1/user').length,1);
  let release;f.setBeforeOwner(()=>new Promise(resolve=>{release=resolve;}));
  const controller=new AbortController(),leader=f.reader.calendarSources(controller.signal);await until(()=>release);
  const joiner=f.reader.calendarSources();await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(ownerCalls(f),2,'the joiner waits on the running lookup');
  f.setBeforeOwner(async()=>{});controller.abort();release();
  const [ended,alive]=await Promise.allSettled([leader,joiner]);
  assert.equal(ended.status,'rejected');assert.equal(alive.status,'fulfilled');assert.equal(alive.value.length,1);
 }finally{await f.close();}
});

test('A refused feed drops the shared lookups',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await f.reader.calendarSources();
  f.setFeedStatus(403);await assert.rejects(f.reader.calendarFeed(calendarInput(source.grantId)));
  f.setFeedStatus(0);f.calls.length=0;await f.reader.calendarFeed(calendarInput(source.grantId));
  assert.equal(f.calls[0].pathname,'/api/v1/user');
 }finally{await f.close();}
});

test('Each account keeps its own calendars across the feed step',async()=>{
 const f=await fixture();try{
  const second={...calendarAccount,connectionId:'55555555-5555-4555-8555-555555555555'},row={calendarId:'primary',summary:'Owned calendar',primary:true,selected:true,accessRole:'owner'};
  f.setAccounts(()=>[calendarAccount,second]);
  f.setCalendars(u=>[u.href.includes(second.connectionId)?{...row,calendarId:'team',summary:'Team'}:row]);
  const sources=await f.reader.calendarSources(),other=sources.find(source=>source.calendarId==='team');
  await assert.rejects(f.reader.calendarFeed(calendarInput(other.grantId)),/not currently readable/);
  assert.equal((await f.reader.calendarFeed(calendarInput(sources.find(source=>source.calendarId==='primary').grantId))).calendarId,'primary');
 }finally{await f.close();}
});

test('Another Cloud credential never reuses a Calendar lookup',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[calendarAccount]);const [source]=await calendarTurn(f);
  f.credential.credentialId='66666666-6666-4666-8666-666666666666';await f.save();f.calls.length=0;
  await assert.rejects(f.reader.calendarFeed(calendarInput(source.grantId)),/current owner/);
  assert.ok(f.calls.some(u=>u.pathname==='/api/v1/user'),'a new credential verified its own owner');
 }finally{await f.close();}
});

test('Gmail reads keep their own owner verification on every read',async()=>{
 const f=await fixture();try{
  await f.reader.list({});f.calls.length=0;await f.reader.list({});
  assert.ok(f.calls.some(u=>u.pathname==='/api/v1/user'));
 }finally{await f.close();}
});

test('Calendar sources join the one merged agent feed when Google shows them, and only then',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[{...account,label:'owned@example.invalid',grantedCapabilities:['google.calendar.read']}]);
  const row=(calendarId,primary,selected,accessRole)=>({calendarId,summary:calendarId,primary,selected,accessRole});
  f.setCalendars(()=>[row('owned@example.invalid',true,false,'owner'),row('en.usa#holiday@group.v.calendar.google.com',false,true,'reader'),row('team@group.calendar.google.com',false,true,'writer'),row('addressbook#contacts@group.v.calendar.google.com',false,false,'reader'),row('freebusy@group.calendar.google.com',false,true,'freeBusyReader')]);
  const sources=await f.reader.calendarSources();
  // Each account's own calendar always joins; other calendars join exactly when Google shows them.
  assert.deepEqual(sources.map(source=>[source.calendarId,source.includeInFeed]),[['owned@example.invalid',true],['en.usa#holiday@group.v.calendar.google.com',true],['team@group.calendar.google.com',true],['addressbook#contacts@group.v.calendar.google.com',false]]);
 }finally{await f.close();}
});

test('Calendar reads list and read every connected account while Gmail still needs one account',async()=>{
 const f=await fixture();try{
  const second='55555555-5555-4555-8555-555555555555';
  f.setAccounts(()=>[{...account,label:'owned@example.invalid',grantedCapabilities:['google.calendar.read','google.gmail.triage']},{...account,connectionId:second,label:'work@example.invalid',grantedCapabilities:['google.calendar.read','google.gmail.triage']}]);
  const sources=await f.reader.calendarSources();assert.equal(sources.length,2);assert.notEqual(sources[0].grantId,sources[1].grantId);
  const input={grantId:sources[1].grantId,calendarId:'primary',timeMin:'2026-10-14T00:00:00Z',timeMax:'2026-10-16T00:00:00Z',timeZone:'UTC'};
  assert.equal((await f.reader.calendarFeed(input)).state,'complete');assert.ok(f.calls.some(u=>u.href.includes(second)&&u.pathname.endsWith('/feed')),'the feed reads the named account');
  await assert.rejects(f.reader.list({}),/More than one/);
 }finally{await f.close();}
});

const mailboxAccount={...sendAccount,grantedCapabilities:[...sendAccount.grantedCapabilities,'google.gmail.mailbox']};
test('agent mailbox changes use a durable turn ID, exact labels and one dispatch after a lost response',async()=>{
 const f=await fixture();try{
  f.setAccounts(()=>[mailboxAccount]);const messageId=(await f.reader.list({limit:1}))[0].id;
  for(const kind of ['archive','trash','mark-read','mark-unread']){
   const input={messageId,kind,requestId:randomUUID()};f.loseDispatch();
   assert.equal((await f.reader.mailbox(input)).ok,true);assert.equal((await f.reader.mailbox(input)).ok,true);
   assert.equal(f.calls.filter(u=>u.pathname.endsWith(input.requestId+'/dispatch')).length,1);
  }
 }finally{await f.close();}
});
test('agent mailbox changes refuse missing scope, foreign account, unknown receipts and account changes',async()=>{
 const f=await fixture();try{
  const messageId=(await f.reader.list({limit:1}))[0].id,input={messageId,kind:'archive',requestId:randomUUID()};
  await assert.rejects(f.reader.mailbox(input),/mailbox changes need permission/);assert.equal(f.sends.size,0);
  f.setAccounts(()=>[mailboxAccount]);await assert.rejects(f.reader.mailbox({...input,messageId:'alpha-gmail:'+'f'.repeat(64)+':mail1'}),/current Gmail owner/);assert.equal(f.sends.size,0);
  f.sends.set(input.requestId,{receipt:{requestId:input.requestId,kind:'archive',state:'outcome-unknown',reviewDigest:'a'.repeat(64),providerResult:null,rejectionCode:null}});
  assert.equal((await f.reader.mailbox(input)).ok,false);assert.equal(f.calls.some(u=>u.pathname.endsWith('/dispatch')),false);
  f.setAfterRead(async()=>f.setAccounts(()=>[]));await assert.rejects(f.reader.mailbox({...input,requestId:randomUUID()}));assert.equal(f.calls.some(u=>u.pathname.endsWith('/dispatch')),false);
 }finally{await f.close();}
});
