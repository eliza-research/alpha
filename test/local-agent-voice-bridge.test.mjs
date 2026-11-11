import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {createLocalAgentDevHandler,localAgentPathAllowed,LOCAL_VOICE_WS_PATH}=await import('../scripts/local-agent-dev-bridge.ts');
const owner=randomUUID(),agent=randomUUID(),conversation=randomUUID(),nonce='a'.repeat(43),voiceToken='b'.repeat(43),root='1'.repeat(64),paired='synthetic-owner-bearer';
const BASE='/api/v1/voice/session';
function requestJson(url,headers,body){return new Promise((resolve,reject)=>{const request=httpRequest(url,{method:'POST',headers},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(text)}));});request.on('error',reject);request.end(body);});}

async function fixture(enabled=true,cloudRealtime=false,attestation={}){
 const directory=await mkdtemp(join(tmpdir(),'alpha-voice-bridge-')),tokenFile=join(directory,'token');await writeFile(tokenFile,root,{mode:0o600});
 const calls=[];let mode='ok',upgrades=0,mintExtras=()=>({});const rendererHeaders=[];
 const runtimeSockets=new Set();const runtime=createServer();runtime.on('upgrade',(req,socket)=>{runtimeSockets.add(socket);socket.once('close',()=>runtimeSockets.delete(socket));upgrades++;if(req.url.startsWith('/ws?'))rendererHeaders.push({url:req.url,authorization:req.headers.authorization});assert.equal(req.headers.origin,runtimeOrigin);const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.on('error',()=>{});socket.on('data',data=>socket.write(data));});
 await new Promise(r=>runtime.listen(0,'127.0.0.1',r));const runtimeOrigin=`http://127.0.0.1:${runtime.address().port}`;
 const request=async(url,input)=>{const path=new URL(url).pathname;calls.push({url,input});
  if(path==='/api/auth/status')return Response.json({instanceId:'fixture'});
  if(path==='/api/auth/pair-code')return Response.json({code:'fixture'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'fixture',identityId:owner});
  assert.equal(input.headers.Authorization,'Bearer '+paired);
  if(path==='/api/auth/me')return Response.json({identity:{id:owner},access:{role:'OWNER'},session:{id:paired,expiresAt:Date.now()+600000}});
  if(mode==='error')return Response.json({code:'voice_owner_session_required'},{status:403});
  if(path.endsWith('/health'))return Response.json({ready:true,agentId:agent,conversationId:mode==='wrong-health'?randomUUID():conversation,...attestation});
  if(path.endsWith('/consent'))return Response.json({consentNonce:nonce,expiresAt:Date.now()+120000});
  if(path.endsWith('/revoke'))return Response.json({revoked:true});
  const sessionId=randomUUID();return Response.json({sessionId,token:voiceToken,expiresAt:mode==='expired'?Date.now()-1:Date.now()+120000,wsUrl:`${mode==='foreign'?'ws://other.invalid':runtimeOrigin.replace('http:','ws:')}${BASE}/ws?sessionId=${sessionId}`,uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']},iceServers:null,...mintExtras(sessionId),...(mode==='secret'?{apiKey:'never-return'}:{})});
 };
 const handler=createLocalAgentDevHandler({origin:runtimeOrigin,tokenFile,request,cartesiaEnabled:enabled,cloudRealtimeEnabled:cloudRealtime}),server=createServer(handler);server.on('upgrade',(req,socket,head)=>void handler.upgrade(req,socket,head));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=async (input,hostOverride)=>{if(hostOverride)return requestJson(origin,{Host:hostOverride,Origin:'http://'+hostOverride,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},JSON.stringify({ownerId:owner,headers:{Accept:'application/json'},...input}));const response=await fetch(origin,{method:'POST',headers:{Origin:hostOverride?`http://${hostOverride}`:origin,...(hostOverride?{Host:hostOverride}:{}),'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({ownerId:owner,headers:{Accept:'application/json'},...input})});return {status:response.status,data:await response.json()};};
 return {call,calls,origin,tokenFile,mintMetadata:value=>{mintExtras=value;},mode:value=>{mode=value;},rendererHeaders,upgrades:()=>upgrades,close:async()=>{handler.closeVoice();for(const socket of runtimeSockets)socket.destroy();server.closeAllConnections();runtime.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>runtime.close(r))]);await rm(directory,{recursive:true,force:true});}};
}
const mint=()=>({path:BASE,method:'POST',body:JSON.stringify({agentId:agent,conversationId:conversation,consentNonce:nonce,transport:'websocket'})});
test('canonical developer voice controls reuse private owner and project only minted socket ticket',async()=>{
 const f=await fixture();try{
  const health=await f.call({path:`${BASE}/health?conversationId=${conversation}`,method:'GET'});assert.equal(health.data.status,200);
  const consent=await f.call({path:BASE+'/consent',method:'POST',body:'{}'});assert.equal(JSON.parse(consent.data.body).consentNonce,nonce);
  const response=await f.call(mint()),ticket=JSON.parse(response.data.body);assert.equal(ticket.wsUrl,`${f.origin.replace('http:','ws:')}${LOCAL_VOICE_WS_PATH}?sessionId=${ticket.sessionId}`);assert.equal(ticket.token,voiceToken);assert.equal(JSON.stringify(response).includes(paired),false);assert.equal(JSON.stringify(response).includes(root),false);
  const revoked=await f.call({path:`${BASE}/${ticket.sessionId}/revoke`,method:'POST',body:'{}'});assert.deepEqual(JSON.parse(revoked.data.body),{revoked:true});
  assert.equal(f.calls.filter(c=>new URL(c.url).pathname==='/api/auth/pair').length,1);
 }finally{await f.close();}
});
test('voice gate, malformed controls, foreign mint, expiry, unknown fields and wrong owner fail closed',async()=>{
 const off=await fixture(false);try{assert.equal((await off.call(mint())).status,400);assert.equal(off.calls.length,0);}finally{await off.close();}
 const f=await fixture();try{
  for(const input of [{path:BASE+'/health?conversationId=bad',method:'GET'},{...mint(),body:JSON.stringify({brain:'external'})},{...mint(),headers:{Authorization:'secret'}},{path:BASE+'/consent',method:'GET'},{path:BASE+'/ws',method:'GET'}])assert.equal((await f.call(input)).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.call({...mint(),ownerId:'other'})).status,409);
  for(const mode of ['foreign','expired','secret']){f.mode(mode);const result=await f.call(mint());assert.equal(result.status,503);assert.equal(JSON.stringify(result).includes('never-return'),false);}
  f.mode('wrong-health');assert.equal((await f.call({path:`${BASE}/health?conversationId=${conversation}`,method:'GET'})).status,503);
  f.mode('error');const error=await f.call(mint());assert.equal(error.data.status,403);assert.deepEqual(JSON.parse(error.data.body),{code:'voice_owner_session_required'});
 }finally{await f.close();}
});
function upgrade(url,origin,hostOverride){return new Promise((resolve,reject)=>{const req=httpRequest(url.replace('ws:','http:'),{headers:{Origin:origin,...(hostOverride?{Host:hostOverride}:{}),Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='}});req.on('upgrade',(response,socket)=>resolve({status:response.statusCode,socket}));req.on('response',response=>{response.resume();resolve({status:response.statusCode});});req.on('error',reject);req.end();});}
test('same-origin owned minted upgrade is single use; revoke and credential rollover close its tunnel',async()=>{
 const f=await fixture();try{
  const ticket=JSON.parse((await f.call(mint())).data.body);
  assert.equal((await upgrade(ticket.wsUrl,'https://other.invalid')).status,403);assert.equal(f.upgrades(),0);
  const accepted=await upgrade(ticket.wsUrl,f.origin);assert.equal(accepted.status,101);assert.equal(f.upgrades(),1);
  assert.equal((await upgrade(ticket.wsUrl,f.origin)).status,403);
  const closed=new Promise(r=>accepted.socket.once('close',r));accepted.socket.resume();await f.call({path:`${BASE}/${ticket.sessionId}/revoke`,method:'POST',body:'{}'});await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Tunnel close timeout')),1000))]);
  const next=JSON.parse((await f.call(mint())).data.body);await writeFile(f.tokenFile,'2'.repeat(64),{mode:0o600});assert.equal((await upgrade(next.wsUrl,f.origin)).status,403);
 }finally{await f.close();}
});

test('renderer channel uses a single-use same-origin ticket and keeps the paired bearer on the host',async()=>{
 const f=await fixture();try{const clientId=randomUUID();
 const result=await f.call({path:'/api/views/voice-channel',method:'POST',body:JSON.stringify({clientId})});
 assert.equal(result.data.status,200);assert.ok(!JSON.stringify(result).includes(paired));
 const {wsUrl,expiresAt}=JSON.parse(result.data.body);assert.ok(wsUrl.includes('/__alpha-local-renderer/ws?'));assert.ok(expiresAt>Date.now()&&expiresAt<=Date.now()+120000);
 assert.equal((await upgrade(wsUrl,'https://other.invalid')).status,403);
 const connected=await upgrade(wsUrl,f.origin);assert.equal(connected.status,101);
 assert.deepEqual(f.rendererHeaders,[{url:'/ws?clientId='+clientId,authorization:'Bearer '+paired}]);
 assert.equal((await upgrade(wsUrl,f.origin)).status,403);connected.socket.destroy();
 }finally{await f.close();}
});

test('canonical message-history pagination is allowed with bounded cursor fields only',()=>{
 const base='/api/conversations/'+randomUUID()+'/messages';
 for(const suffix of ['?limit=200','?before=1792101404606&beforeId='+randomUUID()+'&limit=200','?before=1792101404606&beforeId=1cba3bf9-56fd-086e-b8bf-c2711d9bcffb&limit=200'])assert.equal(localAgentPathAllowed(base+suffix),true);
 for(const suffix of ['?limit=201','?limit=1&limit=2','?token=secret','?before=123','?before=123&beforeId=not-a-uuid','?limit=-1','?limit=1%26token=secret'])assert.equal(localAgentPathAllowed(base+suffix),false);
});

test('renderer renewal issues a fresh single-use short ticket; expired and old-root replacements fail closed',async()=>{
 const f=await fixture();const realNow=Date.now;
 try{
  const clientId=randomUUID(),issue=async()=>JSON.parse((await f.call({path:'/api/views/voice-channel',method:'POST',body:JSON.stringify({clientId})})).data.body);
  const first=await issue(),second=await issue();assert.notEqual(first.wsUrl,second.wsUrl);assert.ok(first.expiresAt<=realNow()+120000&&second.expiresAt<=realNow()+120000);
  const accepted=await upgrade(first.wsUrl,f.origin);assert.equal(accepted.status,101);
  Date.now=()=>second.expiresAt+1;assert.equal((await upgrade(second.wsUrl,f.origin)).status,403);Date.now=realNow;
  const replacement=await issue();await writeFile(f.tokenFile,'2'.repeat(64),{mode:0o600});assert.equal((await upgrade(replacement.wsUrl,f.origin)).status,403);
  assert.ok(f.rendererHeaders.every(row=>row.authorization===`Bearer ${paired}`));accepted.socket.destroy();
 }finally{Date.now=realNow;await f.close();}
});

test('Cloud realtime bridge shares owned voice/renderer controls but requires genuine route attestation',async()=>{const f=await fixture(false,true,{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'});try{const result=await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'});assert.equal(result.data.status,200);assert.equal(JSON.parse(result.data.body).speechRoute,'cloud');const minted=await f.call(mint());assert.equal(minted.data.status,200);assert.match(JSON.parse(minted.data.body).wsUrl,/__alpha-local-voice/);}finally{await f.close();}});
test('Cloud realtime rejects absent/direct provider metadata, and contradictory flags fail before enrollment',async()=>{for(const attestation of [{},{speechRoute:'direct',speechProvider:'cartesia',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'deferred'}]){const f=await fixture(false,true,attestation);try{assert.notEqual((await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'})).data.status,200);}finally{await f.close();}}assert.throws(()=>createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile:'unused',cartesiaEnabled:true,cloudRealtimeEnabled:true}),/cannot both/);});

test('localhost HTTP and websocket aliases remain exact-origin and single-use',async()=>{
 const f=await fixture();try{
  const authority='localhost:'+new URL(f.origin).port,localOrigin='http://'+authority;
  assert.equal((await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'},authority)).data.status,200);
  const ticket=JSON.parse((await f.call(mint(),authority)).data.body),wire=ticket.wsUrl.replace('localhost','127.0.0.1');
  assert.equal((await upgrade(wire,f.origin,authority)).status,403);
  const accepted=await upgrade(wire,localOrigin,authority);assert.equal(accepted.status,101);assert.equal((await upgrade(wire,localOrigin,authority)).status,403);accepted.socket.destroy();
 }finally{await f.close();}
});
test('localhost does not widen HTTP host or origin trust',async()=>{
 const f=await fixture();try{
  const port=new URL(f.origin).port,input={path:BASE+'/health?conversationId='+conversation,method:'GET'};
  for(const [host,origin] of [['localhost:'+port,f.origin],['127.0.0.1:'+port,'http://localhost:'+port],['localhost.evil:'+port,'http://localhost.evil:'+port],['127.0.0.1.evil:'+port,'http://127.0.0.1.evil:'+port],['example.com:'+port,'http://example.com:'+port],['localhost:'+port,'http://localhost:1']]){
   const r=await requestJson(f.origin,{Host:host,Origin:origin,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},JSON.stringify({ownerId:owner,...input}));assert.equal(r.status,403);
  }
  assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('canonical app records use the shared method policy and bound owner without voice',async()=>{
 const f=await fixture(false);try{
  for(const input of [
   {path:'/api/notes/state',method:'GET'},
   {path:'/api/views/notes/interact',method:'POST',body:'{}'},
   {path:'/api/lifeops/calendar/feed?timeMin=2026-10-25T07%3A00%3A00Z&timeMax=2026-10-26T07%3A00%3A00Z',method:'GET'},
   {path:'/api/lifeops/calendar/events',method:'POST',body:'{}'},
   {path:'/api/lifeops/calendar/events/local%3Aevent-1',method:'PATCH',body:'{}'},
   {path:'/api/lifeops/calendar/events/local%3Aevent-1?expectedProviderVersion=1',method:'DELETE'},
  ]){const r=await f.call(input);assert.equal(r.status,200,input.path);assert.equal(r.data.status,200,input.path);assert.ok(f.calls.some(c=>new URL(c.url).pathname===new URL(input.path,'http://example.invalid').pathname&&c.input.method===input.method));assert(!JSON.stringify(r).includes(paired));}
  for(const input of [
   {path:'/api/notes/state',method:'PATCH',body:'{}'},
   {path:'/api/lifeops/calendar/unknown',method:'GET'},
   {path:'/api/lifeops/calendar/events/a%2Fb',method:'DELETE'},
   {path:'/api/lifeops/calendar/feed?unknown=1',method:'GET'},
   {path:'/api/lifeops/calendar/feed?mode=local&mode=remote',method:'GET'},
  ]){const before=f.calls.length;assert.equal((await f.call(input)).status,400,input.path);assert.equal(f.calls.length,before);}
  const before=f.calls.length;assert.equal((await f.call({path:'/api/notes/state',method:'GET',ownerId:'wrong-owner'})).status,409);assert.equal(f.calls.length,before);
 }finally{await f.close();}
});

test('ordinary conversation renderer lease works without enabling voice and stays single-use',async()=>{
 const f=await fixture(false);try{
  const clientId=randomUUID();const r=await f.call({path:'/api/views/renderer-channel',method:'POST',body:JSON.stringify({clientId})});assert.equal(r.status,200);assert.equal(r.data.status,200);
  const ticket=JSON.parse(r.data.body);assert(!JSON.stringify(r).includes(paired));assert.equal((await upgrade(ticket.wsUrl,'https://other.invalid')).status,403);
  const connection=await upgrade(ticket.wsUrl,f.origin);assert.equal(connection.status,101);assert.equal((await upgrade(ticket.wsUrl,f.origin)).status,403);assert.deepEqual(f.rendererHeaders,[{url:'/ws?clientId='+clientId,authorization:'Bearer '+paired}]);connection.socket.destroy();
  assert.equal((await f.call(mint())).status,400);
 }finally{await f.close();}
});


const preparedView={clientId:'renderer-1',delivery:'completed-action',prepareOnly:true,viewType:'gui',completedActionHandoffId:'manual-view-1'};
test('actual browser bridge forwards only strict owner-bound navigation preparation',async()=>{
 const f=await fixture(false);try{
  for(const view of ['settings','calendar','chat','automations']){
   const path=`/api/views/${view}/navigate`,result=await f.call({path,method:'POST',body:JSON.stringify(preparedView)});
   assert.equal(result.status,200);assert.equal(result.data.status,200);
   const request=f.calls.findLast(row=>new URL(row.url).pathname===path);
   assert.deepEqual(JSON.parse(request.input.body),preparedView);
   assert.equal(request.input.headers.Authorization,'Bearer '+paired);
  }
  for(const path of ['/api/views/interact-claim','/api/views/interact-result'])assert.equal((await f.call({path,method:'POST',body:'{}'})).data.status,200);
 }finally{await f.close();}
});
test('actual browser bridge refuses malformed or unowned preparation before forwarding',async()=>{
 const f=await fixture(false);try{
  const path='/api/views/settings/navigate';
  const inputs=[
   ...[undefined,false,'true'].map(prepareOnly=>({body:JSON.stringify({...preparedView,prepareOnly})})),
   ...[{delivery:'originating-client'},{viewType:'tui'},{payload:{}},{action:'close'},{clientId:'bad id'}].map(change=>({body:JSON.stringify({...preparedView,...change})})),
   ...['\n','\r','\u2028','\u2029'].flatMap(end=>[
    {path:'/api/views/settings/navigate'+end,body:JSON.stringify(preparedView)},
    {body:JSON.stringify({...preparedView,clientId:'renderer-1'+end})},
    {body:JSON.stringify({...preparedView,completedActionHandoffId:'manual-view-1'+end})},
   ]),
   {body:'not-json'},{body:JSON.stringify(preparedView),method:'GET'},
   {body:JSON.stringify(preparedView),ownerId:undefined},
   ...['/api/views/../settings/navigate','/api/views/%73ettings/navigate','/api/views/settings/navigate?other=1','/api/views/settings/navigate\n','/api/views/settings/navigate\r\n','/api/views/settings/navigate\t','/api/views/settings/navigate\u0000'].map(path=>({path,body:JSON.stringify(preparedView)})),
  ];
  for(const input of inputs){const result=await f.call({path,method:'POST',...input});assert.equal(result.status,400,JSON.stringify(input));}
  assert.equal(f.calls.length,0);
  const wrong=await f.call({path,method:'POST',ownerId:randomUUID(),body:JSON.stringify(preparedView)});
  assert.equal(wrong.status,409);assert.equal(f.calls.some(row=>new URL(row.url).pathname===path),false);
 }finally{await f.close();}
});


test('SDK17 direct and Cloud mint attestations preserve strict stop generation and legacy tickets',async()=>{
 for(const cloud of [false,true]){
  const f=await fixture(!cloud,cloud);try{
   f.mintMetadata(sessionId=>({stopIntentVersion:1,stopIntentGeneration:sessionId,...(cloud?{rotationPreparation:'retire-before-open-v1'}:{})}));
   const response=await f.call(mint());assert.equal(response.status,200);assert.equal(response.data.status,200);const ticket=JSON.parse(response.data.body);
   assert.equal(ticket.stopIntentVersion,1);assert.equal(ticket.stopIntentGeneration,ticket.sessionId);assert.equal(ticket.rotationPreparation,cloud?'retire-before-open-v1':undefined);
   assert.equal(ticket.wsUrl,`${f.origin.replace('http:','ws:')}${LOCAL_VOICE_WS_PATH}?sessionId=${ticket.sessionId}`);
   assert(!JSON.stringify(response).includes(paired));assert(!JSON.stringify(response).includes(root));
  }finally{await f.close();}
 }
 const legacy=await fixture();try{const response=await legacy.call(mint());assert.equal(response.status,200);const ticket=JSON.parse(response.data.body);assert(!Object.hasOwn(ticket,'stopIntentVersion'));assert(!Object.hasOwn(ticket,'stopIntentGeneration'));}finally{await legacy.close();}
});

test('SDK17 malformed orphan mismatched and unrecognized stop metadata fail closed',async()=>{
 const f=await fixture(false,true);try{
  const changes=[
   id=>({stopIntentVersion:1}),id=>({stopIntentGeneration:id}),id=>({rotationPreparation:'retire-before-open-v1'}),
   id=>({stopIntentVersion:'1',stopIntentGeneration:id}),id=>({stopIntentVersion:2,stopIntentGeneration:id}),
   id=>({stopIntentVersion:1,stopIntentGeneration:randomUUID()}),id=>({stopIntentVersion:1,stopIntentGeneration:null}),
   id=>({stopIntentVersion:1,stopIntentGeneration:id+'\n'}),id=>({stopIntentVersion:1,stopIntentGeneration:id,rotationPreparation:'unknown'}),
   id=>({stopIntentVersion:1,stopIntentGeneration:id,extraMetadata:true}),
  ];
  for(const change of changes){f.mintMetadata(change);assert.equal((await f.call(mint())).status,503);}
 }finally{await f.close();}
 const direct=await fixture();try{direct.mintMetadata(id=>({stopIntentVersion:1,stopIntentGeneration:id,rotationPreparation:'retire-before-open-v1'}));assert.equal((await direct.call(mint())).status,503);}finally{await direct.close();}
});

test('SDK17 renewal forwards one exact predecessor UUID while malformed or extra requests never reach runtime',async()=>{
 const f=await fixture(false,true);try{
  f.mintMetadata(id=>({stopIntentVersion:1,stopIntentGeneration:id,rotationPreparation:'retire-before-open-v1'}));
  const predecessor=randomUUID(),body={...JSON.parse(mint().body),predecessorSessionId:predecessor};
  const response=await f.call({...mint(),body:JSON.stringify(body)});assert.equal(response.status,200);assert.equal(JSON.parse(f.calls.findLast(c=>new URL(c.url).pathname===BASE).input.body).predecessorSessionId,predecessor);
  for(const value of [null,1,{},'',predecessor+'\n','not-a-uuid']){const count=f.calls.length;assert.equal((await f.call({...mint(),body:JSON.stringify({...body,predecessorSessionId:value})})).status,400);assert.equal(f.calls.length,count);}
  const count=f.calls.length;assert.equal((await f.call({...mint(),body:JSON.stringify({...body,providerKey:'not-allowed'})})).status,400);assert.equal(f.calls.length,count);
  assert.equal((await f.call({...mint(),ownerId:randomUUID(),body:JSON.stringify(body)})).status,409);assert.equal(f.calls.filter(c=>new URL(c.url).pathname===BASE).length,1);
 }finally{await f.close();}
});


test('current terminal protocol attestation passes the paired bridge without weakening strict fields',async()=>{
 const attestation={speechRoute:'direct',turnTerminal:true},f=await fixture(true,false,attestation);
 try{
  const health=await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'});assert.equal(health.status,200);assert.equal(JSON.parse(health.data.body).turnTerminal,true);
  const request={...mint(),body:JSON.stringify({...JSON.parse(mint().body),turnTerminal:true})};
  f.mintMetadata(()=>({turnTerminal:true}));const minted=await f.call(request);assert.equal(minted.status,200);assert.equal(JSON.parse(minted.data.body).turnTerminal,true);assert.equal(JSON.parse(f.calls.findLast(c=>new URL(c.url).pathname===BASE).input.body).turnTerminal,true);
  for(const value of [false,'true',1,null]){const before=f.calls.length;assert.equal((await f.call({...request,body:JSON.stringify({...JSON.parse(request.body),turnTerminal:value})})).status,400);assert.equal(f.calls.length,before);}
  f.mintMetadata(()=>({}));assert.equal((await f.call(request)).status,503,'an explicitly negotiated terminal protocol cannot silently fall back');
  f.mintMetadata(()=>({turnTerminal:false}));assert.equal((await f.call(request)).status,503);
  attestation.turnTerminal=false;assert.equal((await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'})).status,503);
 }finally{await f.close();}
});
