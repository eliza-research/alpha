import test from 'node:test';import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const {ViewNavigationClient}=await loadBrowserModule('apps/app/src/runtime/view-navigation.ts');
const before={document:globalThis.document,window:globalThis.window};
globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.window=new EventTarget();
test.after(()=>{globalThis.document=before.document;globalThis.window=before.window;});
// Every exit after a successful claim must settle it exactly once, or the host keeps
// refusing the next navigation for this client until its preparation timeout.
function fixture({claim=()=>{},result=()=>{}}={}){
 let state={view:'home',revision:1,sensitive:false},session=true;const calls=[];
 const client=new ViewNavigationClient(async(path,body)=>{calls.push({path,body});if(path.endsWith('claim')){claim();return {claimId:'owned-claim'};}result(body);return {accepted:true};},()=>session,()=>state);
 const binding={requestId:'owned-handoff',clientId:client.clientId,viewId:'notes',viewType:'gui',installationId:'owned-installation'};
 const results=[{actionName:'VIEWS',success:true,values:{mode:'show',viewId:'notes',viewPath:'/notes',viewType:'gui',navigationPrepared:true,completedActionHandoffId:binding.requestId,navigationBinding:binding}}];
 return {client,calls,results,set state(next){state=next;},get state(){return state;},retire(){session=false;},
  replies:()=>calls.filter(call=>call.path.endsWith('interact-result')).map(call=>call.body)};
}
const switchTo=f=>async(view,current)=>{current();f.state={view,revision:2,sensitive:false};return true;};
const negativeOnce=f=>{const replies=f.replies();assert.equal(replies.length,1);assert.equal(replies[0].success,false);assert.deepEqual(replies[0].result,{switched:false});assert.equal(replies[0].claimId,'owned-claim');};

test('screen change after the claim settles one negative result',async()=>{
 const f=fixture({claim:()=>{f.state={view:'calendar',revision:2,sensitive:false};}});
 await assert.rejects(f.client.deliver(f.results,f.client.capture(f.state),switchTo(f)),/screen or connection changed/);negativeOnce(f);f.client.dispose();
});
test('failed fence after the claim settles one negative result',async()=>{
 const f=fixture();const attempt=f.client.capture(f.state);let checks=0;attempt.fence=()=>++checks===1;
 await assert.rejects(f.client.deliver(f.results,attempt,switchTo(f)),/screen changed/);negativeOnce(f);f.client.dispose();
});
test('an already handled handoff settles one negative result',async()=>{
 const f=fixture();assert.equal((await f.client.deliver(f.results,f.client.capture(f.state),switchTo(f))).status,'delivered');
 f.calls.length=0;f.state={view:'home',revision:3,sensitive:false};
 assert.equal((await f.client.deliver(f.results,f.client.capture(f.state),switchTo(f))).status,'none');negativeOnce(f);f.client.dispose();
});
test('an attempt cancelled during navigation settles one negative result',async()=>{
 const f=fixture();const attempt=f.client.capture(f.state);
 const result=await f.client.deliver(f.results,attempt,async view=>{f.state={view,revision:2,sensitive:false};attempt.controller.abort();return true;});
 assert.equal(result.status,'unknown');negativeOnce(f);f.client.dispose();
});
test('a positive result is never followed by another result, even when lost',async()=>{
 for(const lost of [false,true]){
  const f=fixture({result:()=>{if(lost)throw Error('reply lost');}});
  const delivery=f.client.deliver(f.results,f.client.capture(f.state),switchTo(f));
  if(lost)await assert.rejects(delivery,/reply lost/);else assert.equal((await delivery).status,'delivered');
  const replies=f.replies();assert.equal(replies.length,1);assert.equal(replies[0].success,true);f.client.dispose();
 }
});
test('a retired session posts nothing after the claim',async()=>{
 const f=fixture({claim:()=>f.retire()});
 await assert.rejects(f.client.deliver(f.results,f.client.capture(f.state),switchTo(f)));assert.equal(f.replies().length,0);f.client.dispose();
});
