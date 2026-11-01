import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:30000});process.exit(child.status??1);}
const {createLocalAgentDevHandler}=await import('../scripts/local-agent-dev-bridge.ts');
const owner=randomUUID(),root='1'.repeat(64),paired='fixture-private-owner';
async function fixture(enabled=true,moderation,direct=false){
 const directory=await mkdtemp(join(tmpdir(),'alpha-cloud-speech-')),tokenFile=join(directory,'token');await writeFile(tokenFile,root,{mode:0o600});
 let mode='ok',signal,upstream,cancelled;const calls=[];
 const request=async(url,input)=>{const path=new URL(url).pathname;calls.push({path,input});
  if(path==='/api/auth/status')return Response.json({instanceId:'fixture'});
  if(path==='/api/auth/pair-code')return Response.json({code:'fixture'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'fixture',identityId:owner});
  assert.equal(input.headers.Authorization,'Bearer '+paired);
  if(path==='/api/auth/me')return Response.json({identity:{id:owner},access:{role:'OWNER'},session:{id:paired,expiresAt:Date.now()+600000}});
  signal=input.signal;if(mode==='wait')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  if(mode==='rotate')await writeFile(tokenFile,'2'.repeat(64),{mode:0o600});
  if(mode==='unauthorized')return Response.json({secret:'never-project-provider-error'},{status:401});
  if(mode==='error')return Response.json({secret:'never-project-provider-error'},{status:402});
  const headers={'server-timing':mode==='timing'?'auth;dur=911, admission;dur=1497, synthesis;dur=195, private;desc=never-project-secret':'','x-eliza-speech-provider':mode==='wrong'?'paradee':'cartesia','x-eliza-speech-route':mode==='route'?'other':direct?'direct':'cloud'};
  if(mode==='missing')delete headers['x-eliza-speech-provider'];
  const receipt=response=>{if(moderation!==undefined){const get=response.headers.get.bind(response.headers);response.headers.get=name=>name.toLowerCase()==='x-eliza-tts-moderation'?moderation:get(name);}return response;};
  if(path==='/api/asr/cloud'){assert.equal(input.headers['X-Eliza-STT-Provider'],'cartesia');return receipt(Response.json({text:'Heard exactly once',secret:'never-project-transcript-metadata'},{headers}));}
  assert.equal(input.headers['X-Eliza-STT-Provider'],undefined);assert.deepEqual(JSON.parse(input.body),{text:'Hello'});
  headers['content-type']=mode==='type'?(direct?'audio/mpeg':'audio/wav'):direct?'audio/wav':'audio/mpeg';if(direct)headers['x-request-id']=input.headers['X-Request-Id'];const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVE',8);// Like fetch, an aborted request errors its body. Stream mode hands the body to the test; a stalled
  // body ignores the request signal, so only the bridge's own cancel (recorded) releases it.
  const streamed=mode==='stream'||mode==='stall'?new ReadableStream({start(controller){upstream=controller;if(mode==='stream')signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});},cancel(reason){cancelled=reason;}}):undefined;
  return receipt(new Response(streamed??(mode==='large'?new Uint8Array(8*1024*1024+1):direct?wav:new Uint8Array([73,68,51,1])),{headers}));
 };
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,request,cloudVoiceEnabled:enabled&&!direct,cartesiaEnabled:enabled&&direct}),server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const open=(input,signal)=>fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({ownerId:owner,headers:{},...input}),signal});
 // Cloud TTS answers binary audio/mpeg; every refusal and every other route answers JSON.
 const call=async(input,signal)=>{const response=await open(input,signal);return {status:response.status,headers:Object.fromEntries(response.headers),...(response.headers.get('content-type')==='audio/mpeg'?{audio:Buffer.from(await response.arrayBuffer())}:{data:await response.json()})};};
 return {call,open,calls,mode:value=>mode=value,signal:()=>signal,upstream:()=>upstream,cancelled:()=>cancelled,connections:()=>new Promise((resolve,reject)=>server.getConnections((error,count)=>error?reject(error):resolve(count))),rotate:()=>writeFile(tokenFile,'2'.repeat(64),{mode:0o600}),close:async()=>{handler.closeVoice();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}};
}
const tts=()=>({path:'/api/tts/cloud',method:'POST',requestId:randomUUID(),body:JSON.stringify({text:'Hello'})});
const asr=()=>({path:'/api/asr/cloud',method:'POST',requestId:randomUUID(),audioBase64:Buffer.from('RIFF fixture WAV').toString('base64')});
test('disabled Cloud speech never enrolls or calls the runtime',async()=>{const f=await fixture(false);try{assert.equal((await f.call(tts())).status,400);assert.equal(f.calls.length,0);}finally{await f.close();}});
test('owner-bound Cloud ASR/TTS project only verified Cartesia speech, not keys or vendor fields',async()=>{const f=await fixture();try{
 const recognition=asr(),heard=await f.call(recognition);assert.equal(heard.status,200);assert.equal(heard.data.status,200);const body=JSON.parse(heard.data.body);assert.equal(body.provider,'cartesia');assert.equal(body.route,'cloud');assert.equal(body.requestId,recognition.requestId);assert.equal(body.secret,undefined);assert.equal(body.text,'Heard exactly once');assert(!JSON.stringify(heard).includes(paired));
 const speech=tts(),spoken=await f.call(speech);assert.equal(spoken.status,200);assert.deepEqual(spoken.audio,Buffer.from([73,68,51,1]));
 assert.deepEqual(Object.fromEntries(Object.entries(spoken.headers).filter(([name])=>name.startsWith('x-')||name==='content-type'||name==='cache-control')),{'content-type':'audio/mpeg','cache-control':'no-store, no-transform','x-content-type-options':'nosniff','x-request-id':speech.requestId,'x-eliza-speech-provider':'cartesia','x-eliza-speech-route':'cloud'});
 assert(!JSON.stringify(spoken.headers).includes(paired));assert(!JSON.stringify(spoken.headers).includes('never-project'));
 assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,1);assert.equal(f.calls.filter(x=>x.path==='/api/asr/cloud').length,1);}finally{await f.close();}});
