import {nativeGoogleWorkspaceReturnAvailable,type GoogleWorkspaceBinding,type GoogleWorkspaceReturnPort} from './google-workspace-return';
import {cloudStorageSlot} from './cloud-deployment.generated.ts';
import {browserCloudResidentEnabled,browserCloudManagedServiceAllowed} from './browser-cloud-resident';
import {managedServiceRequest} from './managed-service-routes';
import {ownerRouteAllowed} from './owner-route-policy';
import {BrowserCloudConnection,BrowserCloudSignIn,clearBrowserCloudCredentialIfCurrent} from '../browser/cloud-connection';
import {Capacitor} from '@capacitor/core';
import {devSurfacesEnabled,testMocksEnabled,privateLocalPreviewEnabled} from '../build-flags';
import { registerPlugin } from '../platform-plugins';
import type { CloudNativeRequest, CloudCredentialStore, CloudCredential, CloudEnvironment } from './cloud-protocol';
import type { CloudSignInPort } from './cloud-sign-in';
import type { RemoteRequester, RemoteCredentialStore } from './remote-protocol';

const nativeConnectionHeader=(Capacitor as typeof Capacitor&{PluginHeaders?:{name:string}[]}).PluginHeaders?.some(header=>header.name==='AlphaConnection')??false;
const browserCloudHost=(devSurfacesEnabled||browserCloudResidentEnabled||privateLocalPreviewEnabled)&&!Capacitor.isNativePlatform()&&!nativeConnectionHeader;
/** Exact current-key self-revocation is supported only by the owned Android/private browser hosts. */
export const cloudSelfRevocationSupported=Capacitor.getPlatform()==='android'||browserCloudHost;
const nativeSignInHeader=(Capacitor as typeof Capacitor&{PluginHeaders?:{name:string}[]}).PluginHeaders?.some(header=>header.name==='AlphaCloudSignIn')??false;
/**
 * In-app Eliza Cloud sign-in host: AlphaCloudSignInPlugin on Android, or the development Cloud bridge
 * (email code only) in a test-mocks browser build. Undefined where this build has no sign-in.
 */
/** Google sign-in needs the phone's App Link return; the browser bridge offers email only. */
export const cloudSignInGoogle=nativeSignInHeader;
export const cloudSignInPhone=(Capacitor as typeof Capacitor&{PluginHeaders?:{name:string;methods?:{name:string}[]}[]}).PluginHeaders?.some(header=>header.name==='AlphaCloudSignIn'&&header.methods?.some(method=>method.name==='startPhone')&&header.methods?.some(method=>method.name==='verifyPhone'))??false;
export const cloudSignIn:CloudSignInPort|undefined=nativeSignInHeader?registerPlugin<CloudSignInPort>('AlphaCloudSignIn')
  :browserCloudHost?registerPlugin<CloudSignInPort>('AlphaCloudSignIn',{web:()=>new BrowserCloudSignIn()}):undefined;

export interface ConnectionPort {
  prepareGoogleWorkspaceReturn?(binding:GoogleWorkspaceBinding):ReturnType<GoogleWorkspaceReturnPort['prepare']>;
  consumeGoogleWorkspaceReturn?(binding:GoogleWorkspaceBinding):ReturnType<GoogleWorkspaceReturnPort['consume']>;
  cancelGoogleWorkspaceReturn?(input:{state:string}):Promise<void>;
  addListener?(name:'googleWorkspaceReturn',listener:()=>void):Promise<{remove():void|Promise<void>}>;

