import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';




import {loadBrowserModule} from './fixtures/browser-source.mjs';
const {DevelopmentCloudAgentProtocol}=await loadBrowserModule('apps/app/src/runtime/development-cloud-agents.ts',{testMocks:true});
const {LocalAgentProtocol}=await loadBrowserModule('apps/app/src/runtime/local-agent.ts');
const {createLocalAgentDevHandler}=await loadBrowserModule('scripts/local-agent-dev-bridge.ts',{testMocks:true});
const owner='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333';
const invalid=[['PUT','/api/config'],['DELETE','/api/workflow/workflows/id'],['POST','/api/automations'],['GET','/api/triggers'],['GET','/api/lifeops/scheduled-tasks'],['GET','/api/lifeops/scheduled-tasks?ownerVisibleOnly=0'],['GET','/api/lifeops/scheduled-tasks?ownerVisibleOnly=1&ownerId=other'],['POST','/api/lifeops/scheduled-tasks/id/unknown'],['DELETE','/api/lifeops/definitions'],['DELETE','/api/lifeops/definitions/id/x'],['PATCH','/api/triggers/id'],['GET','https://other/api/automations'],['GET','/api/triggers/%2e%2e'],['GET','/api/triggers/id%2fruns'],['GET','/api/triggers/a..b'],['GET','/api/triggers/id?other=1'],['GET','/api/triggers/id#fragment'],['GET','/api/triggers/id\n'],['GET','/api/triggers/id\\runs'],['GET','/api/triggers/.id'],['GET','/api/triggers/'+ 'a'.repeat(201)]];
const signal=()=>new AbortController().signal;
function cloudFixture(){
 let credential={credentialId:'one',token:'synthetic-token'};const calls=[];let respond=async()=>({status:200,data:{ok:true}});
 const target={agentId:agent,origin:`https://${agent}.cloud.eliza.app`,userId:owner,organizationId:org,credentialId:'one',headers:{'X-Eliza-Device-Id':'device'}};
 const client=new DevelopmentCloudAgentProtocol('production',async req=>{
  calls.push(req);if(req.url.endsWith('/api/v1/user'))return {status:200,data:{success:true,data:{id:owner,organization_id:org}}};
  if(req.url.endsWith('/api/v1/eliza/agents/'+agent))return {status:200,data:{success:true,data:{id:agent,agentName:'Synthetic',status:'running',executionTier:'dedicated-always',webUiUrl:target.origin}}};
  return respond(req);
 },{read:async()=>credential,write:async()=>{},clear:async()=>{}},async()=>{});
 return {client,target,calls,replace:()=>{credential={credentialId:'two',token:'replacement'};},respond:fn=>{respond=fn;}};
}
test('Cloud automation PUT/DELETE retain verified owner runtime and billing credential',async()=>{
 const f=cloudFixture();for(const [method,path,body]of [['PUT','/api/triggers/prompt-1',{enabled:false}],['DELETE','/api/triggers/prompt-1',undefined]]){
  await f.client.phoneRequest(f.target,path,signal(),body,method);const sent=f.calls.at(-1);assert.equal(sent.url,f.target.origin+path);assert.equal(sent.method,method);assert.deepEqual(sent.body,body);assert.equal(sent.headers.Authorization,'Bearer synthetic-token');assert.equal(sent.headers['X-Eliza-Phone-Protocol'],'1');assert.equal(sent.headers['X-Eliza-Device-Id'],'device');
 }
 for(const [method,path]of invalid)await assert.rejects(f.client.phoneRequest(f.target,path,signal(),undefined,method));
 assert.equal(f.calls.filter(c=>c.url.startsWith(f.target.origin)).length,2);
});
test('Cloud changed account, wrong owner/runtime and aborted response never become accepted automation results',async()=>{
 const replaced=cloudFixture();replaced.respond(async()=>{replaced.replace();return {status:200,data:{ok:true}}});await assert.rejects(replaced.client.phoneRequest(replaced.target,'/api/automations',signal()),/account changed/);
 const before=cloudFixture();before.replace();await assert.rejects(before.client.phoneRequest(before.target,'/api/triggers/id',signal()),/account changed/);assert.equal(before.calls.length,0);
 for(const target of [{userId:org},{origin:'https://other.example'}]){const f=cloudFixture();await assert.rejects(f.client.phoneRequest({...f.target,...target},'/api/triggers/id',signal()));assert.equal(f.calls.filter(c=>c.url.startsWith(f.target.origin)).length,0);}
 const f=cloudFixture(),controller=new AbortController();f.respond(async()=>{controller.abort();return {status:200,data:{ok:true}}});await assert.rejects(f.client.phoneRequest(f.target,'/api/automations',controller.signal),e=>e.name==='AbortError');
});
test('resident transport binds explicit mutation methods to its current owner and rejects stale replies',async()=>{
 const calls=[],held=Promise.withResolvers();const protocol=new LocalAgentProtocol({start:async()=>{},request:async input=>{calls.push(input);return held.promise;}});protocol.session={ownerId:owner,agentId:agent,sessionId:'session',origin:protocol.origin};
 const pending=protocol.request('/api/triggers/id',{enabled:false},signal(),{},'PUT');assert.equal(calls[0].method,'PUT');assert.equal(calls[0].ownerId,owner);await protocol.disconnect();held.resolve({status:200,body:'{}'});await assert.rejects(pending,/connection changed/);
 const count=calls.length;await assert.rejects(protocol.request('/api/triggers/id',undefined,signal(),{},'DELETE'));await assert.rejects(protocol.request('/api/config',{},signal(),{},'PUT'));assert.equal(calls.length,count);
});
test('DEV bridge forwards only canonical scoped mutations; wrong owners and encoded/query routes never dispatch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alpha-automation-bridge-')),tokenFile=join(dir,'token');await writeFile(tokenFile,'a'.repeat(64),{mode:0o600});const calls=[];
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,request:async(url,options={})=>{
  const path=new URL(url).pathname;let data;
  if(path==='/api/auth/status')data={instanceId:'instance'};else if(path==='/api/auth/pair-code')data={code:'synthetic'};else if(path==='/api/auth/pair')data={access:'owner',token:'synthetic-machine',identityId:owner,instanceId:'instance'};else if(path==='/api/auth/me')data={identity:{id:owner},access:{role:'OWNER'},session:{id:'synthetic-machine',expiresAt:Date.now()+60000}};else{calls.push({url,...options});data={ok:true};}
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 }});const server=createServer(handler);
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const send=async input=>fetch(origin,{method:'POST',headers:{Origin:origin,'X-Alpha-Local-Agent':'1','Content-Type':'application/json'},body:JSON.stringify(input)});
  for(const [method,path,body]of [['PUT','/api/lifeops/definitions/reminder-1','{"title":"Synthetic"}'],['DELETE','/api/triggers/id',undefined]]){const response=await send({path,method,ownerId:owner,headers:{},...(body===undefined?{}:{body})});assert.equal(response.status,200);assert.equal((await response.json()).status,200);}
  for(const [method,path]of invalid){const response=await send({path,method,ownerId:owner,headers:{}});assert.equal(response.status,400,`${method} ${path}`);}
  assert.equal((await send({path:'/api/triggers/id',method:'DELETE',ownerId:org,headers:{}})).status,409);
  assert.equal((await send({path:'/api/triggers/id',method:'DELETE',headers:{}})).status,400);
  assert.equal(calls.length,2);assert.equal(calls[0].method,'PUT');assert.equal(calls[1].method,'DELETE');assert.equal(calls[0].headers.Authorization,'Bearer synthetic-machine');
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
