import { registerPlugin } from '../platform-plugins';
import { isAndroid } from '../native';
import { parseDigestResult, type DigestResult, type HostedDigestProtocol } from './hosted-digests';
import type { ResultInbox } from './digest-inbox';
interface NativeInbox {
 beginBackground(input:{attemptId:string}):Promise<void>;
 cancelBackground(input:{attemptId:string}):Promise<void>;
 configureBackground(input:Record<string,unknown>):Promise<{generation:string;scope:string}>;
 disableBackground(input?:{sessionId:string}):Promise<void>;
 syncInbox(input:{sessionId:string}):Promise<{entries:unknown[]}>;
 inboxHistory(input:{sessionId:string}):Promise<{entries:unknown[]}>;
}
const native=registerPlugin<NativeInbox>('AlphaHostedResults');
const configuring=new Map<AbortController,string>();
export async function pauseHostedBackground(sessionId?:string){
 for(const [controller,session] of configuring)if(!sessionId||sessionId===session)controller.abort();
 if(!isAndroid)return;
 await native.disableBackground(sessionId?{sessionId}:undefined);
}
export async function configureHostedBackground(input:Record<string,unknown>,signal:AbortSignal):Promise<boolean>{
 if(!isAndroid)return false;signal.throwIfAborted();
 const external=signal,controller=new AbortController();
 const forwardAbort=()=>controller.abort();external.addEventListener('abort',forwardAbort,{once:true});
 signal=controller.signal;configuring.set(controller,String(input.sessionId));
 const attemptId=crypto.randomUUID();
 const cancel=()=>native.cancelBackground({attemptId});
 const abort=()=>{void cancel().catch(()=>{});};
 try{
  // Register cancellation only after this reservation exists. A cancelled begin
  // is explicitly retired before any configuration can be admitted.
  await native.beginBackground({attemptId});
  if(signal.aborted){await cancel();signal.throwIfAborted();}
  signal.addEventListener('abort',abort,{once:true});
  await native.configureBackground({...input,attemptId});signal.throwIfAborted();return true;
 }catch(error){await cancel();signal.throwIfAborted();return false;}
 finally{signal.removeEventListener('abort',abort);external.removeEventListener('abort',forwardAbort);configuring.delete(controller);}
}
export class NativeResultInbox implements ResultInbox {
 constructor(private sessionId:string){}
 async history(){return (await native.inboxHistory({sessionId:this.sessionId})).entries.map(parseDigestResult);}
 async sync(_client:HostedDigestProtocol,signal:AbortSignal){signal.throwIfAborted();const result=await native.syncInbox({sessionId:this.sessionId});signal.throwIfAborted();return result.entries.map(parseDigestResult);}
}
