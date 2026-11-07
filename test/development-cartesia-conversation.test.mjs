import {build} from "esbuild";
import {createRealtimeVoiceTiming} from '../vendor/eliza/packages/voice/src/realtime-voice-timing.ts';
import {validateUuid} from '../vendor/eliza/packages/core/src/utils/uuid.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';
import {applyServerEvent,loopToListening,INITIAL_VOICE_SESSION_STATE} from '../vendor/eliza/packages/ui/src/voice/voice-session-state.ts';
// Match the SDK reducer ordering plus pending/audio eligibility and terminal tombstones.
// The real SDK accepts global interruption only for pending work, owned audio, or a local ACK.
// This unit port omits socket negotiation/local-barge ACKs; it is not a full client replica.
// The paired-client test below uses the actual SDK for those transport/lifecycle paths.
const sdkOptions=options=>{
 let state={...INITIAL_VOICE_SESSION_STATE,phase:'listening'},playbackTrace;
 const pending=new Set(),terminal=new Set();
 return options&&{...options,
  // Mirror the existing local drain; raw generation-end is deliberately not reduced.
  drainPlayback(traceId){if(state.phase==='speaking'&&state.traceId===traceId){playbackTrace=undefined;state=loopToListening(applyServerEvent(state,{t:'speaking_end',traceId}));options.onState(state);}},
  onServerEvent(event){
   if(event.t==='ready'){pending.clear();terminal.clear();playbackTrace=undefined;}
   if(event.t==='stt_final'&&terminal.has(event.traceId))return;
   if(event.t==='interrupted'){
    if(typeof event.traceId!=='string'||!event.traceId||event.traceId.length>256||!['acoustic','explicit'].includes(event.reason)||(!pending.has(event.traceId)&&playbackTrace!==event.traceId))return;
    for(const trace of pending)terminal.add(trace);terminal.add(event.traceId);
    pending.clear();playbackTrace=undefined;
   }
   if(event.t==='speaking_start')playbackTrace=event.traceId;
   if(event.t==='turn_terminal'){if(!pending.delete(event.traceId))return;terminal.add(event.traceId);}
   if(event.t!=='speaking_end'){state=applyServerEvent(state,event);options.onState(state);}
   options.onServerEvent(event);
   if(event.t==='stt_final'&&event.text.trim())pending.add(event.traceId);
   if(event.t==='usage')pending.delete(event.traceId);
  },
 };
};
const source=stripTypeScriptTypes((readFileSync('apps/app/src/runtime/development-cartesia-flag.ts','utf8')+readFileSync('apps/app/src/runtime/development-cartesia-conversation.ts','utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')","await loadClient()").replace(/^export /gm,''),{mode:'transform'});
const binding={conversationId:'conversation',session:{agentId:'agent'}};
async function setup({revoked=true,alreadyRetired=false,cloudRealtime=false,attestation={},askBefore=true,clientFactory}={}){
 let current=true,options,sdk,stops=0,history=0,manualMuted=false;const calls=[],errors=[],performed=[],notices=[];const preferenceWindow=new EventTarget();
 const agent={async request(path,body){calls.push({path,body});if(path.includes('/health'))return {ready:true,turnTerminal:true,conversationId:'conversation',agentId:'agent',...attestation};if(path==='/api/v1/voice/session/consent')return {consentNonce:'fixture-consent'};if(path==='/api/v1/voice/session')return {sessionId:'fixture-session',token:'fixture-ticket',turnTerminal:true,expiresAt:Date.now()+60000,wsUrl:'ws://fixture.invalid/session',uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']}};if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=fixture',expiresAt:Date.now()+120000};if(path.includes('/revoke')){if(alreadyRetired)throw Object.assign(Error('Retired'),{status:404,data:{code:'voice_session_not_found'}});return {revoked};}return {};}};
 const context=vm.createContext({beginRealtimeVoiceTiming:()=>createRealtimeVoiceTiming({storageKey:"fixture",storage:()=>undefined}).start("direct-cartesia"),validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:askBefore}),window:preferenceWindow,AbortController,DOMException,Response,Error,URL,Date,setTimeout,clearTimeout,location:{host:'localhost'},WebSocket:class{constructor(){queueMicrotask(()=>this.onopen?.());}close(){}},Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:cloudRealtime,devSurfacesEnabled:true,connectionController:{voiceTurnFailureMessage:code=>`fixture failure ${code}`,getSnapshot:()=>({residentInference:"cloud"}),getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){history++;},async performVoiceRequestedActions(_binding,messageId){performed.push(messageId);return [{summary:"Note saved"}];}},loadClient:async()=>({createVoiceSessionClient:o=>{options=o;if(clientFactory)return clientFactory(o);sdk=sdkOptions(o);return {async start(){o.onMinted({sessionId:'owned'});},async stop(){stops++;manualMuted=false;},get microphoneMuted(){return manualMuted;},setMicrophoneMuted(value){manualMuted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA",cloudRealtime?"'0'":"'1'")+ ';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){if(!current)throw Error('Changed');},onState(){},onTranscript(){},getUiContext:()=>({viewDelivery:"completed-action",uiViewPath:"/chat"}),onError:e=>errors.push(e),onActionResult:text=>notices.push(text)});
 return {controller,calls,errors,performed,notices,changePreference(value){askBefore=value;preferenceWindow.dispatchEvent(new Event("alpha:device-settings"));},setAcceptedState(state){options.onState(state);},get options(){return sdk;},get stops(){return stops;},get history(){return history;},change(){current=false;}};
}
test('canonical completion refreshes history without a second transcript/model dispatch',async()=>{const h=await setup();await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'synthetic',traceId:'owned'});h.options.onServerEvent({t:'reply_complete',traceId:'owned'});await Promise.resolve();assert.equal(h.history,1);assert.ok(h.calls.every(c=>!c.path.includes('/messages')));await h.controller.stop();assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);await h.controller.stop();assert.equal(h.stops,1);});
test('failed retirement remains failed on repeated Stop',async()=>{const h=await setup({revoked:false});await h.controller.start();await assert.rejects(h.controller.stop(),/not confirmed/);await assert.rejects(h.controller.stop(),/not confirmed/);assert.equal(h.stops,1);});
test('recheck retires the owned server ticket when its conversation changes',async()=>{const h=await setup();await h.controller.start();h.change();h.controller.recheck();for(let i=0;i<4;i++)await Promise.resolve();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);});

test('canonical teardown or rotated tickets already retired are accepted only by exact authenticated status',async()=>{const h=await setup({alreadyRetired:true});await h.controller.start();await h.controller.stop();await h.controller.stop();assert.equal(h.stops,1);});

/** Fake renderer transport/clock; canonical audio client is a single owned fixture, never a microphone. */
async function lifecycleFixture(){
 let now=1_000_000,id=0,rendererId='11111111-1111-4111-8111-111111111111',current=true,swapped=false,holdFetch=false,holdOpen=false,resolveFetch,options,sdk,starts=0,stops=0,clients=0,muted=false;
 const timers=new Map(),calls=[],sockets=[],errors=[],navigation=[];
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 class Clock extends Date {static now(){return now;}}
 const setTimer=(fn,delay)=>{const key=++id;timers.set(key,{fn,at:now+delay});return key;};
 const clearTimer=key=>timers.delete(key);
 class Socket {
  constructor(){sockets.push(this);if(!holdOpen)queueMicrotask(()=>this.open());}
  open(){this.onopen?.();}
  close(){this.closed=true;this.onclose?.();}
  message(frame){this.onmessage?.({data:JSON.stringify(frame)});}
 }
 const ticket=()=>({wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId='+id,expiresAt:now+120000});
 const agent={async request(path,body,signal){calls.push({path,body,signal});if(path.includes('/health'))return {ready:true,turnTerminal:true,conversationId:'conversation',agentId:'agent'};
  if(path==='/api/views/voice-channel'){if(holdFetch)return new Promise(resolve=>{resolveFetch=()=>resolve(ticket());});return ticket();}
  if(path.includes('/revoke'))return {revoked:true};return {};}};
 const context=vm.createContext({beginRealtimeVoiceTiming:()=>createRealtimeVoiceTiming({storageKey:"fixture",storage:()=>undefined}).start("direct-cartesia"),validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:true}),window:new EventTarget(),AbortController,DOMException,Response,Error,URL,Date:Clock,setTimeout:setTimer,clearTimeout:clearTimer,location:{host:'localhost'},WebSocket:Socket,Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:false,devSurfacesEnabled:true,
  connectionController:{getSnapshot:()=>({residentInference:"cloud"}),getBrowserSpeechAgent:()=>swapped?{}:agent,voiceRendererClientId:()=>rendererId,voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){}},
  loadClient:async()=>({createVoiceSessionClient:o=>{clients++;options=o;sdk=sdkOptions(o);return {async start(){starts++;o.onMinted({sessionId:'owned-1'});},async stop(){stops++;},get microphoneMuted(){return muted;},setMicrophoneMuted(value){muted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA","'1'")+';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){if(!current)throw Error('Changed');},onState(){},onTranscript(){},onError:error=>errors.push(error),onNavigate:async event=>navigation.push(event)});
 return {controller,calls,sockets,errors,navigation,timers,get options(){return sdk;},get starts(){return starts;},get stops(){return stops;},get clients(){return clients;},flush,
  async advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=target;await flush();},
  holdFetch(){holdFetch=true;},releaseFetch(){holdFetch=false;resolveFetch?.();},holdOpen(){holdOpen=true;},changeRenderer(){rendererId='22222222-2222-4222-8222-222222222222';},changeOwner(){swapped=true;},changeConversation(){current=false;}};
}
test('more than two renderer renewals retain one audio client, mute, history and navigation deduplication',async()=>{
 const h=await lifecycleFixture();await h.controller.start();
 assert.equal(h.options.maxReconnects,undefined,'canonical live reconnect default is retained');assert.equal(h.options.preLiveMaxReconnects,0);assert.equal(h.options.preLiveMaxAttempts,1);
 h.controller.setMicrophoneMuted(true);h.options.onServerEvent({t:'stt_final',text:'open notes',traceId:'turn-1'});await h.flush();
 const frame={type:'shell:navigate:view',source:'agent',viewType:'gui',viewId:'notes',completedActionHandoffId:'33333333-3333-4333-8333-333333333333'};
 h.sockets[0].message(frame);h.options.onServerEvent({t:'navigate_view',viewId:'notes',traceId:'turn-1'});await h.flush();
 assert.equal(h.navigation.length,1);
 await h.advance(330000);
 assert.equal(h.sockets.length,4);assert.equal(h.clients,1);assert.equal(h.starts,1);assert.equal(h.stops,0);assert.equal(h.controller.microphoneMuted,true);assert.equal(h.errors.length,0);
 assert.equal(h.calls.filter(c=>c.path==='/api/views/voice-channel').length,4);assert.ok(h.calls.filter(c=>c.path==='/api/views/voice-channel').every(c=>c.body.clientId==='11111111-1111-4111-8111-111111111111'));
 h.sockets[0].message({...frame,completedActionHandoffId:'44444444-4444-4444-8444-444444444444'});h.sockets.at(-1).message(frame);await h.flush();assert.equal(h.navigation.length,1,'old socket and duplicate delivery cannot replay navigation');
 h.options.onServerEvent({t:'interrupted',traceId:'turn-1'});h.sockets.at(-1).message({...frame,completedActionHandoffId:'55555555-5555-4555-8555-555555555555'});await h.flush();assert.equal(h.navigation.length,1);
 h.options.onMinted({sessionId:'owned-2'});await h.controller.stop();await h.controller.stop();assert.equal(h.stops,1);assert.deepEqual(h.calls.filter(c=>c.path.includes('/revoke')).map(c=>c.path),['/api/v1/voice/session/owned-1/revoke','/api/v1/voice/session/owned-2/revoke']);
 const count=h.sockets.length;await h.advance(240000);assert.equal(h.sockets.length,count);assert.equal(h.timers.size,0);
});
test('Stop during renewal ticket fetch fences a late ticket and never restarts renderer or capture',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdFetch();await h.advance(110000);assert.equal(h.calls.filter(c=>c.path==='/api/views/voice-channel').length,2);
 const pending=h.calls.at(-1);await h.controller.stop();assert.equal(pending.signal.aborted,true);h.releaseFetch();await h.flush();await h.advance(240000);
 assert.equal(h.sockets.length,1);assert.equal(h.starts,1);assert.equal(h.stops,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,0);
});
test('Stop during renewal socket open closes both sockets and fences a late open',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdOpen();await h.advance(110000);assert.equal(h.sockets.length,2);
 await h.controller.stop();h.sockets[1].open();await h.flush();await h.advance(240000);
 assert.ok(h.sockets.every(s=>s.closed));assert.equal(h.stops,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,0);
});
for(const change of ['changeRenderer','changeOwner','changeConversation'])test(`a ${change} while renewal waits refuses the replacement without replay`,async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdFetch();await h.advance(110000);h[change]();h.releaseFetch();await h.flush();
 assert.equal(h.sockets.length,1);assert.equal(h.stops,1);assert.ok(h.sockets[0].closed);assert.equal(h.navigation.length,0);assert.equal(h.timers.size,0);assert.ok(h.errors.length>=1);if(change==='changeOwner')assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,0,'Never retire a ticket through a replaced owner');
});
test('a replacement renderer socket opening after its bound renderer changes is retired, not adopted',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdOpen();await h.advance(110000);h.changeRenderer();h.sockets[1].open();await h.flush();
 assert.ok(h.sockets.every(s=>s.closed));assert.equal(h.stops,1);assert.equal(h.navigation.length,0);assert.equal(h.timers.size,0);
});

test('an unexpected active renderer disconnect still retires voice and does not silently reconnect',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.sockets[0].close();await h.flush();await h.advance(240000);
 assert.equal(h.stops,1);assert.equal(h.sockets.length,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,1);
});

test('Cloud realtime uses canonical client and renderer only after attested session-start admission',async()=>{const h=await setup({cloudRealtime:true,attestation:{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'}});await h.controller.start();assert.equal(h.options.maxReconnects,0,'Cloud transport loss must not mint automatic paid retries');assert(h.calls.some(c=>c.path==='/api/views/voice-channel'));h.options.onServerEvent({t:'stt_partial',text:'partial'});await h.controller.stop();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);});
test('Cloud realtime refuses legacy, direct or deferred provider attestation',async()=>{for(const attestation of [{},{speechRoute:'direct',speechProvider:'cartesia',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'other',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'deferred'}])await assert.rejects(setup({cloudRealtime:true,attestation}),/not attested/);});

const settleActions=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('voice emits direct-request mode only while the current preference allows it',async()=>{const h=await setup({askBefore:false});await h.controller.start();assert.equal(h.options.getUiContext().agentActionMode,'direct-request-v1');h.changePreference(true);assert.equal(h.options.getUiContext().agentActionMode,undefined);await settleActions();assert.equal(h.options.getUiContext().agentActionMode,undefined);await h.controller.stop();});
test('only the matching completed voice message can execute requested actions once',async(t)=>{const h=await setup({askBefore:false});t.after(()=>h.controller.stop());await h.controller.start();const userMessageId='1f6f565c-00c4-0952-bfa6-a8af23e74913';h.options.onServerEvent({t:'stt_final',text:'Save a note',traceId:'turn'});h.options.onServerEvent({t:'reply_complete',traceId:'foreign',userMessageId});h.options.onServerEvent({t:'reply_complete',traceId:'turn'});await settleActions();assert.equal(h.performed.length,0);h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId});h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId});await settleActions();assert.deepEqual(h.performed,[userMessageId]);await h.controller.stop();});
test('ask-first preference and stopped sessions cannot execute a completed voice action',async()=>{const h=await setup();await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'Save a note',traceId:'turn'});h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId:'11111111-2222-4333-8444-555555555555'});await settleActions();await h.controller.stop();h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId:'11111111-2222-4333-8444-555555555555'});await settleActions();assert.equal(h.performed.length,0);});


