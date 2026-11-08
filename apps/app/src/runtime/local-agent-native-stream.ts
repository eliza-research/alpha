import {anyAbortSignal} from './abort-signal';
import {readLocalAgentStream,type StreamTextListener} from './local-agent-stream';
export interface NativeStreamPort {
 addListener(name:string,callback:(event:any)=>void):Promise<{remove():Promise<void>}>;
 requestStream(input:Record<string,unknown>):Promise<{streamId:string}>;
 cancelStream(input:{streamId:string}):Promise<unknown>;
}
/** Closing IPC does not cancel committed effects. Interrupted sends require history reconciliation. */
export async function streamNativeAgent(port:NativeStreamPort,input:{path:string;ownerId:string;headers:Record<string,string>;body:string},signal:AbortSignal,onText:StreamTextListener,onReplyReady?:(results:readonly unknown[]|undefined)=>void){
 const bounded=anyAbortSignal([signal,AbortSignal.timeout(120000)]),streamId=crypto.randomUUID();
 bounded.throwIfAborted();
 let active=true,started=false,responded=false,terminal=false,bytes=0;
 let controller!:ReadableStreamDefaultController<Uint8Array>;
 let resolveResponse!:(value:Response)=>void,rejectResponse!:(error:Error)=>void;
 let resolveTerminal!:()=>void,rejectTerminal!:(error:Error)=>void;
 const completed=new Promise<void>((resolve,reject)=>{resolveTerminal=resolve;rejectTerminal=reject;});void completed.catch(()=>{});
 const response=new Promise<Response>((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
 // Handler can reject before dispatch awaits finish; attach a rejection observer immediately.
 void response.catch(()=>{});
 const body=new ReadableStream<Uint8Array>({start(value){controller=value;}});
 const fail=(error:Error,revokeReady=false)=>{if(terminal)return;if(revokeReady)onReplyReady?.(undefined);terminal=true;rejectTerminal(error);rejectResponse(error);controller.error(error);};
 const cleanup=(work:Promise<unknown>)=>{void work.catch(()=>{});};
 let remove:(()=>Promise<void>)|undefined;
 let rejectAddition:(()=>void)|undefined;
 const addition=port.addListener('alphaAgentStream',envelope=>{
  if(!active||envelope?.streamId!==streamId)return;
  let interrupted=false;
  try{
   const event=envelope.event;
   if(!event||typeof event!=='object')throw Error('Invalid native stream frame');
   if(terminal)return;
   if(event.type==='response'){
    // Upstream answers 429 only when the room refuses admission, before the turn is recorded or run:
    // that message was provably not accepted. Other statuses keep the unknown outcome.
    if(!responded&&event.status===429)throw Object.assign(Error('The agent is busy and did not accept this message.'),{status:429,beforeDispatch:true});
    if(!responded&&event.status===401)throw Object.assign(Error('Native stream unavailable. Check history before retrying.'),{status:401});
    if(responded||event.status!==200)throw Error('Native stream unavailable. Check history before retrying.');
    const headers=new Headers(event.headers);
    if(!headers.get('content-type')?.startsWith('text/event-stream'))throw Error('Invalid native stream content type');
    responded=true;resolveResponse(new Response(body,{status:200,headers}));
   }else if(event.type==='chunk'){
    if(!responded||typeof event.dataBase64!=='string'||event.dataBase64.length>3*1024*1024)throw Error('Invalid native stream chunk');
    const binary=atob(event.dataBase64);bytes+=binary.length;
    if(bytes>2*1024*1024)throw Error('Native stream exceeds limit');
    controller.enqueue(Uint8Array.from(binary,c=>c.charCodeAt(0)));
   }else if(event.type==='complete'){
    if(event.error!==undefined&&typeof event.error!=='string')throw Error('Invalid native stream completion');
    if(typeof event.error==='string'||!responded){interrupted=typeof event.error==='string'&&responded;throw Error('Response interrupted. Outcome unknown; check history before retrying.');}
    terminal=true;resolveTerminal();controller.close();
   }else throw Error('Invalid native stream event');
  }catch(error){fail(error instanceof Error?error:Error('Invalid native stream'),!interrupted);}
 });
 void addition.then(listener=>{remove=()=>listener.remove();if(bounded.aborted||!active)cleanup(listener.remove());},()=>{});
 const abort=()=>{fail(Error('Response interrupted. Outcome unknown; check history before retrying.'));if(started)void port.cancelStream({streamId}).catch(()=>{});};
 bounded.addEventListener('abort',abort,{once:true});
 try{
  const listener=await Promise.race([addition,new Promise<never>((_,reject)=>{if(bounded.aborted)reject(bounded.reason);else {rejectAddition=()=>reject(bounded.reason);bounded.addEventListener('abort',rejectAddition,{once:true});}})]);
  remove=()=>listener.remove();
  bounded.throwIfAborted();started=true;
  // Do not wait for dispatch acknowledgement to consume events or honour abort.
  const dispatch=port.requestStream({...input,streamId});
  // Native rejects requestStream only before it sends anything to the runtime, so a rejection is
  // provably not dispatched; it resolves first and reports later failures as stream events.
  void dispatch.then(result=>{if(result.streamId!==streamId)fail(Error('Native stream identity changed'));if(!active||bounded.aborted)void port.cancelStream({streamId}).catch(()=>{});},()=>fail(Object.assign(Error('The on-device agent did not accept this message.'),{beforeDispatch:true})));
  const result=await readLocalAgentStream(await response,bounded,onText,onReplyReady,input);
  await completed;bounded.throwIfAborted();return result;
 }finally{
  active=false;bounded.removeEventListener('abort',abort);
  if(rejectAddition)bounded.removeEventListener('abort',rejectAddition);
  if(remove)cleanup(remove());
  if(started)cleanup(port.cancelStream({streamId}));
 }
}
