import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual shared client and microphone implementation; only the sensor, audio
// graph and server are synthetic. No microphone, provider or network is used.
const root=resolve('.eliza/client-features'),entry=resolve(root,'packages/ui/src/voice/voice-session-client-core.ts');
const bundle=buildSync({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022',define:{'import.meta.url':JSON.stringify(pathToFileURL(entry).href)},alias:{'@elizaos/host/voice/ui-context':resolve(root,'packages/host/src/voice/ui-context.ts'),'@elizaos/core/view-interaction':resolve(root,'packages/core/src/view-interaction.ts'),'@elizaos/core/logging':resolve(root,'packages/core/src/logging.ts'),'@elizaos/voice/turn':resolve(root,'packages/voice/src/turn.ts'),'@elizaos/core/speech':resolve(root,'packages/core/src/speech.ts')}}).outputFiles[0].text;
const module={exports:{}};new Function('module','exports',bundle)(module,module.exports);
const {createVoiceSessionClient}=module.exports;
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
function fixture(throwOnError=false){
 const errors=[],sockets=[];let mints=0,trackStops=0;
 class Socket{
  readyState=0;binaryType='arraybuffer';listeners=new Map();
  constructor(){sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
  addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)||[]),listener]);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==listener));}
  emit(type,event){for(const listener of this.listeners.get(type)||[])listener(event);}
  send(data){if(typeof data==='string'&&JSON.parse(data).t==='hello')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({t:'ready',sessionId:'session-1',traceId:'ready-1',playbackCompletion:false,uiContext:false})}));}
  close(){if(this.readyState!==3){this.readyState=3;this.emit('close',{});}}
 }
 const trackListeners=new Map(),track={enabled:true,readyState:'live',getSettings:()=>({}),addEventListener:(type,callback)=>trackListeners.set(type,callback),removeEventListener:type=>trackListeners.delete(type),stop(){this.readyState='ended';trackStops++;},end(){this.readyState='ended';trackListeners.get('ended')?.();}};
 const graph=()=>{const listeners=new Map(),node={connect(){return this;},disconnect(){}};return{sampleRate:16000,state:'running',destination:node,createMediaStreamSource:()=>node,createScriptProcessor:()=>({...node,onaudioprocess:null}),async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';listeners.get('statechange')?.();},addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener:type=>listeners.delete(type),fail(){this.state='closed';listeners.get('statechange')?.();}};};
 const microphone=graph();
 const client=createVoiceSessionClient({agentId:'fixture-agent',conversationId:'fixture-conversation',getConsentNonce:async()=> 'one-use-consent',fetch:async()=>{mints++;return Response.json({sessionId:'session-1',token:'one-use-token',wsUrl:'ws://fixture.invalid/voice',expiresAt:Date.now()+60000,uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']}});},webSocketFactory:()=>new Socket(),getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),createMicAudioContext:()=>microphone,createPlaybackAudioContext:graph,preLiveMaxReconnects:0,preLiveMaxAttempts:1,onError:error=>{errors.push(error);if(throwOnError)throw Error('UI observer failed');}});
 return{client,track,microphone,sockets,errors,get mints(){return mints;},get trackStops(){return trackStops;}};
}
for(const reason of ['track ended','audio graph closed','throwing error observer'])test(`fatal capture retires the actual voice client: ${reason}`,async()=>{
 const h=fixture(reason==='throwing error observer');
 try{
  await h.client.start();await flush();assert.equal(h.track.readyState,'live');assert.equal(h.sockets[0].readyState,1);
  if(reason==='throwing error observer')assert.throws(()=>h.track.end(),/UI observer failed/);
  else if(reason==='track ended')h.track.end();else h.microphone.fail();
  await flush();assert.equal(h.track.readyState,'ended');assert.equal(h.sockets[0].readyState,3);assert.equal(h.client.state.phase,'idle');assert.equal(h.mints,1);assert.equal(h.errors.length,1);assert.equal(h.trackStops,1);
  h.track.end();await flush();assert.equal(h.errors.length,1,'the retired capture cannot report a second failure');
 }finally{await h.client.stop();}
});
