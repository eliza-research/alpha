import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {managedServiceRequest} from './managed-service-routes.ts';
import {Capacitor} from '@capacitor/core';
/** Explicit loopback development host with real Cloud services; never enabled in built artifacts. */
export const browserCloudResidentEnabled=import.meta.env!==undefined&&import.meta.env.DEV===true&&import.meta.env.VITE_ALPHA_CLOUD_RESIDENT==='1'&&!Capacitor.isNativePlatform();
export const browserCloudResidentEnvironment=browserCloudResidentEnabled&&import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT==='staging'?'staging':'production';
/** Why an own-key setup failed, without provider text: the host sends none, and a key never reaches the screen. */
export const OWN_KEYS_NOT_SET_UP='Keys rejected';
export async function browserResidentCall(operation:'residentOwn'|'residentCloud'|'residentBind'|'residentClear'|'residentStatus'|'residentStart'|'residentGoogleCalendarAccess',credentialId?:string,calendarEdits?:boolean,keys?:{apiKey:string;cartesiaKey?:string},signal?:AbortSignal){
 signal?.throwIfAborted();
 if(!browserCloudResidentEnabled)throw Error('Cloud resident host unavailable');
 const response=await fetch('/__alpha-browser-cloud',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify({...keys,operation,environment:browserCloudResidentEnvironment,credentialId,...(operation==='residentGoogleCalendarAccess'?{calendarEdits}:{})}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),redirect:'error'});
 signal?.throwIfAborted();
 if(!response.ok)throw Error(operation==='residentOwn'?OWN_KEYS_NOT_SET_UP:'Cloud resident binding unavailable');
 return response.json();
}

export interface BrowserProviderStatus {
 mode:'cloud'|'own';revision:string;persistence:'host-session';
 keys:{text:{configured:boolean};voice:{configured:boolean}};
 provider:'cerebras'|'elizacloud';configured:boolean;selected:boolean;voiceConfigured:boolean;
 model:string;attachable:boolean;
}
export interface BrowserProviderReveal {key:'text'|'voice';value:string;revision:string}
export interface BrowserProviderInputMap {
 residentProviderSelect:{mode:'cloud'|'own';expectedRevision:string};
 residentProviderEdit:{textKey?:string;voiceKey?:string;expectedRevision:string};
 residentProviderRemove:{key:'text'|'voice';expectedRevision:string};
 residentProviderReveal:{key:'text'|'voice';expectedRevision:string};
}
export type BrowserProviderOperation=keyof BrowserProviderInputMap;
export type BrowserProviderResultMap={
 [Operation in BrowserProviderOperation]:Operation extends 'residentProviderReveal'?BrowserProviderReveal:BrowserProviderStatus;
};
/** Explicit local-owner key management. Absent edit fields stay absent. Only
 * reveal returns a value; callers keep that result in their protected transient
 * surface, never in connection snapshots, logs, storage or model context. */
export async function browserProviderCall<Operation extends BrowserProviderOperation>(operation:Operation,input:BrowserProviderInputMap[Operation],signal?:AbortSignal):Promise<BrowserProviderResultMap[Operation]> {
 signal?.throwIfAborted();
 if(!browserCloudResidentEnabled)throw Error('Cloud resident host unavailable');
 const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
 try{
  const response=await fetch('/__alpha-browser-cloud',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify({...input,operation,environment:browserCloudResidentEnvironment}),signal:requestSignal,redirect:'error',cache:'no-store'});
  requestSignal.throwIfAborted();
  if(!response.ok)throw Error('Provider request refused');
  const value:unknown=await response.json();
  // Cancellation during body consumption must never publish a late revealed key.
  requestSignal.throwIfAborted();
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid provider response');
  const row=value as Record<string,unknown>;
  if(operation==='residentProviderReveal'){
   const request=input as BrowserProviderInputMap['residentProviderReveal'];
   if(row.key!==request.key||row.revision!==request.expectedRevision||typeof row.value!=='string'||!row.value)throw Error('Provider reveal changed');
   return {key:request.key,value:row.value,revision:request.expectedRevision} as BrowserProviderResultMap[Operation];
  }
  const keys=row.keys as BrowserProviderStatus['keys']|undefined;
  if((row.mode!=='cloud'&&row.mode!=='own')||(row.provider!=='cerebras'&&row.provider!=='elizacloud')||typeof row.revision!=='string'||!row.revision||row.persistence!=='host-session'||typeof row.model!=='string'||typeof row.attachable!=='boolean'||typeof row.configured!=='boolean'||typeof row.selected!=='boolean'||typeof row.voiceConfigured!=='boolean'||typeof keys?.text?.configured!=='boolean'||typeof keys?.voice?.configured!=='boolean')throw Error('Invalid provider status');
  // Project status fields rather than forwarding unexpected host payloads.
  return {mode:row.mode,revision:row.revision,persistence:'host-session',keys:{text:{configured:keys.text.configured},voice:{configured:keys.voice.configured}},provider:row.provider,configured:row.configured,selected:row.selected,voiceConfigured:row.voiceConfigured,model:row.model,attachable:row.attachable} as BrowserProviderResultMap[Operation];
 }catch{
  signal?.throwIfAborted();
  if(requestSignal.aborted)throw new DOMException('Timed out','TimeoutError');
  throw Error(operation==='residentProviderEdit'?OWN_KEYS_NOT_SET_UP:'Unavailable');
 }
}

/** The loopback browser Cloud host signs in through the Cloud sign-in hand-off (cli-session). It is a
 * development route only; product route policy (managed-service-routes.ts) never admits it. */
function browserCloudSignInHandOff(input:string,method:string,hasBody:boolean):boolean {
 if(!browserCloudResidentEnabled)return false;
 let url:URL;try{url=new URL(input);}catch{return false;}
 const api=browserCloudResidentEnvironment==='staging'?stagingCloud.api:productionCloud.api;
 if(url.origin!==api||url.username||url.password||url.hash||url.search)return false;
 if(method==='POST')return url.pathname==='/api/auth/cli-session';
 return method==='GET'&&!hasBody&&/^\/api\/auth\/cli-session\/[0-9a-fA-F-]{36}$/.test(url.pathname);
}
/** Reuse the production route policy for one exact, explicitly selected development issuer. */
export function browserCloudManagedServiceAllowed(input:string,method:string,hasBody=false):boolean {
 if(browserCloudSignInHandOff(input,method,hasBody))return true;
 if(browserCloudResidentEnabled&&browserCloudResidentEnvironment==='staging'){
  let url:URL;try{url=new URL(input);}catch{return false;}
  if(url.origin!==stagingCloud.api)return false;
  // Policy comparison only. The transport still dispatches the original staging URL.
  url.hostname=new URL(productionCloud.api).hostname;
  return managedServiceRequest(url.href,method,hasBody);
 }
 return managedServiceRequest(input,method,hasBody);
}
