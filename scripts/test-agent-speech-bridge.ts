import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {speechBridgeFixture} from './fixtures/speech-bridge.ts';

let calls = 0, waiting = false;
let received: Buffer | undefined, closed: () => void;
const disconnected = new Promise<void>(resolve => { closed = resolve; });
const {invoke, token, close} = await speechBridgeFixture((req, res, bytes) => {
 calls++;
 if (waiting) {
  res.on('close', closed);
  return;
 }
 let body;
 if ((req.url ?? '').endsWith('/status')) {
  assert.equal(req.method, 'GET');
  body = {ready: true};
 } else {
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['content-type'], 'audio/wav');
  received = bytes;
  body = {text: 'fixture', requestId: req.headers['x-request-id'], local: true};
 }
 res.writeHead(200, {'Content-Type': 'application/json'});
 res.end(JSON.stringify(body));
});
const bytes=Buffer.from([0,255,128,0,1,2,3]),requestId=randomUUID();
const input={path:'/api/asr/libelizainference',method:'POST',ownerId:'owner',requestId,audioBase64:bytes.toString('base64')};
try{
 const response=await invoke(input);assert.equal(response.status,200);const envelope=await response.json();assert.equal(envelope.status,200);assert.equal(JSON.parse(envelope.body).requestId,requestId);assert.deepEqual(received,bytes);assert.ok(!JSON.stringify(envelope).includes(token));
 assert.equal((await invoke({path:'/api/asr/libelizainference/status',method:'GET',ownerId:'owner'})).status,200);
 const before=calls;
 for(const patch of [{ownerId:undefined},{method:'GET'},{audioBase64:'a==='},{audioBase64:'Zh=='},{audioBase64:''},{requestId:'invalid'},{body:'{}'},{stream:true},{path:'/api/asr/libelizainference/other'},{path:'/api/asr/whisper'},{path:'/api/conversations'}])assert.equal((await invoke({...input,...patch})).status,400);
 assert.equal((await invoke({...input,ownerId:'another'})).status,409);
 assert.equal((await invoke(input,undefined,'https://other.test')).status,403);
 assert.equal((await invoke({...input,path:'/api/asr/libelizainference/status',method:'GET'})).status,400);
 assert.equal((await invoke({...input,audioBase64:Buffer.alloc(2*1024*1024+1).toString('base64')})).status,400);
 assert.equal(calls,before,'Invalid requests must not dispatch audio');
 // A maximal legal payload retains its bytes through the JSON envelope.
 const maximum=Buffer.alloc(2*1024*1024,128);assert.equal((await invoke({...input,audioBase64:maximum.toString('base64')})).status,200);assert.deepEqual(received,maximum);
 waiting=true;const controller=new AbortController();const pending=invoke(input,controller.signal);
 const deadline=Date.now()+3000;while(calls===before+1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(calls,before+2);controller.abort();await assert.rejects(pending,error => error instanceof Error && error.name === 'AbortError');
 await Promise.race([disconnected,new Promise((_,reject)=>setTimeout(()=>reject(Error('Upstream audio request not cancelled')),3000).unref())]);
 console.log('Speech bridge: exact bytes, owner binding, request validation, limits and cancellation passed');
} finally { await close(); }
