import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as pageRequest} from 'node:http';
import {duplexPair} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:30000});process.exit(child.status??1);}
const {createLocalAgentDevHandler}=await import('../scripts/local-agent-dev-bridge.ts');
const owner=randomUUID(),root='1'.repeat(64),paired='fixture-private-owner',encoder=new TextEncoder(),decoder=new TextDecoder();
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
async function fixture(mode){
 const directory=await mkdtemp(join(tmpdir(),'alpha-conversation-stream-')),tokenFile=join(directory,'token');await writeFile(tokenFile,root,{mode:0o600});
 let signal,upstream;const calls=[],cancels=[],handled=[],connections=[];
 const request=async(url,input)=>{const path=new URL(url).pathname;calls.push({path,input});
  if(path==='/api/auth/status')return Response.json({instanceId:'fixture'});
  if(path==='/api/auth/pair-code')return Response.json({code:'fixture'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'fixture',identityId:owner});
  assert.equal(input.headers.Authorization,'Bearer '+paired);
  if(path==='/api/auth/me')return Response.json({identity:{id:owner},access:{role:'OWNER'},session:{id:paired,expiresAt:Date.now()+600000}});
  assert.equal(path,'/api/conversations/thread/messages/stream');assert.equal(input.headers.Accept,'text/event-stream');
  // Like fetch, an aborted request errors its body in stream mode. A stalled body ignores the request
  // signal, so only the bridge's own cancel (recorded) releases it. A late request answers with a stalled body
  // only after its signal has aborted, as a custom request may.
  signal=input.signal;if(mode==='late')await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
  return new Response(new ReadableStream({start(controller){upstream=controller;if(mode==='stream')signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});},cancel(reason){cancels.push(reason);}}),{headers:{'content-type':'text/event-stream'}});
 };
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,request});
 // Each page request keeps the bridge handler's promise, which settles only when the handler returns.
 const server=createServer((req,res)=>{handled.push(handler(req,res));});
 // The page reaches the bridge over an in-process connection whose writes complete only as the page reads.
 // Loopback TCP buffered 0.8 to 2.2 MiB of an unread response on macOS, up to the bridge's 2 MiB stream
 // cap, so over TCP a page that stops reading could not reliably hold the bridge in its drain wait.
 const open=()=>new Promise((resolve,reject)=>{
  const [connection,page]=duplexPair();connection.once('close',()=>page.destroy());page.once('close',()=>connection.destroy());connections.push(connection);server.emit('connection',connection);
  const outgoing=pageRequest({method:'POST',path:'/__alpha-local-agent',headers:{Host:'localhost:5173',Origin:'http://localhost:5173','Content-Type':'application/json','X-Alpha-Local-Agent':'1'},createConnection:()=>page},
   response=>resolve({response,chunks:response[Symbol.asyncIterator](),connection,disconnect:()=>outgoing.destroy()}));
  outgoing.once('error',reject);outgoing.end(JSON.stringify({path:'/api/conversations/thread/messages/stream',method:'POST',ownerId:owner,stream:true,headers:{},body:JSON.stringify({text:'Synthetic'})}));
 });
 return {open,cancels,streams:()=>calls.filter(x=>x.path.endsWith('/messages/stream')).length,signal:()=>signal,upstream:()=>upstream,send:text=>upstream.enqueue(encoder.encode(text)),handled:()=>handled.at(-1),
  close:async()=>{for(const connection of connections)connection.destroy();await rm(directory,{recursive:true,force:true});}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const settled=(promise,ms)=>Promise.race([promise.then(()=>true),new Promise(resolve=>setTimeout(resolve,ms,false))]);
async function receive(chunks,expected){let text='';while(text.length<expected.length){const part=await chunks.next();if(part.done)break;text+=decoder.decode(part.value,{stream:true});}assert.equal(text,expected);return text;}
async function firstEvent(f){const page=await f.open(),first=event({type:'token',text:'First'});f.send(first);return {...page,text:await receive(page.chunks,first)};}
// The page holds the response open but reads nothing more. The bridge relays events while the connection
// still takes them, then waits for drain and leaves the next upstream event unread.
async function blockOnDrain(f){
 const sent=[];
 for(let i=0;i<6;i++){
  const text=event({type:'token',text:String(i).repeat(256*1024)});f.send(text);sent.push(text);
  for(let j=0;j<20&&f.upstream().desiredSize<1;j++)await tick();
  if(f.upstream().desiredSize===0)return sent.join('');
 }
 assert.fail('bridge never waited for drain');
}

test('the conversation stream relays each event once and in order through backpressure, then ends cleanly',async()=>{const f=await fixture('stream');try{
 const {response,chunks,text}=await firstEvent(f);let received=text;
 assert.equal(response.statusCode,200);assert.equal(response.headers['content-type'],'text/event-stream');assert.equal(response.headers['cache-control'],'no-store, no-transform');
 // Each event reaches the page while the upstream is still open.
 const second=event({type:'token',text:'Second'});f.send(second);received+=await receive(chunks,second);
 const held=await blockOnDrain(f);assert.equal(await settled(f.handled(),50),false,'stream still open');
 // The page reads again: drain releases the wait and the held event follows the ones before it.
 received+=await receive(chunks,held);
 const done=event({type:'done',fullText:'Final',agentName:'Fixture'});f.send(done);received+=await receive(chunks,done);
 f.upstream().close();assert.equal((await chunks.next()).done,true,'ended cleanly');
 assert.equal(received,event({type:'token',text:'First'})+second+held+done,'every event once, in order');
 assert.equal(await settled(f.handled(),2000),true);assert.equal(f.signal().aborted,false);assert.deepEqual(f.cancels,[]);assert.equal(f.streams(),1);
}finally{await f.close();}});

for(const [wait,page] of [['read','while the upstream is quiet'],['drain','after it stops reading']])test(`a page that disconnects ${page} still aborts the upstream stream without retry`,async()=>{const f=await fixture('stream');try{
 const {chunks,connection,disconnect}=await firstEvent(f);
 if(wait==='drain')await blockOnDrain(f);
 assert.equal(await settled(f.handled(),50),false,'stream still open');
 disconnect();
 assert.equal(await settled(f.handled(),2000),true,'handler returns');
 assert.equal(f.signal().aborted,true);assert.equal(f.signal().reason.name,'AbortError');
 await assert.rejects(chunks.next());assert.equal(connection.destroyed,true);
 assert.equal(f.streams(),1,'no retry');
}finally{await f.close();}});

for(const [stall,page] of [['idle','whose upstream goes quiet'],['drain','whose connected page stops reading']])test(`the request deadline still ends a conversation stream ${page}`,async()=>{
 // Every bridge deadline is held here, so the test expires the stream request's 120 s one itself.
 const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=ms=>{const controller=new AbortController();deadlines.push({ms,expire:()=>controller.abort(new DOMException('The operation timed out.','TimeoutError'))});return controller.signal;};
 const f=await fixture('stall');try{
  const {chunks,connection}=await firstEvent(f);
  if(stall==='drain')await blockOnDrain(f);
  assert.equal(await settled(f.handled(),50),false,'bridge is waiting');
  deadlines.findLast(deadline=>deadline.ms===120000).expire();
  // The page still reads nothing, so no drain can release a stuck wait: the bridge must return and close the response itself.
  assert.equal(await settled(f.handled(),2000),true,'deadline releases the handler');
  assert.equal(connection.destroyed,true,'response destroyed while the page reads nothing');
  const outcome=await Promise.race([(async()=>{try{for(;;)if((await chunks.next()).done)return 'ended';}catch{return 'truncated';}})(),new Promise(resolve=>setTimeout(resolve,2000,'hung'))]);
  assert.equal(outcome,'truncated');assert.equal(f.signal().reason.name,'TimeoutError');assert.deepEqual(f.cancels.map(reason=>reason?.name),['TimeoutError']);
  assert.equal(f.streams(),1,'no retry');
 }finally{AbortSignal.timeout=timeout;await f.close();}
});

test('the request deadline still ends a conversation stream whose response arrives after it',async()=>{
 // Every bridge deadline is held here. The request answers only after the test expires the 120 s one, so the bridge's
 // abort listener comes after the only abort, and the stalled body never answers a read.
 const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=ms=>{const controller=new AbortController();deadlines.push({ms,expire:()=>controller.abort(new DOMException('The operation timed out.','TimeoutError'))});return controller.signal;};
 const f=await fixture('late');try{
  const opened=f.open();opened.catch(()=>{});
  while(!f.signal())await tick();
  assert.equal(await settled(f.handled(),50),false,'bridge is waiting');
  deadlines.findLast(deadline=>deadline.ms===120000).expire();
  assert.equal(await settled(f.handled(),2000),true,'deadline releases the handler');
  const {response,chunks,connection}=await opened;
  assert.equal(response.statusCode,200);assert.equal(connection.destroyed,true,'response destroyed');
  const outcome=await Promise.race([(async()=>{try{for(;;)if((await chunks.next()).done)return 'ended';}catch{return 'truncated';}})(),new Promise(resolve=>setTimeout(resolve,2000,'hung'))]);
  assert.equal(outcome,'truncated');assert.equal(f.signal().reason.name,'TimeoutError');assert.deepEqual(f.cancels.map(reason=>reason?.name),['TimeoutError']);
  assert.equal(f.streams(),1,'no retry');
 }finally{AbortSignal.timeout=timeout;await f.close();}
});
