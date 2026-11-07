// The actual native stream adapter and local reply reader over a synthetic Capacitor port with
// mocked timers. No device or agent: this proves the renderer's deadlines and refusal handling.
import test,{mock} from 'node:test';import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{streamNativeAgent},{LocalAgentProtocol}]=await loadBrowserModule(['apps/app/src/runtime/local-agent-native-stream.ts','apps/app/src/runtime/local-agent.ts']);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const sse=value=>typeof value==='string'?value:`data: ${JSON.stringify(value)}\n\n`;
function fixture(){
 let listener,streamId;const cancels=[];
 const port={
  async addListener(name,callback){assert.equal(name,'alphaAgentStream');listener=callback;return {remove:async()=>{}};},
  async requestStream(input){streamId=input.streamId;return {streamId};},
  async cancelStream(input){cancels.push(input.streamId);},
 };
 const emit=event=>listener({streamId,event});
 return {port,cancels,
  respond:()=>emit({type:'response',status:200,headers:{'content-type':'text/event-stream'}}),
  chunk:value=>emit({type:'chunk',dataBase64:Buffer.from(sse(value)).toString('base64')}),
  complete:()=>emit({type:'complete'}),
  open:()=>{const settled={done:false};const work=streamNativeAgent(port,{path:'/api/conversations/room/messages/stream',ownerId:'owner',headers:{},body:'{}'},new AbortController().signal,()=>{});void work.then(()=>{settled.done=true;},()=>{settled.done=true;});return {work,settled};},
 };
}

test('heartbeats every 5 s keep a 150 s turn streaming',async t=>{
 mock.timers.enable({apis:['setTimeout']});t.after(()=>mock.timers.reset());
 const f=fixture(),{work,settled}=f.open();await flush();f.respond();await flush();
 for(let second=5;second<=150;second+=5){mock.timers.tick(5000);f.chunk(': heartbeat\n\n');await flush();}
 assert.equal(settled.done,false,'heartbeats keep the stream open past the old 120 s limit');
 f.chunk({type:'done',fullText:'Long reply',agentName:'Agent'});f.complete();
 assert.equal((await work).text,'Long reply');
});

test('61 s of silence ends the stream with an unknown outcome',async t=>{
 mock.timers.enable({apis:['setTimeout']});t.after(()=>mock.timers.reset());
 const f=fixture(),{work,settled}=f.open();await flush();f.respond();await flush();
 mock.timers.tick(59000);await flush();assert.equal(settled.done,false);
 mock.timers.tick(2000);
 await assert.rejects(work,/Outcome unknown/);assert.equal(f.cancels.length>0,true,'the native stream is closed');
});

test('the 600 s turn budget bounds a stream that only sends heartbeats',async t=>{
 mock.timers.enable({apis:['setTimeout']});t.after(()=>mock.timers.reset());
 const f=fixture(),{work,settled}=f.open();await flush();f.respond();await flush();
 for(let second=5;second<600;second+=5){mock.timers.tick(5000);f.chunk(': heartbeat\n\n');await flush();}
 assert.equal(settled.done,false);
 mock.timers.tick(5000);
 await assert.rejects(work,/Outcome unknown/);
});

test('a room_busy error frame is a refusal before dispatch',async()=>{
 const f=fixture(),{work}=f.open();await flush();f.respond();await flush();
 f.chunk({type:'error',code:'room_busy',message:'Conversation is busy; retry after the pending turns finish'});
 await assert.rejects(work,error=>error.beforeDispatch===true&&error.status===429);
});

const session={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://device.alpha.invalid'};
test('a 429 from the recovery POST is a refusal before dispatch',async()=>{
 const paths=[];
 const local=new LocalAgentProtocol({start:async()=>{},request:async input=>{paths.push(input.path);return {status:429,body:JSON.stringify({error:'Conversation is busy; retry after the pending turns finish'})};},stream:async()=>{throw Error('Response interrupted. Outcome unknown; check history before retrying.');}});local.session=session;
 await assert.rejects(local.send('room','Hello',{clientMessageId:'client-1',onText(){}}),error=>error.status===429&&error.beforeDispatch===true);
 assert.deepEqual(paths,['/api/conversations/room/messages']);
});

test('other recovery failures keep the unknown outcome',async()=>{
 const local=new LocalAgentProtocol({start:async()=>{},request:async()=>({status:503,body:'{}'}),stream:async()=>{throw Error('Response interrupted. Outcome unknown; check history before retrying.');}});local.session=session;
 await assert.rejects(local.send('room','Hello',{clientMessageId:'client-1',onText(){}}),error=>error.status===503&&!('beforeDispatch' in error));
});
