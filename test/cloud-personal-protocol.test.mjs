import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
// The runtime source uses full TypeScript, so it loads through the Vite-aware fixture. Synthetic
// transport only: no Cloud, native credential store or provider is contacted.
const {CloudPersonalProtocol}=await loadBrowserModule('apps/app/src/runtime/cloud-personal-protocol.ts');

const target='72475cd0-e135-4c42-a9e2-fb5fe0820ada',personal='personal:72475cd0-e135-5c42-a9e2-fb5fe0820ada';
const owner={environment:'production',credentialId:'generation1',userId:target,organizationId:target};
const prices={hourlyRateUsd:.01,dailyRateUsd:.24,minimumActivationChargeUsd:.01,minimumBalanceUsd:1,minimumRunwayDays:3,balanceUsd:9,deficitUsd:0};
const ok=data=>({status:200,data:{success:true,data}});
const signal=new AbortController().signal;
function fixture(activationStatus,agentStatus){
 const posts=[];
 const protocol=new CloudPersonalProtocol(owner,async(path,_signal,body)=>{
  if(body!==undefined){posts.push(path);throw Error('No activation in this fixture');}
  if(path==='/api/v1/eliza/personal')return ok({identity:{id:personal,displayName:'Eliza',runtime:'shared'}});
  if(path.endsWith('/upgrade-tier'))return ok({quoteId:'a'.repeat(64),sourceAgentId:personal,requiresConfirmation:true,action:'activate_dedicated',canActivate:true,...prices,activation:{state:'in_progress',dedicatedAgentId:target,status:activationStatus}});
  throw Error('Unexpected path '+path);
 },async()=>agentStatus);
 return {protocol,posts};
}

test('a disconnected Dedicated target Cloud is reconnecting reads as provisioning, not an invalid response',async()=>{
 const {protocol,posts}=fixture('disconnected','disconnected');
 const view=await protocol.inspect(signal);
 assert.equal(view.kind,'pending');assert.equal(view.phase,'provisioning');assert.equal(view.receipt.dedicatedAgentId,target);
 const polled=await protocol.poll(view.receipt,signal);
 assert.equal(polled.kind,'pending');assert.equal(polled.phase,'provisioning');
 assert.equal(posts.length,0,'reading the target never starts or adopts compute');
});

test('a running target polled while Cloud reports it disconnected stays in provisioning',async()=>{
 const {protocol}=fixture('running','disconnected');
 const view=await protocol.inspect(signal);assert.equal(view.phase,'cutover');
 const polled=await protocol.poll(view.receipt,signal);
 assert.equal(polled.kind,'pending');assert.equal(polled.phase,'provisioning');
});

test('an unknown target status is still refused',async()=>{
 await assert.rejects(fixture('migrating','running').protocol.inspect(signal),error=>error.code==='invalid-response');
 const {protocol}=fixture('provisioning','migrating');const view=await protocol.inspect(signal);
 await assert.rejects(protocol.poll(view.receipt,signal),error=>error.code==='invalid-response');
});
