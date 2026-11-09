import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {committedViewFixture as fixture} from './fixtures/committed-view-observation.mjs';

for(const mode of ['before','after','deadline','disposed'])test(`abandoned observation ${mode} settles actual host negative without history or later timeout`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),false);
  assert.equal([...f.timers.values()].filter(t=>t.ms===120000).length,0);
  const result=await f.settled;assert.equal(result.success,false);assert.equal(result.result.switched,false);
  assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-claim')).length,1);
  assert.equal(f.calls.filter(c=>c.path.endsWith('interact-result')).length,1);
  assert.notEqual(f.calls.at(-1).signal,f.calls[0].signal);
  assert.equal([...f.timers.values()].some(t=>t.ms===1500),false);
  assert.equal([...f.timers.values()].filter(t=>t.ms===120000).length,0);f.expire();
 }finally{f.close();}
});
for(const mode of ['unchanged'])test(`${mode} preserves underlying Calendar and records exactly one positive`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),true);await f.settled;await Promise.resolve();
  assert.equal(f.history,1);assert.equal(f.calls[0].path,'/api/views/calendar/navigate');
  assert.equal(await f.client.observeCommittedView(),true);assert.equal(f.calls.length,3);
 }finally{f.close();}
});
for(const mode of ['retired','retired-after-claim','lost-prepare','invalid-binding','empty-request','foreign-client','claim-lost','cleanup-denied','cleanup-retired'])test(`${mode} remains unknown; no cleanup under changed/unknown custody, genuine host timeout retained`,async()=>{
 const f=fixture(mode);try{
  assert.equal(await f.client.observeCommittedView(),false);assert.equal(f.calls.some(c=>c.path.endsWith('interact-result')),false);
  const rejected=assert.rejects(f.settled,error=>error.code==='PENDING_REQUEST_TIMEOUT');f.expire();await rejected;
  assert.equal(f.history,0);assert.ok(f.calls.filter(c=>c.path.endsWith('interact-claim')).length<=1);
 }finally{f.close();}
});
for(const mode of ['installation-retired','bad-nonce'])test(`${mode} rejects negative settlement and retains genuine timeout`,async()=>{
 const f=fixture(mode);try{assert.equal(await f.client.observeCommittedView(),false);const replies=f.calls.filter(c=>c.path.endsWith('interact-result'));assert.equal(replies.length,1);assert.equal(replies[0].body.success,false);const rejected=assert.rejects(f.settled,error=>error.code==='PENDING_REQUEST_TIMEOUT');f.expire();await rejected;assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-claim')).length,1);}finally{f.close();}
});
test('superseding an observation while its claim is pending settles the claim; the next navigation is not refused',async()=>{
 const f=fixture('superseded-claim');try{
  assert.equal(await f.client.observeCommittedView(),false);
  const first=await f.settled;assert.equal(first.success,false);assert.equal(f.history,0);
  f.context.document.hidden=false;
  assert.equal(await f.client.observeCommittedView(),true);assert.equal(f.calls.at(-3).path,'/api/views/settings/navigate');
  await f.settled;assert.equal(f.history,1);
 }finally{f.close();}
});
test('lost positive acknowledgment never sends a contradictory negative or retry',async()=>{
 const f=fixture('positive-lost');try{assert.equal(await f.client.observeCommittedView(),false);assert.equal((await f.settled).success,true);assert.equal(f.calls.length,3);assert.equal(f.history,1);}finally{f.close();}
});

test('lost negative acknowledgment is settled once and never replayed',async()=>{
 const f=fixture('negative-lost');try{assert.equal(await f.client.observeCommittedView(),false);assert.equal(f.calls.length,3);assert.equal((await f.settled).success,false);assert.equal(f.history,0);assert.equal(f.calls.filter(c=>c.path.endsWith('interact-result')).length,1);}finally{f.close();}
});

for(const view of ['calendar','settings'])for(const chat of ['sheet','full'])test(`actual adapter ${chat} overlay retains underlying ${view}`,async()=>{
 const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 const start=adapter.indexOf('  function context(shell: Shell) {');
 const helper=stripTypeScriptTypes(adapter.slice(start,adapter.indexOf('  p.componentDidMount',start)),{mode:'strip'});
 let observed;
 const alphaClient={setViewContext(value){observed=value;},getState(){return {context:observed};}};
 new Function('document','alphaClient','connectionController','currentClockTimeZone','passwordSurfaceOpen','updateBackAvailability','recoverPendingActions','syncPreviousNotesAvailability','shell',helper+';context(shell);')(
  {hidden:false,documentElement:{dataset:{}}},alphaClient,{getSnapshot:()=>({open:false})},()=> 'UTC',()=>false,()=>{},()=>{},shell=>assert.notEqual(shell.S().view,'notes'),
  {S:()=>({view,chat}),vget:()=>({}),calendarSelection:()=>undefined,clockSelection:()=>undefined});
 assert.equal(observed.view,view);assert.equal(observed.sensitive,false);
 const f=fixture('unchanged',observed);try{assert.equal(await f.client.observeCommittedView(),true);await f.settled;assert.equal(f.calls[0].path,`/api/views/${view}/navigate`);assert.equal(f.history,1);}finally{f.close();}
});
