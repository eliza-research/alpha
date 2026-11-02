import { isPreparedViewNavigationRequest } from './prepared-view-navigation.ts';
import {subscribeNativeViewEvents,type NativeViewEventPort} from "./native-view-events";
import {browserCloudResidentEnabled,browserResidentCall} from './browser-cloud-resident';
import type {AppRecordMethod} from './app-record-route-policy';
import {developmentCartesiaVoiceEnabled} from './development-cartesia-flag';
import {parseRecoveryReview,parseRecoveryArchive} from './resident-recovery';
import {anyAbortSignal,runProviderConfiguration} from './abort-signal';
import {developmentCloudVoiceEnabled} from './development-cloud-voice';
import type {AutomationsMethod} from './automations-route-policy.ts';
import {ownerRouteAllowed, ownerRouteGroup} from './owner-route-policy.ts';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import type { VerifiedSession, ChatChannel } from './alpha-client';
import { conversationViewHeaders, conversationRoomId, messagePageQuery, turnAbortOutcome, turnAbortPath, type MessagePage, type RemoteChatReply, type RemoteConversation, type TurnAbortOutcome } from './remote-protocol';
import { readLocalAgentStream } from './local-agent-stream';
import { streamNativeAgent, type NativeStreamPort } from './local-agent-native-stream';
import { subscribeNativeVoiceEvents, type NativeVoiceEventPort } from './local-agent-native-events';

export type LocalAgentMethod = AutomationsMethod | AppRecordMethod;
export interface LocalAgentBridge {
  subscribeConversationEvents?(ownerId:string,listener:(envelope:unknown)=>void,onState:(state:"connected"|"unavailable",resync:boolean)=>void):()=>void;
  subscribeVoiceEvents?(ownerId:string,listener:(envelope:unknown)=>void):()=>void;
  start(input?:{requestId:string}): Promise<unknown>;
  cancelStart?(input:{requestId:string}):Promise<unknown>;
  stop?():Promise<unknown>;
  getStatus?():Promise<{packaged?:boolean;state?:string;reason?:string;serviceActive?:boolean;socketListening?:boolean}>;
  reviewRecovery?():Promise<unknown>;
  archiveRecovery?(input:{reviewToken:string}):Promise<unknown>;
  prepareProviderConfiguration?():Promise<{requestId:string}>;
  configureProvider?(input:{apiKey:string;model:string;cartesiaKey?:string;requestId:string}):Promise<unknown>;
  cancelProviderConfiguration?(input:{requestId:string}):Promise<void>;
  providerStatus?():Promise<{provider?:unknown;configured?:unknown;model?:unknown;voiceConfigured?:unknown}>;
  clearProvider?(input?:{onlyIfPresent?:true;requestId?:string}):Promise<{configured?:unknown}>;
  clearProviderIfCurrent?(input:{bindingGuard:string}):Promise<{outcome?:unknown}>;
  /** Read-only native query; see residentAttachable. */
  residentAttachment?(input:{credentialId?:string}):Promise<{attachable?:unknown;reason?:unknown;bindingGuard?:unknown}>;
  configureCloudProvider?(input:{credentialId:string;model:string}):Promise<unknown>;
  request(input: { path: string; audioBase64?:string;requestId?:string;ownerId?:string; method: LocalAgentMethod; headers: Record<string,string>; body?: string; timeoutMs: number }, signal?:AbortSignal): Promise<{status:number;body?:string}>;
  stream?(input:{path:string;ownerId:string;headers:Record<string,string>;body:string},signal:AbortSignal,onText:(text:string)=>void,onReplyReady?:(results:readonly unknown[]|undefined)=>void):Promise<RemoteChatReply>;
  /** Cloud read-aloud as it arrives: binary audio/mpeg, or the JSON envelope of a refusal. */
  speechAudio?(input:{path:'/api/tts/cloud';ownerId:string;requestId:string;body:string},signal:AbortSignal):Promise<Response>;
}
const native = registerPlugin<Omit<LocalAgentBridge, 'subscribeVoiceEvents'> & NativeStreamPort & NativeVoiceEventPort & NativeViewEventPort>('Agent');
// Capacitor proxies synthesize functions for unknown methods. Do not use that
// proxy to feature-detect streaming before the native IPC adapter implements it.
const nativeBridge:LocalAgentBridge={subscribeVoiceEvents:(ownerId,listener)=>subscribeNativeVoiceEvents(native,ownerId,listener),start:()=>native.start(),request:input=>native.request(input),stream:(input,signal,onText,onReplyReady)=>streamNativeAgent(native,input,signal,onText,onReplyReady)};
// The host bridge at /__alpha-local-agent exists only on the development server
// with test mocks or the explicit real Cloud resident mode. This
// module is also imported by Node contract tests, where import.meta.env is absent.
const developmentBridgeAllowed: boolean = browserCloudResidentEnabled || (import.meta.env !== undefined && import.meta.env.DEV === true && (import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1' || (import.meta.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW === '1' && import.meta.env.VITE_LOCAL_AGENT === '1')));
export const browserLocalAgentEnabled: boolean = developmentBridgeAllowed && import.meta.env.VITE_LOCAL_AGENT === '1';
export const localAgentAvailable = () => Capacitor.isNativePlatform()
  ? Capacitor.isPluginAvailable('Agent') : browserLocalAgentEnabled;
/** Packaging availability only; it does not prove startup or inference readiness. */
export async function localAgentPackaged():Promise<boolean> {
  if(!localAgentAvailable())return false;
  if(!Capacitor.isNativePlatform())return browserLocalAgentEnabled;
  try{return (await native.getStatus?.())?.packaged===true;}catch{return false;}
}
const unavailableBridge: LocalAgentBridge = {
  async start() { throw new Error('On-device agent is unavailable here. Connect to an agent or use Cloud.'); },
  async request() { throw new Error('On-device agent is unavailable here. Connect to an agent or use Cloud.'); },
};
const browserBridge: LocalAgentBridge | null = developmentBridgeAllowed ? {
  subscribeConversationEvents(ownerId,listener,onState){return subscribeBrowserConversationEvents(this,ownerId,listener,onState);},
  async start() { if(browserCloudResidentEnabled)await browserResidentCall('residentStart');return { state: 'host-managed' }; },
  async stream(input,signal,onText,onReplyReady){
    const bounded=anyAbortSignal([signal,AbortSignal.timeout(120000)]);
    const response=await fetch('/__alpha-local-agent',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},
      body:JSON.stringify({...input,method:'POST',stream:true}),signal:bounded,redirect:'error'});
    return readLocalAgentStream(response,bounded,onText,onReplyReady,input);
  },
  async request(input, signal) {
    const response = await fetch('/__alpha-local-agent', {
      method:'POST', headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},
      body:JSON.stringify(input), signal:signal ? anyAbortSignal([signal,AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs), redirect:'error',
    });
    if (!response.ok) throw Object.assign(new Error('Local agent development bridge unavailable. Check the development server.'),{status:response.status});
    return response.json();
  },
  async speechAudio(input,signal){
    const response=await fetch('/__alpha-local-agent',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},
      body:JSON.stringify({...input,method:'POST',headers:{}}),signal:anyAbortSignal([signal,AbortSignal.timeout(120000)]),redirect:'error'});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(new Error('Local agent development bridge unavailable. Check the development server.'),{status:response.status});}
    return response;
  },
} : null;
/** Passive owner conversation events over the existing authenticated renderer WS bridge.
 * Lease renewal/reconnect carries no message sends, workflow runs or polling reads. */
