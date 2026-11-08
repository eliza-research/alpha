import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const source=readFileSync(new URL('../apps/app/src/runtime/local-agent-native-events.ts',import.meta.url),'utf8');
const {subscribeNativeVoiceEvents}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({delayListener=false,delaySubscribe=false}={}){
 let callback,resolveListener,resolveSubscribe;const calls=[],seen=[];let removed=0;
 const port={addListener:async(name,listener)=>{assert.equal(name,'alphaVoiceEvent');callback=listener;if(delayListener)await new Promise(resolve=>resolveListener=resolve);return {remove:async()=>{removed++;}};},subscribeVoiceEvents:async input=>{calls.push(['subscribe',input]);if(delaySubscribe)await new Promise(resolve=>resolveSubscribe=resolve);return {subscriptionId:input.subscriptionId};},unsubscribeVoiceEvents:async input=>{calls.push(['unsubscribe',input]);}};
 const stop=subscribeNativeVoiceEvents(port,'owner',value=>seen.push(value));
 return {stop,calls,seen,emit:value=>callback(value),id:()=>calls.find(row=>row[0]==='subscribe')[1].subscriptionId,removed:()=>removed,releaseListener:()=>resolveListener(),releaseSubscribe:()=>resolveSubscribe()};
}
test('native feed admits only matching subscription and voice envelopes; end is terminal',async()=>{
 const f=fixture();await tick();const id=f.id(),event={type:'agent_event',stream:'voice-transcript',payload:{text:'ephemeral'}};
 f.emit({subscriptionId:'foreign',type:'event',event});f.emit({subscriptionId:id,type:'event',event:{...event,stream:'other'}});f.emit({subscriptionId:id,type:'event',event});assert.deepEqual(f.seen,[event]);
 f.emit({subscriptionId:id,type:'end'});f.emit({subscriptionId:id,type:'event',event});await tick();assert.equal(f.seen.length,1);assert.equal(f.removed(),1);assert.equal(f.calls.filter(row=>row[0]==='unsubscribe').length,1);f.stop();assert.equal(f.removed(),1);
});
test('stop before listener registration never starts native feed and removes late listener',async()=>{
 const f=fixture({delayListener:true});f.stop();f.releaseListener();await tick();assert.equal(f.calls.length,0);assert.equal(f.removed(),1);
});
test('stop during native admission fences late events and cancels again after acknowledgement',async()=>{
 const f=fixture({delaySubscribe:true});await tick();const id=f.id();f.stop();f.emit({subscriptionId:id,type:'event',event:{type:'agent_event',stream:'voice-transcript'}});f.releaseSubscribe();await tick();assert.equal(f.seen.length,0);assert.equal(f.removed(),1);assert.equal(f.calls.filter(row=>row[0]==='unsubscribe').length,2);
});
test('native admission rejection cleans up the listener without retry',async()=>{
 let removed=0,subscribed=0,cancelled=0;
 subscribeNativeVoiceEvents({addListener:async()=>({remove:async()=>{removed++;}}),subscribeVoiceEvents:async()=>{subscribed++;throw Error('unavailable');},unsubscribeVoiceEvents:async()=>{cancelled++;}},'owner',()=>assert.fail());
 await tick();assert.deepEqual({removed,subscribed,cancelled},{removed:1,subscribed:1,cancelled:1});
});
test('protocol session change and disconnect fence callbacks and detach feeds',async()=>{
 // Load real browser source with production flags in an isolated Node child.
 const {execFileSync}=await import('node:child_process');
 execFileSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {loadBrowserModule} from './test/fixtures/browser-source.mjs';
  const {LocalAgentProtocol}=await loadBrowserModule('apps/app/src/runtime/local-agent.ts');
  let callback,removed=0,seen=0;
  const client=new LocalAgentProtocol({start:async()=>{},request:async()=>({status:200}),subscribeVoiceEvents:(owner,listener)=>{assert.equal(owner,'owner');callback=listener;return ()=>removed++;}});
  client.session={ownerId:'owner',sessionId:'first'};
  const stop=client.subscribeVoiceEvents(()=>seen++);callback({});assert.equal(seen,1);
  client.session={ownerId:'owner',sessionId:'second'};callback({});assert.equal(seen,1);
  await client.disconnect();callback({});assert.equal(seen,1);assert.equal(removed,1);stop();assert.equal(removed,1);
 `],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
});
