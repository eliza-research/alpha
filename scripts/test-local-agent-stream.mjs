import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {loadBrowserModule} from '../test/fixtures/browser-source.mjs';
const [{createLocalAgentDevHandler},{readLocalAgentStream,localTurnStatus},{AlphaClient},{LocalAgentProtocol},{RemoteProtocol},{streamNativeAgent}]=await loadBrowserModule(['scripts/local-agent-dev-bridge.ts', 'apps/app/src/runtime/local-agent-stream.ts', 'apps/app/src/runtime/alpha-client.ts', 'apps/app/src/runtime/local-agent.ts', 'apps/app/src/runtime/remote-protocol.ts', 'apps/app/src/runtime/local-agent-native-stream.ts'],{testMocks:true});
const encoder=new TextEncoder(),signal=new AbortController().signal;
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
function response(text,size=1){const bytes=encoder.encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=size)c.enqueue(bytes.slice(i,i+size));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
const progress=[];
const terminal=await readLocalAgentStream(response(': heartbeat\r\n\r\n'+event({type:'token',text:'Hé'}).replaceAll('\n','\r\n')+event({type:'token',text:'llo'})+event({type:'token',fullText:'Hello revised'})+event({type:'tool',action:'execute',proposal:{id:'untrusted'}})+event({type:'done',fullText:'Final',agentName:'Fixture'})),signal,text=>progress.push(text));
assert.deepEqual(progress,['Hé','Héllo','Hello revised']);
// A planning label is a transient display event: it never becomes reply text, and oversized or empty labels are dropped.
const labels=[],onLabel=event=>labels.push(event.detail);localTurnStatus.addEventListener('label',onLabel);
const labelled=await readLocalAgentStream(response(event({type:'status',kind:'thinking'})+event({type:'status',kind:'thinking',label:"  checking today's calendar  "})+event({type:'status',kind:'thinking',label:'x'.repeat(161)})+event({type:'token',text:'Done.'})+event({type:'done',fullText:'Done.',agentName:'Fixture'})),signal,()=>{});
localTurnStatus.removeEventListener('label',onLabel);
assert.deepEqual(labels,["checking today's calendar"]);assert.equal(labelled.text,'Done.');assert.equal(terminal.text,'Final');assert.equal(terminal.proposals,undefined);
// A settled semantic refusal carries its diagnostic without a second display,
// early navigation, a thrown transport error, or an invented retry.
const calendarFailure={kind:'reply_generation_error',code:'CALENDAR_READ_RECEIPT_MISMATCH',transient:false,message:"I couldn't confirm that Calendar request."};
const readiness=[];
const calendarReply=await readLocalAgentStream(response(event({type:'done',fullText:calendarFailure.message,agentName:'Fixture',messageId:'calendar-reply',failureKind:calendarFailure.kind,terminalFailure:calendarFailure})),signal,()=>{throw Error('Unexpected extra prose frame');},value=>readiness.push(value));
assert.equal(calendarReply.text,calendarFailure.message);assert.deepEqual(calendarReply.terminalFailure,calendarFailure);assert.equal(calendarReply.failureKind,calendarFailure.kind);assert.deepEqual(readiness,[undefined]);

await assert.rejects(readLocalAgentStream(response(event({type:'token',text:'Partial'})),signal,()=>{}),/without a completed reply/);
await assert.rejects(readLocalAgentStream(response(event({type:'error',message:'untrusted provider secret'})),signal,()=>{}),error=>!error.message.includes('secret')&&error.message.includes('interrupted'));
await assert.rejects(readLocalAgentStream(response(event({type:'done',fullText:'not enough'})),signal,()=>{}),/Invalid terminal/);
await assert.rejects(readLocalAgentStream(response(event({type:'token',text:'x'.repeat(200001)}),4096),signal,()=>{}),/display limit/);
await assert.rejects(readLocalAgentStream(response('data: not-json\n\n'),signal,()=>{}));
await assert.rejects(readLocalAgentStream(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([0xc3,0x28]));c.close();}}),{headers:{'content-type':'text/event-stream'}}),signal,()=>{}),/Invalid stream encoding/);
await assert.rejects(readLocalAgentStream(response(':'+ 'x'.repeat(2*1024*1024),4096),signal,()=>{}),/Local stream exceeds limit/);
let cancelled=false;
const aborted=new AbortController();const hanging=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
const pending=readLocalAgentStream(hanging,aborted.signal,()=>{});aborted.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(cancelled,true);