function subscribeBrowserConversationEvents(bridge:LocalAgentBridge,ownerId:string,listener:(envelope:unknown)=>void,onState:(state:'connected'|'unavailable',resync:boolean)=>void):()=>void {
  const clientId=crypto.randomUUID(),lifecycle=new AbortController();
  let retired=false,current:WebSocket|undefined,pending:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,connecting=false,backoff=1000;
  const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
  const stop=()=>{if(retired)return;retired=true;clear();lifecycle.abort();current?.close();pending?.close();current=pending=undefined;};
  const schedule=(delay:number)=>{if(retired)return;clear();timer=setTimeout(()=>{timer=undefined;void connect();},delay);};
  const failed=()=>{if(retired)return;onState('unavailable',false);schedule(backoff);backoff=Math.min(30000,backoff*2);};
  const connect=async()=>{
    if(retired||connecting)return;connecting=true;
    let next:WebSocket|undefined;
    try{
      const response=await bridge.request({path:'/api/views/renderer-channel',ownerId,method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({clientId}),timeoutMs:15000},lifecycle.signal);
      if(retired)return;
      if(response.status===401||response.status===403){onState('unavailable',false);stop();return;}
      if(response.status!==200)throw Error('Conversation channel unavailable');
      const value=JSON.parse(response.body||'{}'),url=new URL(value.wsUrl),expiresAt=value.expiresAt;
      if(url.protocol!=='ws:'||url.host!==location.host||url.pathname!=='/__alpha-local-renderer/ws'||typeof expiresAt!=='number'||!Number.isFinite(expiresAt)||expiresAt<=Date.now()+10000||expiresAt>Date.now()+125000)throw Error('Invalid conversation renderer lease');
      next=new WebSocket(url);pending=next;
      await new Promise<void>((resolve,reject)=>{
        const socket=next!;let settled=false;
        const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(deadline);lifecycle.signal.removeEventListener('abort',abort);socket.onopen=socket.onerror=socket.onclose=null;error?reject(error):resolve();};
        const abort=()=>finish(new DOMException('Conversation channel retired','AbortError'));
        const deadline=setTimeout(()=>finish(Error('Conversation channel timed out')),5000);
        socket.onopen=()=>finish();socket.onerror=()=>finish(Error('Conversation channel unavailable'));socket.onclose=()=>finish(Error('Conversation channel closed'));lifecycle.signal.addEventListener('abort',abort,{once:true});if(lifecycle.signal.aborted)abort();
      });
      if(retired){next.close();return;}
      const previous=current,gap=!previous||previous.readyState!==WebSocket.OPEN;current=next;pending=undefined;backoff=1000;
      const socket=next;
      socket.onmessage=event=>{if(retired||current!==socket||typeof event.data!=='string'||event.data.length>2*1048576)return;let value;try{value=JSON.parse(event.data);}catch{return;}if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='proactive-message')listener(value);};
      socket.onclose=event=>{if(retired||current!==socket)return;current=undefined;if(event.code===1008){onState('unavailable',false);stop();return;}failed();};
      socket.onerror=()=>{if(!retired&&current===socket)socket.close();};
      previous?.close();onState('connected',gap);schedule(expiresAt-Date.now()-10000);
    }catch(error){next?.close();if(pending===next)pending=undefined;const status=error&&typeof error==='object'?Reflect.get(error,'status'):undefined;if(status===401||status===403||status===409){onState('unavailable',false);stop();return;}failed();}
    finally{connecting=false;}
  };
  void connect();return stop;
}

function record(value:unknown):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local agent response.');
  return value as Record<string,unknown>;
}
// Set when this surface attached to the running resident but the attach did not yield a verified
// owner session. The surface then stops asking to attach: its next resident admission takes the
// ordinary stop → bind → start path, so a listening but unusable runtime is still restarted by a
// retry. Cleared by the next verified connection.
let attachDistrusted=false;
function identifier(value:unknown):string {
  if (typeof value !== 'string' || !value || value.length>512) throw new Error('Invalid local agent identity.');
  return value;
}

