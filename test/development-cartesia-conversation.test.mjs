import {validateUuid} from '../vendor/eliza/packages/core/src/utils/uuid.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';
import {applyServerEvent,INITIAL_VOICE_SESSION_STATE} from '../vendor/eliza/packages/ui/src/voice/voice-session-state.ts';
// Like the pinned SDK client, reduce each frame into accepted state before the raw callback.
const sdkOptions=options=>{let state={...INITIAL_VOICE_SESSION_STATE,phase:'listening'};return options&&{...options,onServerEvent(event){if(event.t!=='speaking_end'){state=applyServerEvent(state,event);options.onState(state);}options.onServerEvent(event);}};};
const source=stripTypeScriptTypes((readFileSync('apps/app/src/runtime/development-cartesia-flag.ts','utf8')+readFileSync('apps/app/src/runtime/development-cartesia-conversation.ts','utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')","await loadClient()").replace(/^export /gm,''),{mode:'transform'});
const binding={conversationId:'conversation',session:{agentId:'agent'}};
async function setup({revoked=true,alreadyRetired=false,cloudRealtime=false,attestation={},askBefore=true}={}){
 let current=true,options,sdk,stops=0,history=0;const calls=[],errors=[],performed=[];const preferenceWindow=new EventTarget();
 const agent={async request(path,body){calls.push({path,body});if(path.includes('/health'))return {ready:true,conversationId:'conversation',agentId:'agent',...attestation};if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=fixture',expiresAt:Date.now()+120000};if(path.includes('/revoke')){if(alreadyRetired)throw Object.assign(Error('Retired'),{status:404,data:{code:'voice_session_not_found'}});return {revoked};}return {};}};
 const context=vm.createContext({validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:askBefore}),window:preferenceWindow,AbortController,DOMException,Response,Error,URL,Date,setTimeout,clearTimeout,location:{host:'localhost'},WebSocket:class{constructor(){queueMicrotask(()=>this.onopen?.());}close(){}},Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:cloudRealtime,devSurfacesEnabled:true,connectionController:{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){history++;},async performVoiceRequestedActions(_binding,messageId){performed.push(messageId);return [{summary:"Note saved"}];}},loadClient:async()=>({createVoiceSessionClient:o=>{options=o;sdk=sdkOptions(o);return {async start(){o.onMinted({sessionId:'owned'});},async stop(){stops++;},microphoneMuted:false,setMicrophoneMuted(){},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA",cloudRealtime?"'0'":"'1'")+ ';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){if(!current)throw Error('Changed');},onState(){},onTranscript(){},getUiContext:()=>({viewDelivery:"completed-action",uiViewPath:"/chat"}),onError:e=>errors.push(e)});
 return {controller,calls,errors,performed,changePreference(value){askBefore=value;preferenceWindow.dispatchEvent(new Event("alpha:device-settings"));},get options(){return sdk;},get stops(){return stops;},get history(){return history;},change(){current=false;}};
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
 const agent={async request(path,body,signal){calls.push({path,body,signal});if(path.includes('/health'))return {ready:true,conversationId:'conversation',agentId:'agent'};
  if(path==='/api/views/voice-channel'){if(holdFetch)return new Promise(resolve=>{resolveFetch=()=>resolve(ticket());});return ticket();}
  if(path.includes('/revoke'))return {revoked:true};return {};}};
 const context=vm.createContext({validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:true}),window:new EventTarget(),AbortController,DOMException,Response,Error,URL,Date:Clock,setTimeout:setTimer,clearTimeout:clearTimer,location:{host:'localhost'},WebSocket:Socket,Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:false,devSurfacesEnabled:true,
  connectionController:{getBrowserSpeechAgent:()=>swapped?{}:agent,voiceRendererClientId:()=>rendererId,voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){}},
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