const directory=mkdtempSync(join(tmpdir(),'alpha-stream-')),tokenFile=join(directory,'token');writeFileSync(tokenFile,'a'.repeat(64),{mode:0o600});
let requests=0,mode='stream',finish;let disconnected;
const host=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 if(req.url.endsWith('/messages/stream')){
  requests++;assert.equal(req.headers.authorization,'Bearer fixture-token');assert.equal(req.headers['x-eliza-device-id'],'device');
  if(mode==='unauthorized'){res.writeHead(401);res.end('{}');return;}
  assert.equal(req.method,'POST');assert.equal(JSON.parse(raw).streamProtocol,'delta-v2');
  res.writeHead(200,{'content-type':'text/event-stream'});res.write(event({type:'token',text:'First'}));
  res.on('close',()=>disconnected?.());finish=()=>res.end(event({type:'done',fullText:'Final',agentName:'Fixture'}));return;
 }
 const data=req.url==='/api/auth/status'?{instanceId:'instance'}:req.url==='/api/auth/pair-code'?{code:'fixture'}:req.url==='/api/auth/pair'?{access:'owner',token:'fixture-token',identityId:'owner',instanceId:'instance'}:{identity:{id:'owner'},access:{role:'OWNER'},session:{id:'fixture-token',expiresAt:Date.now()+60000}};
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
});
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));await listen(host);
const proxy=http.createServer(createLocalAgentDevHandler({origin:`http://127.0.0.1:${host.address().port}`,tokenFile}));await listen(proxy);
const origin=`http://127.0.0.1:${proxy.address().port}`,input={path:'/api/conversations/thread/messages/stream',method:'POST',ownerId:'owner',stream:true,headers:{'X-Eliza-Device-Id':'device'},body:JSON.stringify({text:'Synthetic',streamProtocol:'delta-v2'})};
const invoke=(body=input,requestSignal)=>fetch(origin,{method:'POST',headers:{Origin:origin,'content-type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify(body),signal:requestSignal});
try{
 const navigationInput={path:'/api/views/interact-claim',method:'POST',ownerId:'owner',body:JSON.stringify({requestId:'owned-handoff'})};
 assert.equal((await invoke(navigationInput)).status,200);
 assert.equal((await invoke({...navigationInput,ownerId:'wrong'})).status,409);
 assert.equal((await invoke({...navigationInput,ownerId:undefined})).status,400);
 for(const ownerId of ['', '  ', 42])assert.equal((await invoke({...navigationInput,ownerId})).status,400);
 assert.equal((await invoke({...navigationInput,method:'GET',body:undefined})).status,400);
 assert.equal((await invoke({...navigationInput,path:'/api/views/interact'})).status,400);
 assert.equal((await invoke({...input,ownerId:'wrong'})).status,409);assert.equal(requests,0);
 assert.equal((await invoke({...input,path:'/api/auth/me'})).status,400);
 assert.equal((await invoke({...input,stream:false})).status,400);
 const live=await invoke();let observed;
 const first=new Promise(resolve=>{observed=resolve;});let completed=false;
 const result=readLocalAgentStream(live,signal,text=>observed(text)).then(value=>{completed=true;return value;});
 assert.equal(await first,'First');assert.equal(completed,false,'Progress must arrive before terminal completion');finish();assert.equal((await result).text,'Final');assert.equal(requests,1);
 const stop=new AbortController();const closed=new Promise(resolve=>{disconnected=resolve;});const abortResponse=await invoke(input,stop.signal);
 const stopping=readLocalAgentStream(abortResponse,stop.signal,()=>stop.abort());await assert.rejects(stopping);await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Upstream socket did not close')),2000))]);
 mode='unauthorized';assert.equal((await invoke()).status,401);assert.equal(requests,3,'Failed streams are not replayed');
}finally{proxy.closeAllConnections();host.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>host.close(r))]);rmSync(directory,{recursive:true,force:true});}