/** Same app-host conversation API on both platforms. The native service or
 * development server injects credentials; no bearer token reaches the renderer. */
export class LocalAgentProtocol {
  readonly origin = Capacitor.isNativePlatform() ? 'https://device.alpha.invalid' : 'https://development.alpha.invalid';
  session: VerifiedSession | null = null;
  private generation = 0;
  private streams = new Set<AbortController>();
  private voiceSubscriptions = new Set<()=>void>();
  private conversationSubscriptions = new Set<()=>void>();
  subscribeVoiceEvents(listener:(envelope:unknown)=>void):()=>void {
    const session=this.session,generation=this.generation;
    if(!session||!this.bridge.subscribeVoiceEvents)return ()=>{};
    let active=true;
    const detach=this.bridge.subscribeVoiceEvents(session.ownerId,envelope=>{if(active&&session===this.session&&generation===this.generation)listener(envelope);});
    const close=()=>{if(!active)return;active=false;this.voiceSubscriptions.delete(close);detach();};
    this.voiceSubscriptions.add(close);return close;
  }
  /** Transport capability is optional; native/remote peers must implement it before claiming live updates. */
  subscribeConversationEvents(listener:(envelope:unknown)=>void,onState:(state:'connected'|'unavailable',resync:boolean)=>void):()=>void {
    const session=this.session,generation=this.generation;
    if(!session||!this.bridge.subscribeConversationEvents){onState('unavailable',false);return ()=>{};}
    let active=true;
    const current=()=>active&&session===this.session&&generation===this.generation;
    const detach=this.bridge.subscribeConversationEvents(session.ownerId,value=>{if(current())listener(value);},(state,resync)=>{if(current())onState(state,resync);});
    const close=()=>{if(!active)return;active=false;this.conversationSubscriptions.delete(close);detach();};
    this.conversationSubscriptions.add(close);return close;
  }
  subscribeViewEvents(clientId:string,listener:(frame:unknown)=>void,ended:()=>void){
    const session=this.session,generation=this.generation;
    if(!session||this.bridge!==nativeBridge)throw Error('Native renderer events unavailable');
    return subscribeNativeViewEvents(native,session.ownerId,clientId,frame=>{if(session===this.session&&generation===this.generation)listener(frame);},ended);
  }
  deviceHeaders:Record<string,string>={};
  constructor(private bridge:LocalAgentBridge = Capacitor.isNativePlatform() ? nativeBridge : browserBridge ?? unavailableBridge) {}
  async request(path:string, body:unknown|undefined, signal:AbortSignal, headers:Record<string,string> = {}, method:LocalAgentMethod = body===undefined?'GET':'POST'):Promise<any> {
    signal.throwIfAborted();
    const group=ownerRouteGroup(path);
    if (group ? !ownerRouteAllowed(group,path,method) || !this.session : !['GET','POST'].includes(method)) throw Error('Invalid local app request');
    if ((method==='GET'||method==='DELETE') && body!==undefined) throw Error('Invalid local request body');
    const generation=this.generation,session=this.session,deadline=Date.now()+120000;
    const recordRead=group==='records'&&method==='GET';
    const input={path,...(session?{ownerId:session.ownerId}:{}),method,headers:{Accept:'application/json',...this.deviceHeaders,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})};
    let starting=false;
    for(;;){
      signal.throwIfAborted();
      if(generation!==this.generation||(recordRead&&this.session!==session))throw new Error('Local agent connection changed.');
      const remaining=starting?Math.min(120000,deadline-Date.now()):120000;
      if(remaining<=0)throw new DOMException('Local agent request timed out.','TimeoutError');
      const attempt=new AbortController(),bounded=starting?anyAbortSignal([signal,attempt.signal]):signal;
      const timeout=starting?setTimeout(()=>attempt.abort(new DOMException('Local agent request timed out.','TimeoutError')),remaining):undefined;
      let cancel:()=>void=()=>{};
      const cancelled=new Promise<never>((_,reject)=>{cancel=()=>reject(bounded.reason||new DOMException('Cancelled','AbortError'));});
      bounded.addEventListener('abort',cancel,{once:true});
      let response:{status:number;body?:string};
      try{
        response=await Promise.race([this.bridge.request({...input,timeoutMs:remaining},bounded),cancelled]);
        bounded.throwIfAborted();
      }finally{
        bounded.removeEventListener('abort',cancel);if(timeout!==undefined)clearTimeout(timeout);
        // Release the existing WebView AbortSignal.any fallback's source listeners.
        // A completed read has no accepted mutation to cancel.
        if(starting)attempt.abort();
      }
      signal.throwIfAborted();
      if(generation!==this.generation||(recordRead&&this.session!==session))throw new Error('Local agent connection changed.');
      if(response.status>=200&&response.status<300)return JSON.parse(response.body||'{}');
      const data=(()=>{try{return JSON.parse(response.body||'{}');}catch{return {};}})();
      const failure=Object.assign(new Error(`Local agent request failed (HTTP ${response.status}).`),{status:response.status,data});
      // The canonical app host rejects feature_starting BEFORE dispatch. Match
      // that closed read barrier only; never replay mutations or generic 503s.
      const deferred=recordRead&&response.status===503&&data&&typeof data==='object'&&!Array.isArray(data)&&
        data.code==='feature_starting'&&data.error==='feature_starting'&&data.retryable===true&&
        ['agent-deferred-boot','app-route-tail'].includes(data.phase)&&(data.status==='pending'||data.status==='runtime_starting'&&data.phase==='app-route-tail')&&
        (data.retryAfter===undefined||typeof data.retryAfter==='number'&&Number.isFinite(data.retryAfter)&&data.retryAfter>=0);
      if(!deferred||Date.now()>=deadline)throw failure;
      starting=true;
      // The loopback envelope has no Retry-After header. The canonical host's
      // fixed one-second barrier is the default; retain its numeric body hint.
      const delay=Math.min(Math.min(5000,Math.max(250,(data.retryAfter??1)*1000)),deadline-Date.now());
      await new Promise<void>((resolve,reject)=>{
        const aborted=()=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);reject(signal.reason||new DOMException('Cancelled','AbortError'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},delay);
        signal.addEventListener('abort',aborted,{once:true});
        if(signal.aborted)aborted();
      });
      signal.throwIfAborted();
      if(generation!==this.generation||this.session!==session)throw new Error('Local agent connection changed.');
      if(Date.now()>=deadline)throw failure;
    }
  }

  async connect(signal:AbortSignal) {
    signal.throwIfAborted();
    const generation=this.generation,requestId=crypto.randomUUID();
    let cancel:()=>void=()=>{};
    let dispatched=false,cancellationSent=false,attached=false;
    const cancelOwned=()=>{if(dispatched&&!cancellationSent){cancellationSent=true;void this.bridge.cancelStart?.({requestId}).catch(()=>{});}};
    const cancelled=new Promise<never>((_,reject)=>{cancel=()=>{cancelOwned();reject(signal.reason||new DOMException('Cancelled','AbortError'));};});
    signal.addEventListener('abort',cancel,{once:true});
    try{
    dispatched=true;
    const started=this.bridge.start({requestId});
    if(signal.aborted)cancel();
    const startup=await Promise.race([started,cancelled]);
    // Native reports when it attached this surface to the already admitted running resident
    // instead of starting it: no epoch change, no new enrollment, other surfaces' work untouched.
    attached=Boolean(startup)&&typeof startup==='object'&&(startup as {attached?:unknown}).attached===true;
    signal.throwIfAborted();
    if(generation!==this.generation)throw Error('Local agent connection changed.');
    const who=record(await this.request('/api/auth/me',undefined,signal));
    signal.throwIfAborted();
    const identity=record(who.identity),access=record(who.access);
    // Only the explicitly selected native/host bridge may establish local trust.
    if(identity.kind!=='owner'||access.role!=='OWNER'||access.mode!=='local'&&access.mode!=='session')throw new Error('The local runtime did not verify local owner access.');
    const result=record(await this.request('/api/agents',undefined,signal));
    signal.throwIfAborted();
    if(!Array.isArray(result.agents)||result.agents.length!==1)throw new Error('The local runtime must expose exactly one agent.');
    const agent=record(result.agents[0]);
    if(agent.status!=='running')throw Error('The local agent is still starting. Try again when it is ready.');
    if(generation!==this.generation)throw Error('Local agent connection changed.');
    this.session={ownerId:identifier(identity.id),agentId:identifier(agent.id),sessionId:crypto.randomUUID(),origin:this.origin};
    attachDistrusted=false;
    return {session:this.session,name:typeof agent.name==='string'?agent.name:'Local agent',attached};
    }catch(error){
      // The runtime answered the attach but not as a usable owner session. A cancelled or
      // superseded connect says nothing about the runtime and changes nothing; neither does a
      // lifecycle change made by another surface, which native reports on the next attach query.
      if(attached&&!signal.aborted&&generation===this.generation&&(error as {code?:unknown}|null)?.code!=='LOCAL_AGENT_EPOCH_CHANGED')attachDistrusted=true;
      cancelOwned();throw error;
    }
    finally{signal.removeEventListener('abort',cancel);}
  }
  get browserSpeechAvailable(){return browserLocalAgentEnabled&&browserBridge!==null&&this.bridge===browserBridge;}
  async speechRequest(audio:Uint8Array|undefined,signal:AbortSignal){
    if(!this.browserSpeechAvailable||!this.session)throw Error('Connect the local agent first.');
    const session=this.session,generation=this.generation,controller=new AbortController();
    this.streams.add(controller);
    const bounded=anyAbortSignal([signal,controller.signal]);
    try{
      bounded.throwIfAborted();
      let audioBase64:string|undefined;
      if(audio){
        if(!audio.byteLength||audio.byteLength>2*1024*1024)throw Error('Recording is too large.');
        let binary='';for(let i=0;i<audio.length;i+=8192)binary+=String.fromCharCode(...audio.subarray(i,i+8192));
        audioBase64=btoa(binary);
      }
      const requestId=audio?crypto.randomUUID():undefined;
      const response=await this.bridge.request({path:'/api/asr/libelizainference'+(audio?'':'/status'),method:audio?'POST':'GET',ownerId:session.ownerId,
        headers:{},timeoutMs:120000,...(audio?{audioBase64,requestId}:{})},bounded);
      bounded.throwIfAborted();
      if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');
      if(response.status!==200)throw Error(`Local speech failed (HTTP ${response.status}).`);
      const result=JSON.parse(response.body||'{}');
      // The reviewed host returns text/provider, not a request-id echo. This HTTP operation
      // remains bound to the captured session, generation and cancellation signal above.
      if(result.provider!=='local-inference'||(audio?(typeof result.text!=='string'||!result.text.trim()||result.text.length>16000):typeof result.ready!=='boolean'))throw Error('Invalid local speech response.');
      return result;
    }finally{this.streams.delete(controller);}
  }
  /** Explicit developer speech through the same owner-bound agent as text inference. */
  async developmentCloudSpeech(input:{kind:'asr';audio:Uint8Array}|{kind:'tts';text:string},signal:AbortSignal,route:'cloud'|'direct'='cloud'){
    const direct=route==='direct';
    if(!(direct?(developmentCartesiaVoiceEnabled||browserCloudResidentEnabled):developmentCloudVoiceEnabled)||!this.browserSpeechAvailable||!this.session)throw Error('Developer Cloud speech is unavailable.');
    const session=this.session,generation=this.generation,controller=new AbortController(),requestId=crypto.randomUUID();
    this.streams.add(controller);const bounded=anyAbortSignal([signal,controller.signal]);let streaming=false;
    try{
      bounded.throwIfAborted();let audioBase64:string|undefined;
      if(input.kind==='asr'){if(!input.audio.byteLength||input.audio.byteLength>2*1024*1024)throw Error('Recording is too large.');let binary='';for(let i=0;i<input.audio.length;i+=8192)binary+=String.fromCharCode(...input.audio.subarray(i,i+8192));audioBase64=btoa(binary);}
      else if(!input.text.trim()||input.text.length>16000)throw Error('Choose text between 1 and 16000 characters.');
      if(input.kind==='tts'&&!direct){const audio=await this.cloudSpeechAudio(input.text,requestId,controller,bounded);streaming=true;return audio;}
      const response=await this.bridge.request({path:direct?(input.kind==='asr'?'/api/v1/voice/session/transcribe':'/api/v1/voice/session/read-aloud'):'/api/asr/cloud',ownerId:session.ownerId,method:'POST',headers:{},requestId,timeoutMs:120000,...(audioBase64?{audioBase64}:{body:JSON.stringify({text:(input as {text:string}).text})})},bounded);
      bounded.throwIfAborted();if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');
      if(response.status!==200)throw Object.assign(Error(`${direct?'Direct':'Cloud'} speech unavailable (HTTP ${response.status}).`),{code:'voice-http-'+response.status});
      const result=JSON.parse(response.body||'{}');
      if(result.provider!=='cartesia'||result.route!==route||result.requestId!==requestId)throw Error('Cloud speech provider was not verified.');
      if(input.kind==='asr'){if(typeof result.text!=='string'||result.text.length>16000)throw Error('Invalid Cloud transcript.');return {text:result.text,local:false as const};}
      // Direct read-aloud: a whole verified WAV. Cloud read-aloud streams (cloudSpeechAudio).
      if(result.contentType!=='audio/wav'||typeof result.audioBase64!=='string'||!result.audioBase64.length||result.audioBase64.length>11184812)throw Error('Invalid Cloud speech audio.');
      const bytes=Uint8Array.from(atob(result.audioBase64),c=>c.charCodeAt(0));if(bytes.length>8*1024*1024)throw Error('Cloud speech audio is too large.');if(bytes.length<44||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WAVE'||new DataView(bytes.buffer).getUint32(4,true)+8!==bytes.length)throw Error('Invalid direct speech audio.');return new Blob([bytes],{type:'audio/wav'});
    }finally{if(!streaming)this.streams.delete(controller);}
  }
  /** Cloud read-aloud bytes as they arrive (audio/mpeg). Until the body ends, it stays bound to the
   * captured session, generation and cancellation; disconnect() aborts it like any owned request. */
  private async cloudSpeechAudio(text:string,requestId:string,controller:AbortController,signal:AbortSignal):Promise<ReadableStream<Uint8Array<ArrayBuffer>>>{
    const session=this.session,generation=this.generation;
    if(!session||!this.bridge.speechAudio)throw Error('Developer Cloud speech is unavailable.');
    const response=await this.bridge.speechAudio({path:'/api/tts/cloud',ownerId:session.ownerId,requestId,body:JSON.stringify({text})},signal);
    const current=()=>{signal.throwIfAborted();if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');};
    const body=response.body;
    try{
      current();
      if(response.headers.get('content-type')==='application/json'){const envelope=await response.json();current();if(envelope?.status===200)throw Error('Invalid Cloud speech audio.');throw Object.assign(Error(`Cloud speech unavailable (HTTP ${envelope?.status}).`),{code:'voice-http-'+envelope?.status});}
      if(response.headers.get('content-type')!=='audio/mpeg'||response.headers.get('x-eliza-speech-provider')!=='cartesia'||response.headers.get('x-eliza-speech-route')!=='cloud'||response.headers.get('x-request-id')!==requestId||!body)throw Error('Cloud speech provider was not verified.');
    }catch(error){await body?.cancel().catch(()=>{});throw error;}
    const reader=body.getReader();let received=0;
    const end=(error?:unknown)=>{this.streams.delete(controller);if(error!==undefined){controller.abort(error);void reader.cancel(error).catch(()=>{});}};
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull:async out=>{
        try{
          for(;;){
            const part=await reader.read();current();
            if(part.done){if(!received)throw Error('Invalid Cloud speech audio.');end();out.close();return;}
            if(!part.value.byteLength)continue;
            received+=part.value.byteLength;if(received>8*1024*1024)throw Error('Cloud speech audio is too large.');
            out.enqueue(part.value);return;
          }
        }catch(error){end(error);out.error(error);}
      },
      cancel:reason=>end(reason??new DOMException('Speech cancelled','AbortError')),
    });
  }
  async synthesizeSpeech(text:string,signal:AbortSignal):Promise<Blob>{
    if(!this.browserSpeechAvailable||!this.session)throw Error('Connect the local agent first.');
    if(typeof text!=='string'||!text.trim()||text.length>500)throw Error('Local agent speech accepts up to 500 characters per phrase.');
    const session=this.session,generation=this.generation,controller=new AbortController(),requestId=crypto.randomUUID();
    this.streams.add(controller);const bounded=anyAbortSignal([signal,controller.signal]);
    try{
      bounded.throwIfAborted();
      const response=await this.bridge.request({path:'/api/tts/paradee',ownerId:session.ownerId,method:'POST',headers:{},requestId,body:JSON.stringify({text}),timeoutMs:45000},bounded);
      bounded.throwIfAborted();if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');
      if(response.status!==200)throw Error(`Local agent speech unavailable (HTTP ${response.status}).`);
      const result=JSON.parse(response.body||'{}');
      if(result.requestId!==requestId||result.provider!=='libelizainference-paradee'||result.contentType!=='audio/wav'||typeof result.audioBase64!=='string'||result.audioBase64.length>1920060)throw Error('Invalid local speech response.');
      const bytes=Uint8Array.from(atob(result.audioBase64),c=>c.charCodeAt(0));
      if(bytes.length<44||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WAVE'||new DataView(bytes.buffer).getUint32(4,true)+8!==bytes.length)throw Error('Invalid local speech audio.');
      return new Blob([bytes],{type:'audio/wav'});
    }finally{this.streams.delete(controller);}
  }
  async disconnect() { for(const close of this.conversationSubscriptions)close();this.conversationSubscriptions.clear();for(const close of this.voiceSubscriptions)close();this.voiceSubscriptions.clear();this.generation++; this.session=null; for(const controller of this.streams)controller.abort();this.streams.clear(); }
  private async json(path:string,body:unknown|undefined,signal?:AbortSignal,headers:Record<string,string>={}) {
    if(!this.session)throw new Error('Start the local agent first.');
    return record(await this.request(path,body,signal||new AbortController().signal,headers));
  }
  async viewNavigationRequest(path:string,body:unknown,signal:AbortSignal):Promise<unknown> {
    if(path!=="/api/views/interact-claim"&&path!=="/api/views/interact-result"&&!isPreparedViewNavigationRequest(path,body))throw Error("Invalid navigation route");
    return this.json(path,body,signal);
  }
  async listConversations(signal?:AbortSignal):Promise<RemoteConversation[]> {
    const value=await this.json('/api/conversations',undefined,signal);
    if(!Array.isArray(value.conversations))throw new Error('Invalid local conversation list.');
    return value.conversations.map((item:unknown)=>{const row=record(item);return {...row,id:identifier(row.id)};});
  }
  async createConversation(title:string,signal?:AbortSignal):Promise<RemoteConversation> {
    const value=record((await this.json('/api/conversations',{title},signal)).conversation);
    return {...value,id:identifier(value.id)};
  }
  async truncateMessages(id:string,messageId:string,signal:AbortSignal):Promise<void> {
    const value=await this.json(`/api/conversations/${encodeURIComponent(identifier(id))}/messages/truncate`,{messageId,inclusive:true},signal);
    if(value.ok!==true||!Number.isSafeInteger(value.deletedCount)||Number(value.deletedCount)<1)throw Error('Message replacement was not confirmed. Reload conversation history before trying again.');
  }
  async messages(id:string,signal?:AbortSignal,page?:MessagePage):Promise<{messages:Record<string,unknown>[];hasMore?:boolean}> {
    const value=await this.json(`/api/conversations/${encodeURIComponent(identifier(id))}/messages${messagePageQuery(page)}`,undefined,signal);
    if(!Array.isArray(value.messages))throw new Error('Invalid local conversation history.');
    return {messages:value.messages.map(record),...(typeof value.hasMore==='boolean'?{hasMore:value.hasMore}:{})};
  }
  /** Streams render progress. If the stream drops before its terminal frame, the same request is
   * repeated once without streaming under the same clientMessageId: the agent returns the durable
   * outcome recorded for that key (or waits for the in-flight turn) and never runs a second turn.
   * Stop and connection changes are never retried. */
  async send(id:string,text:string,options:{metadata?:Record<string,unknown>;clientMessageId?:string;channelType?:ChatChannel;onReplyReady?:(results:readonly unknown[]|undefined)=>void;signal?:AbortSignal;onText?:(text:string)=>void}={}):Promise<RemoteChatReply> {
    const path=`/api/conversations/${encodeURIComponent(identifier(id))}/messages`;
    const headers=conversationViewHeaders(options.metadata);
    const body={text,channelType:options.channelType??'DM',metadata:options.metadata,clientMessageId:options.clientMessageId};
    if(this.bridge.stream&&options.onText){
      if(!this.session)throw Error('Start the local agent first.');
      const controller=new AbortController();this.streams.add(controller);
      const generation=this.generation,session=this.session,signal=options.signal?anyAbortSignal([options.signal,controller.signal]):controller.signal;
      const valid=()=>{signal.throwIfAborted();if(generation!==this.generation||session!==this.session)throw Error('Local agent connection changed.');};
      try{
        valid();
        const result=await this.bridge.stream({path:`${path}/stream`,ownerId:session.ownerId,headers:{...this.deviceHeaders,...headers},
          body:JSON.stringify({...body,streamProtocol:'delta-v2'})},signal,value=>{valid();options.onText!(value);},results=>{valid();options.onReplyReady?.(results);});
        valid();return result;
      }catch(error){
        valid();
        // A refusal, an undispatched stream or a terminal failure frame is the outcome: nothing is re-read.
        if(!options.clientMessageId||(error&&typeof error==='object'&&(('status' in error&&typeof error.status==='number'&&error.status<500)||'beforeDispatch' in error||'failureKind' in error)))throw error;
        this.recoveries++;
        const recovered=await this.json(path,body,signal,headers);valid();
        if(typeof recovered.text!=='string'||typeof recovered.agentName!=='string')throw new Error('Invalid local agent reply.');
        return recovered as RemoteChatReply;
      }finally{this.streams.delete(controller);}
    }
    const value=await this.json(path,body,options.signal,headers);
    if(typeof value.text!=='string'||typeof value.agentName!=='string')throw new Error('Invalid local agent reply.');
    return value as RemoteChatReply;
  }
  /** Explicit Stop through upstream's `POST /api/turns/:roomId/abort`. The room comes from the
   * agent's conversation list. Any refusal reports `unsupported`; it is never retried. */
  async abortTurn(conversationId:string,signal:AbortSignal=new AbortController().signal):Promise<TurnAbortOutcome>{
    if(!this.session)return 'unsupported';
    const generation=this.generation;
    try{
      const room=conversationRoomId(await this.listConversations(signal),conversationId);
      if(!room)return 'unsupported';
      const outcome=turnAbortOutcome(await this.request(turnAbortPath(room),{reason:'client-stop'},signal));
      if(generation!==this.generation)throw Error('Local agent connection changed.');
      return outcome;
    }catch(error){signal.throwIfAborted();if(generation!==this.generation)throw error;return 'unsupported';}
  }
  /** Persisted-reply reads after dropped streams; exposed for contract tests and diagnostics. */
  recoveries=0;
}

