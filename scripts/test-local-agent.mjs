import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {loadBrowserModule} from '../test/fixtures/browser-source.mjs';
const [{createLocalAgentDevHandler,localAgentPathAllowed},{localAgentStorage},{LocalAgentProtocol}]=await loadBrowserModule(['scripts/local-agent-dev-bridge.ts', 'scripts/local-agent-dev-storage.ts', 'apps/app/src/runtime/local-agent.ts'],{testMocks:true});
const directory=mkdtempSync(join(tmpdir(),'alpha-local-contract-'));
const root='a'.repeat(64),token='synthetic-machine-secret';
const tokenFile=join(directory,'token');writeFileSync(tokenFile,root,{mode:0o600});
let pairs=0,sends=0,truncates=0,approvalReads=0,trajectoryReads=0,mode='ok';
const metadataPath='/api/trajectories/11111111-1111-4111-8111-111111111111?includePayloads=0';
const metadataDetail={trajectory:{id:'11111111-1111-4111-8111-111111111111',llmCallCount:2},llmCalls:[{id:'call-a',trajectoryId:'11111111-1111-4111-8111-111111111111',purpose:'action-extraction',promptTokens:12,completionTokens:4},{id:'call-b',trajectoryId:'11111111-1111-4111-8111-111111111111',purpose:'response',promptTokens:20,completionTokens:8}]};
const trajectoryPaths=[];
const host=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const auth=req.headers.authorization;
 const url=req.url;
 let value;
 if(url==='/api/auth/status'||url==='/api/auth/pair-code'||url==='/api/auth/pair'){
  assert.equal(auth,`Bearer ${root}`);
  if(url.endsWith('/status'))value={instanceId:'instance'};
  else if(url.endsWith('/pair-code'))value={code:'SYNTHETIC'};
  else {pairs++;assert.equal(JSON.parse(raw).code,'SYNTHETIC');value={token,instanceId:'instance',identityId:'owner',access:'owner'};}
 } else {
  assert.equal(auth,`Bearer ${token}`);
  if(url==='/api/auth/me')value={identity:{id:'owner',kind:'owner'},access:{role:'OWNER',mode:'session'},session:{id:token,expiresAt:Date.now()+60000}};
  else if(url==='/api/approvals?state=all&limit=500'){approvalReads++;assert.equal(req.method,'GET');value={approvals:[]};}
  else if(url.startsWith('/api/trajectories')){trajectoryReads++;trajectoryPaths.push(url);assert.equal(req.method,'GET');value=url===metadataPath?metadataDetail:{trajectories:[]};}
  else if(url==='/api/agents')value={agents:[{id:'agent',name:'Fixture',status:'running'}]};
  else if(url==='/api/conversations'&&req.method==='POST')value={conversation:{id:'thread',title:'Contract'}};
  else if(url==='/api/conversations')value={conversations:[{id:'thread',title:'Contract'}]};
  else if(url==='/api/conversations/thread/messages/truncate'){truncates++;assert.equal(req.method,'POST');assert.deepEqual(JSON.parse(raw),{messageId:'11111111-1111-4111-8111-111111111111',inclusive:true});value={ok:mode!=='unconfirmed',deletedCount:2};}
  else if(req.method==='POST'){sends++;assert.equal(req.headers['x-eliza-device-id'],'device');value={text:'Fixture reply',agentName:'Fixture'};}
  else value={messages:[{text:'Fixture reply'}]};
 }
 if(mode==='unauthorized'&&url.includes('/messages')){res.writeHead(401);res.end('{}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await listen(host);
const handler=createLocalAgentDevHandler({origin:`http://127.0.0.1:${host.address().port}`,tokenFile});
const proxy=http.createServer(handler);await listen(proxy);
const origin=`http://127.0.0.1:${proxy.address().port}`;
const invoke=(input,headers={})=>fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Alpha-Local-Agent':'1',...headers},body:JSON.stringify(input)});
try{
 for(const value of ['https://evil.test/api/agents','/api/auth/pair-code','/api/conversations/../auth/me','/api/conversations/%2e%2e','/api/status#bad','/api/agents?x=1'])assert.equal(localAgentPathAllowed(value),false,value);
 assert.equal(localAgentPathAllowed('/api/workflow/phone/catalog'),true);
 assert.equal(localAgentPathAllowed('/api/workflow/executions/test/approvals/node/0'),true);
 assert.throws(()=>createLocalAgentDevHandler({origin:'http://localhost:1234',tokenFile}));
 assert.equal((await invoke({path:'/api/agents',method:'GET'},{Origin:'https://evil.test'})).status,403);
 assert.equal(await new Promise(resolve=>{const req=http.request(origin,{method:'POST',headers:{Host:'evil.test',Origin:'http://evil.test','Content-Type':'application/json','X-Alpha-Local-Agent':'1'}},res=>{res.resume();resolve(res.statusCode);});req.end('{}');}),403);
 assert.equal((await invoke({path:'/api/auth/pair-code',method:'GET'})).status,400);
 const bridge={start:async()=>{},request:async(input,signal)=>{const response=await invoke(input);assert.equal(response.status,200);return response.json();}};
 const client=new LocalAgentProtocol(bridge),signal=new AbortController().signal;
 const identity=await client.connect(signal);assert.equal(identity.session.ownerId,'owner');
 assert.equal(pairs,1);
 assert.equal((await invoke({path:'/api/conversations/thread/messages',method:'POST',ownerId:'another-owner',body:'{}'})).status,409);
 assert.equal(sends,0,'Changed owner must not receive a dispatched message');
 const who=await bridge.request({path:'/api/auth/me',method:'GET'});assert.ok(!who.body.includes(token));
 assert.equal((await client.createConversation('Contract')).id,'thread');
 assert.equal((await client.listConversations()).length,1);
 const approvalPath='/api/approvals?state=all&limit=500';assert.equal(localAgentPathAllowed(approvalPath),true);
 assert.deepEqual(await client.request(approvalPath,undefined,signal),{approvals:[]});assert.equal(approvalReads,1);
 for(const input of [{path:approvalPath,method:'POST',ownerId:'owner',body:'{}'},{path:approvalPath,method:'GET'},{path:approvalPath,method:'GET',ownerId:'owner',body:'{}'},{path:'/api/approvals/execute',method:'POST',ownerId:'owner',body:'{}'},{path:'/api/approvals?state=all&limit=501',method:'GET',ownerId:'owner'}])assert.equal((await invoke(input)).status,400);
 assert.equal((await invoke({path:approvalPath,method:'GET',ownerId:'another-owner'})).status,409);assert.equal(approvalReads,1,'refused approval reads never reach the agent');
 const trajectoryPath='/api/trajectories?limit=10';
 assert.equal(localAgentPathAllowed(trajectoryPath),true);
 assert.equal(localAgentPathAllowed('/api/trajectories/11111111-1111-4111-8111-111111111111'),true);
 assert.equal(localAgentPathAllowed('/api/trajectories/step-1792180105633-ulsxnc'),true);
 assert.equal(localAgentPathAllowed('/api/trajectories?limit=10&search=11111111-1111-4111-8111-111111111111'),true);
 assert.equal(localAgentPathAllowed('/api/trajectories?limit=10&search=x&resolve=1'),false);
 const trace=await invoke({path:trajectoryPath,method:'GET',ownerId:'owner'});assert.equal(trace.status,200);assert.deepEqual(JSON.parse((await trace.json()).body),{trajectories:[]});
 for(const input of [{path:trajectoryPath,method:'POST',ownerId:'owner',body:'{}'},{path:trajectoryPath,method:'GET'},{path:'/api/trajectories?limit=11',method:'GET',ownerId:'owner'},{path:'/api/trajectories/config',method:'GET',ownerId:'owner'},{path:'/api/trajectories/export',method:'POST',ownerId:'owner',body:'{}'}])assert.equal((await invoke(input)).status,400);
 assert.equal((await invoke({path:trajectoryPath,method:'GET',ownerId:'another-owner'})).status,409);assert.equal(trajectoryReads,1,'refused diagnostic reads never reach the agent');

 // Exact metadata detail is the existing SDK getTrajectoryDetail(...,{includePayloads:false}) route.
 assert.equal(localAgentPathAllowed(metadataPath),true);
 assert.equal(localAgentPathAllowed('/api/trajectories/step-1792180105633-ulsxnc?includePayloads=0'),true);
 const metadata=await invoke({path:metadataPath,method:'GET',ownerId:'owner'});assert.equal(metadata.status,200);
 assert.deepEqual(JSON.parse((await metadata.json()).body),metadataDetail);assert.equal(trajectoryPaths.at(-1),metadataPath);assert.equal(trajectoryReads,2);
 const rejectedMetadata=[
  metadataPath.replace('=0','=1'),metadataPath.replace('=0','=false'),metadataPath+'&includePayloads=0',metadataPath+'&unknown=1',
  metadataPath.replace('?includePayloads=0','?unknown=1&includePayloads=0'),metadataPath.replace('includePayloads','IncludePayloads'),
  metadataPath.replace('=0','=00'),metadataPath+'&',metadataPath+'#fragment',metadataPath.replace('?','/?'),
  '/api/trajectories?includePayloads=0','/api/trajectories?limit=10&includePayloads=0',
  ...['config','CONFIG','export','stats'].map(id=>'/api/trajectories/'+id+'?includePayloads=0'),
  '/api/trajectories/%63onfig?includePayloads=0','/api/trajectories/id%2Fother?includePayloads=0','/api/trajectories/../id?includePayloads=0',
  '/api/trajectories/id?includePayloads=%30','/api/trajectories/id?includePayloads=0\n','/api/trajectories/'+'a'.repeat(129)+'?includePayloads=0',
 ];
 for(const path of rejectedMetadata){assert.equal(localAgentPathAllowed(path),false,path);assert.equal((await invoke({path,method:'GET',ownerId:'owner'})).status,400,path);}
 for(const input of [{path:metadataPath,method:'POST',ownerId:'owner',body:'{}'},{path:metadataPath,method:'GET'},{path:metadataPath,method:'GET',ownerId:'   '},{path:metadataPath,method:'GET',ownerId:'owner',body:'{}'},{path:metadataPath,method:'GET',ownerId:'owner',headers:{'X-Elizaos-Client-Id':'22222222-2222-4222-8222-222222222222'}}])assert.equal((await invoke(input)).status,400);
 assert.equal((await invoke({path:metadataPath,method:'GET',ownerId:'another-owner'})).status,409);
 assert.equal((await invoke({path:metadataPath,method:'GET',ownerId:'owner'},{'X-Alpha-Local-Agent':'0'})).status,403);
 assert.equal((await invoke({path:metadataPath,method:'GET',ownerId:'owner'},{Origin:'https://foreign.invalid'})).status,403);
 assert.equal(trajectoryReads,2,'metadata refusals preserve owner/GET/header gates and never reach the agent');


 client.deviceHeaders={'X-Eliza-Device-Id':'device'};
 assert.equal((await client.send('thread','Hello')).text,'Fixture reply');
 assert.equal((await client.messages('thread')).messages.length,1);
 assert.equal(localAgentPathAllowed('/api/conversations/thread/messages/truncate'),true);
 assert.equal((await invoke({path:'/api/conversations/thread/messages/truncate',method:'GET',ownerId:'owner'})).status,400);
 await client.truncateMessages('thread','11111111-1111-4111-8111-111111111111',signal);assert.equal(truncates,1);
 mode='unconfirmed';await assert.rejects(client.truncateMessages('thread','11111111-1111-4111-8111-111111111111',signal),/not confirmed/);assert.equal(truncates,2);mode='ok';
 mode='unauthorized';await assert.rejects(client.send('thread','Do not replay'),error=>error.status===401);assert.equal(sends,2);
 mode='ok';await client.connect(signal);assert.equal(pairs,2);
 chmodSync(tokenFile,0o644);assert.equal((await invoke({path:'/api/agents',method:'GET'})).status,503);chmodSync(tokenFile,0o600);
 // A pending operation rejects promptly; late native results cannot reattach.
 let release;
 const pending=new LocalAgentProtocol({start:async()=>{},request:()=>new Promise(resolve=>{release=resolve;})});
 const cancelled=new AbortController();const request=pending.request('/api/agents',undefined,cancelled.signal);cancelled.abort();await assert.rejects(request,error=>error.name==='AbortError');release({status:200,body:'{}'});
 let releaseStale;
 const stale=new LocalAgentProtocol({start:async()=>{},request:()=>new Promise(resolve=>{releaseStale=resolve;})});
 const obsolete=stale.request('/api/agents',undefined,signal);await stale.disconnect();releaseStale({status:200,body:'{}'});await assert.rejects(obsolete,/connection changed/);
 const rejected=new LocalAgentProtocol({start:async()=>{},request:async()=>({status:200,body:JSON.stringify({identity:{id:'x',kind:'guest'},access:{role:'OWNER',mode:'local'}})})});await assert.rejects(rejected.connect(signal),/owner access/);
 const scope='b'.repeat(64),entry={scope,proposalId:'proposal',operationId:'operation',operationHash:'c'.repeat(64),record:{description:'Synthetic'}};
 const storage=input=>localAgentStorage(join(directory,'journal'),input);
 const draftSlot='workflow-draft:v1:'+'e'.repeat(64), draftText=JSON.stringify({format:1,spec:{name:'Synthetic draft'}});
 assert.equal(storage({operation:'draftRead',slot:draftSlot}).value,null);
 assert.equal(storage({operation:'draftCompareExchange',slot:draftSlot,expectedValue:null,value:draftText}).status,'saved');
 assert.equal(storage({operation:'draftCompareExchange',slot:draftSlot,expectedValue:null,value:'stale tab'}).status,'conflict');
 assert.equal(localAgentStorage(join(directory,'journal'),{operation:'draftRead',slot:draftSlot}).value,draftText);
 assert.equal(storage({operation:'draftRead',slot:'workflow-draft:v1:'+'f'.repeat(64)}).value,null);
 assert.throws(()=>storage({operation:'draftCompareExchange',slot:draftSlot,expectedValue:draftText,value:'x'.repeat(100001)}),/Invalid workflow draft/);
 assert.throws(()=>storage({operation:'draftCompareExchange',slot:'device:'+'e'.repeat(64),expectedValue:null,value:'wrong namespace'}),/Invalid local storage scope/);
 assert.equal(storage({operation:'draftCompareExchange',slot:draftSlot,expectedValue:draftText,value:null}).status,'saved');
 assert.equal(storage({operation:'draftRead',slot:draftSlot}).value,null);
 assert.equal(storage({...entry,operation:'reserve'}).created,true);
 assert.equal(storage({...entry,operation:'reserve'}).created,false);
 assert.throws(()=>storage({...entry,operation:'reserve',operationHash:'d'.repeat(64)}),/conflict/);
 assert.throws(()=>storage({operation:'finish',scope,proposalId:'proposal',status:'succeeded',summary:'Done'}),/not admitted/);
 storage({operation:'markApplying',scope,proposalId:'proposal',attemptId:'attempt'});
 storage({operation:'finish',scope,proposalId:'proposal',status:'succeeded',summary:'Done'});
 assert.equal(storage({operation:'get',scope,proposalId:'proposal'}).entry.phase,'terminal');
 assert.throws(()=>storage({operation:'finish',scope,proposalId:'proposal',status:'failed',summary:'Wrong'}),/conflict/);
 assert.throws(()=>storage({operation:'read',slot:'../../token'}));
 // The real private preview has mocks disabled but needs its same host-backed
 // credential store before it can negotiate device and message capabilities.
 const savedFetch=globalThis.fetch;let storageRequests=0;
 globalThis.fetch=(url,options)=>{assert.equal(url,'/__alpha-local-agent');storageRequests++;return savedFetch(origin,{...options,headers:{...options.headers,Origin:origin}});};
 try{
  const module='apps/app/src/runtime/local-agent-storage.ts';
  const privateEnv={DEV:true,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1'};
  const {developmentDeviceStore}=await loadBrowserModule(module,{env:privateEnv});
  const deviceSlot='device:'+'9'.repeat(64),device={installationId:'22222222-2222-4222-8222-222222222222',key:'8'.repeat(64)};
  assert.equal(await developmentDeviceStore.read(deviceSlot),null);
  await developmentDeviceStore.write(deviceSlot,device);
  assert.deepEqual(await developmentDeviceStore.read(deviceSlot),device);
  assert.equal(storageRequests,3);
  for(const env of [
   {DEV:false,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1'},
   {DEV:true,VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1'},
   {DEV:true,VITE_LOCAL_AGENT:'1'},
   {DEV:true},
  ]){
   const blocked=await loadBrowserModule(module,{env});
   await assert.rejects(blocked.developmentDeviceStore.read(deviceSlot),/Device storage is unavailable/);
   assert.equal(storageRequests,3,'production and partial flags make no storage request');
  }
 }finally{globalThis.fetch=savedFetch;}
 console.log('Local runtime transport, origin isolation, token redaction, no replay, cancellation and durable journal contracts passed.');
}finally{proxy.closeAllConnections();host.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>host.close(r))]);rmSync(directory,{recursive:true,force:true});}
