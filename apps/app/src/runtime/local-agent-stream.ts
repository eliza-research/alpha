import {batchProgressBinding,emitBatchProgress,emitBatchReply} from './batch-voice-progress-ack';
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
