import {validateUuid} from '../../../../vendor/eliza/packages/core/src/utils/uuid';
import {readDevicePreferences} from '../browser/device-preferences';
import type { ViewActionHandoff } from "@elizaos/core/view-interaction";
import {developmentCloudRealtimeVoiceEnabled} from './development-cloud-voice';
import {developmentCartesiaVoiceEnabled} from './development-cartesia-flag';
export {developmentCartesiaVoiceEnabled} from './development-cartesia-flag';
import {connectionController} from './connection-ui';
import type {CurrentDeviceActionRequest} from './device-actions';
import type {VoiceConversationBinding} from './alpha-client';
export type RealtimeVoiceNavigation = Pick<ViewActionHandoff, "viewId" | "viewPath" | "subview" | "navigationPrepared" | "navigationBinding" | "completedActionHandoffId"> & {traceId:string};
/** Canonical self-hosted voice owns the runtime turn; this adapter never sends its transcript twice. */
export async function developmentCartesiaConversation(input:{binding:VoiceConversationBinding;assertCurrent:()=>void;onState:(phase:string,progressText?:string)=>void;onTranscript:(text:string)=>void;onError:(error:Error)=>void;onPlaybackUnlockChange?:()=>void;onActionResult?:(summary:string)=>void;getUiContext?:()=>import('@elizaos/host/voice/ui-context').VoiceUiContext;onNavigate?:(event:RealtimeVoiceNavigation)=>Promise<void>}){
 if(developmentCartesiaVoiceEnabled&&developmentCloudRealtimeVoiceEnabled)throw Error('Choose direct or Cloud realtime speech, not both.');
 if(!developmentCartesiaVoiceEnabled&&!developmentCloudRealtimeVoiceEnabled)throw Error('Developer realtime speech is disabled.');
 const agent=connectionController.getBrowserSpeechAgent();if(!agent)throw Error('Connect the local developer agent first.');
 const lifecycle=new AbortController(),minted=new Set<string>();let stopped=false,stopPromise:Promise<void>|undefined,rendererId:string|undefined;
 let renderer:WebSocket|undefined,pendingRenderer:WebSocket|undefined,rendererRenewal:ReturnType<typeof setTimeout>|undefined,rendererTask:Promise<void>|undefined;
 const current=()=>{lifecycle.signal.throwIfAborted();input.assertCurrent();if(agent!==connectionController.getBrowserSpeechAgent()||!connectionController.voiceConversationCurrent(input.binding)||rendererId!==undefined&&rendererId!==connectionController.voiceRendererClientId())throw new DOMException('Developer voice connection changed','AbortError');};
 const request=async(path:string,body?:unknown,signal:AbortSignal=lifecycle.signal)=>{current();const result=await agent.request(path,body,signal);current();return result;};
 const health=await request('/api/v1/voice/session/health?conversationId='+encodeURIComponent(input.binding.conversationId));if(health.ready!==true||health.conversationId!==input.binding.conversationId||health.agentId!==input.binding.session.agentId)throw Error('The selected developer speech service is unavailable.');
 if(developmentCloudRealtimeVoiceEnabled&&(health.speechRoute!=='cloud'||health.speechProvider!=='cartesia'||health.providerAdmission!=='at-session-start'))throw Error('Cloud realtime speech was not attested.');
 if(!developmentCloudRealtimeVoiceEnabled&&health.speechRoute!==undefined&&health.speechRoute!=='direct')throw Error('Direct realtime speech route changed.');
 const {createVoiceSessionClient}=await import('@elizaos/ui/voice/voice-session-client');current();
 let directActions=false,preferenceGeneration=0;
 const refreshActionPreference=async()=>{const generation=++preferenceGeneration;directActions=false;try{const preferences=await readDevicePreferences(lifecycle.signal);if(!stopped&&generation===preferenceGeneration)directActions=!preferences.askBeforeAgentActions;}catch{ /* Unreadable preferences retain review. */ }};
 await refreshActionPreference();current();
 const preferenceChanged=()=>{void refreshActionPreference();};

 rendererId=connectionController.voiceRendererClientId();if(!rendererId)throw Error('The voice renderer is not bound.');
 window.addEventListener('alpha:device-settings',preferenceChanged);
 let refreshTask:Promise<void>|undefined,refreshAgain=false;
 const reconcile=()=>{if(refreshTask){refreshAgain=true;return;}refreshTask=(async()=>{do{refreshAgain=false;current();await connectionController.refreshDeveloperVoiceHistory(input.binding,lifecycle.signal);current();}while(refreshAgain&&!stopped);})().catch(error=>{if(!stopped)input.onError(error instanceof Error?error:Error('Voice history could not be verified.'));}).finally(()=>{refreshTask=undefined;});};
 const submitted=new Set<string>(),navigated=new Set<string>(),performedMessages=new Set<string>(),performedTurns=new Set<string>();
 let currentTurn:string|undefined,acceptedFinal:Readonly<{traceId:string;text:string}>|undefined;
 let acceptedState:Readonly<{traceId:string|null;phase:string;finalTranscript:string;cancelledTraceId:string|null}>|undefined;
 let completedRequest:{traceId:string;messageId:string;proof:CurrentDeviceActionRequest}|undefined;
 const clearTurn=()=>{currentTurn=undefined;acceptedFinal=undefined;completedRequest=undefined;};
 let navigationTask=Promise.resolve();let phase='idle';
 // OG's targeted renderer channel owns early delivery. The voice terminal
 // suppresses its duplicate once that transport has accepted the frame.
 const navigate=(event:RealtimeVoiceNavigation)=>{
  if(currentTurn!==event.traceId||!submitted.has(event.traceId)||navigated.has(event.traceId)||!input.onNavigate)return;
  if(navigated.size>=64)navigated.delete(navigated.values().next().value!);navigated.add(event.traceId);
  const cameraContinuation=event.viewId==='camera'&&completedRequest?.traceId===event.traceId?completedRequest:undefined;
  navigationTask=navigationTask.then(async()=>{current();if(currentTurn!==event.traceId)return;await input.onNavigate!(event);current();
   if(cameraContinuation&&directActions){const receipts=await connectionController.performVoiceRequestedActions(input.binding,cameraContinuation.messageId,lifecycle.signal,'camera_capture_photo',cameraContinuation.proof);current();for(const receipt of receipts)input.onActionResult?.(receipt.summary);reconcile();}
  }).catch(error=>{if(!stopped)input.onError(error instanceof Error?error:Error('Voice navigation could not be verified.'));});
 };
 const rendererHandoffs=new Set<string>();
 const receiveNavigation=(message:MessageEvent)=>{
  if(stopped||typeof message.data!=='string')return;
  try{current();const frame=JSON.parse(message.data);
   if(frame?.type!=='shell:navigate:view'||frame.source!=='agent'||frame.viewType!=='gui'||typeof frame.viewId!=='string'||frame.action||frame.payload!==undefined||frame.views||frame.layout||frame.placement||frame.alwaysOnTop||!currentTurn||!submitted.has(currentTurn))return;
   const id=frame.completedActionHandoffId;if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||rendererHandoffs.has(id))return;
   if(rendererHandoffs.size>=64)rendererHandoffs.delete(rendererHandoffs.values().next().value!);rendererHandoffs.add(id);
   const prepared=Object.hasOwn(frame,"navigationPrepared")||Object.hasOwn(frame,"navigationBinding");
   navigate({viewId:frame.viewId,viewPath:frame.viewPath,subview:frame.subview,traceId:currentTurn,...(prepared?{navigationPrepared:frame.navigationPrepared,navigationBinding:frame.navigationBinding,completedActionHandoffId:id}:{})});
  }catch(error){if(!stopped)input.onError(error instanceof Error?error:Error('Voice navigation could not be verified.'));}
 };
 const client=createVoiceSessionClient({agentId:input.binding.session.agentId,conversationId:input.binding.conversationId,preLiveMaxReconnects:0,preLiveMaxAttempts:1,...(developmentCloudRealtimeVoiceEnabled?{maxReconnects:0}:{}),getUiContext:()=>{current();const uiClientId=connectionController.voiceRendererClientId();if(!uiClientId)throw Error('The voice renderer is not bound.');return {...input.getUiContext?.(),uiClientId,...(directActions?{agentActionMode:'direct-request-v1' as const}:{})};},
  getConsentNonce:async()=>{const result=await request('/api/v1/voice/session/consent',{});return typeof result.consentNonce==='string'?result.consentNonce:null;},
  fetch:async(path,init={})=>{if(path!=='/api/v1/voice/session'||init.method!=='POST'||typeof init.body!=='string')throw Error('Unsupported developer voice request');const body=JSON.parse(init.body);if(body.agentId!==input.binding.session.agentId||body.conversationId!==input.binding.conversationId||body.transport!=='websocket')throw Error('Developer voice binding changed');return Response.json(await request(path,body,init.signal??lifecycle.signal));},
  onMinted:result=>{minted.add(result.sessionId);try{current();}catch{void stop().catch(error=>input.onError(error instanceof Error?error:Error('Developer voice retirement was not confirmed.')));}},
  onState:state=>{if(!stopped){current();
   acceptedState=Object.freeze({traceId:state.traceId,phase:state.phase,finalTranscript:state.finalTranscript,cancelledTraceId:state.progressCancelledTraceId??null});
   if((currentTurn&&state.traceId!==currentTurn)||state.phase==='interrupted'||state.progressCancelledTraceId===currentTurn||['idle','connecting','ready'].includes(state.phase))clearTurn();
   phase=state.phase;input.onState(state.phase,state.progressText??'');
  }},
  onServerEvent:event=>{if(stopped)return;current();if(event.t==='stt_partial'||event.t==='stt_final')input.onTranscript(event.text);
   // The raw callback is only the commit notification. Text and trace proof
   // come from the SDK reducer's accepted state, never interim or reply prose.
   if(event.t==='interrupted'&&currentTurn===event.traceId)clearTurn();
   if(event.t==='stt_final'&&acceptedState?.traceId===event.traceId&&acceptedState.cancelledTraceId!==event.traceId&&['thinking','speaking'].includes(acceptedState.phase)&&acceptedState.finalTranscript.trim()){
    acceptedFinal=Object.freeze({traceId:acceptedState.traceId,text:acceptedState.finalTranscript});currentTurn=acceptedFinal.traceId;
    if(submitted.size>=64)submitted.delete(submitted.values().next().value!);submitted.add(currentTurn);
   }
   if(['ready','stt_final','speaking_start','reply_complete','usage'].includes(event.t))reconcile();
   if(event.t==='navigate_view')navigate(event);
   if(event.t==='reply_complete'&&acceptedFinal?.traceId===event.traceId&&event.traceId===currentTurn&&submitted.has(event.traceId)&&directActions&&'userMessageId' in event&&typeof event.userMessageId==='string'&&validateUuid(event.userMessageId)&&!performedMessages.has(event.userMessageId)&&!performedTurns.has(event.traceId)){
    const messageId=event.userMessageId,traceId=event.traceId,final=acceptedFinal;
    const proof:CurrentDeviceActionRequest=Object.freeze({messageId,text:final.text,current:()=>{current();if(acceptedFinal!==final||currentTurn!==traceId||!submitted.has(traceId))throw new DOMException('Voice request retired','AbortError');}});
    completedRequest={messageId,traceId,proof};
    if(performedMessages.size>=64)performedMessages.delete(performedMessages.values().next().value!);performedMessages.add(messageId);
    if(performedTurns.size>=64)performedTurns.delete(performedTurns.values().next().value!);performedTurns.add(traceId);
    navigationTask=navigationTask.then(async()=>{current();if(currentTurn!==traceId||!directActions)return;const receipts=await connectionController.performVoiceRequestedActions(input.binding,messageId,lifecycle.signal,undefined,proof);current();for(const receipt of receipts)input.onActionResult?.(receipt.summary);reconcile();}).catch(error=>{if(!stopped)input.onError(error instanceof Error?error:Error('Voice action could not be verified.'));});
   }

  },
  onPlaybackUnlockChange:()=>{if(!stopped)input.onPlaybackUnlockChange?.();},
  onError:error=>{clearTurn();acceptedState=undefined;if(!stopped)input.onError(error);},
 });
 const stop=()=>{if(stopPromise)return stopPromise;stopped=true;clearTurn();acceptedState=undefined;window.removeEventListener('alpha:device-settings',preferenceChanged);if(rendererRenewal)clearTimeout(rendererRenewal);rendererRenewal=undefined;lifecycle.abort();renderer?.close();pendingRenderer?.close();stopPromise=(async()=>{await client.stop();for(const id of minted){if(agent!==connectionController.getBrowserSpeechAgent())throw Error('Developer voice retirement could not be confirmed after connection change.');try{const result=await agent.request(`/api/v1/voice/session/${id}/revoke`,{},new AbortController().signal);if(result.revoked!==true)throw Error('Developer voice retirement was not confirmed.');}catch(error){const failure=error as {status?:number;data?:{code?:string}};if(failure.status!==404||failure.data?.code!=='voice_session_not_found')throw error;}}})();return stopPromise;};
 // Renderer authority is independent of the canonical audio socket. Renew its
 // short, single-use ticket without restarting capture or resetting turn deduplication.
 const renewRenderer=():Promise<void>=>{
  if(rendererTask)return rendererTask;
  rendererTask=(async()=>{
   current();const reply=await request('/api/views/voice-channel',{clientId:rendererId});current();
   const url=new URL(reply.wsUrl),expiresAt=reply.expiresAt;
   if(url.protocol!=='ws:'||url.host!==location.host||url.pathname!=='/__alpha-local-renderer/ws'||typeof expiresAt!=='number'||!Number.isFinite(expiresAt)||expiresAt<=Date.now()+10000||expiresAt>Date.now()+125000)throw Error('Invalid voice renderer channel.');
   const next=new WebSocket(url);pendingRenderer=next;
   await new Promise<void>((resolve,reject)=>{
    let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);lifecycle.signal.removeEventListener('abort',aborted);next.onopen=null;next.onerror=null;next.onclose=null;if(error){next.close();reject(error);}else resolve();};
    const aborted=()=>finish(new DOMException('Developer voice stopped','AbortError'));
    const timeout=setTimeout(()=>finish(Error('The voice renderer could not connect.')),5000);
    next.onopen=()=>finish();next.onerror=()=>finish(Error('The voice renderer could not connect.'));next.onclose=()=>finish(Error('The voice renderer disconnected.'));
    lifecycle.signal.addEventListener('abort',aborted,{once:true});if(lifecycle.signal.aborted)aborted();
   });
   try{current();}catch(error){next.close();throw error;}
   const previous=renderer;renderer=next;pendingRenderer=undefined;
   next.onmessage=event=>{if(renderer===next)receiveNavigation(event);};
   next.onclose=()=>{if(!stopped&&renderer===next){void stop().catch(error=>input.onError(error));input.onError(Error('The voice renderer disconnected. Start voice again.'));}};
   previous?.close();
   rendererRenewal=setTimeout(()=>{rendererRenewal=undefined;void renewRenderer().catch(error=>{if(!stopped){void stop().catch(failure=>input.onError(failure));input.onError(error instanceof Error?error:Error('The voice renderer could not renew.'));}});},expiresAt-Date.now()-10000);
  })().finally(()=>{rendererTask=undefined;});return rendererTask;
 };
 try{await renewRenderer();current();}catch(error){await stop();throw error;}
 return {start:async()=>{try{current();await client.start();current();}catch(error){await stop();throw error;}},recheck:()=>{try{current();}catch{void stop().catch(error=>input.onError(error instanceof Error?error:Error('Developer voice retirement was not confirmed.')));}},resume:()=>false,
  get microphoneAutomaticallyMuted(){return phase==='speaking';},get microphoneMuted(){return client.microphoneMuted;},setMicrophoneMuted:(muted:boolean)=>{current();client.setMicrophoneMuted(muted);},
  get needsPlaybackUnlock(){return client.needsPlaybackUnlock;},unlockPlayback:async()=>{current();await client.unlockPlayback();current();},
  stop,
 };
}