test('automatic microphone pause starts only for accepted nonempty final and lasts through early speaking_end',async()=>{
 const h=await setup();try{await h.controller.start();assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_partial',text:'partial',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);assert.equal(h.controller.microphoneMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'turn'});h.options.onServerEvent({t:'speaking_end',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'old',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('matching usage does not unpause playback that has not ended',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});h.options.onServerEvent({t:'speaking_start',traceId:'turn'});
 h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'speaking_end',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('old usage and old interruption cannot clear a newer accepted turn',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'first',traceId:'first'});h.options.onServerEvent({t:'stt_final',text:'second',traceId:'second'});
 h.options.onServerEvent({t:'usage',traceId:'first',sttMs:0,ttsChars:0});h.options.onServerEvent({t:'interrupted',traceId:'first',reason:'explicit'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'second',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
for(const terminal of ['usage','error','interrupted'])test('silent turn releases automatic pause on matching '+terminal,async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'silent request',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent(terminal==='error'?{t:'error',traceId:'turn',code:'unavailable',retryable:false}:terminal==='interrupted'?{t:'interrupted',traceId:'turn',reason:'explicit'}:{t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('manual mute remains independent and Stop clears automatic pause despite late events',async()=>{
 const h=await setup();await h.controller.start();h.controller.setMicrophoneMuted(true);h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});assert.equal(h.controller.microphoneMuted,true);
 await h.controller.stop();assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(h.controller.microphoneMuted,false,'SDK Stop resets manual mute');
 h.options.onServerEvent({t:'stt_final',text:'late',traceId:'late'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
});
test('empty final never invents processing and session transport error clears busy state',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:' ',traceId:'empty'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});h.options.onError(Error('transport closed'));assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});

test('local playback drain before usage keeps processing paused until its receipt',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check',traceId:'turn'});h.options.onServerEvent({t:'speaking_start',traceId:'turn'});h.options.onServerEvent({t:'speaking_end',traceId:'turn'});h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});
test('opening greeting stays paused until local playback drains without a user turn',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.onServerEvent({t:'usage',traceId:'greeting',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('greeting');assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});
test('old greeting events and drain cannot clear a newer accepted request',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.drainPlayback('greeting');h.options.onServerEvent({t:'stt_final',text:'new request',traceId:'new'});
 h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.onServerEvent({t:'usage',traceId:'greeting',sttMs:0,ttsChars:0});h.options.drainPlayback('greeting');assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'new',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});

test('fresh server fallback playback after a completed request is paused until local drain',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'request',traceId:'request'});h.options.onServerEvent({t:'usage',traceId:'request',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'speaking_end',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('fallback');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,false,'retired fallback cannot restart');
 }finally{await h.controller.stop();}
});

for(const code of ['stt_reconnecting','transport_error'])test('retryable unscoped '+code+' preserves busy processing until matching usage',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'active request',traceId:'active'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'error',code,retryable:true});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'other',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'active',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});

