import {SseEventFramer} from '../../../../.eliza/client-features/packages/ui/src/api/transport.ts';
import {findViewActionHandoff} from '../../../../.eliza/client-features/packages/core/src/views/view-action-handoff.ts';
import type {RemoteChatReply} from './remote-protocol';

/** Only finalized, navigation-only reply_ready snapshots can be retained.
 * Tool/status frames and prose never become effects; durable completion remains done. */
function preparedNavigation(results:unknown):readonly unknown[]|undefined {
 if(!Array.isArray(results))return;
 for(let i=results.length-1;i>=0;i--){
  const result=results[i],handoff=findViewActionHandoff([result]);
  if(!handoff?.navigationPrepared||!handoff.navigationBinding)continue;
  const values=result.values;
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!['mode','viewId','viewPath','viewType','label','completedActionDelivered','completedActionHandoffId','navigationPrepared','navigationBinding'].includes(key))||values.completedActionDelivered===true||values.viewType!=='gui')return;
  return Object.freeze([Object.freeze({actionName:'VIEWS',success:true,values:Object.freeze({mode:'show',viewId:handoff.viewId,...(handoff.viewPath?{viewPath:handoff.viewPath}:{}),viewType:'gui',...(typeof values.label==='string'&&values.label.length<=256?{label:values.label}:{}),completedActionDelivered:false,completedActionHandoffId:handoff.completedActionHandoffId,navigationPrepared:true,navigationBinding:Object.freeze(handoff.navigationBinding)})})]);
 }
}
/** Transient planning label ("checking today's calendar") for the turn in flight.
 * It is display-only: never reply text, never history, never an effect. */
export const localTurnStatus=new EventTarget();
/** Batch voice progress from the same status frames: a request-bound cue for the one spoken
 * acknowledgement a Batch voice turn may play while it waits. Transient speech only. No chat rows,
 * agent request, provider selection or record store. */