/** Hosted inference stays on Qwen through Cerebras; the model is not user-selectable. */
export const LOCAL_PROVIDER_MODEL='qwen-3.8-27b';
export interface LocalProviderStatus { configured:boolean; provider:'cerebras'|'elizacloud'; model?:string;voiceConfigured?:boolean;revision?:string;selected?:boolean }
const modelVendors:Record<string,string>={cerebras:'Cerebras'};
/** One label for a configured route and model, shared by the chooser and Settings: Eliza Cloud
 * reports `cerebras/qwen-3.8-27b`, shown as `Eliza Cloud · qwen-3.8-27b (Cerebras)`; a direct
 * route shows the model alone. */
export function modelLabel(providerLabel:string,model:string):string {
  const slash=model.indexOf('/');
  if(slash<0)return providerLabel+' · '+model;
  const vendor=model.slice(0,slash),name=model.slice(slash+1);
  return providerLabel+' · '+name+' ('+(modelVendors[vendor.toLowerCase()]??vendor)+')';
}
export function providerStatusLabel(status:LocalProviderStatus|null|undefined):string {
  if(!status)return 'Provider status unavailable';
  if(!status.configured)return status.provider==='elizacloud'?'Not configured · Cloud sign-in required':'Not configured';
  // Eliza Cloud serves the same Qwen model through Cerebras.
  const model=status.model||(status.provider==='elizacloud'?'cerebras/'+LOCAL_PROVIDER_MODEL:LOCAL_PROVIDER_MODEL);
  return 'Configured · '+modelLabel(status.provider==='elizacloud'?'Cloud':'Cerebras',model);
}
function parseProviderStatus(value:unknown):LocalProviderStatus {
  const row=record(value);
  const provider=row.provider==='elizacloud'?'elizacloud':row.provider==='cerebras'?'cerebras':null;
  if(!provider||typeof row.configured!=='boolean'||(row.model!==undefined&&typeof row.model!=='string'))throw Error('Invalid provider status.');
  // Native reports `cerebras/qwen-3.8-27b` for Cloud billing; modelLabel names the vendor.
  const model=typeof row.model==='string'?row.model:undefined;
  return {configured:row.configured,provider,selected:row.selected===true||row.configured===true,voiceConfigured:row.voiceConfigured===true,...(typeof row.revision==='string'?{revision:row.revision}:{}),...(model?{model}:{})};
}
/** The native bridge verifies the key against Cerebras before it reports success; the key itself
 * never returns to the renderer. */
