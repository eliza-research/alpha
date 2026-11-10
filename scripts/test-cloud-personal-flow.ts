// Actual CloudProtocol/native-transport boundary over loopback HTTP only.
import {startLoopback, stopLoopback} from './fixtures/loopback.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PersonalProtocolError, type PersonalView} from '../apps/app/src/runtime/cloud-personal-protocol.ts';
import {DevelopmentCloudAgentProtocol} from '../apps/app/src/runtime/development-cloud-agents.ts';
const target='72475cd0-e135-4c42-a9e2-fb5fe0820ada', personal='personal:72475cd0-e135-5c42-a9e2-fb5fe0820ada', job='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
const posts: {path: string; body: unknown}[] = [];
let mode='new',ready=false,credential={credentialId:'generation1',token:'synthetic-only'},quoteId='a'.repeat(64),cutovers=0;
const prices={hourlyRateUsd:.01,dailyRateUsd:.24,minimumActivationChargeUsd:.01,minimumBalanceUsd:1,minimumRunwayDays:3,balanceUsd:9,deficitUsd:0};
const quote=()=>({quoteId,sourceAgentId:personal,requiresConfirmation:true,action:'activate_dedicated',canActivate:true,...prices,activation:mode==='inflight'||mode==='stopped'||mode==='bound-stopped'||mode==='fallback-stopped'?{state:'in_progress',dedicatedAgentId:target,status:mode==='inflight'?'provisioning':'stopped'}:{state:'available'}});
const adoption=()=>({quoteId,dedicatedAgentId:target,requiresConfirmation:true,action:'adopt_existing_dedicated',canAdopt:true,...prices,adoptionState:'available',status:'stopped',startsCompute:true,stateDisposition:'verified_backup_present',requiresCatalogRestore:false});
const server=http.createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer synthetic-only');let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):undefined;let status=200,d;const path=decodeURIComponent(req.url ?? '');if(req.method==='POST')posts.push({path,body});
if(path==='/api/v1/user')d={id:target,organization_id:job};
else if(path==='/api/v1/eliza/personal'){if(mode==='outage'){res.writeHead(503);res.end('{}');return;}d={identity:{id:personal,displayName:'Eliza',runtime:ready?'dedicated':'shared',...(ready?{activeAgentId:target,apiBase:`https://${target}.cloud.eliza.app`}:{})}};}
else if(path===`/api/v1/eliza/agents/${target}`)d={id:target,agentName:'Eliza',executionTier:'dedicated-lazy',status:mode==='bound-stopped'||mode==='fallback-stopped'?'stopped':mode==='inflight'?'provisioning':'running',webUiUrl:mode==='foreign'?'https://evil.invalid':`https://${target}.cloud.eliza.app`};
else if(path.endsWith('/adopt-existing')){if(req.method==='GET'){if(mode==='fallback-stopped'){res.writeHead(404);res.end(JSON.stringify({success:false,code:'dedicated_adoption_unavailable'}));return;}d=adoption();}else {status=202;d={dedicatedAgentId:target,jobId:job,runtime:'dedicated_pending_cutover'};}}
else if(path.endsWith('/cutover')){cutovers++;if(mode==='lost-cutover'){req.socket.destroy();return;}ready=true;d={personalElizaId:personal,activeAgentId:target,runtime:'dedicated',apiBase:`https://${target}.cloud.eliza.app`,importedMessages:0};}
else if(path.endsWith('/upgrade-tier')){if(req.method==='GET')d=quote();else{assert.deepEqual(body,{action:'activate_dedicated',quoteId,minimumActivationChargeUsd:.01});if(mode==='lost'){req.socket.destroy();return;}if(mode==='timeout'){res.writeHead(408);res.end('{}');return;}if(mode==='changed'||mode==='selection'){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({success:false,code:mode==='changed'?'dedicated_quote_changed':'dedicated_adoption_selection_required'}));quoteId='b'.repeat(64);return;}status=202;d={dedicatedAgentId:target,jobId:job};}}
else if(path===`/api/v1/jobs/${job}`)d={id:job,status:mode==='failed-job'?'failed':'completed'};else throw Error('Unexpected path');res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({success:true,data:d}));}catch(error){res.writeHead(500);res.end('{}');throw error;}});
const base = await startLoopback(server);
const signal=new AbortController().signal;
const make=()=>new DevelopmentCloudAgentProtocol('production',async input=>{const u=new URL(input.url);assert.equal(u.origin,'https://api.eliza.app');const r=await fetch(base+u.pathname+u.search,{method:input.method,headers:input.headers,body:input.body===undefined?undefined:JSON.stringify(input.body),signal:input.signal,redirect:input.redirect});return {status:r.status,data:await r.json()};},{read:async()=>credential,write:async()=>{throw Error('No login writes');},clear:async()=>{}},async()=>{throw Error('No browser');});
let passed=0;const reset=(m: string)=>{mode=m;ready=false;posts.length=0;quoteId='a'.repeat(64);cutovers=0;credential={credentialId:'generation1',token:'synthetic-only'};};
function expectView<K extends PersonalView['kind']>(view: PersonalView, kind: K): Extract<PersonalView, {kind: K}> {
  assert.equal(view.kind, kind);
  return view as Extract<PersonalView, {kind: K}>;
}
const rejectsWith = (code: PersonalProtocolError['code']) => (error: unknown) => error instanceof PersonalProtocolError && error.code === code;
try{
reset('new');let c=await make().personal(signal),v=await c.inspect(signal);const review=expectView(v,'review').review;assert.equal(posts.length,0);v=await c.accept(review,signal);assert.equal(expectView(v,'pending').phase,'provisioning');await assert.rejects(c.accept(review,signal),rejectsWith('review-consumed'));v=await c.poll(expectView(v,'pending').receipt,signal);assert.equal(expectView(v,'pending').phase,'cutover');v=await c.finalize(expectView(v,'pending').receipt,signal);assert.equal(v.kind,'ready');assert.equal(posts.length,2);passed++;
reset('new');ready=true;c=await make().personal(signal);assert.equal((await c.inspect(signal)).kind,'ready');assert.equal(posts.length,0);passed++;
reset('outage');c=await make().personal(signal);await assert.rejects(c.inspect(signal));assert.equal(posts.length,0);passed++;
reset('inflight');c=await make().personal(signal);v=await c.inspect(signal);assert.equal(v.kind,'pending');assert.equal(posts.length,0);passed++;
reset('stopped');c=await make().personal(signal);v=await c.inspect(signal);assert.equal(expectView(v,'review').review.action,'adopt_existing_dedicated');v=await c.accept(expectView(v,'review').review,signal);assert.equal(posts.length,1);assert.match(posts[0].path,/adopt-existing$/);passed++;
reset('changed');c=await make().personal(signal);v=await c.accept(expectView(await c.inspect(signal),'review').review,signal);assert.equal(expectView(v,'review').review.quoteId,'b'.repeat(64));assert.equal(posts.length,1);passed++;
reset('selection');c=await make().personal(signal);v=await c.accept(expectView(await c.inspect(signal),'review').review,signal);assert.equal(expectView(v,'review').review.action,'adopt_existing_dedicated');assert.equal(posts.length,1);passed++;
reset('lost');c=await make().personal(signal);v=await c.inspect(signal);await assert.rejects(c.accept(expectView(v,'review').review,signal),rejectsWith('outcome-unknown'));await assert.rejects(c.accept(expectView(v,'review').review,signal));assert.equal(posts.length,1);mode='inflight';assert.equal((await c.inspect(signal)).kind,'pending');assert.equal(posts.length,1);passed++;
reset('new');c=await make().personal(signal);v=await c.inspect(signal);credential={...credential,credentialId:'generation2'};await assert.rejects(c.accept(expectView(v,'review').review,signal));assert.equal(posts.length,0);passed++;
reset('foreign');ready=true;c=await make().personal(signal);await assert.rejects(c.inspect(signal));assert.equal(posts.length,0);passed++;
reset('failed-job');c=await make().personal(signal);v=await c.accept(expectView(await c.inspect(signal),'review').review,signal);await assert.rejects(c.poll(expectView(v,'pending').receipt,signal),rejectsWith('job-failed'));assert.equal(cutovers,0);passed++;
reset('lost-cutover');c=await make().personal(signal);v=await c.accept(expectView(await c.inspect(signal),'review').review,signal);await assert.rejects(c.finalize(expectView(v,'pending').receipt,signal),rejectsWith('outcome-unknown'));await assert.rejects(c.finalize(expectView(v,'pending').receipt,signal));assert.equal(cutovers,1);passed++;
reset('bound-stopped');ready=true;c=await make().personal(signal);v=await c.inspect(signal);assert.equal(expectView(v,'review').review.dedicatedAgentId,target);assert.equal(posts.length,0);passed++;
reset('inflight');c=await make().personal(signal);v=await c.inspect(signal);v=await c.poll(expectView(v,'pending').receipt,signal);assert.equal(expectView(v,'pending').phase,'provisioning');assert.equal(posts.length,0);passed++;
reset('new');c=await make().personal(signal);v=await c.inspect(signal);await assert.rejects(c.accept({...expectView(v,'review').review},signal),rejectsWith('review-consumed'));assert.equal(posts.length,0);const aborted=new AbortController();aborted.abort();await assert.rejects(c.accept(expectView(v,'review').review,aborted.signal));assert.equal(posts.length,0);passed++;
reset('timeout');c=await make().personal(signal);v=await c.inspect(signal);await assert.rejects(c.accept(expectView(v,'review').review,signal),rejectsWith('outcome-unknown'));assert.equal(posts.length,1);passed++;
reset('fallback-stopped');ready=true;c=await make().personal(signal);v=await c.inspect(signal);assert.equal(expectView(v,'review').review.action,'activate_dedicated');assert.equal(expectView(v,'review').review.status,'stopped');assert.equal(expectView(v,'review').review.dedicatedAgentId,target);assert.equal(posts.length,0);passed++;
console.log(JSON.stringify({status:'PASS',scenarios:passed,scope:'synthetic loopback actual CloudProtocol; no live/native/provider acceptance'}));
}finally{server.closeAllConnections();await stopLoopback(server);}