test('Cloud ASR rejects missing or wrong provider, owner rotation, unauthorized errors and cancellation',async()=>{
 for(const mode of ['missing','wrong','route','rotate','unauthorized','error','wait']){const f=await fixture();try{
  f.mode(mode);const controller=new AbortController(),pending=f.call(asr(),controller.signal);
  if(mode==='wait'){while(!f.signal())await new Promise(r=>setTimeout(r,5));controller.abort();await assert.rejects(pending);for(let i=0;i<50&&!f.signal().aborted;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.signal().aborted,true);}
  else {const response=await pending;assert.notEqual(response.data.status,200);assert(!JSON.stringify(response).includes('Heard exactly once'));}
  assert.equal(f.calls.filter(x=>x.path==='/api/asr/cloud').length,1);
 }finally{await f.close();}}
});
test('wrong owner and unapproved synthesis fields never reach speech dispatch',async()=>{const f=await fixture();try{assert.equal((await f.call({...tts(),ownerId:'other'})).status,409);assert.equal((await f.call({...tts(),body:JSON.stringify({text:'Hi',modelId:'other',apiKey:'no'})})).status,400);assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,0);}finally{await f.close();}});
test('non-Cartesia provider, wrong audio MIME and oversized audio fail closed',async()=>{for(const mode of ['wrong','type','large']){const f=await fixture();try{f.mode(mode);const result=await f.call(tts());assert.notEqual(result.status,200);assert.equal(result.audio,undefined);}finally{await f.close();}}});
test('upstream billing errors are sanitized and root rotation retires the old voice response',async()=>{for(const mode of ['error','rotate']){const f=await fixture();try{f.mode(mode);const result=await f.call(tts());if(mode==='error'){assert.equal(result.data.status,402);assert(!JSON.stringify(result).includes('never-project'));}else assert.equal(result.status,409);}finally{await f.close();}}});
test('Stop aborts the in-flight proxy request without retry',async()=>{const f=await fixture();try{f.mode('wait');const controller=new AbortController(),pending=f.call(tts(),controller.signal);while(!f.signal())await new Promise(r=>setTimeout(r,5));controller.abort();await assert.rejects(pending);for(let i=0;i<50&&!f.signal().aborted;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.signal().aborted,true);assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,1);}finally{await f.close();}});
test('frontend mode requires DEV, test-mock surfaces, non-native platform and explicit flag',async()=>{const source=await readFile(new URL('../apps/app/src/runtime/development-cloud-voice.ts',import.meta.url),'utf8');assert.match(source,/import\.meta\.env\.DEV===true&&import\.meta\.env\.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'&&!Capacitor\.isNativePlatform\(\)&&import\.meta\.env\.VITE_ALPHA_DEV_CLOUD_VOICE==='1'/);const voice=await readFile(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8');assert.match(voice,/native\.transcribeDevelopmentCloudRecording\(input\)/);assert.match(voice,/native\.synthesizeDevelopmentCloud/);assert.doesNotMatch(source,/API_KEY|credentialId|cartesia\.ai/);});