export async function configureLocalProvider(apiKey:string,model:string=LOCAL_PROVIDER_MODEL,cartesiaKey?:string,signal:AbortSignal=new AbortController().signal) {
  // Explicit owner configuration: native vault or the private browser host's memory only.
  signal.throwIfAborted();
  if(browserCloudResidentEnabled)return browserResidentCall('residentOwn',undefined,undefined,{apiKey,...(cartesiaKey?{cartesiaKey}:{})},signal);
  if(!Capacitor.isNativePlatform())throw Error('Own API keys require the Android secure credential store. This browser cannot save them.');
  if(!await localAgentPackaged())throw Error('On-device agent is unavailable in this version.');
  signal.throwIfAborted();
  if(!native.prepareProviderConfiguration||!native.configureProvider||!native.cancelProviderConfiguration)throw Error('Cancellable model provider setup is unavailable.');
  if(model!==LOCAL_PROVIDER_MODEL)throw Error(`Alpha Phone uses ${LOCAL_PROVIDER_MODEL} on Cerebras.`);
  return runProviderConfiguration(signal,{prepare:()=>native.prepareProviderConfiguration!(),configure:requestId=>native.configureProvider!({apiKey,model,requestId,...(cartesiaKey?{cartesiaKey}:{})}),cancel:requestId=>native.cancelProviderConfiguration!({requestId})});
}
export async function localProviderStatus():Promise<LocalProviderStatus> {
  if(browserCloudResidentEnabled)return parseProviderStatus(await browserResidentCall('residentStatus'));
  if(!Capacitor.isNativePlatform()||!native.providerStatus)throw Error('Provider status is unavailable here.');
  return parseProviderStatus(await native.providerStatus());
}
/** Removes the stored key and reads native status back; success requires configured:false. */
export async function clearLocalProvider(onlyIfPresent=false,signal?:AbortSignal):Promise<LocalProviderStatus> {
  signal?.throwIfAborted();
  if(browserCloudResidentEnabled){const cleared=parseProviderStatus(await browserResidentCall('residentClear'));if(cleared.configured)throw Error('Cloud provider removal unconfirmed');return cleared;}
  if(!Capacitor.isNativePlatform()||!native.clearProvider)throw Error('Provider removal is unavailable in this version.');
  if(signal&&(!native.prepareProviderConfiguration||!native.cancelProviderConfiguration))throw Error('Cancellable provider selection is unavailable.');
  const clear=(requestId?:string)=>native.clearProvider!({...(onlyIfPresent?{onlyIfPresent:true as const}:{}),...(requestId?{requestId}:{})});
  const cleared=signal?await runProviderConfiguration(signal,{prepare:()=>native.prepareProviderConfiguration!(),configure:requestId=>clear(requestId),cancel:requestId=>native.cancelProviderConfiguration!({requestId})}):await clear();
  signal?.throwIfAborted();
  if(record(cleared).configured!==false)throw Error('The provider key could not be confirmed removed.');
  const status=await localProviderStatus();
  signal?.throwIfAborted();
  if(status.configured)throw Error('The provider key could not be confirmed removed.');
  return status;
}

