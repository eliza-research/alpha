import {validateUuid} from '../vendor/eliza/packages/core/src/utils/uuid.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {tsImport} from 'tsx/esm/api';
import {applyServerEvent,INITIAL_VOICE_SESSION_STATE} from '../vendor/eliza/packages/ui/src/voice/voice-session-state.ts';

// Synthetic transport callbacks only; no socket, microphone, provider, or model calls.
const source=fs.readFileSync(new URL('../apps/app/src/runtime/development-cartesia-conversation.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace(/^export \{.*\} from .*;\n/gm,'').replace(/import\.meta\.env\.DEV===true&&devSurfacesEnabled&&!Capacitor\.isNativePlatform\(\)&&import\.meta\.env\.VITE_ALPHA_DEV_CARTESIA==='1'/,'true').replace("await import('@elizaos/ui/voice/voice-session-client')",'({createVoiceSessionClient:fixtureClient})').replace(/export /g,''),{mode:'transform'});
class RendererSocket{static latest;constructor(){RendererSocket.latest=this;queueMicrotask(()=>this.onopen?.());}close(){}}
const factory=new Function('connectionController','fixtureClient','WebSocket','location','setTimeout','clearTimeout','developmentCloudRealtimeVoiceEnabled','developmentCartesiaVoiceEnabled','readDevicePreferences','window','validateUuid',js+'\nreturn developmentCartesiaConversation;');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
// Like the pinned SDK client, reduce each frame into accepted state before the raw callback.
const sdkOptions=options=>{let state={...INITIAL_VOICE_SESSION_STATE,phase:'listening'};return options&&{...options,onServerEvent(event){if(event.t!=='speaking_end'){state=applyServerEvent(state,event);options.onState(state);}options.onServerEvent(event);}};};
function harness(ask=true){
 let options,sdk,current=true,refreshes=0,hold,release;const errors=[],navigations=[],transcripts=[],actions=[];let view='home';
 const binding={conversationId:'room',session:{agentId:'agent'}},agent={request:async path=>path.includes('/health')?{ready:true,conversationId:'room',agentId:'agent'}:path==='/api/views/voice-channel'?{wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=fixture',expiresAt:Date.now()+120000}:{}};
 const controller={performVoiceRequestedActions:async(_binding,_message,_signal,operation)=>{actions.push((operation||'general')+':'+view);return view==='camera'?[{summary:'Photo saved'}]:[];},getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>current,refreshDeveloperVoiceHistory:async()=>{refreshes++;if(hold)await new Promise(resolve=>release=resolve);}};
 const createVoiceSessionClient=value=>{options=value;sdk=sdkOptions(value);return {start:async()=>{},stop:async()=>{},setMicrophoneMuted:()=>{}};};
 return {create:()=>factory(controller,createVoiceSessionClient,RendererSocket,{host:'localhost'},()=>1,()=>{},false,true,async()=>({askBeforeAgentActions:ask}),new EventTarget(),validateUuid)({binding,assertCurrent:()=>{if(!current)throw Error('changed');},onState:()=>{},onTranscript:text=>transcripts.push(text),onError:error=>errors.push(error.message),getUiContext:()=>({uiViewPath:'/notes',uiBrowserSurface:'native'}),onNavigate:async event=>{navigations.push(event);view=event.viewId;}}),renderer:event=>RendererSocket.latest.onmessage({data:JSON.stringify(event)}),get options(){return sdk;},get refreshes(){return refreshes;},errors,navigations,transcripts,actions,setCurrent:value=>current=value,hold:()=>hold=true,release:()=>{hold=false;release?.();}};
}
test('authoritative progress refreshes canonical history with one in-flight loader and one coalesced followup',async()=>{
 const f=harness();await f.create();f.hold();for(const t of ['ready','stt_final','speaking_start','reply_complete','usage'])f.options.onServerEvent({t,text:'hello',traceId:'turn'});await flush();assert.equal(f.refreshes,1);f.release();await flush();assert.equal(f.refreshes,2);assert.deepEqual(f.transcripts,['hello']);assert.deepEqual(f.errors,[]);
});
test('only one finalized current socket turn may navigate; unsolicited and duplicate effects are ignored',async()=>{
 const f=harness();await f.create();const event={t:'navigate_view',traceId:'turn',viewId:'notes'};f.options.onServerEvent(event);await flush();assert.equal(f.navigations.length,0);f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});f.options.onServerEvent(event);f.options.onServerEvent(event);await flush();assert.equal(f.navigations.length,1);assert.equal(f.navigations[0].viewId,'notes');assert.deepEqual(f.options.getUiContext(),{uiViewPath:'/notes',uiBrowserSurface:'native',uiClientId:'11111111-1111-4111-8111-111111111111'});
});
test('stop retires queued effects and later history/transcript events without replay',async()=>{
 const f=harness(),voice=await f.create();f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});f.options.onServerEvent({t:'navigate_view',traceId:'turn',viewId:'notes'});await voice.stop();await flush();assert.equal(f.navigations.length,0);const count=f.refreshes;f.options.onServerEvent({t:'ready'});assert.equal(f.refreshes,count);assert.deepEqual(f.errors,[]);
});
test('a replaced owner/session rejects UI context and event delivery',async()=>{
 const f=harness();await f.create();f.setCurrent(false);assert.throws(()=>f.options.getUiContext(),/changed/);assert.throws(()=>f.options.onServerEvent({t:'navigate_view',traceId:'turn',viewId:'notes'}),/changed/);assert.equal(f.navigations.length,0);
});