const client=new AlphaClient();let late,resolveSend;const values=[];
client.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://agent.example'},send:async({onText})=>{late=onText;onText('Progress');return {text:'Final'};},execute:async()=>{throw Error('No action');}});
await client.send('Hello',text=>values.push(text));late('Late');assert.deepEqual(values,['Progress']);
client.disconnect();client.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'new',origin:'https://agent.example'},send:({onText})=>{late=onText;return new Promise(r=>{resolveSend=r;});},execute:async()=>{throw Error('No action');}});
const stale=client.send('Cancel',text=>values.push(text));client.cancel();late('Stale');resolveSend({text:'Too late'});await assert.rejects(stale);assert.deepEqual(values,['Progress']);

// Original authored bytes cross the verified transport unchanged; whitespace-only is not sent.
{
 const textClient=new AlphaClient(),sent=[];
 textClient.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'authored',origin:'https://agent.example'},send:async input=>{sent.push(input.text);return {text:'Done'};},execute:async()=>{throw Error('No action');}});
 await assert.rejects(textClient.send(' \n\t  '),/Enter a message/);assert.equal(sent.length,0);
 const authored='  Indented line.\n\nTrailing space.  \n';
 await textClient.send(authored);assert.deepEqual(sent,[authored]);
}

// Dropped stream: exactly one non-streaming read of the persisted reply under the same clientMessageId.
{
 const posts=[];let mode='drop';
 const bridge={start:async()=>({}),request:async input=>{posts.push(JSON.parse(input.body));return {status:200,body:JSON.stringify({text:'Persisted reply',agentName:'Fixture'})};},
  stream:async(_input,signal,onText)=>{onText('Partial');if(mode==='hold')await new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});if(mode==='status')throw Object.assign(Error('Local agent request failed (HTTP 409).'),{status:409});throw Error('Response interrupted. Outcome unknown; check history before retrying.');}};
 const local=new LocalAgentProtocol(bridge);local.session={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://device.alpha.invalid'};
 const shown=[];
 const reply=await local.send('thread','Hello',{clientMessageId:'client-1',metadata:{a:1},onText:text=>shown.push(text)});
 assert.equal(reply.text,'Persisted reply');assert.deepEqual(shown,['Partial']);
 assert.equal(posts.length,1,'one persisted-reply read after a dropped stream');assert.equal(local.recoveries,1);
 assert.deepEqual(posts[0],{text:'Hello',channelType:'DM',metadata:{a:1},clientMessageId:'client-1'},'identical idempotent request without the stream protocol');
 await assert.rejects(local.send('thread','No key',{onText:()=>{}}));assert.equal(posts.length,1,'no recovery without a clientMessageId');
 mode='status';await assert.rejects(local.send('thread','Refused',{clientMessageId:'client-2',onText:()=>{}}));assert.equal(posts.length,1,'a refused request is not repeated');
 mode='hold';const stop=new AbortController();const stopped=local.send('thread','Stop me',{clientMessageId:'client-3',signal:stop.signal,onText:()=>stop.abort()});
 await assert.rejects(stopped,error=>error.name==='AbortError');assert.equal(posts.length,1,'Stop never reads or repeats the turn');
}
// Remote: a transport drop repeats the identical request once; HTTP failures and Stop are not repeated.
{
 const saved={origin:'https://agent.example',token:'session-token',identityId:'owner',sessionId:'session-token',expiresAt:Date.now()+60000};
 const posts=[];let failures=1,status=200;
 const requester=async input=>{
  const path=new URL(input.url).pathname;
  if(path==='/api/auth/me')return {status:200,body:{identity:{id:'owner',kind:'owner',displayName:'Owner'},session:{id:'session-token',kind:'machine',expiresAt:Date.now()+60000},access:{role:'OWNER',mode:'session'}}};
  if(input.method==='POST'){posts.push(input.body);if(failures-->0)throw Error('socket hang up');return {status,body:{text:'Durable reply',agentName:'Fixture'}};}
  return {status:404,body:{}};
 };
 const remote=new RemoteProtocol('https://agent.example',requester,{read:async()=>saved,write:async()=>{},remove:async()=>{}});
 await remote.restore();
 assert.equal((await remote.send('thread','Hi',{clientMessageId:'remote-1'})).text,'Durable reply');
 assert.equal(posts.length,2);assert.equal(posts[0],posts[1],'the replay is byte-identical');
 failures=1;await assert.rejects(remote.send('thread','No key'));assert.equal(posts.length,3,'no replay without a clientMessageId');
 failures=0;status=500;await assert.rejects(remote.send('thread','Server error',{clientMessageId:'remote-2'}));assert.equal(posts.length,4,'a server error is not repeated');
 const stop=new AbortController();stop.abort();await assert.rejects(remote.send('thread','Stopped',{clientMessageId:'remote-3',signal:stop.signal}));assert.equal(posts.length,4);
}
// Explicit Stop: upstream's POST /api/turns/:roomId/abort, with the room read from the conversation list.
{
 const room='5f0c8a52-6d8e-4c4a-9a51-0b6e6f0d1a22',calls=[];let abortStatus=200,abortBody={aborted:true};
 const bridge={start:async()=>({}),request:async input=>{calls.push({path:input.path,method:input.method,body:input.body});
  if(input.path==='/api/conversations')return {status:200,body:JSON.stringify({conversations:[{id:'thread',title:'T',roomId:room},{id:'roomless',title:'R'}]})};
  if(input.path===`/api/turns/${room}/abort`)return {status:abortStatus,body:JSON.stringify(abortBody)};
  return {status:404,body:'{}'};}};
 const local=new LocalAgentProtocol(bridge);local.session={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://device.alpha.invalid'};
 assert.equal(await local.abortTurn('thread'),'aborted');
 assert.deepEqual(calls.at(-1),{path:`/api/turns/${room}/abort`,method:'POST',body:JSON.stringify({reason:'client-stop'})});
 abortBody={aborted:false};assert.equal(await local.abortTurn('thread'),'idle','no active turn: the reply may already be durable');
 abortStatus=404;assert.equal(await local.abortTurn('thread'),'unsupported','an agent without the route keeps the may-still-finish state');
 const before=calls.length;assert.equal(await local.abortTurn('roomless'),'unsupported');assert.equal(calls.length,before+1,'no abort without a verified room');
 const saved={origin:'https://agent.example',token:'session-token',identityId:'owner',sessionId:'session-token',expiresAt:Date.now()+60000};
 let removed=0,remoteStatus=200;const remoteCalls=[];
 const requester=async input=>{const path=new URL(input.url).pathname;remoteCalls.push({path,method:input.method,body:input.body});
  if(path==='/api/auth/me')return {status:200,body:{identity:{id:'owner',kind:'owner',displayName:'Owner'},session:{id:'session-token',kind:'machine',expiresAt:Date.now()+60000},access:{role:'OWNER',mode:'session'}}};
  if(path==='/api/conversations')return {status:200,body:{conversations:[{id:'thread',roomId:room}]}};
  if(path===`/api/turns/${room}/abort`)return {status:remoteStatus,body:{aborted:true,roomId:room}};
  return {status:404,body:{}};};
 const remote=new RemoteProtocol('https://agent.example',requester,{read:async()=>saved,write:async()=>{},remove:async()=>{removed++;}});
 await remote.restore();
 assert.equal(await remote.abortTurn('thread'),'aborted');
 const abortCall=remoteCalls.find(item=>item.path===`/api/turns/${room}/abort`);assert.equal(abortCall.method,'POST');
 remoteStatus=401;assert.equal(await remote.abortTurn('thread'),'unsupported');assert.equal(removed,0,'a refused optional cancel never signs the phone out');
 assert.ok(remote.session,'the paired session remains');
 const stop=new AbortController();stop.abort();await assert.rejects(remote.abortTurn('thread',stop.signal));
}
console.log('Streaming framing, progress, terminal validation, interruption, owner binding, no replay, upstream cancellation, stale callback, single persisted-reply recovery after a dropped stream, no Stop replay and explicit turn-abort checks passed.');
console.log('Streaming framing, progress, terminal validation, interruption, owner binding, no replay, upstream cancellation and stale callback checks passed.');

// Navigation is carried only by the authenticated terminal result; status/tool
// frames and prose are never instructions to switch views or approve effects.
const handoff={actionName:'VIEWS',success:true,values:{mode:'show',viewId:'notes',navigationPrepared:true,completedActionHandoffId:'owned-handoff'}};
const navWire=await readLocalAgentStream(response(event({type:'tool',actionResults:[{...handoff,values:{...handoff.values,viewId:'wallet'}}]})+event({type:'done',fullText:'Opening Notes.',agentName:'Fixture',actionResults:[handoff]})),signal,()=>{});
assert.deepEqual(navWire.actionResults,[handoff]);
const navigationClient=new AlphaClient();let automaticEffects=0;
navigationClient.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'navigation-session',origin:'https://agent.example'},send:async()=>({text:navWire.text,actionResults:navWire.actionResults}),execute:async()=>{automaticEffects++;throw Error('Navigation must not auto-approve device actions');}});
const navigationReply=await navigationClient.send('Open Notes');assert.deepEqual(navigationReply.actionResults,[handoff]);assert.equal(automaticEffects,0);
console.log('PASS terminal navigation metadata survives the existing stream/client boundary without executing device approvals.');