/** True only when native confirms an admitted, running, enrolled resident whose stored provider
 * admission is this Cloud credential and is the one the running process launched with. Read-only:
 * it never starts, stops, pairs or rebinds. Any error or doubt reports false, which keeps the
 * ordinary stop → bind → start path; so does an earlier attach by this surface that failed its
 * owner-session verification. */
async function residentAttachmentStatus(credentialId:string,bridge:Pick<LocalAgentBridge,'residentAttachment'>=native,nativePlatform:boolean=Capacitor.isNativePlatform()):Promise<{attachable:boolean;bindingGuard?:string}> {
  if(attachDistrusted||!nativePlatform&&!browserCloudResidentEnabled||typeof credentialId!=='string'||!credentialId)return {attachable:false};
  try{
    const result=browserCloudResidentEnabled?await browserResidentCall('residentStatus',credentialId):await bridge.residentAttachment?.({credentialId});
    const guard=result&&typeof result.bindingGuard==='string'&&/^[a-f0-9]{64}$/.test(result.bindingGuard)?result.bindingGuard:undefined;
    return {attachable:result?.attachable===true,...(guard?{bindingGuard:guard}:{})};
  }catch{return {attachable:false};}
}
export async function residentAttachable(credentialId:string,bridge:Pick<LocalAgentBridge,'residentAttachment'>=native,nativePlatform:boolean=Capacitor.isNativePlatform()):Promise<boolean> {
  return (await residentAttachmentStatus(credentialId,bridge,nativePlatform)).attachable;
}
/** A returned guard identifies this call's exact attachment or newly applied binding. */
export async function bindResidentCloudProvider(credentialId:string,ports?:{attachable:(credentialId:string)=>Promise<boolean>;configure:(credentialId:string)=>Promise<void|string>}):Promise<string|undefined> {
  const attachment=ports?{attachable:await ports.attachable(credentialId)}:await residentAttachmentStatus(credentialId);
  if(attachment.attachable)return 'bindingGuard' in attachment?attachment.bindingGuard:undefined;
  const bindingGuard=await (ports?.configure??configureLocalCloudProvider)(credentialId);
  return typeof bindingGuard==='string'?bindingGuard:undefined;
}
/** Automatic failed-bind cleanup has no unguarded fallback, including on older hosts. */
export async function clearLocalProviderIfCurrent(bindingGuard:string,signal:AbortSignal):Promise<'cleared'|'changed'> {
  signal.throwIfAborted();
  if(!/^[a-f0-9]{64}$/.test(bindingGuard)||browserCloudResidentEnabled||!Capacitor.isNativePlatform()||!native.clearProviderIfCurrent)throw Error('Conditional provider removal is unavailable.');
  const result=await native.clearProviderIfCurrent({bindingGuard});
  signal.throwIfAborted();
  if(result.outcome!=='cleared'&&result.outcome!=='changed')throw Error('Conditional provider removal was not confirmed.');
  return result.outcome;
}

