import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {action} from '../specs/quint/refinement/services/support.mjs';
import {inboxPagingImplementation, inboxPagingFixture} from '../specs/quint/refinement/services/inbox-list-paging-ports.mjs';

const account=value=>value?Number(value.split('-')[1]):0,query=value=>value==='in:inbox'?1:value==='in:sent'?2:0,cursor=value=>value?Number(value.split('-')[1]):0;
function observe(fixture){
 const s=fixture.source.inspect(),first=s.messages[0],available=s.loadingMore&&s.busy?0:cursor(s.nextPageToken);
 // setFolder retires loadedQuery immediately; the private old set is reused as an allocation
 // until the first-page merge replaces it, but carries no current-folder paging authority.
 const seen=s.loadedQuery?Array.from(s.seenCursors,cursor):[];
 for(const row of s.messages){assert.equal(row.owner,s.selected,'Every shown row belongs to the selected account');assert.equal(row.folder,s.query,'Every shown row belongs to the selected folder');}
 return {'s.account':account(s.selected),'s.query':query(s.query),'s.generation':s.generation-fixture.baseline,'s.busy':s.busy,
  's.pages':Math.min(3,s.messages.length),'s.shownAccount':first?account(first.owner):0,'s.shownQuery':first?query(first.folder):0,
  's.loadedQuery':query(s.loadedQuery),'s.cursor':available,'s.seenCursors':qset(seen),'s.usedCursors':qset(seen.filter(value=>value!==available)),
  's.newerMail':s.newerMail,'s.failure':s.failure,'s.cachedShown':s.cachedShown};
}
function assertPagingEffects(fixture){
 assert.equal(fixture.fixture.state.dispatches,0,'Paging cannot send email');assert.equal(fixture.fixture.state.prepares,0,'Paging cannot prepare mutations');
 // A provider cursor may be fetched ahead of demand, but one read-ahead generation cannot start
 // two identical live reads. Cancelled old generations remain visible in the full request log.
 const live=fixture.requests.filter(request=>!request.settled&&!request.signal.aborted),keys=live.map(request=>JSON.stringify([request.grant,request.query,request.cursor]));
 assert.equal(new Set(keys).size,keys.length,'No duplicate live provider read for the same cursor');
}
async function checkInboxListPaging(extraSources=[]){
 const temporary=mkdtempSync(join(tmpdir(),'quint-inbox-paging-'));
 try{
  const implementation=await inboxPagingImplementation(temporary),sources=[...implementation.sources,'bun.lock',...implementation.generated,fileURLToPath(import.meta.url),'specs/quint/refinement/services/inbox-list-paging-ports.mjs','specs/quint/refinement/services/support.mjs',...extraSources];
  const driverHashes=captureInputs(sources);implementation.rebuildInboxDriver(await implementation.inboxDriverSources());
  assert.equal(await implementation.pagingArtifact(),readFileSync(implementation.generated[1],'utf8'),'Exact executable source after capture');
  const traces=[],states=[],counts=[];
  async function setup(name){const f=await inboxPagingFixture(implementation),trace={name,expect:observe(f),steps:[]};
   const step=(description,transition)=>{assertPagingEffects(f);const expect=observe(f);states.push(expect);trace.steps.push({label:description,...(transition?{action:transition}:{}),expect});};
   return {f,trace,step,finish(){counts.push(f.requests.length);traces.push(trace);f.close();}};}
  for(const firstCursor of [1,2])for(const variant of ['repeat','changed','failed','single-flight','stale-folder','stale-account']){
   const {f,step,finish}=await setup(`${variant}, cursor ${firstCursor}`);
   try{
    const started=await f.load();assert.equal(started.accepted,true);const first=f.currentRequest();step('one first-page read',action('loadFirst'));
    if(variant==='stale-folder'||variant==='stale-account'){
     if(variant==='stale-folder')await f.folder();else await f.account();
     const pending=f.currentRequest();assert.ok(pending&&pending!==first);step('selection retires the old read and starts the new list',[action(variant==='stale-folder'?'changeFolder':'selectAccount'),action('loadFirst')]);
     await f.answer(first,{following:firstCursor});step('old owner result cannot publish',action('reply',1,firstCursor,false));
     await f.answer(pending);step('current owner result publishes once',[action('reply',3,0,false),action('remember')]);
    }else{
     if(variant==='single-flight'){
      const before=f.requests.length;assert.equal((await f.load()).accepted,false);assert.equal(f.requests.length,before);step('busy load refuses a second consumer request',{...action('loadFirst'),reject:true});
     }
     await f.answer(first,{following:firstCursor});step('actual first page is automatically remembered',[action('reply',1,firstCursor,false),action('remember')]);
     const prepared=f.currentRequest(`cursor-${firstCursor}`);assert.ok(prepared,'Actual read-ahead starts the next transport');
     const before=f.requests.length;assert.equal((await f.load(true)).accepted,true);assert.equal(f.requests.length,before,'Consumer joins actual prefetch');step('next cursor is consumed once',action('loadMore'));
     if(variant==='failed'){
      await f.answer(prepared,{failed:true});step('failure retains shown rows and retires cursor',action('pageFailed',2));
      const beforeRetry=f.requests.length;assert.equal((await f.load(true)).accepted,false);assert.equal(f.requests.length,beforeRetry);step('failed cursor is not offered again',{...action('loadMore'),reject:true});
      await f.load();const retry=f.currentRequest();step('explicit retry starts from first page',action('loadFirst'));
      await f.answer(retry,{following:3-firstCursor});step('retry replaces the previous list',[action('reply',3,3-firstCursor,false),action('remember')]);
     }else{
      const changed=variant==='changed',following=variant==='repeat'?firstCursor:0;
      await f.answer(prepared,{following,shifted:changed});step('provider result merges through the shared helper',[action('reply',2,following,changed),action('remember')]);
      if(variant==='repeat'){const total=f.requests.length;assert.equal((await f.load(true)).accepted,false);assert.equal(f.requests.length,total);step('repeated cursor ends paging',{...action('loadMore'),reject:true});}
     }
    }
   }finally{finish();}
  }
  for(const firstCursor of [1,2]){
   const {f,step,finish}=await setup(`fresh folder cache restore ${firstCursor}`);
   try{
    await f.load();const initial=f.currentRequest();step('first read',action('loadFirst'));
    await f.answer(initial,{following:firstCursor});step('settled list is retained',[action('reply',1,firstCursor,false),action('remember')]);
    await f.folder();const other=f.currentRequest();step('other folder starts independently',[action('changeFolder'),action('loadFirst')]);
    await f.folder();step('return restores the exact cached account and folder',[action('changeFolder'),action('restoreSaved')]);
    const prepared=f.currentRequest(`cursor-${firstCursor}`);assert.ok(prepared);
    await f.load(true);step('restored cursor may be consumed once',action('loadMore'));
    await f.answer(prepared,{shifted:true});step('changed provider revision is marked',[action('reply',5,0,true),action('remember')]);
    await f.answer(other);step('late other-folder result remains retired',action('reply',3,0,false));
   }finally{finish();}
  }
  // Negative oracle canaries act only on copied observations/port logs, never fake source traces.
  const {f,finish}=await setup('read-only invalidation and negative canaries');
  try{
   f.source.invalidateList(false);assert.equal(f.source.inspect().saved.length,0);traces.push({name:'explicit cache invalidation',expect:observe(f),steps:[{label:'actual cache invalidation',action:action('invalidate'),expect:observe(f)}]});
   await f.load();const request=f.currentRequest();f.requests.push({...request});assert.throws(()=>assertPagingEffects(f),/No duplicate live provider read/);f.requests.pop();
   const actual=observe(f),wrong=structuredClone(actual);wrong['s.account']=2;assert.throws(()=>assert.deepEqual(wrong,actual),assert.AssertionError);
  }finally{f.close();} // this canary campaign intentionally publishes no fabricated model trace
  const witness={SavedListShownWitness:state=>state['s.cachedShown']&&state['s.cursor']!==0,ChangedMailboxWitness:state=>state['s.newerMail']&&state['s.pages']===2,
   RepeatedCursorWitness:state=>state['s.pages']===2&&state['s.cursor']===0&&state['s.seenCursors'].values.length===1&&!state['s.failure']};
  for(const [name,holds] of Object.entries(witness))assert.ok(states.some(holds),`Actual source reached ${name}`);
  const receipt=await checkTraces({model:'InboxListPaging',sources,driverHashes,generatedSources:implementation.generated,traces,scope:'bounded-component',assumptions:[
   'The full actual Inbox adapter, work/abort/generation guards, shared merge/cursor/cache helpers and real read-ahead implementation execute through the existing functional fixture. A passive closure observer exposes values and actual functions without replacing product behavior.',
   'Paging starts after controlled account discovery. No component mount/HOME, body reads, drafts, mutations, OAuth, native transport or physical persistence is exercised. Each nonempty synthetic provider page contributes one distinct message, capped at three in the model projection.',
   'Fourteen actual fields are observed. Flights and the single saved-row record are not projected: real read-ahead may start transport before a consumer and the actual cache retains multiple folders. Independent full provider-request logs and zero mutation counts remain asserted.',
   'The cursor field means available consumer authority: actual loadingMore plus operation makes the retained private token unavailable. Seen/used cursors project only the current loadedQuery; a retired folder private allocation has no current-list authority. Used cursors derive from that actual seen set minus available token. Grouped transitions reflect source auto-loading on folder/account selection and automatic remembering after successful reads.',
  ]});
  return {receipt,coverage:{selectedNamedScenarios:['staleReplyDroppedTest','replyForOtherAccountDroppedTest','repeatedCursorEndsPagingTest','failedPageKeepsListTest','singleFlightTest','savedListRestoredTest'],providerRequests:counts.reduce((a,b)=>a+b,0),witnesses:Object.keys(witness),canaries:['duplicate-provider-read','wrong-owner-observation']},obligations:[{model:'InboxListPaging',obligation:'Unobserved consumer flights, cache capacity and mounted lifecycle',reason:'The real speculative transport, pending consumer-flight map and multi-folder cache exceed the model abstraction and are not claimed fully refined. Stale-flight witness with concurrently retained current rows, arbitrary provider payloads, mounted UI/HOME lifecycle, storage durability and live Gmail require separate coverage.'}]};
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

test('real Inbox list paging retains cursor and selection guards with actual prefetch',async()=>{
 const {receipt,coverage}=await checkInboxListPaging([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.traces,15);assert.equal(receipt.observedFields.length,14);
 assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);assert.equal(verifyRefinementReceiptInputs(receipt),true);
 assert.ok(coverage.providerRequests>20);assert.equal(coverage.witnesses.length,3);assert.equal(coverage.canaries.length,2);
 assert.equal(coverage.selectedNamedScenarios.length,6);
});