test('actual Cloud driver uses explicit paired gateway with no renderer Cloud account or double transcript send',async()=>{
 const {stripTypeScriptTypes}=await import('node:module'),vm=await import('node:vm');
 const source=(await readFile(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export type','type');
 let agent={session:{ownerId:'fixture-owner',sessionId:'fixture-session'}},uploads=0,synthesis=0,legacy=0,sends=0,release;
 const native={transcribeDevelopmentCloudRecording:async()=>{uploads++;if(release===true)await new Promise(r=>release=r);return {text:'hello',local:false};},synthesizeDevelopmentCloud:async input=>{synthesis++;assert.deepEqual(Object.keys(input).sort(),['requestId','text']);return {playbackId:'owned'};},transcribeRecording:async()=>{legacy++;},synthesize:async()=>{legacy++;}};
 const box={browserCloudResidentEnabled:false,developmentCartesiaVoiceEnabled:false,developmentCloudVoiceEnabled:true,registerPlugin:()=>native,connectionController:{getCloudEnvironment:()=>null,getCloudClient:()=>null,getBrowserSpeechAgent:()=>agent,getSnapshot:()=>({open:false}),subscribe:()=>()=>{},send:()=>sends++},document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},AbortController,DOMException,markTtsPlaybackStarted(){},markTtsPlaybackEnded(){},playOwnedSpeech:async(_native,signal,prepare,current,started,strict)=>{assert.equal(strict,true);signal.throwIfAborted();current();await prepare('request');current();started();}};
 vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'transform'})+';globalThis.create=createCloudVoice;globalThis.failure=cloudVoiceFailure;}',box);
 for(const mode of [true,false])for(const environment of [null,'production']){box.browserCloudResidentEnabled=mode;box.connectionController.getCloudEnvironment=()=>environment;for(const code of ['voice-http-401','voice-http-403'])assert.match(box.failure({code}),mode?/Sign in to Cloud again in Settings/:/developer agent/);}box.browserCloudResidentEnabled=false;box.connectionController.getCloudEnvironment=()=>null;
 const driver=box.create();assert.deepEqual(JSON.parse(JSON.stringify(await driver.transcribeRecording({recordingId:'clip',requestId:'request'}))),{text:'hello',local:false});await driver.speak('reply',new AbortController().signal);assert.equal(uploads,1);assert.equal(synthesis,1);assert.equal(legacy,0);assert.equal(sends,0);
 release=true;const stale=driver.transcribeRecording({recordingId:'clip',requestId:'request'});while(typeof release!=='function')await Promise.resolve();agent={session:{ownerId:'other',sessionId:'other'}};release();await assert.rejects(stale,/Voice agent changed/);
 box.developmentCloudVoiceEnabled=false;assert.throws(()=>box.create(),/Sign in/);box.developmentCloudVoiceEnabled=true;agent=null;assert.throws(()=>box.create(),/developer agent/);
});

