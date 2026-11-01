/** The native boot path applies the shared runtime profile with this declaration. */
export {nativeCloudRuntime} from './native-cloud-runtime.ts';
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createManagedGoogleAgentHost,type ManagedGoogleAgentPort,type GoogleAgentAccess} from './managed-google-agent-host.ts';
import {createManagedGoogleAgentBroker} from './managed-google-agent-broker.ts';
import {createNativeGoogleCloudPort,type NativeGoogleBinding} from './native-google-cloud-port.ts';

/** Signed in-process application host; no renderer, browser profile or credential writes. */
export async function startNativeGoogleAgentHost(options:{binding:NativeGoogleBinding;apiToken:string;request?:typeof fetch;assertCurrent?:()=>void}) {
 if(!/^[A-Za-z0-9_-]{64}$/.test(options.apiToken))throw Error('Private native agent authentication is unavailable');
 const retired=new AbortController();
 const port=createNativeGoogleCloudPort(options.binding,()=>{retired.signal.throwIfAborted();options.assertCurrent?.();},options.request);
 const host=await startManagedGoogleAgentHost({port,apiToken:options.apiToken});
 return {port:host.port,async close(){if(!retired.signal.aborted)retired.abort();await host.close();}};
}

/** Same private broker lifecycle for an existing host-owned Cloud port. */
export async function startManagedGoogleAgentHost(options:{port:ManagedGoogleAgentPort;apiToken:string;access?:()=>GoogleAgentAccess}) {
 if(!/^[A-Za-z0-9_-]{64}$/.test(options.apiToken))throw Error('Private agent authentication is unavailable');
 const broker=createManagedGoogleAgentBroker({host:createManagedGoogleAgentHost(options.port,options.access),async authorized(value){
  const actual=Buffer.from(value??''),expected=Buffer.from('Bearer '+options.apiToken);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
 }});
 const server=createServer({maxHeaderSize:8192},(req,res)=>void broker(req,res));
 server.requestTimeout=35000;server.headersTimeout=5000;
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(new Promise<void>((resolve,reject)=>{
  if(!server.listening){resolve();return;}
  server.close(error=>error?reject(error):resolve());server.closeAllConnections();
 }));
 try{
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw Error('Private Google host did not bind');
  return {port:address.port,close};
 }catch(error){await close();throw error;}
}
