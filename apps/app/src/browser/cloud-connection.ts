import {productionCloud,stagingCloud} from '../runtime/cloud-deployment.generated';
import {anyAbortSignal} from '../runtime/abort-signal';
import {googleAuthorizationUrlAllowed} from '../runtime/google-authorization';
import {WebPlugin} from '@capacitor/core';
import type {CloudCredential,CloudEnvironment} from '../runtime/cloud-protocol';
import {cloudVoiceLimitOf,type CloudVoiceLimitFacts} from '../runtime/cloud-voice-limit';

const endpoint='/__alpha-browser-cloud';
const references=new Map<string,string|null>();
export async function browserCloudCall(data:Record<string,unknown>,signal?:AbortSignal):Promise<Response>{
 return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify(data),signal:signal?anyAbortSignal([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),redirect:'error'});
}
async function rpc(data:Record<string,unknown>,signal?:AbortSignal){const response=await browserCloudCall(data,signal);if(!response.ok)throw Object.assign(Error('Cloud development connection unavailable.'),{status:response.status});return response.json();}
/** Development host storage references only. Cloud bearers never enter browser storage. */
export class BrowserCloudConnection extends WebPlugin {
 async request(input:{requestId:string;url:string;method:string;headers:Record<string,string>;body?:string;credentialReference?:string}){
  const origin=new URL(input.url).origin,environment=origin===productionCloud.api?'production':origin===stagingCloud.api?'staging':undefined;
  if(!environment)throw Error('Cloud development authority unavailable');
  const response=await browserCloudCall({operation:'request',requestId:input.requestId,environment,input}),data=await response.json();
  return response.ok?data:{status:response.status,data};
 }
 async cancel(input:{requestId:string}){await rpc({operation:'cancel',requestId:input.requestId});}
 async secureRead(input:{slot:string}){
  const result=await rpc({operation:'secureRead',...input});
  references.set(input.slot,result.value===null?null:JSON.parse(result.value).credentialReference);return result;
 }
 async secureWrite(input:{slot:string;value:string}){
  await rpc({operation:'secureWrite',...input,previousReference:references.get(input.slot)??null});references.set(input.slot,JSON.parse(input.value).credentialReference);
 }
 async secureRemove(input:{slot:string}){await rpc({operation:'secureRemove',...input,previousReference:references.get(input.slot)??null});references.set(input.slot,null);}
 async secureCompareExchange(input:{slot:string;expectedValue:string|null;value:string|null}){
  const result=await rpc({operation:'secureCompareExchange',...input,previousReference:references.get(input.slot)??null});if(result.status==='saved')references.set(input.slot,input.value===null?null:JSON.parse(input.value).credentialReference);return result;
 }
 async openExternal(input:{url:string;requestId:string}){
  const url=new URL(input.url),sessions=url.searchParams.getAll('session'),apps=url.searchParams.getAll('app');
  const login=[productionCloud.web,stagingCloud.web].some(origin=>origin===url.origin)&&url.pathname==='/auth/cli-login'&&sessions.length===1&&/^[0-9a-f-]{36}$/i.test(sessions[0])&&(apps.length===0||apps.length===1&&apps[0]==='alpha')&&[...url.searchParams.keys()].every(k=>k==='session'||k==='app');
  const billing=[productionCloud.agents,stagingCloud.agents].some(host=>host===url.host)&&url.pathname==='/cloud/billing'&&!url.search;
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!login&&!billing&&!googleAuthorizationUrlAllowed(url.href))throw Error('Unsupported Cloud browser destination');
  const opened=window.open(url.href,'_blank');if(!opened)throw Error('Allow the Cloud sign-in window, then try again.');opened.opener=null;
 }
}
/** Private browser-host credential cleanup. Never routes through the native secure-store plugin. */
export async function clearBrowserCloudCredentialIfCurrent(environment:CloudEnvironment,expected:CloudCredential|null){
 if(environment!=='production'&&environment!=='staging')throw Error('Unsupported Cloud environment');
 if(expected!==null&&(!expected.credentialReference||expected.token))throw Error('A browser Cloud reference is required');
 const host=new BrowserCloudConnection(),slot='cloud:'+environment;
 const result=await host.secureCompareExchange({slot,expectedValue:expected===null?null:JSON.stringify(expected),value:null});
 // A lost swap is success only when the slot is already empty; another account's reference stays and is reported.
 if(result.status==='conflict'&&(await host.secureRead({slot})).value!==null)throw Error('Cloud account changed');
}
/** Binds native-compatible voice calls to the current host reference and account generation. */
export async function browserCloudCredential(environment:string,credentialId:string,signal:AbortSignal){
 const stored=await rpc({operation:'secureRead',slot:'cloud:'+environment},signal),credential=stored.value===null?null:JSON.parse(stored.value);signal.throwIfAborted();
 if(!credential?.credentialReference)throw Object.assign(Error('Sign in to Cloud before using voice.'),{code:'voice-http-401',status:401});
 if(credential.credentialId!==credentialId)throw new DOMException('Cloud account changed','AbortError');return credential;
}
export async function browserCloudVoice(input:{environment:string;credentialId:string;requestId:string},operation:'stt'|'tts',payload:Blob|string,signal:AbortSignal):Promise<Response>{
 const credential=await browserCloudCredential(input.environment,input.credentialId,signal);
 const values={operation,environment:input.environment,credentialId:input.credentialId,requestId:input.requestId,credentialReference:credential.credentialReference};let response:Response;
 if(operation==='stt'){
  if(!(payload instanceof Blob))throw Error('Recorded audio required');const form=new FormData();for(const [key,value]of Object.entries(values))form.append(key,value);form.append('audio',payload,'recording');
  response=await fetch(endpoint,{method:'POST',headers:{'X-Alpha-Browser-Cloud':'1'},body:form,signal:anyAbortSignal([signal,AbortSignal.timeout(120000)]),redirect:'error'});
 }else response=await browserCloudCall({...values,text:payload},signal);
 signal.throwIfAborted();if(!response.ok){
  // The development bridge passes a 429's retry facts only (cloud-voice-limit.ts); they are validated again.
  let data:CloudVoiceLimitFacts|undefined;
  if(response.status===429){try{const body=await response.json() as {limit?:unknown};data=cloudVoiceLimitOf({code:'voice-http-429',data:body?.limit})??undefined;}catch{data=undefined;}}else await response.body?.cancel();
  throw Object.assign(Error('Cloud voice request failed.'),{code:'voice-http-'+response.status,status:response.status,...(data?{data}:{})});
 }return response;
}
/** Development host sign-in (in-app email code or canonical hosted Google OAuth). The host keeps the Steward session and the key;
 * this page receives only non-secret outcomes. Google uses the canonical hosted web flow. */
