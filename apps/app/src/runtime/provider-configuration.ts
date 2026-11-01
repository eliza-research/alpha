/** Native reserves a lease before keys are sent. Cancellation during that first IPC step cannot
 * dispatch a mutation; once reserved, cancel/back revokes the lease before reporting success. */
export async function runProviderConfiguration<T>(signal:AbortSignal,ports:{prepare:()=>Promise<{requestId:string}>;configure:(requestId:string)=>Promise<T>;cancel:(requestId:string)=>Promise<void>}):Promise<T>{
 signal.throwIfAborted();
 let requestId:string;
 try{({requestId}=await ports.prepare());}catch(error){signal.throwIfAborted();throw error;}
 let cancellation:Promise<void>|undefined;
 let rejectCancelled:(reason:unknown)=>void=()=>{};
 const cancelled=new Promise<never>((_resolve,reject)=>{rejectCancelled=reject;});
 const cancel=()=>{
  if(cancellation)return;
  try{cancellation=ports.cancel(requestId);}catch(error){cancellation=Promise.reject(error);}
  void cancellation.then(()=>rejectCancelled(signal.reason??new DOMException('Cancelled','AbortError')),()=>rejectCancelled(new Error('Provider cancellation could not be confirmed. Check the saved provider before trying again.')));
 };
 signal.addEventListener('abort',cancel,{once:true});
 try{
  if(signal.aborted){cancellation=ports.cancel(requestId);await cancellation;signal.throwIfAborted();}
  const result=await Promise.race([ports.configure(requestId),cancelled]);
  if(signal.aborted){if(cancellation)await cancellation;signal.throwIfAborted();}
  return result;
 }catch(error){
  // A rejected request may not have reached native begin (for example invalid input).
  // Release its reserved lease as well; an already-finished native request is a no-op.
  try{await (cancellation??ports.cancel(requestId));}catch{throw new Error('Provider cancellation could not be confirmed. Check the saved provider before trying again.');}
  throw error;
 }finally{signal.removeEventListener('abort',cancel);}
}