export interface BatchProgressCue {
  turnId: string;
  conversationId: string;
  ownerId: string;
  kind: 'thinking' | 'running_action' | 'running_tool';
  label?: string;
  actionName?: string;
  toolName?: string;
}
export const batchVoiceProgressEvents = new EventTarget();
export const batchVoiceReplyEvents = new EventTarget();
export function emitBatchReply(binding: ReturnType<typeof batchProgressBinding>): void {
  if (binding) batchVoiceReplyEvents.dispatchEvent(new CustomEvent('reply', { detail: Object.freeze({ ...binding }) }));
}
/** Correlation comes from the actual already-dispatched local stream request, not status prose. */
export function batchProgressBinding(request?: { path: string; ownerId: string; body: string }):
  Pick<BatchProgressCue, 'turnId' | 'conversationId' | 'ownerId'> | undefined {
  if (!request || typeof request.body !== 'string' || request.body.length > 200000 ||
      typeof request.ownerId !== 'string' || !request.ownerId.trim() || request.ownerId.length > 128) return;
  const conversation = /^\/api\/conversations\/([a-f0-9-]{36})\/messages\/stream$/i.exec(request.path)?.[1];
  if (!conversation) return;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (!uuid.test(conversation)) return;
  try {
    const body = JSON.parse(request.body);
    if (body?.channelType !== 'VOICE_DM' || typeof body.clientMessageId !== 'string' || !uuid.test(body.clientMessageId)) return;
    return { turnId: body.clientMessageId, conversationId: conversation, ownerId: request.ownerId };
  } catch { return; }
}
export function emitBatchProgress(binding: ReturnType<typeof batchProgressBinding>, status: Record<string, unknown>): void {
  if (!binding || !['thinking', 'running_action', 'running_tool'].includes(String(status.kind))) return;
  const cue: BatchProgressCue = { ...binding, kind: status.kind as BatchProgressCue['kind'],
    ...(typeof status.label === 'string' ? { label: status.label } : {}),
    ...(typeof status.actionName === 'string' ? { actionName: status.actionName } : {}),
    ...(typeof status.toolName === 'string' ? { toolName: status.toolName } : {}) };
  if (genuineBatchProgress(cue)) batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress', { detail: Object.freeze(cue) }));
}
export function genuineBatchProgress(value: BatchProgressCue): boolean {
  const bounded = (text: unknown) => typeof text === 'string' && !!text.trim() && text.length <= 160;
  return value.kind === 'thinking' ? bounded(value.label) : value.kind === 'running_action'
    ? bounded(value.actionName) : value.kind === 'running_tool' && bounded(value.toolName);
}
export function createBatchProgressAcknowledgment(input: {
  turnId: string; conversationId: string; ownerId: string;
  signal: AbortSignal;
  assertCurrent(): void;
  /** The recorded clip's capture is retired (batch). null on a live path: its capture stays open
   * for barge-in and the host's live session hears the cue as its own playback. */
  captureRetired: (() => boolean) | null;
  /** Existing selected speech facade; settles only after matching playback/media cleanup. */
  speak(text: string, signal: AbortSignal): Promise<void>;
}) {
  const cue = new AbortController();
  let used = false, final = false, retired = false;
  let pending: Promise<void> = Promise.resolve();
  const check = () => { input.signal.throwIfAborted(); input.assertCurrent(); };
  const microphoneClear = () => input.captureRetired === null || input.captureRetired();
  const cancel = () => { retired = true; cue.abort(input.signal.reason ?? new DOMException('Voice cue retired.', 'AbortError')); };
  input.signal.addEventListener('abort', cancel, { once: true });
  if (input.signal.aborted) cancel();
  const preempt = () => { final = true; cue.abort(new DOMException('Final voice reply superseded its cue.', 'AbortError')); };
  return {
    progress(value: BatchProgressCue): void {
      if (used || final || retired || cue.signal.aborted || value.kind !== 'thinking' || !genuineBatchProgress(value) ||
          value.turnId !== input.turnId || value.conversationId !== input.conversationId || value.ownerId !== input.ownerId)
        return;
      const label = value.label;
      if (typeof label !== 'string' || !label.trim() || label.length > 160) return;
      try { check(); if (!microphoneClear()) return; } catch { cancel(); return; }
      used = true;
      // One microtask lets an already-ready final/token preempt queued prospective speech.
      pending = Promise.resolve().then(async () => {
        if (final || retired || cue.signal.aborted) return;
        check();
        if (!microphoneClear()) throw Error('Voice capture was not retired before acknowledgement.');
        try { await input.speak(label, cue.signal); }
        catch (error) {
          // Normal selected playback may reject AbortError AFTER confirmed cleanup.
          // Unconfirmed cleanup/provider errors are not hidden or converted into permission to listen.
          if (!(cue.signal.aborted && error instanceof Error && error.name === 'AbortError')) throw error;
        }
      });
      void pending.catch(() => {});
    },
    replyStarted(): void { preempt(); },
    async finish(): Promise<void> {
      preempt();
      try { await pending; check(); }
      finally { input.signal.removeEventListener('abort', cancel); }
    },
    async stop(): Promise<void> {
      cancel();
      try { await pending; }
      finally { input.signal.removeEventListener('abort', cancel); }
    },
  };
}
export async function readLocalAgentStream(response:Response, signal:AbortSignal, onText:(text:string)=>void,onReplyReady?:(results:readonly unknown[]|undefined)=>void,request?:{path:string;ownerId:string;body:string}):Promise<RemoteChatReply> {
 if(!response.ok)throw Object.assign(Error(`Local agent request failed (HTTP ${response.status}).`),{status:response.status});
 if(!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw Error('Invalid local stream response');
 const progressBinding=batchProgressBinding(request);
 const framer=new SseEventFramer();
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let text='',received=0,readySeen=false,readyKey:string|undefined;
 const invalid=(message:string):never=>{onReplyReady?.(undefined);throw Error(message);};
 const abort=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',abort,{once:true});
 function frame(lines:readonly string[]):RemoteChatReply|undefined {
  const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
  if(!data)return;
  let value;try{value=JSON.parse(data);}catch{return invalid('Invalid stream event');}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Invalid stream event');
  if(value.type==='error'){
   if(value.terminalFailure||value.failureKind||value.actionResults!==undefined)onReplyReady?.(undefined);
   // The upstream failure kind (CHAT_FAILURE_KINDS) travels with the error; its prose never does.
   const kind=typeof value.failureKind==='string'?value.failureKind:value.terminalFailure&&typeof value.terminalFailure==='object'&&typeof value.terminalFailure.kind==='string'?value.terminalFailure.kind:undefined;
   throw Object.assign(Error('Local agent response interrupted. Check conversation and action history before retrying.'),kind&&kind.length<=64?{failureKind:kind}:{});
  }
  if(value.type==='status'){
   if(!signal.aborted)emitBatchProgress(progressBinding,value);
   const label=typeof value.label==='string'?value.label.trim():'';
   if(label&&label.length<=160&&!signal.aborted)localTurnStatus.dispatchEvent(new CustomEvent('label',{detail:label}));
   return;
  }
  if(value.type==='reply_ready'){
   if(value.terminalFailure!==undefined||value.failureKind!==undefined)return invalid('Reply-ready snapshot is not successful');
   if(typeof value.fullText!=='string'||value.fullText.length>200000||(value.actionResults!==undefined&&!Array.isArray(value.actionResults)))return invalid('Invalid reply-ready snapshot');
   const navigation=preparedNavigation(value.actionResults),key=navigation?JSON.stringify(navigation):undefined;
   if(readySeen&&key!==readyKey)return invalid('Reply-ready navigation changed');
   if(!readySeen){readySeen=true;readyKey=key;signal.throwIfAborted();emitBatchReply(progressBinding);if(navigation)onReplyReady?.(navigation);}
  }
  if(value.type==='token'){
   if(typeof value.fullText==='string')text=value.fullText;
   else if(typeof value.text==='string')text+=value.text;
   else return invalid('Invalid stream text');
   if(text.length>200000)return invalid('Local reply exceeds display limit');
   signal.throwIfAborted();if(value.provisional===undefined||value.provisional===false)emitBatchReply(progressBinding);onText(text);
  }
  if(value.type==='done'){
   if(typeof value.fullText!=='string'||value.fullText.length>200000||typeof value.agentName!=='string')return invalid('Invalid terminal reply');
   const navigation=preparedNavigation(value.actionResults),key=navigation?JSON.stringify(navigation):undefined;
   if(readySeen&&key!==readyKey)return invalid('Terminal navigation disagrees with reply-ready snapshot');
   if(value.terminalFailure||value.failureKind)onReplyReady?.(undefined);
   signal.throwIfAborted();emitBatchReply(progressBinding);
   return {...value,text:value.fullText} as RemoteChatReply;
  }
 }
 try {
  while(true){
   signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();
   if(part.done)throw Error('Local agent stream ended without a completed reply. Check history before retrying.');
   received+=part.value.byteLength;if(received>2*1024*1024)return invalid('Local stream exceeds limit');
   let chunk;try{chunk=decoder.decode(part.value,{stream:true});}catch{return invalid('Invalid stream encoding');}let result:RemoteChatReply|undefined;
   framer.push(chunk,lines=>{result=frame(lines);return result!==undefined;});
   if(result)return result;
  }
 } finally {signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
