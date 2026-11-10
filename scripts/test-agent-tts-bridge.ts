import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {speechBridgeFixture} from './fixtures/speech-bridge.ts';

const wav = Buffer.alloc(46);
wav.write('RIFF');
wav.writeUInt32LE(38, 4);
wav.write('WAVE', 8);
let calls = 0, mode = 'ok';
let closed: () => void;
const disconnected = new Promise<void>(resolve => { closed = resolve; });
const {invoke, token, close} = await speechBridgeFixture((req, res, bytes) => {
 calls++;
 if ((req.url ?? '').endsWith('/status')) {
  assert.equal(req.method, 'GET');
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({ready: true, provider: 'libelizainference-paradee'}));
  return;
 }
 assert.equal(req.method, 'POST');
 assert.equal(req.headers['content-type'], 'application/json');
 assert.deepEqual(JSON.parse(bytes.toString('utf8')), {text: 'Synthetic speech'});
 if (mode === 'held') {
  res.on('close', closed);
  return;
 }
 res.writeHead(200, {
  'Content-Type': mode === 'type' ? 'text/plain' : 'audio/wav',
  'X-Request-Id': mode === 'id' ? randomUUID() : req.headers['x-request-id'],
  'X-Eliza-Speech-Provider': mode === 'provider' ? 'other' : 'libelizainference-paradee',
 });
 res.end(mode === 'oversized' ? Buffer.alloc(1440045) : mode === 'invalid' ? Buffer.from('invalid WAV') : wav);
});
const input={path:'/api/tts/paradee',method:'POST',ownerId:'owner',requestId:randomUUID(),body:JSON.stringify({text:'Synthetic speech'})};
try{
 const response=await invoke(input);assert.equal(response.status,200);const envelope=await response.json();assert.equal(envelope.status,200);const result=JSON.parse(envelope.body);assert.deepEqual(Buffer.from(result.audioBase64,'base64'),wav);assert.equal(result.requestId,input.requestId);assert.equal(result.provider,'libelizainference-paradee');assert.ok(!JSON.stringify(envelope).includes(token));
 assert.equal((await invoke({path:'/api/tts/paradee/status',method:'GET',ownerId:'owner'})).status,200);
 const before=calls;
 for(const patch of [{ownerId:undefined},{requestId:'bad'},{method:'GET'},{body:'{'},{body:JSON.stringify({text:'x'.repeat(501)})},{body:JSON.stringify({text:'Synthetic speech',voice:'other'})},{audioBase64:'AAAA'},{stream:true},{path:'/api/tts/paradee/other'},{path:'/api/tts/kokoro'}])assert.equal((await invoke({...input,...patch})).status,400);
 assert.equal((await invoke({...input,ownerId:'other-owner'})).status,409);assert.equal(calls,before);
 for(const bad of ['id','type','provider','invalid','oversized']){mode=bad;const result=await invoke(input);assert.equal(result.status,bad==='oversized'?503:502,bad);assert.ok(!(await result.text()).includes('audioBase64'));}
 mode='held';const controller=new AbortController(),prior=calls,pending=invoke(input,controller.signal);
 for(let i=0;i<300&&calls===prior;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,prior+1);controller.abort();await assert.rejects(pending,error => error instanceof Error && error.name === 'AbortError');await Promise.race([disconnected,new Promise((_,reject)=>setTimeout(()=>reject(Error('Upstream synthesis was not cancelled')),3000).unref())]);
 console.log('TTS bridge: exact audio, session ownership, validation, output bounds and cancellation passed');
} finally { await close(); }