test('Cloud bridge forwards numeric timing evidence without arbitrary header descriptions',async()=>{const f=await fixture();try{f.mode('timing');const heard=await f.call(asr()),spoken=await f.call(tts());assert.deepEqual(heard.data.timings,[{name:'auth',durationMs:911},{name:'admission',durationMs:1497},{name:'synthesis',durationMs:195}]);assert.equal(spoken.headers['server-timing'],'auth;dur=911, admission;dur=1497, synthesis;dur=195');assert.ok(!JSON.stringify([heard,spoken.headers]).includes('never-project-secret'));}finally{await f.close();}});

test('Cloud bridge projects only exact reviewed/approved-hit TTS receipts and never adds them to ASR',async()=>{
 for(const receipt of ['reviewed','approved-hit']){const f=await fixture(true,receipt);try{const speech=await f.call(tts());assert.equal(speech.status,200);assert.equal(speech.headers['x-eliza-tts-moderation'],receipt);assert.equal(speech.data,undefined);const recognition=await f.call(asr());assert.equal(recognition.data.status,200);assert.equal(recognition.data.moderationCache,undefined);}finally{await f.close();}}
});
test('Cloud bridge drops invalid oversized and injected moderation evidence without exposing its bytes',async()=>{
 for(const value of ['hit','APPROVED-HIT','approved-hit, reviewed','approved-hit'.repeat(500),'reviewed\r\nX-Secret: never-project-secret']){const f=await fixture(true,value);try{const result=await f.call(tts());assert.equal(result.status,200);assert.equal(result.headers['x-eliza-tts-moderation'],undefined);assert.ok(!JSON.stringify(result.headers).includes('never-project-secret'));}finally{await f.close();}}
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function firstChunk(f,signal){const input=tts(),pending=f.open(input,signal);while(!f.upstream())await tick();f.upstream().enqueue(new Uint8Array([73,68,51]));const response=await pending,reader=response.body.getReader();return {input,response,reader,first:[...(await reader.read()).value]};}
test('Cloud TTS sends the first audio chunk while the upstream body is still open',async()=>{const f=await fixture();try{
 f.mode('stream');const {input,response,reader,first}=await firstChunk(f);
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('x-request-id'),input.requestId);assert.deepEqual(first,[73,68,51]);
 f.upstream().enqueue(new Uint8Array([4,5]));assert.deepEqual([...(await reader.read()).value],[4,5]);
 f.upstream().close();assert.equal((await reader.read()).done,true);assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,1);
}finally{await f.close();}});
test('Cloud TTS upstream failure, oversize or owner rotation after audio started truncates and never ends cleanly',async()=>{for(const fault of ['error','large','rotate']){const f=await fixture();try{
 f.mode('stream');const {reader}=await firstChunk(f);
 if(fault==='error')f.upstream().error(Error('synthetic upstream reset'));
 if(fault==='large')f.upstream().enqueue(new Uint8Array(8*1024*1024));
 if(fault==='rotate'){await f.rotate();f.upstream().enqueue(new Uint8Array([6,6,6]));}
 const later=[];await assert.rejects(async()=>{for(;;){const part=await reader.read();if(part.done)return;later.push(...part.value);}});
 assert.equal(later.length,0,fault);
}finally{await f.close();}}});
test('Stop after audio started aborts the upstream Cloud TTS body without retry',async()=>{const f=await fixture();try{
 f.mode('stream');const controller=new AbortController();await firstChunk(f,controller.signal);controller.abort();
 for(let i=0;i<100&&!f.signal().aborted;i++)await tick();assert.equal(f.signal().aborted,true);assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,1);
}finally{await f.close();}});
for(const [stall,clip] of [['idle','whose upstream goes quiet'],['drain','whose connected page stops reading']])test(`the Cloud TTS deadline still ends a clip ${clip}`,async()=>{
 // Every bridge deadline is held here, so the test expires the speech request's 120 s one itself.
 const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=ms=>{const controller=new AbortController();deadlines.push({ms,expire:()=>controller.abort(new DOMException('The operation timed out.','TimeoutError'))});return controller.signal;};
 const f=await fixture();try{
  f.mode('stall');const {reader}=await firstChunk(f);
  if(stall==='drain'){
   // The page holds the response open but reads nothing more: the bridge takes a chunk larger than
   // the socket buffers, waits for drain, and leaves the next upstream chunk unread.
   f.upstream().enqueue(new Uint8Array(4*1024*1024));for(let i=0;i<200&&f.upstream().desiredSize<1;i++)await tick();assert.equal(f.upstream().desiredSize,1);
   f.upstream().enqueue(new Uint8Array([7]));await new Promise(resolve=>setTimeout(resolve,100));assert.equal(f.upstream().desiredSize,0,'bridge waits for drain');
  }
  deadlines.findLast(deadline=>deadline.ms===120000).expire();
  // The page still reads nothing, so no drain can release a stuck wait: the bridge must close the response itself.
  for(let i=0;i<100&&await f.connections();i++)await tick();assert.equal(await f.connections(),0,'response destroyed while the page reads nothing');
  const outcome=await Promise.race([(async()=>{try{for(;;)if((await reader.read()).done)return 'ended';}catch{return 'truncated';}})(),new Promise(resolve=>setTimeout(resolve,2000,'hung'))]);
  assert.equal(outcome,'truncated');assert.equal(f.signal().reason.name,'TimeoutError');assert.equal(f.cancelled()?.name,'TimeoutError');
  assert.equal(f.calls.filter(x=>x.path==='/api/tts/cloud').length,1);
 }finally{AbortSignal.timeout=timeout;await f.close();}
});
const directTts=()=>({...tts(),path:'/api/v1/voice/session/read-aloud'});
test('direct DEV read-aloud uses exact owner-authenticated runtime endpoint and verified Cartesia WAV',async()=>{const f=await fixture(true,undefined,true);try{const result=await f.call(directTts());assert.equal(result.status,200);assert.equal(result.data.status,200);const value=JSON.parse(result.data.body);assert.equal(value.provider,'cartesia');assert.equal(value.route,'direct');assert.equal(value.contentType,'audio/wav');assert.equal(Buffer.from(value.audioBase64,'base64').toString('ascii',0,4),'RIFF');assert.equal(f.calls.filter(x=>x.path==='/api/v1/voice/session/read-aloud').length,1);assert.equal((await f.call(tts())).status,400);assert(!JSON.stringify(result).includes(paired));}finally{await f.close();}});
test('direct DEV route rejects disabled mode, wrong owner, provider, route and MIME without Cloud fallback',async()=>{
 {const f=await fixture(false,undefined,true);try{assert.equal((await f.call(directTts())).status,400);assert.equal(f.calls.length,0);}finally{await f.close();}}
 for(const mode of ['wrong','route','type','rotate']){const f=await fixture(true,undefined,true);try{f.mode(mode);assert.notEqual((await f.call(directTts())).status,200);}finally{await f.close();}}
 {const f=await fixture(true,undefined,true);try{assert.equal((await f.call({...directTts(),ownerId:'other'})).status,409);assert.equal(f.calls.filter(x=>x.path==='/api/v1/voice/session/read-aloud').length,0);}finally{await f.close();}}
});
test('direct DEV Stop aborts the owned runtime synthesis without retry',async()=>{const f=await fixture(true,undefined,true);try{f.mode('wait');const c=new AbortController(),p=f.call(directTts(),c.signal);while(!f.signal())await new Promise(r=>setTimeout(r,5));c.abort();await assert.rejects(p);for(let i=0;i<50&&!f.signal().aborted;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.signal().aborted,true);assert.equal(f.calls.filter(x=>x.path==='/api/v1/voice/session/read-aloud').length,1);}finally{await f.close();}});