// reply_ready finalizes generation metadata, not persistence or navigation.
const prepared={actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:'notes',viewPath:'/notes',viewType:'gui',label:'Notes',completedActionDelivered:false,completedActionHandoffId:'ready-handoff',navigationPrepared:true,navigationBinding:{requestId:'ready-handoff',clientId:'owned-client',viewId:'notes',viewType:'gui',installationId:'owned-installation'}}};
const ready=event({type:'reply_ready',fullText:'PRIVATE_READY_PROSE',actionResults:[{actionName:'NOTES_GET',success:true,data:{body:'PRIVATE_NOTE_BODY'}},prepared]});
let retained,readyCalls=0;
await assert.rejects(readLocalAgentStream(response(event({type:'tool',actionResults:[prepared]})+ready+ready+event({type:'error',message:'PRIVATE_FAILURE'})),signal,()=>{throw Error('Ready prose must not render');},value=>{retained=value;readyCalls++;}),/interrupted/);
assert.equal(readyCalls,1);assert.equal(retained.length,1);assert.equal(retained[0].values.navigationBinding.requestId,'ready-handoff');assert.doesNotMatch(JSON.stringify(retained),/PRIVATE_/);
const readyTerminal=event({type:'done',fullText:'Opening Notes.',agentName:'Fixture',actionResults:[prepared]});
await readLocalAgentStream(response(ready+readyTerminal),signal,()=>{},value=>{retained=value;});
assert.equal(retained[0].values.viewId,'notes');
for(const ending of [event({type:'done',fullText:'Correction',agentName:'Fixture',actionResults:[]}),event({type:'reply_ready',fullText:'Correction',actionResults:[]}),event({type:'done',fullText:'Failure',agentName:'Fixture',actionResults:[prepared],failureKind:'interrupted'})]){
 retained=undefined;try{await readLocalAgentStream(response(ready+ending),signal,()=>{},value=>{retained=value;});}catch{}assert.equal(retained,undefined,'A contradictory/failing terminal snapshot revokes ready navigation');
}
const readyClient=new AlphaClient();let lateReady,clientReady;readyClient.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'ready-session',origin:'https://agent.example'},send:async({onReplyReady})=>{lateReady=onReplyReady;onReplyReady([prepared]);assert.equal(readyClient.getState().pending,true);throw Error('PRIVATE_PERSISTENCE_FAILURE');},execute:async()=>{throw Error('No device effects');}});
await assert.rejects(readyClient.send('Open Notes',undefined,undefined,value=>{clientReady=value;}),error=>error.code==='transport-failed'&&!error.message.includes('PRIVATE_'));assert.equal(readyClient.getState().pending,false);assert.deepEqual(clientReady,[prepared]);lateReady(undefined);assert.deepEqual(clientReady,[prepared],'Late callbacks cannot erase a settled ready receipt');
console.log('PASS reply-ready navigation retention, privacy, disagreement revocation and settled client fences.');