export class BrowserCloudSignIn extends WebPlugin {
 private googleController?:AbortController;
 private googlePopup?:Window;
 private googleAttemptId?:string;
 private async signIn(data:Record<string,unknown>,signal?:AbortSignal){
  const response=await browserCloudCall(data,signal);let body:unknown;try{body=await response.json();}catch{/* An unreadable reply cannot confirm cancellation. */}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(Error('Cloud development sign-in failed'),{code:'unavailable'});
  const result=body as Record<string,unknown>;
  if(!response.ok)throw Object.assign(Error('Cloud development sign-in failed'),{code:typeof result.code==='string'?result.code:'unavailable'});
  return result;
 }
 async serviceInfo(input:{environment:CloudEnvironment}){return this.signIn({operation:'signInServiceInfo',environment:input.environment});}
 async startGoogle(input:{environment:CloudEnvironment}){
  if(this.googleController)throw Object.assign(Error('Sign-in already active'),{code:'login-active'});
  // Called before the first await in the user-click path; do not defer popup creation.
  if(typeof window==='undefined')throw Object.assign(Error('Browser sign-in window unavailable'),{code:'browser-unavailable'});
  const popup=window.open('about:blank','_blank');if(!popup)throw Object.assign(Error('Allow the sign-in window and try again.'),{code:'browser-unavailable'});
  popup.opener=null;this.googlePopup=popup;const attemptId=this.googleAttemptId=crypto.randomUUID();const controller=this.googleController=new AbortController();
  try{
   const started=await this.signIn({operation:'signInStartGoogle',environment:input.environment,attemptId},controller.signal);
   const url=new URL(String(started.browserUrl)),origin=input.environment==='production'?productionCloud.web:stagingCloud.web;
   if(url.origin!==origin||url.pathname!=='/auth/cli-login'||url.username||url.password||url.hash||url.searchParams.getAll('app').length!==1||url.searchParams.get('app')!=='alpha'||url.searchParams.getAll('provider').length!==1||url.searchParams.get('provider')!=='google'||url.searchParams.getAll('session').length!==1||!/^[0-9a-f-]{36}$/i.test(url.searchParams.get('session')||'')||[...url.searchParams.keys()].some(key=>!['session','app','provider'].includes(key))||started.attemptId!==attemptId||!Number.isFinite(started.expiresAt)||Number(started.expiresAt)<=Date.now())throw Object.assign(Error('Invalid sign-in response'),{code:'unavailable'});
   controller.signal.throwIfAborted();popup.location.replace(url.href);
   while(Date.now()<Number(started.expiresAt)){
    // OAuth COOP or a successful auto-close may detach the handle. Only the
    // host outcome, explicit Cancel or expiry can retire this login.
    const result=await this.signIn({operation:'signInPollGoogle',attemptId:started.attemptId},controller.signal);
    if(result.status==='authenticated')return result;
    await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);reject(controller.signal.reason);},timer=setTimeout(done,1000);controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
   }
   throw Object.assign(Error('Sign-in expired'),{code:'expired'});
  }finally{controller.abort();popup.close();if(this.googleController===controller){this.googleController=undefined;this.googlePopup=undefined;this.googleAttemptId=undefined;await this.signIn({operation:'signInCancelGoogle',attemptId}).catch(()=>{});}}
 }
 async startEmail(input:{environment:string;email:string}){return this.signIn({operation:'signInStartEmail',environment:input.environment,email:input.email});}
 async verifyEmail(input:{attemptId:string;code:string}){return this.signIn({operation:'signInVerifyEmail',attemptId:input.attemptId,code:input.code});}
 async verifyMfa(input:{attemptId:string;code:string}){return this.signIn({operation:'signInVerifyMfa',attemptId:input.attemptId,code:input.code});}
 async cancelGoogleSignIn(){
  const attemptId=this.googleAttemptId,controller=this.googleController,popup=this.googlePopup;if(!attemptId)return {status:'cancelled'};
  const outcome=await this.signIn({operation:'signInCancelGoogle',attemptId});
  if(outcome.status==='authenticated'){
   if(outcome.attemptId!==attemptId)throw Object.assign(Error('Cloud development sign-in failed'),{code:'unavailable'});
   return outcome;
  }
  if(outcome.status!=='cancelled'||Object.keys(outcome).some(key=>key!=='status'))throw Object.assign(Error('Cloud sign-in cancellation is unconfirmed'),{code:'unavailable'});
  // The answer belongs to the attempt that sent it, even if another attempt is now open.
  if(this.googleAttemptId===attemptId&&this.googleController===controller&&this.googlePopup===popup){controller?.abort();popup?.close();}
  return outcome;
 }
 async cancel(){
  if(this.googleAttemptId){await this.cancelGoogleSignIn();return;}
  await this.signIn({operation:'signInCancel'}).catch(()=>{});
 }
 async status(input?:{environment:CloudEnvironment}){return this.signIn({operation:'signInStatus',...(input?{environment:input.environment}:{})});}
}
