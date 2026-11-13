/** Connection controller, native connection, local agent and Cloud read authorization step
 * contracts. Real source is sliced or bundled and run with injected infrastructure: no renderer,
 * network, credential store or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';

// ---- Plan window ----

// ---- Connection controller ----

// ---- Native connection ----

// ---- Local agent ----

const agent=await loadBrowserModule('apps/app/src/runtime/local-agent.ts');
test('Stop reads the conversation list once per conversation, and a refusal names its source',async()=>{
 const room='5f0c8a52-6d8e-4c4a-9a51-0b6e6f0d1a22',paths=[];let status=200;
 const local=new agent.LocalAgentProtocol({start:async()=>({}),request:async input=>{paths.push(input.path);
  if(input.path==='/api/conversations')return {status,body:JSON.stringify({conversations:[{id:'thread',title:'T',roomId:room}]})};
  return {status:200,body:JSON.stringify({aborted:true})};}});
 const session={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://device.alpha.invalid'};local.session=session;
 for(let i=0;i<3;i++)assert.equal(await local.abortTurn('thread'),'aborted');
 assert.equal(paths.filter(path=>path==='/api/conversations').length,1);assert.equal(paths.filter(path=>path===`/api/turns/${room}/abort`).length,3);
 // A new connection reads its own list.
 await local.disconnect();local.session=session;assert.equal(await local.abortTurn('thread'),'aborted');
 assert.equal(paths.filter(path=>path==='/api/conversations').length,2);
 status=401;const refusal=await local.request('/api/conversations',undefined,new AbortController().signal).catch(error=>error);
 assert.equal(refusal.status,401);assert.equal(refusal.source,'local-agent');assert.equal(agent.localAgentRefusal(refusal),true);
 assert.equal(agent.localAgentRefusal({status:401}),false);
});
test('waiting for shutdown tolerates a failed status read and polls with backoff',async()=>{
 const stopped={state:'stopped',serviceActive:false,socketListening:false};
 const run=async answers=>{let now=0,reads=0;const sleeps=[];
  const result=await agent.awaitLocalAgentStopped(async()=>{const answer=answers[Math.min(reads++,answers.length-1)];if(answer instanceof Error)throw answer;return answer;},{now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}}).then(()=>'stopped',error=>error.message);
  return {result,reads,sleeps};};
 const recovered=await run([Error('bridge busy'),{state:'stopping',serviceActive:true,socketListening:true},stopped]);
 assert.equal(recovered.result,'stopped');assert.deepEqual(recovered.sleeps,[200,400]);
 const stuck=await run([{state:'stopping',serviceActive:true,socketListening:true}]);
 assert.match(stuck.result,/Not confirmed/);
 assert.ok(stuck.reads<=40,`a 30 s wait costs ${stuck.reads} status reads`);assert.equal(Math.max(...stuck.sleeps),1000);
 const failing=await run([Error('bridge gone')]);assert.match(failing.result,/Not confirmed/);
});

// ---- Cloud read authorization ----
