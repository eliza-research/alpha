import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createManagedGoogleAgentHost} from './managed-google-agent-host.ts';
import {createManagedGoogleAgentBroker} from './managed-google-agent-broker.ts';
import {createNativeGoogleCloudPort,type NativeGoogleBinding} from './native-google-cloud-port.ts';
export {nativeCloudRuntime} from './native-cloud-runtime-config.ts';

/** Signed in-process application host; no renderer, browser profile or credential writes. */
export async function startNativeGoogleAgentHost(options:{binding:NativeGoogleBinding;apiToken:string;request?:typeof fetch;assertCurrent?:()=>void}) {
 if(!/^[A-Za-z0-9_-]{64}$/.test(options.apiToken))throw Error('Private native agent authentication is unavailable');
 const retired=new AbortController();
 const port=createNativeGoogleCloudPort(options.binding,()=>{retired.signal.throwIfAborted();options.assertCurrent?.();},options.request);
 const broker=createManagedGoogleAgentBroker({host:createManagedGoogleAgentHost(port),async authorized(value){
  const actual=Buffer.from(value??''),expected=Buffer.from('Bearer '+options.apiToken);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
 }});
 const server=createServer({maxHeaderSize:8192},(req,res)=>void broker(req,res));
 server.requestTimeout=35000;server.headersTimeout=5000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw Error('Native Google host did not bind');
 return {port:address.port,async close(){
  if(!retired.signal.aborted)retired.abort();
  await new Promise<void>((resolve,reject)=>{
   server.close(error=>error?reject(error):resolve());
   server.closeAllConnections();
  });
 }};
}