for(const missingAny of [false,true]){
 const originalAny=Object.getOwnPropertyDescriptor(AbortSignal,'any');
 if(missingAny)Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});
 try{
 for(const mode of ['interrupted','invalid-native','malformed-complete','done']){
 let emit,id,observed,retainedNative;const seen=new Promise(resolve=>{observed=resolve;});let finished=false;
 const port={async addListener(_name,callback){emit=callback;return {async remove(){}};},async cancelStream(){},async requestStream(input){id=input.streamId;emit({streamId:id,event:{type:'response',status:200,headers:{'content-type':'text/event-stream'}}});emit({streamId:id,event:{type:'chunk',dataBase64:Buffer.from(ready).toString('base64')}});return {streamId:id};}};
 const work=streamNativeAgent(port,{path:'/api/conversations/fixture/messages/stream',ownerId:'owner',headers:{},body:'{}'},signal,()=>{},value=>{retainedNative=value;if(value)observed();});void work.then(()=>{finished=true;},()=>{finished=true;});await seen;assert.equal(finished,false,'Ready metadata does not settle the native stream');
 if(mode==='done'){emit({streamId:id,event:{type:'chunk',dataBase64:Buffer.from(readyTerminal).toString('base64')}});emit({streamId:id,event:{type:'complete'}});assert.equal((await work).text,'Opening Notes.');assert.ok(retainedNative);}
 else{emit({streamId:id,event:mode==='interrupted'?{type:'complete',error:'PRIVATE_NATIVE_FAILURE'}:mode==='malformed-complete'?{type:'complete',error:{failure:'not a transport string'}}:{type:'unknown'}});await assert.rejects(work,error=>!error.message.includes('PRIVATE_'));assert.equal(!!retainedNative,mode==='interrupted');}
}
 }finally{Object.defineProperty(AbortSignal,'any',originalAny);}
}
console.log('PASS actual native adapter drains ready metadata, retains interruptions and revokes invalid native frames, including WebView113 without AbortSignal.any.');

for(const failure of [{terminalFailure:{code:'MODEL_OUTPUT_INCOMPLETE'}},{failureKind:'interrupted'}]){
 for(const prefix of ['',ready]){retained=undefined;await assert.rejects(readLocalAgentStream(response(prefix+event({type:'reply_ready',fullText:'PRIVATE_FAILED_READY',actionResults:[prepared],...failure})),signal,()=>{},value=>{retained=value;}),/not successful/);assert.equal(retained,undefined);}
}
console.log('PASS failure-marked ready snapshots and malformed native completions revoke retained navigation.');