const adapterSource=fs.readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const projectionSource=adapterSource.slice(adapterSource.indexOf('  p.applyRealtimeVoiceNavigation = async function('),adapterSource.indexOf('  p.sendVoiceTurn = async function('));
const projectionJs=stripTypeScriptTypes(projectionSource,{mode:'transform'});
const {alphaNavigation}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
// Notes, Calendar and Workflows are available; the product registry resolves every other id.
const projectionViews=alphaNavigation(view=>['notes','calendar','workflows'].includes(view));
function projectionHarness(){
 let active=true,hidden=false,commits=0;globalThis.document={get hidden(){return hidden;}};
 const state={view:null,chat:'full'},alphaClient={getState:()=>({context:{view:state.view||'home',revision:1,sensitive:false}})},p={};
 new Function('p','alphaViewKey','alphaViewPaths','connectionController','context','openInternalView','alphaClient',projectionJs)(p,projectionViews.viewKey,projectionViews.viewPaths,{voiceConversationCurrent:()=>active},()=>{},(shell,view,chat)=>{commits++;state.view=view==='home'?null:view;state.chat=chat;return true;},alphaClient);
 const shell={live:true,S:()=>state,setState:(_patch,done)=>done()},observed=[];
 const navigation={apply:async(view,current,commit)=>{current();return commit(state.chat,context=>observed.push(context));},finish:value=>observed.push(value)};
 return {apply:event=>p.applyRealtimeVoiceNavigation.call(shell,{...event,binding:{},assertCurrent:()=>{if(!active)throw Error('changed');},navigation}),state,observed,get commits(){return commits;},replace:()=>active=false,background:()=>hidden=true};
}
test('typed realtime projection allows only MVP views and matching paths, keeps the detent and waits for committed context',async()=>{
 const f=projectionHarness();assert.equal(await f.apply({viewId:'notes',viewPath:'/notes'}),true);assert.deepEqual(f.state,{view:'notes',chat:'full'});assert.deepEqual(f.observed,[{view:'notes',revision:1,sensitive:false},true]);
 for(const event of [{viewId:'wallet'},{viewId:'notes',viewPath:'https://evil.test'},{viewId:'notes',viewPath:'/notes/secret'},{viewId:'notes',subview:'record-1'}])await assert.rejects(f.apply(event),/not available/);
 assert.equal(f.commits,1);
});
test('projection refuses replaced ownership and hidden documents before any screen effect',async()=>{
 const f=projectionHarness();f.replace();await assert.rejects(f.apply({viewId:'notes'}),/changed/);assert.equal(f.commits,0);
 const g=projectionHarness();g.background();await assert.rejects(g.apply({viewId:'notes'}),/changed/);assert.equal(g.commits,0);
});

test('interrupted and superseded finalized turns cannot deliver a late screen effect',async()=>{
 const f=harness();await f.create();f.options.onServerEvent({t:'stt_final',traceId:'old',text:'open notes'});f.options.onServerEvent({t:'interrupted',traceId:'old'});f.options.onServerEvent({t:'navigate_view',traceId:'old',viewId:'notes'});await flush();assert.equal(f.navigations.length,0);
 f.options.onServerEvent({t:'stt_final',traceId:'old2',text:'open notes'});f.options.onServerEvent({t:'navigate_view',traceId:'old2',viewId:'notes'});f.options.onServerEvent({t:'stt_partial',traceId:'new',text:'no wait'});await flush();assert.equal(f.navigations.length,0);
});

test('direct adapter reports automatic playback mute separately from manual mute',async()=>{
 const f=harness(),voice=await f.create();assert.equal(voice.microphoneAutomaticallyMuted,false);
 f.options.onState({phase:'speaking'});assert.equal(voice.microphoneAutomaticallyMuted,true);
 f.options.onState({phase:'listening'});assert.equal(voice.microphoneAutomaticallyMuted,false);
});