  /** `retryAfter` is the Retry-After header of an error response (seconds or an HTTP date), when present. */
  request(input: { requestId: string; url: string; method: string; headers: Record<string,string>; body?: string; credentialReference?:string; expiresAt?: number }): Promise<{status:number;data:unknown;retryAfter?:string}>;
  cancel(input:{requestId:string}):Promise<void>;
  secureRead(input:{slot:string}):Promise<{value:string|null}>;
  secureWrite(input:{slot:string;value:string}):Promise<void>;
  secureCompareExchange(input:{slot:string;expectedValue:string|null;value:string|null}):Promise<{status:"saved"|"conflict"}>;
  secureRemove(input:{slot:string}):Promise<void>;
  openExternal(input:{url:string;requestId:string}):Promise<void>;
}
/** Secret storage for the web build's connection slots only. Values are AES-GCM encrypted with a
 * non-extractable key held in IndexedDB; without IndexedDB they live in memory for this page only.
 * This is not Android Keystore: any script running on this origin can use the key. */
export interface BrowserSecretBackend {
  read(slot:string):Promise<string|null>;
  /** Atomic within this origin: replaces only when the current value equals expected. */
  compareExchange(slot:string,expected:string|null|undefined,value:string|null):Promise<boolean>;
}
/** Web slots are limited to agent connection credentials. Other renderer stores keep their own
 * browser documents and must not silently start writing secrets here. */
export const browserConnectionSlot=(slot:unknown):string=>{
  if(typeof slot!=='string'||!slot||slot.length>1024||!/^(remote|cloud|device|cloud-runtime):[^\s]+$/.test(slot))throw new Error('This secure slot is unavailable in the browser.');
  return slot;
};
export function memorySecretBackend():BrowserSecretBackend{
  const values=new Map<string,string>();
  return {
    async read(slot){return values.get(slot)??null;},
    async compareExchange(slot,expected,value){if(expected!==undefined&&(values.get(slot)??null)!==expected)return false;if(value===null)values.delete(slot);else values.set(slot,value);return true;},
  };
}
const SECRET_DATABASE='alpha-connection-secrets.v1';
function idb<T>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
/** IndexedDB values are {iv,data}; the CryptoKey is structured-cloned and never exported. */
export function indexedDbSecretBackend(factory:IDBFactory=indexedDB,subtle:SubtleCrypto=crypto.subtle):BrowserSecretBackend{
  let opened:Promise<{db:IDBDatabase;key:CryptoKey}>|null=null;
  const open=()=>opened??=(async()=>{
    const request=factory.open(SECRET_DATABASE,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys');if(!db.objectStoreNames.contains('slots'))db.createObjectStore('slots');};
    const db=await idb(request);
    let key=await idb(db.transaction('keys','readonly').objectStore('keys').get('aes')) as CryptoKey|undefined;
    if(!key){
      const generated=await subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys');
      // Another tab may have generated first; keep whichever key is stored.
      const existing=await idb(store.get('aes')) as CryptoKey|undefined;
      if(!existing)store.put(generated,'aes');
      await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      key=existing??generated;
    }
    return {db,key};
  })().catch(error=>{opened=null;throw error;});
  const decrypt=async(key:CryptoKey,stored:unknown,slot:string):Promise<string|null>=>{
    if(stored===undefined)return null;
    const value=stored as {iv?:unknown;data?:unknown};
    if(!(value?.iv instanceof Uint8Array)||!(value.data instanceof ArrayBuffer))throw new Error('Stored connection secret is invalid.');
    return new TextDecoder().decode(await subtle.decrypt({name:'AES-GCM',iv:value.iv as Uint8Array<ArrayBuffer>,additionalData:new TextEncoder().encode(slot)},key,value.data));
  };
  const locked=<T>(slot:string,work:()=>Promise<T>):Promise<T>=>typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request(`${SECRET_DATABASE}:${slot}`,work) as Promise<T>:work();
  return {
    async read(slot){const {db,key}=await open();return decrypt(key,await idb(db.transaction('slots','readonly').objectStore('slots').get(slot)),slot);},
    compareExchange(slot,expected,value){return locked(slot,async()=>{
      const {db,key}=await open();
      // Crypto awaits cannot run inside an IndexedDB write transaction. Capture ciphertext,
      // prepare outside the transaction, then compare the exact stored ciphertext again in
      // that transaction before writing. This also fences other tabs without Web Locks.
      for (;;) {
        const observed=await idb(db.transaction('slots','readonly').objectStore('slots').get(slot));
        if(expected!==undefined&&await decrypt(key,observed,slot)!==expected)return false;
        let record:{iv:Uint8Array;data:ArrayBuffer}|null=null;
        if(value!==null){const iv=crypto.getRandomValues(new Uint8Array(12));record={iv,data:await subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(slot)},key,new TextEncoder().encode(value))};}
        const bytesEqual=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((byte,index)=>byte===b[index]);
        let matched=false;
        const tx=db.transaction('slots','readwrite'),store=tx.objectStore('slots'),request=store.get(slot);
        request.onsuccess=()=>{
          const live=request.result;
          matched=observed===undefined?live===undefined:!!live&&bytesEqual(new Uint8Array(observed.iv),new Uint8Array(live.iv))&&bytesEqual(new Uint8Array(observed.data),new Uint8Array(live.data));
          if(matched){if(record)store.put(record,slot);else store.delete(slot);}
        };
        await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        if(matched)return true;
        if(expected!==undefined)return false;
      }
    });},
  };
}
function webSecrets():BrowserSecretBackend{
  if(typeof indexedDB==='undefined'||typeof crypto==='undefined'||!crypto.subtle)return memorySecretBackend();
  const durable=indexedDbSecretBackend(),fallback=memorySecretBackend();
  let degraded=false;
  // Private windows can refuse IndexedDB. Keep this page usable without claiming persistence.
  const use=async<T>(work:(backend:BrowserSecretBackend)=>Promise<T>)=>{if(degraded)return work(fallback);try{return await work(durable);}catch(error){if(error instanceof DOMException&&['InvalidStateError','UnknownError','SecurityError','NotSupportedError'].includes(error.name)){degraded=true;return work(fallback);}throw error;}};
  return {read:slot=>use(backend=>backend.read(cloudStorageSlot(slot))),compareExchange:(slot,expected,value)=>use(backend=>backend.compareExchange(cloudStorageSlot(slot),expected,value))};
}
/** Plain-HTTP loopback agents are a test-mocks surface; flag-off bundles accept HTTPS only. */
const webDevelopmentHttp:boolean=import.meta.env!==undefined&&import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1';
/** Product builds send managed Cloud requests only. Device and phone-protocol headers declare this
 * phone to a hosted or paired agent runtime, which exists only in test-mocks builds (#406). */
