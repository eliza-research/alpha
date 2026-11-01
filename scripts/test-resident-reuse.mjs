/** Renderer contract for attaching to an admitted running resident. Synthetic bridge; not device evidence. */
import assert from 'node:assert/strict';
import {loadBrowserModule} from '../test/fixtures/browser-source.mjs';
const {LocalAgentProtocol,residentAttachable,bindResidentCloudProvider}=await loadBrowserModule('apps/app/src/runtime/local-agent.ts');

const credential='11111111-1111-4111-8111-111111111111';
// The native answer is trusted only as an exact boolean, only on the native platform.
const calls=[];
const bridge=answer=>({residentAttachment:async input=>{calls.push(input);if(answer instanceof Error)throw answer;return answer;}});
assert.equal(await residentAttachable(credential,bridge({attachable:true}),true),true);
assert.deepEqual(calls,[{credentialId:credential}]);
for(const answer of [{attachable:false,reason:'provider-changed'},{attachable:'true'},{attachable:1},{},null,undefined,Error('bridge closed')])
 assert.equal(await residentAttachable(credential,bridge(answer),true),false,JSON.stringify(answer));
assert.equal(await residentAttachable(credential,bridge({attachable:true}),false),false,'browser never attaches natively');
assert.equal(await residentAttachable('',bridge({attachable:true}),true),false);
assert.equal(await residentAttachable(credential,{},true),false,'older native bridge without the query');

// Attachable: the provider is not rebound, so the running agent is never stopped.
const order=[];
assert.equal(await bindResidentCloudProvider(credential,{attachable:async id=>{order.push(['attachable',id]);return true;},configure:async id=>{order.push(['configure',id]);}}),undefined);
assert.deepEqual(order,[['attachable',credential]]);
// Not attachable: the ordinary stop → bind path runs once, after the query.
order.length=0;
assert.equal(await bindResidentCloudProvider(credential,{attachable:async id=>{order.push(['attachable',id]);return false;},configure:async id=>{order.push(['configure',id]);}}),undefined);
assert.deepEqual(order,[['attachable',credential],['configure',credential]]);
const bindingGuard='a'.repeat(64);
assert.equal(await bindResidentCloudProvider(credential,{attachable:async()=>false,configure:async()=>bindingGuard}),bindingGuard,'new binding guard is forwarded unchanged');
// A failed bind is reported, never swallowed into an attach.
await assert.rejects(bindResidentCloudProvider(credential,{attachable:async()=>false,configure:async()=>{throw Error('Cloud account changed');}}),/Cloud account changed/);

// connect(): the same owner/agent identity whether native started or attached; attach never
// triggers cancelStart on success and reports `attached` so callers can tell the two apart.
function host(startResult){
 const log=[];
 return {log,bridge:{
  async start(input){log.push(['start',typeof input?.requestId]);return startResult;},
  async cancelStart(input){log.push(['cancelStart',input.requestId]);},
  async request(input){
   log.push(['request',input.path]);
   if(input.path==='/api/auth/me')return {status:200,body:JSON.stringify({identity:{id:'owner',kind:'owner'},access:{role:'OWNER',mode:'session'},session:{id:'native-owned-session'}})};
   if(input.path==='/api/agents')return {status:200,body:JSON.stringify({agents:[{id:'agent',name:'Resident',status:'running'}]})};
   return {status:404,body:'{}'};
  },
 }};
}
const home=host({state:'ready'}),homeClient=new LocalAgentProtocol(home.bridge);
const started=await homeClient.connect(new AbortController().signal);
assert.equal(started.attached,false);
const identities=[];
// Repeated assistant invocations: each is a new surface with its own protocol instance.
for(let invocation=0;invocation<3;invocation++){
 const assistant=host({state:'ready',attached:true}),client=new LocalAgentProtocol(assistant.bridge);
 const result=await client.connect(new AbortController().signal);
 assert.equal(result.attached,true);
 assert.deepEqual(assistant.log.map(row=>row[0]),['start','request','request'],'attach makes one start call and no cancellation');
 identities.push([result.session.ownerId,result.session.agentId,result.session.origin]);
 // Closing the assistant retires only its own protocol state.
 await client.disconnect();
 assert.equal(client.session,null);
 assert.ok(homeClient.session,'Home keeps its session while the assistant opens and closes');
}
// The conversation selection is keyed by owner/agent/origin, so the same identity restores the same thread.
assert.deepEqual(new Set(identities.map(row=>JSON.stringify(row))).size,1);
assert.deepEqual(identities[0],[started.session.ownerId,started.session.agentId,started.session.origin]);
// Only an exact `attached:true` counts.
for(const value of [{state:'ready',attached:'true'},{state:'ready',attached:1},null,undefined,'ready'])
 assert.equal((await new LocalAgentProtocol(host(value).bridge).connect(new AbortController().signal)).attached,false);