test('targeted renderer delivery opens Notes even when the voice terminal suppresses its duplicate',async()=>{
 const f=harness();await f.create();const frame={type:'shell:navigate:view',source:'agent',viewType:'gui',viewId:'notes',viewPath:'/notes',completedActionHandoffId:'22222222-2222-4222-8222-222222222222'};
 f.renderer(frame);await flush();assert.equal(f.navigations.length,0);
 f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});f.renderer(frame);await flush();assert.equal(f.navigations.length,1);assert.equal(f.navigations[0].viewId,'notes');
 f.renderer(frame);f.options.onServerEvent({t:'navigate_view',traceId:'turn',viewId:'notes'});await flush();assert.equal(f.navigations.length,1);
});
test('targeted navigation refuses interrupted turns, unsupported effects and stopped owners',async()=>{
 const f=harness(),voice=await f.create();const frame={type:'shell:navigate:view',source:'agent',viewType:'gui',viewId:'notes',completedActionHandoffId:'22222222-2222-4222-8222-222222222222'};
 f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});f.renderer({...frame,payload:{record:'private'}});await flush();assert.equal(f.navigations.length,0);
 f.options.onServerEvent({t:'interrupted',traceId:'turn'});f.renderer(frame);await flush();assert.equal(f.navigations.length,0);
 await voice.stop();f.renderer(frame);await flush();assert.equal(f.navigations.length,0);
});

test('targeted prepared metadata reaches canonical delivery intact, including malformed protocol markers',async()=>{
 for(const navigationPrepared of [true,false]){const f=harness();const voice=await f.create();try{const id='22222222-2222-4222-8222-222222222222';const navigationBinding={requestId:id,clientId:'owned-renderer',installationId:'33333333-3333-4333-8333-333333333333',viewId:'notes',viewType:'gui'};f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});f.renderer({type:'shell:navigate:view',source:'agent',viewType:'gui',viewId:'notes',completedActionHandoffId:id,navigationPrepared,navigationBinding});await flush();assert.equal(f.navigations.length,1);assert.equal(f.navigations[0].navigationPrepared,navigationPrepared);assert.deepEqual(f.navigations[0].navigationBinding,navigationBinding);assert.equal(f.navigations[0].completedActionHandoffId,id);}finally{await voice.stop();}}
});

const cameraMessage='1f6f565c-00c4-0952-bfa6-a8af23e74913';
test('camera continuation waits for later navigation after an already completed voice reply',async()=>{
 const f=harness(false);await f.create();f.options.onServerEvent({t:'stt_final',traceId:'camera-turn',text:'take a photo'});f.options.onServerEvent({t:'reply_complete',traceId:'camera-turn',userMessageId:cameraMessage});await flush();assert.deepEqual(f.actions,['general:home']);f.options.onServerEvent({t:'navigate_view',traceId:'camera-turn',viewId:'camera'});await flush();assert.deepEqual(f.actions,['general:home','camera_capture_photo:camera']);f.options.onServerEvent({t:'navigate_view',traceId:'camera-turn',viewId:'camera'});await flush();assert.equal(f.actions.length,2);
});
test('camera continuation does not repeat an action when navigation precedes completion',async()=>{
 const f=harness(false);await f.create();f.options.onServerEvent({t:'stt_final',traceId:'camera-turn',text:'take a photo'});f.options.onServerEvent({t:'navigate_view',traceId:'camera-turn',viewId:'camera'});f.options.onServerEvent({t:'reply_complete',traceId:'camera-turn',userMessageId:cameraMessage});await flush();assert.deepEqual(f.actions,['general:camera']);
});
test('camera continuation ignores an interrupted request and respects ask-first',async()=>{
 const f=harness(false);await f.create();f.options.onServerEvent({t:'stt_final',traceId:'camera-turn',text:'take a photo'});f.options.onServerEvent({t:'reply_complete',traceId:'camera-turn',userMessageId:cameraMessage});await flush();f.options.onServerEvent({t:'interrupted',traceId:'camera-turn'});f.options.onServerEvent({t:'navigate_view',traceId:'camera-turn',viewId:'camera'});await flush();assert.deepEqual(f.actions,['general:home']);
 const g=harness(true);await g.create();g.options.onServerEvent({t:'stt_final',traceId:'camera-turn',text:'take a photo'});g.options.onServerEvent({t:'reply_complete',traceId:'camera-turn',userMessageId:cameraMessage});g.options.onServerEvent({t:'navigate_view',traceId:'camera-turn',viewId:'camera'});await flush();assert.deepEqual(g.actions,[]);
});

test('direct voice action completion refuses malformed message identities',async()=>{
 for(const userMessageId of ['invalid-message',cameraMessage+'-extra',' '+cameraMessage]){const f=harness(false);await f.create();f.options.onServerEvent({t:'stt_final',traceId:'turn',text:'take a photo'});f.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId});await flush();assert.deepEqual(f.actions,[]);}
});