/** The renderer has not attempted a credential bind when this stop fails.
 * Keep the saved slot; native ownership must be resolved before another start. */
export class LocalCloudProviderStopUnconfirmed extends Error {
  constructor(cause:unknown) {
    super('Local agent shutdown could not be confirmed. Your saved AI connection was kept. Check local agent status before reconnecting.',{cause});
    this.name='LocalCloudProviderStopUnconfirmed';
  }
}

export async function configureLocalCloudProvider(credentialId:string) {
  if(browserCloudResidentEnabled){await browserResidentCall('residentBind',credentialId);return;}
  if(!Capacitor.isNativePlatform() || !await localAgentPackaged()) throw Error('The on-device runtime is unavailable in this build.');
  try { await stopLocalAgent(); }
  catch(cause) { throw new LocalCloudProviderStopUnconfirmed(cause); }
  if(!native.configureCloudProvider)throw Error('Cloud billing is unavailable in this version.');
  const result=record(await native.configureCloudProvider({credentialId,model:'cerebras/qwen-3.8-27b'}));
  return typeof result.bindingGuard==='string'&&/^[a-f0-9]{64}$/.test(result.bindingGuard)?result.bindingGuard:undefined;
}

export async function stopLocalAgent() {
  if(!Capacitor.isNativePlatform()||!native.stop)throw Error('Stop browser development with Ctrl-C in its terminal.');
  await native.stop();
  const deadline=performance.now()+30000;
  while(performance.now()<deadline){
    const status=await native.getStatus?.();
    if(status?.state==='stopped'&&status.serviceActive===false&&status.socketListening===false)return;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('Shutdown is still pending. Check local agent status before starting again.');
}

/** Recovery keeps opaque native review tokens in memory; the service owns inventory and archival. */
export async function reviewLocalRecovery(){
 if(!Capacitor.isNativePlatform())throw Error('Recovery is unavailable here. Your records were kept.');
 try{return parseRecoveryReview(await native.reviewRecovery?.());}catch{throw Error('Recovery could not be checked. Your records were kept.');}
}
export async function archiveLocalRecovery(reviewToken:string){
 if(!Capacitor.isNativePlatform())throw Error('Recovery is unavailable here. Your records were kept.');
 try{return parseRecoveryArchive(await native.archiveRecovery?.({reviewToken}));}catch{throw Error('Recovery could not be confirmed. Review again before restarting your agent.');}
}
