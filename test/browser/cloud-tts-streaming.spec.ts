import {test,expect,type Page} from '@playwright/test';
import {createServer} from 'vite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalAgentDevHandler} from '../../scripts/local-agent-dev-bridge';

// Closed fixture: the real development bridge and renderer against a fake paired agent whose Cloud
// read-aloud body the test releases chunk by chunk. No Cloud account, provider or audio device.
const owner='11111111-1111-4111-8111-111111111111',paired='closed-owner-session';
// MPEG-1 Layer III, 32 kbit/s, 32 kHz, mono: 144-byte frames, each 36 ms of silence.
function mp3(frames:number){const out=new Uint8Array(frames*144);for(let i=0;i<frames;i++)out.set([0xff,0xfb,0x18,0xc0],i*144);return out;}
type Host={requests:number;refuse:boolean;upstream?:ReadableStreamDefaultController<Uint8Array>;signal?:AbortSignal};
type Proof={outcome:string|null;events:string[];firstAudioMs?:number;speak():void;stop():void;prepare():Promise<string>;play(playbackId:string):Promise<string>;hide(hidden:boolean):void;state():Promise<{playing:boolean;positionMs:number}>;gate():boolean};

async function start(page:Page,options:{mediaSource:boolean}={mediaSource:true}){
 const directory=await mkdtemp(join(tmpdir(),'alpha-tts-stream-')),tokenFile=join(directory,'owner-token'),host:Host={requests:0,refuse:false};
 await writeFile(tokenFile,'1'.repeat(64),{mode:0o600});
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,cloudVoiceEnabled:true,request:async(url,input={})=>{
  const path=new URL(String(url)).pathname;
  if(path==='/api/auth/status')return Response.json({instanceId:'closed-resident'});
  if(path==='/api/auth/pair-code')return Response.json({code:'closed-pair'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'closed-resident',identityId:owner});
  if(path==='/api/auth/me')return Response.json({identity:{id:owner,kind:'owner'},access:{role:'OWNER',mode:'local'},session:{id:paired,expiresAt:Date.now()+600000}});
  if(path==='/api/agents')return Response.json({agents:[{id:'closed-agent',status:'running'}]});
  expect(path).toBe('/api/tts/cloud');host.requests++;host.upstream=undefined;
  if(host.refuse)return Response.json({secret:'never-project-provider-error'},{status:402});
  const signal=host.signal=input.signal!;
  // Like fetch, an aborted request errors its body. The test owns every chunk and the end.
  return new Response(new ReadableStream<Uint8Array>({start(controller){host.upstream=controller;signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),
   {headers:{'Content-Type':'audio/mpeg','X-Eliza-Speech-Provider':'cartesia','X-Eliza-Speech-Route':'cloud'}});
 }});
 const server=await createServer({configFile:resolve('vite.config.ts'),cacheDir:resolve('test-results/cloud-tts-streaming/vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify(''),'import.meta.env.VITE_ALPHA_CLOUD_RESIDENT':JSON.stringify('1'),'import.meta.env.VITE_LOCAL_AGENT':JSON.stringify('1'),'import.meta.env.VITE_ELIZA_RUNTIME_PROFILE':JSON.stringify('cloud')},plugins:[{name:'closed-streamed-cloud-speech',enforce:'pre',configureServer(server){server.middlewares.use('/__alpha-local-agent',(req,res)=>{void handler(req,res);});server.middlewares.use('/__alpha-browser-cloud',async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);const data=JSON.parse(Buffer.concat(parts).toString());res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data.operation==='secureRead'?{value:null}:{state:'host-managed'}));});}}]});
 const foreign:string[]=[];await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,async route=>{foreign.push(route.request().url());await route.abort();});
 if(!options.mediaSource)await page.addInitScript(()=>{Object.defineProperty(window,'MediaSource',{configurable:true,value:undefined});});
 const cleanup=async()=>{handler.closeVoice();await server.close();await rm(directory,{recursive:true,force:true});};
 try{
  await server.listen();await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}/`);
  await page.evaluate(async activity=>{
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{LocalAgentProtocol}=await import('/src/runtime/local-agent.ts'),{bindBrowserSpeechConnection}=await import('/src/browser/agent-speech.ts');
   const agent=new LocalAgentProtocol();await agent.connect(new AbortController().signal);c.getBrowserSpeechAgent=()=>agent;c.getCloudEnvironment=()=>'production';const binding={sessionId:'closed-cloud-session',credentialId:'closed-cloud-generation'} as any;c.getCloudClient=()=>binding;const snapshot={...c.getSnapshot(),open:false};c.getSnapshot=()=>snapshot;bindBrowserSpeechConnection(c);
   const {createCloudVoice}=await import('/src/runtime/cloud-voice.ts'),{registerPlugin}=await import('/src/platform-plugins.ts'),markers=await import(/* @vite-ignore */ activity);
   const voice=registerPlugin<any>('AlphaVoiceCloud');let controller:AbortController|undefined,speakAt=0;
   const proof:Proof=(window as any).ttsStream={outcome:null,events:[],
    // The voice conversation's speaker: no onStarted, so it marks half-duplex playback itself.
    speak(){controller=new AbortController();proof.outcome=null;proof.events=[];proof.firstAudioMs=undefined;speakAt=performance.now();createCloudVoice().speak('Streaming speech test.',controller.signal).then(()=>{proof.outcome='finished';},(error:Error)=>{proof.outcome=error.name==='AbortError'?'stopped':'failed: '+error.message;});},
    stop(){controller?.abort();},
    // A clip prepared for later and played by id, as the read-aloud queue does.
    prepare:()=>voice.synthesizeDevelopmentCloud({text:'Prepared speech test.',requestId:crypto.randomUUID()}).then(({playbackId}:{playbackId:string})=>playbackId),
    play:playbackId=>voice.play({playbackId}).then(()=>'played',(error:Error)=>error.message),
    hide(hidden){Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});if(hidden)document.dispatchEvent(new Event('visibilitychange'));},
    state:()=>voice.state(),gate:()=>markers.isTtsEchoGateActive(performance.now(),-1)};
   const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.addEventListener('playing',()=>{proof.firstAudioMs??=Math.round(performance.now()-speakAt);},{once:true});return play.call(this);};
   for(const event of ['playbackEnded','playbackFailed','playbackStopped'])await voice.addListener(event,()=>proof.events.push(event));
  },'/@fs'+resolve('.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts'));
 }catch(error){await cleanup();throw error;}
 const proof=<T,>(read:(value:Proof)=>T|Promise<T>)=>page.evaluate(`(${read.toString()})(window.ttsStream)`) as Promise<T>;
 const audible=()=>proof(async value=>{const state=await value.state();return state.playing&&state.positionMs>100;});
 return {host,foreign,proof,audible,cleanup};
}
/** Starts the voice conversation's speaker on a fresh fixture request and waits for the agent to receive it. */
async function speak(page:Page,host:Host,body=true){host.upstream=undefined;host.signal=undefined;const requests=host.requests;await page.evaluate(()=>(window as any).ttsStream.speak());await expect.poll(()=>host.requests).toBe(requests+1);if(body)await expect.poll(()=>host.upstream!==undefined).toBe(true);}

test('Cloud read-aloud plays its first frames before the agent finishes sending the clip',async({page},info)=>{
 const f=await start(page);
 try{
  expect(await page.evaluate(()=>MediaSource.isTypeSupported('audio/mpeg'))).toBe(true);
  await speak(page,f.host);
  f.host.upstream!.enqueue(mp3(28));
  // Audible and advancing while the body is still open: nothing below has ended it.
  await expect.poll(f.audible,{timeout:10000}).toBe(true);
  expect(await f.proof(value=>value.outcome)).toBeNull();
  expect(await f.proof(value=>value.gate())).toBe(true);
  const firstAudioMs=await f.proof(value=>value.firstAudioMs);
  f.host.upstream!.enqueue(mp3(14));f.host.upstream!.close();
  await expect.poll(()=>f.proof(value=>value.outcome),{timeout:15000}).toBe('finished');
  expect(await f.proof(value=>value.events)).toEqual(['playbackEnded']);
  expect(await f.proof(value=>value.gate())).toBe(false);
  expect(f.host.requests).toBe(1);expect(f.foreign).toEqual([]);
  await info.attach('streamed-first-audio',{body:JSON.stringify({firstAudioMs,bodyOpen:true}),contentType:'application/json'});
 }finally{await f.cleanup();}
});

test('Stop aborts the Cloud read-aloud download and its playback, before and after the first frames',async({page})=>{
 const f=await start(page);
 try{
  // Before any audio: the request itself is aborted.
  await speak(page,f.host);
  await page.evaluate(()=>(window as any).ttsStream.stop());
  await expect.poll(()=>f.proof(value=>value.outcome)).toBe('stopped');
  await expect.poll(()=>f.host.signal?.aborted).toBe(true);
  // While playing: the playback stops and the bridge aborts the agent's body.
  await speak(page,f.host);
  expect(f.host.signal?.aborted).toBe(false);
  f.host.upstream!.enqueue(mp3(28));
  await expect.poll(f.audible,{timeout:10000}).toBe(true);
  await page.evaluate(()=>(window as any).ttsStream.stop());
  await expect.poll(()=>f.proof(value=>value.outcome)).toBe('stopped');
  await expect.poll(()=>f.host.signal?.aborted,{timeout:5000}).toBe(true);
  expect(await f.proof(async value=>(await value.state()).playing)).toBe(false);
  expect(await f.proof(value=>value.events)).toEqual(['playbackStopped']);
  expect(await f.proof(value=>value.gate())).toBe(false);
  expect(f.host.requests).toBe(2);
 }finally{await f.cleanup();}
});

test('without MediaSource the clip is buffered whole and played after its last byte',async({page},info)=>{
 const f=await start(page,{mediaSource:false});
 try{
  await speak(page,f.host);
  f.host.upstream!.enqueue(mp3(28));
  await page.waitForTimeout(750);
  expect(await f.proof(async value=>(await value.state()).playing)).toBe(false);
  expect(await f.proof(value=>value.firstAudioMs)).toBeUndefined();
  f.host.upstream!.enqueue(mp3(14));f.host.upstream!.close();
  await expect.poll(()=>f.proof(value=>value.outcome),{timeout:15000}).toBe('finished');
  expect(await f.proof(value=>value.events)).toEqual(['playbackEnded']);
  await info.attach('buffered-first-audio',{body:JSON.stringify({firstAudioMs:await f.proof(value=>value.firstAudioMs),heldMs:750}),contentType:'application/json'});
 }finally{await f.cleanup();}
});

test('a clip cut off after playback started fails instead of finishing, and refusals stay errors',async({page})=>{
 const f=await start(page);
 try{
  await speak(page,f.host);
  f.host.upstream!.enqueue(mp3(28));
  await expect.poll(f.audible,{timeout:10000}).toBe(true);
  f.host.upstream!.error(Error('synthetic upstream reset'));
  await expect.poll(()=>f.proof(value=>value.outcome),{timeout:10000}).toMatch(/^failed: /);
  expect(await f.proof(value=>value.events)).toEqual(['playbackFailed']);
  expect(await f.proof(async value=>(await value.state()).playing)).toBe(false);
  expect(await f.proof(value=>value.gate())).toBe(false);
  // A billing refusal before any audio is the sanitized HTTP error, with no playback at all.
  f.host.refuse=true;await speak(page,f.host,false);
  await expect.poll(()=>f.proof(value=>value.outcome)).toBe('failed: Cloud speech unavailable (HTTP 402).');
  expect(await f.proof(value=>value.events)).toEqual([]);
  expect(JSON.stringify(await f.proof(value=>value))).not.toContain('never-project');
 }finally{await f.cleanup();}
});

test('a clip prepared before play stops downloading when the page is hidden, and never plays',async({page})=>{
 const f=await start(page);
 try{
  // Headers, and so the playback id, arrive with the first chunk; the rest of the body stays open.
  const prepared=f.proof(value=>value.prepare());
  await expect.poll(()=>f.host.upstream!==undefined).toBe(true);
  f.host.upstream!.enqueue(mp3(28));const playbackId=await prepared;
  expect(f.host.signal?.aborted).toBe(false);
  await f.proof(value=>value.hide(true));
  await expect.poll(()=>f.host.signal?.aborted,{timeout:5000}).toBe(true);
  await f.proof(value=>value.hide(false));
  expect(await page.evaluate(id=>(window as any).ttsStream.play(id),playbackId)).toBe('Prepare speech first.');
  expect(await f.proof(async value=>(await value.state()).playing)).toBe(false);
  expect(f.host.requests).toBe(1);expect(f.foreign).toEqual([]);
 }finally{await f.cleanup();}
});

test('an element that lets its MediaSource go stops the streamed download and releases its URL',async({page})=>{
 const f=await start(page);
 try{
  const result=await page.evaluate(async frames=>{
   const {StreamedSpeech,streamedSpeechSource}=await import('/src/browser/streamed-speech.ts');
   let cancelled:unknown;const body=new ReadableStream<Uint8Array<ArrayBuffer>>({start(controller){controller.enqueue(new Uint8Array(frames));},cancel(reason){cancelled=reason;}});
   const revoked:string[]=[],revoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{revoked.push(url);revoke(url);};
   try{
    const {url,fed}=streamedSpeechSource(new StreamedSpeech(body),new AbortController().signal),audio=new Audio(url);
    // Attached and fed its first chunk while the rest of the clip downloads, then the source is reset.
    await new Promise(resolve=>audio.addEventListener('loadedmetadata',resolve,{once:true}));
    audio.removeAttribute('src');audio.load();
    const outcome=await Promise.race([fed.then(()=>'fed',(error:Error)=>'failed: '+error.message),new Promise(resolve=>setTimeout(resolve,3000,'pending'))]);
    return {outcome,cancelled:cancelled instanceof Error?cancelled.message:String(cancelled),revoked:revoked.includes(url)};
   }finally{URL.revokeObjectURL=revoke;}
  },[...mp3(28)]);
  expect(result).toEqual({outcome:'failed: Speech audio could not be played.',cancelled:'Speech audio could not be played.',revoked:true});
 }finally{await f.cleanup();}
});