const allowedHeaders=new Set(['accept','content-type','authorization',...(testMocksEnabled?['x-eliza-device-id','x-eliza-device-key','x-eliza-device-capabilities','x-eliza-phone-protocol']:[])]);
/** Browser AlphaConnection: managed-service HTTPS without redirects or cookies.
 * Remote connections are available only in explicitly enabled development builds. */
export function createBrowserConnection(options:{fetch?:typeof fetch;secrets?:BrowserSecretBackend;open?:(url:string)=>boolean;allowHttp?:boolean}={}):ConnectionPort{
  const requests=new Map<string,AbortController>();
  const doFetch=options.fetch??((input,init)=>fetch(input,init));
  let secrets=options.secrets;
  const store=()=>secrets??=webSecrets();
  const queue=new Map<string,Promise<unknown>>();
  const serialSlot=<T>(slot:string,work:()=>Promise<T>):Promise<T>=>{const previous=queue.get(slot)??Promise.resolve();const result=previous.then(work,work);const tail=result.catch(()=>{});queue.set(slot,tail);void tail.then(()=>{if(queue.get(slot)===tail)queue.delete(slot);});return result;};
  const allowHttp=options.allowHttp??webDevelopmentHttp;
  return {
    async request(input){
      if(typeof input?.requestId!=='string'||!input.requestId||input.requestId.length>256||requests.has(input.requestId))throw new Error('Invalid request');
      let url:URL;try{url=new URL(input.url);}catch{throw new Error('Connection request failed');}
      if(!testMocksEnabled&&!managedServiceRequest(input.url,input.method,input.body!==undefined))throw new Error('Only managed Cloud services are available.');
      const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if(url.username||url.password||!(url.protocol==='https:'||(allowHttp&&loopback&&url.protocol==='http:')))throw new Error('Connection request failed');
      if(input.method!=='GET'&&input.method!=='POST'&&!ownerRouteAllowed('automations',url.pathname+url.search,input.method)&&!managedServiceRequest(input.url,input.method,input.body!==undefined))throw new Error('Connection request failed');
      if(input.credentialReference)throw new Error('This credential requires its native or development host.');
      if(input.method==='GET'&&input.body!==undefined)throw new Error('Connection request failed');
      const headers=new Headers();
      for(const [name,value] of Object.entries(input.headers||{})){if(!allowedHeaders.has(name.toLowerCase())||typeof value!=='string'||value.length>16384||/[\r\n]/.test(value))throw new Error('Connection request failed');headers.set(name,value);}
      if(input.body!==undefined)JSON.parse(input.body);
      const controller=new AbortController();requests.set(input.requestId,controller);
      try{
        const response=await doFetch(url.href,{method:input.method,headers,body:input.body,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors'});
        if(response.type==='opaqueredirect'||response.status>=300&&response.status<400)throw new Error('Connection request failed');
        const text=await response.text();
        if(text.length>2*1024*1024)throw new Error('Connection request failed');
        let data:unknown=null;
        if(text){try{data=JSON.parse(text);}catch(error){if(response.status<400)throw error;}}
        // Some Cloud refusals give their wait only in this header. Cloud exposes it to CORS reads.
        const retryAfter=response.status>=400?response.headers.get('retry-after'):null;
        return {status:response.status,data,...(retryAfter&&/^[A-Za-z0-9 ,:+-]{1,64}$/.test(retryAfter)?{retryAfter}:{})};
      }catch(error){throw new Error(controller.signal.aborted?'Request cancelled':'Connection request failed',{cause:error});}
      finally{requests.delete(input.requestId);}
    },
    async cancel(input){requests.get(input?.requestId)?.abort();},
    async secureRead(input){const slot=browserConnectionSlot(input?.slot);return {value:await serialSlot(slot,()=>store().read(slot))};},
    async secureWrite(input){const slot=browserConnectionSlot(input?.slot);if(typeof input.value!=='string')throw new Error('Invalid secure value');await serialSlot(slot,()=>store().compareExchange(slot,undefined,input.value));},
    async secureCompareExchange(input){const slot=browserConnectionSlot(input?.slot);return {status:await serialSlot(slot,()=>store().compareExchange(slot,input.expectedValue??null,input.value??null))?'saved':'conflict'};},
    async secureRemove(input){const slot=browserConnectionSlot(input?.slot);await serialSlot(slot,()=>store().compareExchange(slot,undefined,null));},
    async openExternal(input){
      const url=new URL(input.url);
      if(url.protocol!=='https:')throw new Error('Only HTTPS sign-in pages can be opened.');
      // A new tab keeps this page polling. A blocked pop-up is reported instead of navigating away.
      const opened=options.open?options.open(url.href):(()=>{const target=window.open(url.href,'_blank');if(target)target.opener=null;return !!target;})();
      if(!opened)throw new Error('Allow pop-ups for Alpha Phone, then try Cloud sign-in again.');
    },
  };
}
let browserConnection:ConnectionPort|undefined;
// Capacitor keeps the first registration. browser/register.ts imports this module first, so the
// web build gets this implementation while Android keeps the native plugin.
const native = registerPlugin<ConnectionPort>('AlphaConnection',!nativeConnectionHeader&&!Capacitor.isNativePlatform()?{web:()=>browserCloudHost?new BrowserCloudConnection():browserConnection??=createBrowserConnection()}:undefined);

/** Unsupported or unverified native app links retain the existing manual-return flow. */
export const googleWorkspaceReturnPort:GoogleWorkspaceReturnPort|undefined=Capacitor.getPlatform()==='android'&&nativeGoogleWorkspaceReturnAvailable((Capacitor as typeof Capacitor&{PluginHeaders?:unknown}).PluginHeaders)?{
 async prepare(binding){if(binding.environment!=='production')return {supported:false};return native.prepareGoogleWorkspaceReturn?native.prepareGoogleWorkspaceReturn(binding):{supported:false};},
 async consume(binding){return native.consumeGoogleWorkspaceReturn?native.consumeGoogleWorkspaceReturn(binding):{result:'none'};},
 async cancel(state){await native.cancelGoogleWorkspaceReturn?.({state});},
 async subscribe(listener){return native.addListener?native.addListener('googleWorkspaceReturn',listener):{remove(){}};},
}:undefined;

export const secureConnectionStore = {
  async readRaw(slot:string):Promise<string|null> { return (await native.secureRead({slot})).value; },
  async compareExchangeRaw(slot:string,expectedValue:string|null,value:string|null) { return native.secureCompareExchange({slot,expectedValue,value}); },
  async read<T>(slot:string):Promise<T|null> {
    const result=await native.secureRead({slot});
    return result.value===null ? null : JSON.parse(result.value) as T;
  },
  async write(slot:string,value:unknown) { await native.secureWrite({slot,value:JSON.stringify(value)}); },
  async compareExchange(slot:string,expected:unknown|null,value:unknown|null) { return native.secureCompareExchange({slot,expectedValue:expected===null?null:JSON.stringify(expected),value:value===null?null:JSON.stringify(value)}); },
  async remove(slot:string) { await native.secureRemove({slot}); },
};
// Serialize credential operations so a cancellation cleanup cannot erase a later login.
let storageQueue:Promise<unknown>=Promise.resolve();
function serial<T>(operation:()=>Promise<T>):Promise<T> {
  const result=storageQueue.then(operation,operation);storageQueue=result.catch(()=>{});return result;
}
export const cloudCredentialStore:CloudCredentialStore={
  acceptsReferences:browserCloudHost,
  read:environment=>serial(async()=>{
    const value=await secureConnectionStore.read<CloudCredential>(`cloud:${environment}`);
    if(value&&!value.credentialId){value.credentialId=crypto.randomUUID();await secureConnectionStore.write(`cloud:${environment}`,value);}
    return value;
  }),
  write:(environment,value,signal)=>serial(async()=>{
    signal.throwIfAborted();
    await secureConnectionStore.write(`cloud:${environment}`,{...value,credentialId:crypto.randomUUID()});
    if(signal.aborted){await secureConnectionStore.remove(`cloud:${environment}`);signal.throwIfAborted();}
  }),
  // Native credential CAS remains prohibited; only the private browser host admits this capability.
  ...(browserCloudHost?{clearIfCurrent:(environment:CloudEnvironment,expected:CloudCredential|null)=>serial(()=>clearBrowserCloudCredentialIfCurrent(environment,expected))}:{}),
  clear:environment=>serial(()=>secureConnectionStore.remove(`cloud:${environment}`)),
};
/**
 * Forced sign-out of a build that cannot use Eliza Cloud: removes the Cloud key an earlier build
 * stored for this environment. Only the `cloud:<environment>` slot is deleted, without reading or
 * decrypting it; remote-agent, device and every other slot is left alone. Where the browser can list
 * its databases, a browser that never stored a secret is not given a secret store by this.
 */
export async function removeStoredCloudCredential(environment:CloudEnvironment):Promise<void>{
  if(!Capacitor.isNativePlatform()&&typeof indexedDB!=='undefined'&&typeof indexedDB.databases==='function'
    &&!(await indexedDB.databases()).some(database=>database.name===SECRET_DATABASE))return;
  await cloudCredentialStore.clear(environment);
}
export const remoteCredentialStore:RemoteCredentialStore={
  read:origin=>serial(()=>secureConnectionStore.read(`remote:${origin}`)),
  write:record=>serial(()=>secureConnectionStore.write(`remote:${record.origin}`,record)),
  remove:origin=>serial(()=>secureConnectionStore.remove(`remote:${origin}`)),
};
export const nativeCloudRequest:CloudNativeRequest=async input=>{
  input.signal.throwIfAborted();
  if(!testMocksEnabled&&!browserCloudManagedServiceAllowed(input.url,input.method,input.body!==undefined))throw new Error('Only managed Cloud services are available.');
  const requestId=crypto.randomUUID();
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const cancel=()=>{void native.cancel({requestId}).catch(()=>{});rejectAbort(input.signal.reason||new DOMException('Cancelled','AbortError'));};
  input.signal.addEventListener('abort',cancel,{once:true});
  const timerMs=input.expiresAt===undefined?input.timeoutMs:Math.max(1,Math.min(input.expiresAt-Date.now(),2_147_483_647));
  const timer=setTimeout(()=>{void native.cancel({requestId}).catch(()=>{});rejectAbort(new Error('Connection timed out'));},timerMs);
  try {
    // Issue first, then check again: native cancel targets an already-dispatched ID.
    const response=native.request({requestId,url:input.url,method:input.method,headers:input.headers,...(input.credentialReference?{credentialReference:input.credentialReference}:{}),...(input.expiresAt===undefined?{}:{expiresAt:input.expiresAt}),...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
    if(input.signal.aborted)cancel();
    return await Promise.race([response,interrupted]);
  }finally{clearTimeout(timer);input.signal.removeEventListener('abort',cancel);}
};
export const nativeRemoteRequest:RemoteRequester=async input=>{
  const response=await nativeCloudRequest({url:input.url,method:input.method,headers:input.headers,
    body:input.body===undefined?undefined:JSON.parse(input.body),signal:input.signal||new AbortController().signal,timeoutMs:120000,redirect:'error'});
  return {status:response.status,body:response.data};
};
export async function openConnectionBrowser(url:string,signal:AbortSignal) {
  signal.throwIfAborted();
  const requestId=crypto.randomUUID();
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  let nativeRetired=false;
  const retireNative=()=>{if(nativeRetired)return;nativeRetired=true;void native.cancel({requestId}).catch(()=>{});};
  const cancel=()=>{retireNative();rejectAbort(signal.reason||new DOMException('Cancelled','AbortError'));};
  signal.addEventListener('abort',cancel,{once:true});
  // Android also reports the page returning through visibility/focus. A delayed
  // native browser reply must not strand this same login after a real return.
  // Focus alone is insufficient: this page must first have gone to background.
  let backgrounded=false;
  let finishReturn:()=>void=()=>{};
  const returned=new Promise<void>(resolve=>{finishReturn=resolve;});
  const visible=()=>{if(document.hidden)backgrounded=true;else if(backgrounded)finishReturn();};
  const focused=()=>{if(backgrounded&&!document.hidden)finishReturn();};
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('focus',focused);
  try{
    const opened=Promise.resolve(native.openExternal({url,requestId})).then(()=> 'native' as const);
    if(signal.aborted)cancel();
    // One caller continues into the existing foreground-gated, single-use poll.
    // Promise.race also observes a late native rejection; no retry is started.
    const winner=await Promise.race([opened,returned.then(()=> 'foreground' as const),interrupted]);signal.throwIfAborted();
    // Retire only this browser call. The login signal and credential poll stay live.
    if(winner==='foreground')retireNative();
  }catch(error){signal.throwIfAborted();throw error;}finally{
    signal.removeEventListener('abort',cancel);
    document.removeEventListener('visibilitychange',visible);
    window.removeEventListener('focus',focused);
  }
}