// A failure after an attached start still sends its cancellation; native treats it as a no-op.
const failing=host({state:'ready',attached:true});failing.bridge.request=async()=>({status:500,body:'{}'});
await assert.rejects(new LocalAgentProtocol(failing.bridge).connect(new AbortController().signal));
assert.equal(failing.log.filter(row=>row[0]==='cancelStart').length,1);
// ...and this surface stops asking to attach: its retry takes the ordinary stop → bind → start
// path, so a listening runtime that cannot serve an owner session is still restarted by a retry.
const willing=id=>residentAttachable(id,bridge({attachable:true}),true);
assert.equal(await willing(credential),false,'an attach that failed owner verification is not trusted again');
order.length=0;
assert.equal(await bindResidentCloudProvider(credential,{attachable:willing,configure:async id=>{order.push(['configure',id]);}}),undefined);
assert.deepEqual(order,[['configure',credential]]);
// The next verified connection (here the restarted runtime) restores attach.
await new LocalAgentProtocol(host({state:'ready'}).bridge).connect(new AbortController().signal);
assert.equal(await willing(credential),true);
// A cancelled or superseded attach says nothing about the runtime and keeps attach available.
const aborting=host({state:'ready',attached:true}),abort=new AbortController();
aborting.bridge.request=async()=>{abort.abort();return {status:500,body:'{}'};};
await assert.rejects(new LocalAgentProtocol(aborting.bridge).connect(abort.signal));
assert.equal(await willing(credential),true,'cancelling an attach does not force a restart');
const superseded=host({state:'ready',attached:true}),supersededClient=new LocalAgentProtocol(superseded.bridge);
superseded.bridge.request=async()=>{await supersededClient.disconnect();return {status:500,body:'{}'};};
await assert.rejects(supersededClient.connect(new AbortController().signal),/connection changed/);
assert.equal(await willing(credential),true,'a superseded attach does not force a restart');
// Another surface changing the runtime lifecycle mid-attach is not evidence against the runtime:
// native answers the next attach query from the new state, so this surface is not forced to stop it.
const displaced=host({state:'ready',attached:true});displaced.bridge.request=async()=>{throw Object.assign(Error('Local agent connection changed.'),{code:'LOCAL_AGENT_EPOCH_CHANGED'});};
await assert.rejects(new LocalAgentProtocol(displaced.bridge).connect(new AbortController().signal),/connection changed/);
assert.equal(await willing(credential),true,'a lifecycle change by another surface does not force a restart');
// ...while any other rejected owner request after an attach still does.
const refused=host({state:'ready',attached:true});refused.bridge.request=async()=>{throw Object.assign(Error('Local agent request failed. No automatic retry was made.'),{code:'UNKNOWN'});};
await assert.rejects(new LocalAgentProtocol(refused.bridge).connect(new AbortController().signal));
assert.equal(await willing(credential),false);
await new LocalAgentProtocol(host({state:'ready'}).bridge).connect(new AbortController().signal);
assert.equal(await willing(credential),true);
// A failed ordinary start is not an attach failure.
const cold=host({state:'ready'});cold.bridge.request=async()=>({status:500,body:'{}'});
await assert.rejects(new LocalAgentProtocol(cold.bridge).connect(new AbortController().signal));
assert.equal(await willing(credential),true);
console.log('PASS resident reuse: attach query, provider binding order and repeated assistant connects');