test('accepted session reset retires busy traces and old frames cannot revive the projection',async()=>{
 const h=await setup();try{await h.controller.start();h.controller.setMicrophoneMuted(true);
 h.options.onServerEvent({t:'stt_final',text:'old request',traceId:'old'});h.options.onServerEvent({t:'speaking_start',traceId:'old'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.setAcceptedState({phase:'connecting',traceId:null,finalTranscript:''});assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(h.controller.microphoneMuted,true);
 h.setAcceptedState({phase:'ready',traceId:null,finalTranscript:''});h.setAcceptedState({phase:'listening',traceId:null,finalTranscript:''});
 h.options.onServerEvent({t:'stt_final',text:'late old request',traceId:'old'});h.options.onServerEvent({t:'speaking_start',traceId:'old'});h.options.onServerEvent({t:'speaking_end',traceId:'old'});h.options.onServerEvent({t:'usage',traceId:'old',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'fresh request',traceId:'new'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'usage',traceId:'new',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});


test('actual SDK and Alpha preserve A queued playback while B failure settles once',async()=>{
 const observed=[];let readAutomaticMute;
 const observe=row=>{if(observed.length<32&&Buffer.byteLength(JSON.stringify([...observed,row]))<=7168)observed.push(row);};
 // Compile the paired SDK client without replacing its reducer, frame parser or drain.
 const bundled=await build({
  entryPoints:['vendor/eliza/packages/ui/src/voice/voice-session-client-core.ts'],
  alias:{
   '@elizaos/core/logging':'./.eliza/client-features/packages/core/src/logging.ts',
   '@elizaos/core/speech':'./.eliza/client-features/packages/core/src/speech.ts',
   '@elizaos/core/view-interaction':'./.eliza/client-features/packages/core/src/view-interaction.ts',
   '@elizaos/host/voice/ui-context':'./.eliza/client-features/packages/host/src/voice/ui-context.ts',
  },
  nodePaths:process.env.ALPHA_CLOUD_COLLECTOR_SOURCE?[process.env.ALPHA_CLOUD_COLLECTOR_SOURCE+'/node_modules']:[],
  bundle:true,platform:'browser',conditions:['eliza-source','browser'],format:'esm',write:false,
 });
 const {createVoiceSessionClient}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const sockets=[],playbackProcessors=[],tracks=[];
 const node=()=>({connect(){return this;},disconnect(){}});
 class Socket {
  readyState=0;binaryType='arraybuffer';listeners=new Map();
  constructor(){sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
  emit(type,event){for(const fn of this.listeners.get(type)||[])fn(event);}
  frame(value){observe({kind:'wire',type:value.t,trace:typeof value.traceId==='string'?value.traceId.slice(0,160):null});this.emit('message',{data:JSON.stringify(value)});}
  send(value){if(typeof value==='string'&&JSON.parse(value).t==='hello')queueMicrotask(()=>this.frame({t:'ready',turnTerminal:true,sessionId:'fixture-session',traceId:'ready',playbackCompletion:true}));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close',{});}
 }
 const h=await setup({askBefore:false,clientFactory:options=>createVoiceSessionClient({...options,rotationLeadMs:0,
  onState:(state,status)=>{options.onState?.(state,status);observe({kind:'state-delivered',phase:state.phase,trace:state.traceId?.slice(0,160)??null,playback:state.playbackTraceId?.slice(0,160)??null,muted:readAutomaticMute?.()??null});},
  onServerEvent:event=>{options.onServerEvent?.(event);observe({kind:'event-delivered',type:event.t,trace:'traceId'in event&&typeof event.traceId==='string'?event.traceId.slice(0,160):null,muted:readAutomaticMute?.()??null});},
  webSocketFactory:()=>new Socket(),
  getUserMedia:async()=>{const track={enabled:true,stop(){}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};},
  createMicAudioContext:()=>({sampleRate:16000,state:'running',destination:node(),createMediaStreamSource:()=>node(),createScriptProcessor:()=>({...node(),onaudioprocess:null}),async resume(){},async close(){}}),
  createPlaybackAudioContext:()=>({sampleRate:16000,state:'running',destination:node(),createScriptProcessor:()=>{const processor={...node(),onaudioprocess:null};playbackProcessors.push(processor);return processor;},async resume(){},async close(){}}),
 })});
 readAutomaticMute=()=>h.controller.microphoneAutomaticallyMuted;
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 try{
  await h.controller.start();await flush();const socket=sockets[0];
  assert.deepEqual(h.errors,[],'Actual SDK capture must start without an error before turn frames');
  assert.ok(observed.some(row=>row.kind==='state-delivered'&&row.phase==='listening'),'Actual SDK must reach listening before turn frames');
  assert.equal(tracks[0]?.enabled,true,'Actual SDK microphone must be admitted before turn frames');
  socket.frame({t:'stt_final',text:'first request',traceId:'A'});socket.frame({t:'speaking_start',traceId:'A'});
  socket.emit('message',{data:new Int16Array(320).fill(1000).buffer});
  socket.frame({t:'stt_final',text:'second request',traceId:'B'});
  socket.frame({t:'turn_terminal',traceId:'B',outcome:'failed',code:'handler_error'});
  socket.frame({t:'turn_terminal',traceId:'B',outcome:'failed',code:'handler_error'});
  assert.equal(h.controller.microphoneAutomaticallyMuted,true);assert.equal(tracks[0].enabled,false);
  assert.deepEqual(h.notices,['fixture failure handler_error']);assert.deepEqual(h.errors,[]);assert.equal(h.performed.length,0);assert.equal(sockets.length,1);
  for(const traceId of ['unknown','B'])socket.frame({t:'interrupted',traceId,reason:'explicit'});
  assert.equal(h.controller.microphoneAutomaticallyMuted,true);assert.equal(tracks[0].enabled,false);
  socket.frame({t:'speaking_end',traceId:'A'});await flush();assert.equal(h.controller.microphoneAutomaticallyMuted,true);
  for(const processor of playbackProcessors)processor.onaudioprocess?.({outputBuffer:{numberOfChannels:1,getChannelData:()=>new Float32Array(4096)}});
  await flush();assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(tracks[0].enabled,true);
 }catch(error){if(error instanceof Error)error.message+='\nActual paired SDK callback trace: '+JSON.stringify(observed);throw error;}finally{await h.controller.stop();}
});


test('existing health discovery refuses missing/false settlement capability before client creation',async()=>{
 for(const turnTerminal of [undefined,false,'true'])await assert.rejects(setup({attestation:{turnTerminal}}),/selected developer speech service is unavailable/);
});


test('both Direct and local Cloud callers opt in by resident transport',async()=>{
 for(const cloudRealtime of [false,true]){
  const h=await setup({cloudRealtime,attestation:cloudRealtime?{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'}:{}});
  assert.equal(h.options.requireTurnTerminal,true);await h.controller.stop();
 }
});
