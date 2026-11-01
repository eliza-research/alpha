import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
// The real BrowserVoice and speech errors, with only their imports replaced by synthetic ports.
// Every agent or Cloud speech call is held until the test settles it and rejects on its own signal,
// as fetch does; zero network, audio, IndexedDB or agent I/O.
const load=(file,names)=>stripTypeScriptTypes(readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env.DEV','true'),{mode:'transform'})+`;return {${names}};`;
const {speechError,speechCancelled}=new Function(load('apps/app/src/browser/speech-errors.ts','speechError,speechCancelled:typeof speechCancelled==="function"?speechCancelled:undefined'))();
// voice.ts carries the real streamed clip and support check; only MediaSource is a stand-in that accepts audio/mpeg.
const voiceCode=load('apps/app/src/browser/voice.ts','BrowserVoice');
const idle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));};
function harness(){
 const window=new EventTarget(),document=new EventTarget(),warnings=[],held=[],bodies=[];let hidden=false;
 Object.defineProperty(document,'hidden',{get:()=>hidden});
 const hold=(kind,signal,value)=>new Promise((resolve,reject)=>{held.push({kind,signal,settle:()=>resolve(value)});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 // Cloud read-aloud: the first chunk arrives and the rest of the body stays open; it records its cancellation.
 const clip=()=>{const body={};bodies.push(body);return new ReadableStream({start(controller){controller.enqueue(new Uint8Array([73,68,51]));},cancel(reason){body.cancelled=reason;}});};
 const agent={session:{sessionId:'agent'},synthesizeSpeech:(_text,signal)=>hold('tts',signal,new Blob(['x'],{type:'audio/wav'})),developmentCloudSpeech:(_input,signal)=>hold('tts',signal,clip())};
 const connection={getSnapshot:()=>({kind:'ready',session:{sessionId:'session'}}),getCloudEnvironment:()=>'env',getCloudClient:()=>({sessionId:'cloud',credentialId:'cred'}),subscribe:()=>()=>{},getBrowserSpeechAgent:()=>agent};
 const cloud=(_input,kind,_body,signal)=>hold(kind,signal,kind==='stt'?{json:async()=>({local:false,text:'hello'})}:{blob:async()=>new Blob(['x'],{type:'audio/mpeg'})});
 class WebPlugin{notifyListeners(){return Promise.resolve();}}
 class BrowserAudioCapture{get(){return {blob:new Blob(['pcm'])};}cancel(){}clear(){}}
 const unexpected=()=>{throw Error('Unexpected dependency');};
 const {BrowserVoice}=new Function('browserLocalSpeechStatus','transcribeWithSelectedBrowserAgent','devSurfacesEnabled','browserCloudVoice','browserCloudCredential','connectionController','recordingPcmWav','browserMediaVolume','audioRecord','audioMetadata','retainAudio','changeAudioDeleted','audioDeletionStatus','migrateAudio','purgeAudio','speechError','speechCancelled','BrowserAudioCapture','WebPlugin','MediaSource','window','document','console','BroadcastChannel',voiceCode)(
  (_agent,signal)=>hold('status',signal,{ready:true,playback:true,execution:'browser',route:'local-agent'}),(_agent,_wav,signal)=>hold('stt',signal,{text:'local',local:true}),true,cloud,unexpected,connection,async()=>new Blob(),()=>1,unexpected,unexpected,unexpected,unexpected,unexpected,async()=>{},unexpected,speechError,speechCancelled,BrowserAudioCapture,WebPlugin,{isTypeSupported:type=>type==='audio/mpeg'},window,document,{warn:(...args)=>warnings.push(args)},undefined);
 return {voice:new BrowserVoice(),held,bodies,warnings,window,hide(){hidden=true;document.dispatchEvent(new Event('visibilitychange'));},show(){hidden=false;}};
}
const stt=(h,requestId='stt')=>h.voice.transcribeRecording({recordingId:'clip',requestId,environment:'env',credentialId:'cred'});
const tts=(h,requestId='tts')=>h.voice.synthesizeLocal({text:'Hello there.',requestId});
const cancelledBy=(kind,reason)=>error=>error?.name==='AbortError'&&error.speechKind===kind&&error.cancelReason===reason;
const globalCancels=[[g=>g.voice.cancel(),'stopped'],[g=>g.voice.releaseLocalSpeech(),'released'],[g=>g.hide(),'hidden'],[g=>g.window.dispatchEvent(new Event('pagehide')),'pagehide'],[g=>g.window.dispatchEvent(new Event('alpha:device-state')),'device-state']];

test('a readiness check never cancels an in-flight transcription or synthesis',async()=>{
 const h=harness(),heard=stt(h);await idle();const spoken=tts(h);await idle();const status=h.voice.localSpeechStatus();await idle();
 assert.deepEqual(h.held.map(r=>[r.kind,r.signal.aborted]),[['stt',false],['tts',false],['status',false]]);
 for(const request of h.held)request.settle();
 assert.deepEqual(await heard,{text:'hello',local:false});assert.equal(typeof (await spoken).playbackId,'string');assert.equal((await status).ready,true);
 assert.deepEqual(h.warnings,[]);
});
test('a readiness check in flight does not make queued speech busy; an in-flight transcription still does',async()=>{
 const h=harness(),status=h.voice.localSpeechStatus();await idle();
 const queued=h.voice.synthesize({text:'Queued.',requestId:'queued',environment:'env',credentialId:'cred',replace:false});await idle();
 assert.deepEqual(h.held.map(r=>r.kind),['status','tts']);for(const request of h.held)request.settle();await status;assert.equal(typeof (await queued).playbackId,'string');
 const g=harness(),heard=stt(g);await idle();
 await assert.rejects(g.voice.synthesize({text:'Queued.',requestId:'queued',environment:'env',credentialId:'cred',replace:false}),{code:'playback-busy'});
 g.held[0].settle();assert.equal((await heard).text,'hello');
});
test('only a newer request of the same kind supersedes, and the abort names the reason',async()=>{
 const h=harness(),first=stt(h,'first');await idle();const second=stt(h,'second'),superseded=assert.rejects(first,cancelledBy('stt','superseded'));await idle();
 await superseded;
 h.held.at(-1).settle();assert.equal((await second).text,'hello');
 assert.deepEqual(h.warnings,[['[Alpha speech]',{kind:'stt',reason:'superseded'}]]);
});
test('a targeted cancel stops only its request; stop, release, hide, pagehide and device-state stop all with their own reason',async()=>{
 const h=harness(),kept=stt(h,'keep');await idle();const dropped=tts(h,'drop');await idle();
 const refused=assert.rejects(dropped,cancelledBy('tts','cancelled'));await h.voice.cancel({requestId:'drop'});await refused;
 assert.equal(h.held[0].signal.aborted,false);h.held[0].settle();assert.equal((await kept).text,'hello');
 for(const [trigger,reason] of globalCancels){
  const g=harness(),heard=stt(g);await idle();const spoken=tts(g);await idle();const refused=Promise.all([assert.rejects(heard,cancelledBy('stt',reason),reason),assert.rejects(spoken,cancelledBy('tts',reason),reason)]);void trigger(g);await refused;
  assert.deepEqual(g.warnings.map(([,detail])=>detail),[{kind:'stt',reason},{kind:'tts',reason}],reason);
 }
});
test('stop, release, hide, pagehide and device-state end a prepared Cloud clip that is still downloading; a cancel for another request keeps it',async()=>{
 for(const [trigger,reason] of globalCancels){
  const g=harness(),prepared=g.voice.synthesizeDevelopmentCloud({text:'Hello there.',requestId:'prepared'});await idle();g.held[0].settle();const {playbackId}=await prepared;
  await g.voice.cancel({requestId:'other'});await idle();assert.equal(g.bodies[0].cancelled,undefined,reason);
  void trigger(g);await idle();
  assert.equal(g.bodies[0].cancelled?.name,'AbortError',reason);
  g.show();await assert.rejects(g.voice.play({playbackId}),/Prepare speech first/,reason);
 }
});
