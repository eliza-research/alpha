import {productionCloud, stagingCloud, cloudStorageNamespace} from '../apps/app/src/runtime/cloud-deployment.generated.ts';
import {createCloudResidentHost} from './cloud-resident-host.mjs';
import {startManagedGoogleAgentHost} from '../backend/native-google-agent-host.ts';
import {managedGoogleRequest,boundedServiceJson,object} from '../backend/managed-google-route-policy.ts';
import {CLOUD_EMAIL_CODE,emailCodeExpiresAt,emailCodeResendAt,emailCodeSendBody,emailCodeVerifyBody} from './cloud-email-code.ts';
import {parseCloudServiceInfo} from '../apps/app/src/runtime/cloud-service-info.ts';
import {readCloudVoiceLimit,type CloudVoiceLimitFacts} from '../apps/app/src/runtime/cloud-voice-limit.ts';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Plugin} from 'vite';

export const BROWSER_CLOUD_BRIDGE_PATH='/__alpha-browser-cloud';
const UUID=/^[0-9a-f-]{36}$/i,REFERENCE=/^browser-cloud-reference:[0-9a-f-]{36}$/i;
const authorities={production:productionCloud.api,staging:stagingCloud.api};
type Environment=keyof typeof authorities;
type Credential={credentialReference:string;credentialId:string;userId:string;organizationId:string;email?:string;expiresAt?:number;token?:string;credentialFile?:string;credentialSha256?:string};
const publicCredential=(c:Credential)=>({credentialReference:c.credentialReference,credentialId:c.credentialId,userId:c.userId,organizationId:c.organizationId,...(c.expiresAt===undefined?{}:{expiresAt:c.expiresAt})});
function environment(value:unknown):Environment{if(value!=='production'&&value!=='staging')throw Error('Unsupported Cloud environment');return value;}
function refusal(status:number,code:string){return Object.assign(Error(code),{status,code});}
function requestId(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid request identity');return value;}
/** DEV transport only. Canonical Cloud owns login, identity, plan entitlement and speech authorization. */
export function createBrowserCloudDevHandler(options:{profile:string;request?:typeof fetch;environment?:Environment;diagnostic?:(event:{environment:Environment;operation:string;status:number;code?:string})=>void;resident?:{bind:(credential:{token:string;credentialId:string;reference:string;expiresAt?:number})=>Promise<unknown>;clear:()=>Promise<unknown>;status:(id?:string)=>unknown;ready:(signal:AbortSignal)=>Promise<unknown>}}){
 const profile=path.resolve(options.profile,cloudStorageNamespace.replaceAll(':','-')),stateFile=path.join(profile,'credentials.json'),initialFile=path.join(profile,'initial-credential.json'),fetchCloud=options.request??fetch;
 let queue:Promise<unknown>=Promise.resolve();
 const pending=new Map<string,{environment:Environment;expiresAt:number;previousReference:string|null}>();
 const claims=new Map<string,{environment:Environment;previousReference:string|null;expiresAt:number;credential:Credential}>();
 const active=new Map<string,{controller:AbortController;environment:Environment;credentialId?:string}>();
 async function privateFile(file:string){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Private Cloud file required');return readFile(file,'utf8');}
 async function directory(){await mkdir(profile,{recursive:true,mode:0o700});const st=await lstat(profile);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Private Cloud directory required');}
 async function load():Promise<Partial<Record<Environment,Credential>>>{
  await directory();try{return object(JSON.parse(await privateFile(stateFile)));}catch(error:any){if(error.code!=='ENOENT')throw error;}
  try{const seed=object(JSON.parse(await privateFile(initialFile))),env=environment(seed.environment);if(!REFERENCE.test(seed.credentialReference)||!UUID.test(seed.credentialId)||typeof seed.credentialFile!=='string'||!path.isAbsolute(seed.credentialFile)||typeof seed.credentialSha256!=='string'||!UUID.test(seed.userId)||!UUID.test(seed.organizationId))throw Error('Invalid initial Cloud binding');return {[env]:seed as Credential};}catch(error:any){if(error.code==='ENOENT')return {};throw error;}
 }
 async function save(value:Partial<Record<Environment,Credential>>){if(options.resident)await options.resident.clear();await directory();const tmp=stateFile+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,stateFile);}
 function serial<T>(run:()=>Promise<T>):Promise<T>{const result=queue.then(run,run);queue=result.catch(()=>{});return result;}
 async function keyFor(c:Credential){if(c.token)return c.token;if(!c.credentialFile||!c.credentialSha256)throw Error('Cloud credential unavailable');const token=(await privateFile(c.credentialFile)).trim();if(createHash('sha256').update(token).digest('hex')!==c.credentialSha256)throw Error('Cloud credential changed');return token;}
 async function admitted(env:Environment,reference:unknown,id?:unknown){const c=(await load())[env];if(!c)throw refusal(401,'credentials-missing');if(c.credentialReference!==reference||id!==undefined&&c.credentialId!==id)throw refusal(409,'account-changed');if(c.expiresAt!==undefined&&c.expiresAt<=Date.now())throw refusal(401,'expired');return c;}
 async function current(env:Environment,c:Credential,signal:AbortSignal){signal.throwIfAborted();await admitted(env,c.credentialReference,c.credentialId);await keyFor(c);signal.throwIfAborted();}
 function retire(env:Environment){for(const row of active.values())if(row.environment===env)row.controller.abort(new DOMException('Cloud account changed','AbortError'));for(const [id,login]of pending)if(login.environment===env)pending.delete(id);for(const [ref,claim]of claims)if(claim.environment===env)claims.delete(ref);}
 async function canonical(env:Environment,route:string,signal:AbortSignal,init:RequestInit={},credential?:Credential){const headers=new Headers(init.headers);headers.set('Accept','application/json');headers.set('User-Agent','AlphaPhone-Browser-Cloud/1');if(credential)headers.set('Authorization','Bearer '+await keyFor(credential));const result=await fetchCloud(authorities[env]+route,{...init,headers,redirect:'error',signal});signal.throwIfAborted();return result;}
 // In-app sign-in for the browser development host (email code only: Google needs the phone's App
 // Link). The same Steward and mobile App Auth contracts as AlphaCloudSignInPlugin; the Steward
 // session, PKCE material and the minted key stay in this process and the private profile file.
 type SignInAttempt={controller:AbortController;id:string;environment:Environment;email:string;verifier:string;expiresAt:number;resendAt:number;busy:boolean;failed:number;mfa?:{type:string;challengeId:string}};
 let signIn:SignInAttempt|null=null;
 // One code send per 30 seconds minimum, across addresses; honor longer server deadlines.
 let lastEmailSendAt=0,emailSendAllowedAt=0;const MAX_VERIFY_ATTEMPTS=5;
 const SIGN_IN_CLIENT='ai.elizaresearch.alphaphone',SIGN_IN_CALLBACK={production:productionCloud.web+'/alphaphone/auth/callback',staging:stagingCloud.web+'/alphaphone/auth/callback'} as const;
 const signInFailure=(code:string)=>Object.assign(Error(code),{status:409,code});
 const signInStatus=(stage:string,status:number)=>status===429?'rate-limited':status===410?'expired':status===403?'account-check':(status===400||status===401)&&(stage==='verify'||stage==='mfa')?'invalid-code':status>=500?'unavailable':'rejected';
 async function signInCall(env:Environment,route:string,body:Record<string,unknown>,signal:AbortSignal,bearer?:string){
  let response:Response;
  try{response=await fetchCloud(authorities[env]+route,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'AlphaPhone-Browser-Cloud/1',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body),redirect:'error',signal});}
  catch(error:any){if(signal.aborted)throw signInFailure('cancelled');throw signInFailure('offline');}
  const text=await response.text();signal.throwIfAborted();if(text.length>256*1024)throw signInFailure('unavailable');
  let data:Record<string,any>={};try{if(text)data=object(JSON.parse(text));}catch{if(response.ok)throw signInFailure('unavailable');}
  const codes=new Set(['invalid_client','binding_mismatch','invalid_request','authorization_code_expired','authorization_complete','credential_proof_invalid','invalid_authorization_code','invalid_code_verifier','server_configuration_error']);
  const code=codes.has(data.error)?data.error:codes.has(data.code)?data.code:undefined;
  options.diagnostic?.({environment:env,operation:route,status:response.status,...(code?{code}:{})});
  return {status:response.status,data,retryAfter:response.headers.get('Retry-After')};
 }
 const pkce=()=>{const verifier=randomBytes(48).toString('base64url');return {verifier,challenge:createHash('sha256').update(verifier).digest('base64url'),state:randomBytes(32).toString('base64url')};};
 async function signInComplete(attempt:SignInAttempt,session:Record<string,any>,signal:AbortSignal){
  const token=session.token,refresh=session.refreshToken,env=attempt.environment;
  if(typeof token!=='string'||token.length<20||token.length>16384)throw signInFailure('unavailable');
  try{
   const {verifier,challenge,state}=pkce(),binding={clientId:SIGN_IN_CLIENT,environment:env,redirectUri:SIGN_IN_CALLBACK[env]};
   const connected=await signInCall(env,'/api/v1/app-auth/connect',{flow:'mobile_pkce',...binding,state,codeChallenge:challenge,codeChallengeMethod:'S256',deviceName:'Alpha Phone browser development'},signal,token);
   if(connected.status!==200)throw signInFailure(signInStatus('connect',connected.status));
   if(connected.data.codeType!=='mobile_app_auth_code'||typeof connected.data.code!=='string'||!/^emac_[0-9a-f]{64}$/.test(connected.data.code))throw signInFailure('unavailable');
   const proof={...binding,code:connected.data.code,state,codeVerifier:verifier};
   const minted=await signInCall(env,'/api/v1/app-auth/mobile/token',{...proof,grantType:'authorization_code'},signal);
   if(minted.status!==200)throw signInFailure(signInStatus('token',minted.status));
   const secret=minted.data.secret,credentialId=minted.data.credentialId,expiresAt=Date.parse(minted.data.expiresAt);
   if(minted.data.acknowledgementRequired!==true||typeof secret!=='string'||!secret.startsWith('eliza_mobile_')||secret.length>512||!UUID.test(credentialId)||!(expiresAt>Date.now()))throw signInFailure('unavailable');
   let acknowledged=false;
   for(let attemptNumber=0;attemptNumber<3&&!acknowledged;attemptNumber++){
    if(attemptNumber)await new Promise(resolve=>setTimeout(resolve,1000*2**(attemptNumber-1)));
    const acked=await signInCall(env,'/api/v1/app-auth/mobile/ack',{...proof,credentialId,secret},signal).catch(()=>({status:-1,data:{}as Record<string,any>}));
    if(acked.status===200&&acked.data.status==='acknowledged'&&acked.data.credentialId===credentialId||acked.status===409&&acked.data.error==='authorization_complete')acknowledged=true;
    else if(!(acked.status===-1||acked.status===429||acked.status>=500))break;
   }
   if(!acknowledged)throw signInFailure('activation-pending');
   const identityResponse=await canonical(env,'/api/v1/user',signal,{},{token:secret}as Credential),identity=object(await identityResponse.json()),who=object(identity.data??identity);
   if(!identityResponse.ok||!UUID.test(who.id)||!UUID.test(who.organization_id))throw signInFailure('unavailable');
   await serial(async()=>{const stored=await load();signal.throwIfAborted();if(signIn!==attempt)throw signInFailure('cancelled');stored[env]={token:secret,credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),userId:who.id,organizationId:who.organization_id,expiresAt};retire(env);await save(stored);});
   return {status:'authenticated',environment:env,expiresAt,accountCreated:typeof connected.data.accountCreated==='boolean'?connected.data.accountCreated:null};
  }finally{void signInCall(env,'/steward/auth/logout',typeof refresh==='string'?{refreshToken:refresh}:{},AbortSignal.timeout(10000),token).catch(()=>{});}
 }
 async function signInOperation(data:Record<string,any>,signal:AbortSignal){
  if(data.operation==='signInServiceInfo'){
   if(Object.keys(data).some(key=>key!=='operation'&&key!=='environment'))throw signInFailure('invalid-request');
   const env=environment(data.environment);if(options.environment&&env!==options.environment)throw signInFailure('invalid-request');
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(15000)]),response=await canonical(env,'/api/public/service',bounded,{method:'GET'});
   if(response.status!==200){await response.body?.cancel();throw signInFailure('unavailable');}
   const result=await boundedServiceJson(response);bounded.throwIfAborted();
   return {success:true,version:1,service:parseCloudServiceInfo(result)};
  }
  if(data.operation==='signInCancel'){signIn?.controller.abort();signIn=null;await serial(async()=>{});return {};}
  if(data.operation==='signInStatus')return {active:!!signIn,inApp:true,google:false,email:true};
  if(data.operation==='signInStartEmail'){
   const env=environment(data.environment);if(options.environment&&env!==options.environment)throw Error('Cloud environment mismatch');const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
   if(email.length>320||!/^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+\.[^\s@\p{Cc}\p{Cf}]+$/u.test(email))throw signInFailure('invalid-email');
   if(signIn?.busy)throw signInFailure('login-active');
   if(Date.now()<Math.max(lastEmailSendAt+30000,emailSendAllowedAt))throw signInFailure('cooldown');
   const attempt:SignInAttempt={controller:new AbortController(),id:randomUUID(),environment:env,email,verifier:randomBytes(48).toString('base64url'),expiresAt:0,resendAt:0,busy:true,failed:0};signIn=attempt;lastEmailSendAt=Date.now();signal=AbortSignal.any([signal,attempt.controller.signal]);
   try{
    const sent=await signInCall(env,CLOUD_EMAIL_CODE.sendPath,emailCodeSendBody(env,email,attempt.verifier),signal);
    const reply=sent.data.data&&typeof sent.data.data==='object'?sent.data.data:sent.data;
    emailSendAllowedAt=Math.max(emailSendAllowedAt,emailCodeResendAt(reply.resendAt,sent.retryAfter));
    if(sent.status!==200&&sent.status!==202)throw signInFailure(signInStatus('send',sent.status));
    const expiresAt=emailCodeExpiresAt(reply.expiresAt);
    attempt.expiresAt=expiresAt;attempt.resendAt=emailSendAllowedAt;return {attemptId:attempt.id,expiresAt,resendAt:attempt.resendAt};
   }catch(error){if(signIn===attempt)signIn=null;throw error;}finally{attempt.busy=false;}
  }
  if(data.operation==='signInVerifyEmail'||data.operation==='signInVerifyMfa'){
   const mfa=data.operation==='signInVerifyMfa',attempt=signIn;
   if(!attempt||attempt.id!==data.attemptId||Date.now()>=attempt.expiresAt){signIn=null;throw signInFailure('expired');}
   if(attempt.busy)throw signInFailure('login-active');
   if(attempt.failed>=MAX_VERIFY_ATTEMPTS){signIn=null;throw signInFailure('attempts-exhausted');}
   if(typeof data.code!=='string'||!/^\d{6}$/.test(data.code))throw signInFailure('invalid-code');
   if(mfa!==!!attempt.mfa)throw signInFailure('expired');
   if(mfa&&!['totp','sms'].includes(attempt.mfa!.type))throw signInFailure('mfa-unsupported');
   attempt.busy=true;signal=AbortSignal.any([signal,attempt.controller.signal]);
   try{
    const verified=mfa?await signInCall(attempt.environment,`/steward/auth/mfa/${attempt.mfa!.type}/complete`,{challengeId:attempt.mfa!.challengeId,code:data.code},signal)
     :await signInCall(attempt.environment,CLOUD_EMAIL_CODE.verifyPath,emailCodeVerifyBody(attempt.environment,attempt.email,data.code,attempt.verifier),signal);
    if(verified.status!==200){let code=signInStatus(mfa?'mfa':'verify',verified.status);if(code==='invalid-code'&&++attempt.failed>=MAX_VERIFY_ATTEMPTS)code='attempts-exhausted';if(code!=='invalid-code'&&signIn===attempt)signIn=null;throw signInFailure(code);}
    if(!mfa&&verified.data.mfaRequired===true){
     const challenge=verified.data.mfa;if(!challenge||!['totp','sms','passkey'].includes(challenge.type)||typeof challenge.challengeId!=='string')throw signInFailure('unavailable');
     attempt.mfa={type:challenge.type,challengeId:challenge.challengeId};attempt.failed=0;attempt.expiresAt=Math.min(attempt.expiresAt,Date.parse(challenge.expiresAt)||attempt.expiresAt);
     return {status:'mfa',method:challenge.type,expiresAt:attempt.expiresAt};
    }
    const outcome=await signInComplete(attempt,verified.data,signal);if(signIn===attempt)signIn=null;return outcome;
   }catch(error:any){if(error.code!=='invalid-code'&&signIn===attempt)signIn=null;throw error;}finally{attempt.busy=false;}
  }
  throw Error('Unsupported development operation');
 }
 const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const handler=async(req:IncomingMessage,res:ServerResponse)=>{
  const host=req.headers.host,origin=req.headers.origin;
  if(req.url!=='/'&&req.url!==''&&req.url!==BROWSER_CLOUD_BRIDGE_PATH){send(res,404,{error:'Unknown development route'});return;}
  if(!host||! /^(127\.0\.0\.1|localhost):\d+$/.test(host)||origin!==`http://${host}`||req.method!=='POST'||req.headers['x-alpha-browser-cloud']!=='1'){send(res,403,{error:'Same-origin development request required'});return;}
  let ownedId:string|undefined;const controller=new AbortController(),closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
  try{
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>17_000_000)throw Error('Cloud request too large');chunks.push(Buffer.from(chunk));}
   const bytes=Buffer.concat(chunks),content=req.headers['content-type']||'';let data:Record<string,any>,audio:File|undefined;
   if(content.startsWith('multipart/form-data;')){const form=await new Request('http://127.0.0.1',{method:'POST',headers:{'Content-Type':content},body:bytes}).formData();if([...form.keys()].some(k=>!['operation','environment','credentialReference','credentialId','requestId','audio'].includes(k)))throw Error('Invalid speech form');data=Object.fromEntries([...form].filter(([k])=>k!=='audio'));const value=form.get('audio');if(!(value instanceof File)||value.size<1||value.size>16_000_000||!['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg'].includes(value.type.split(';')[0]))throw Error('Invalid speech audio');audio=value;}
   else{if(content!=='application/json'||size>9*1024*1024)throw Error('JSON development request required');data=object(JSON.parse(bytes.toString('utf8')));}
   if(typeof data.operation==='string'&&data.operation.startsWith('signIn')){send(res,200,await signInOperation(data,controller.signal));return;}
   if(data.operation==='cancel'){active.get(requestId(data.requestId))?.controller.abort();send(res,200,{});return;}
   const slot=data.slot,env=environment(data.environment??(typeof slot==='string'?slot.replace(/^cloud:/,''):undefined));
   if(options.environment&&env!==options.environment)throw Error('Cloud environment mismatch');
   if(typeof data.operation==='string'&&data.operation.startsWith('resident')){
    if(!options.resident||env!==(options.environment??'production')||audio)throw Error('Cloud resident host unavailable');
    if(data.operation==='residentStart'){send(res,200,await options.resident.ready(controller.signal));return;}
    const value=await serial(async()=>{
     if(data.operation==='residentClear')return options.resident!.clear();
     if(data.operation==='residentStatus')return options.resident!.status(typeof data.credentialId==='string'?data.credentialId:undefined);
     if(data.operation!=='residentBind'||!UUID.test(data.credentialId))throw Error('Invalid resident operation');
     const c=(await load())[env];if(!c||c.credentialId!==data.credentialId)throw refusal(409,'account-changed');
     await admitted(env,c.credentialReference,data.credentialId);controller.signal.throwIfAborted();
     const result=await options.resident!.bind({token:await keyFor(c),credentialId:c.credentialId,reference:c.credentialReference,expiresAt:c.expiresAt});
     try{await current(env,c,controller.signal);}catch(error){await options.resident!.clear();throw error;}
     return result;
    });send(res,200,value);return;
   }
   if(data.operation==='secureRead'){if(slot!==`cloud:${env}`)throw Error('Unsupported credential slot');const c=(await load())[env];send(res,200,{value:c?JSON.stringify(publicCredential(c)):null});return;}
   if(data.operation==='secureWrite'||data.operation==='secureRemove'||data.operation==='secureCompareExchange'){
    if(slot!==`cloud:${env}`)throw Error('Unsupported credential slot');await serial(async()=>{
     const state=await load(),old=state[env],expected=data.previousReference??null;if((old?.credentialReference??null)!==expected)throw Error('Cloud account changed');
     if(data.operation==='secureCompareExchange'&&data.expectedValue!==(old?JSON.stringify(publicCredential(old)):null)){send(res,200,{status:'conflict'});return;}
     if(data.operation==='secureRemove'||data.value===null){delete state[env];retire(env);await save(state);send(res,200,data.operation==='secureCompareExchange'?{status:'saved'}:{});return;}
     const value=object(JSON.parse(data.value)),claim=claims.get(value.credentialReference);
     if(claim&&claim.expiresAt<=Date.now())throw refusal(410,'expired');
     if(!claim||claim.environment!==env||claim.previousReference!==(old?.credentialReference??null)||value.token||!UUID.test(value.credentialId))throw refusal(409,'account-changed');
     const claimed=claim.credential;
     if(value.userId!==undefined&&value.userId!==claimed.userId||value.organizationId!==undefined&&value.organizationId!==claimed.organizationId)throw refusal(409,'account-changed');
     controller.signal.throwIfAborted();state[env]={...claimed,credentialId:value.credentialId};retire(env);await save(state);claims.delete(value.credentialReference);send(res,200,data.operation==='secureCompareExchange'?{status:'saved'}:{});
    });return;
   }
   ownedId=requestId(data.requestId);if(active.has(ownedId))throw Error('Cloud request already active');active.set(ownedId,{controller,environment:env,credentialId:data.credentialId});
   if(data.operation==='request'){
    const input=object(data.input);if(typeof input.url!=='string'||input.url.length>12000||/[\\#\s]/.test(input.url))throw Error('Invalid Cloud URL');const rawPath=input.url.split('?')[0];if(rawPath.includes('%')||rawPath.includes('..'))throw Error('Invalid Cloud path');const url=new URL(input.url);if(url.origin!==authorities[env]||url.username||url.password||url.hash||url.port)throw Error('Unsupported Cloud authority');
    const route=url.pathname+url.search;const method=input.method;
    const mapsPost=method==='POST'&&['/api/v1/maps/geocode','/api/v1/maps/reverse','/api/v1/maps/places/search','/api/v1/maps/places/details','/api/v1/maps/routes'].includes(route);
    const headers=object(input.headers??{}),identityHeaders=Object.keys(headers).filter(k=>k.toLowerCase()==='idempotency-key');
    if(Object.keys(headers).some(k=>!['accept','content-type',...(mapsPost?['idempotency-key']:[])].includes(k.toLowerCase())))throw Error('Unsupported Cloud request header');
    let mapsRequestId:string|undefined;
    if(mapsPost){mapsRequestId=headers[identityHeaders[0]];if(identityHeaders.length!==1||typeof mapsRequestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(mapsRequestId)||typeof input.body!=='string'||Buffer.byteLength(input.body)>128*1024)throw Error('Invalid Maps request');object(JSON.parse(input.body));}
    const create=method==='POST'&&route==='/api/auth/cli-session',poll=method==='GET'&&/^\/api\/auth\/cli-session\/[0-9a-f-]{36}$/i.test(route);
    if(create){if(input.credentialReference||Object.keys(object(JSON.parse(input.body??'{}'))).length)throw Error('Invalid login creation');const previous=(await load())[env]?.credentialReference??null;const response=await canonical(env,route,controller.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),result=object(await response.json());if(response.ok){if(!UUID.test(result.sessionId)||!Number.isFinite(Date.parse(result.expiresAt)))throw Error('Invalid login session');controller.signal.throwIfAborted();pending.set(result.sessionId,{environment:env,expiresAt:Date.parse(result.expiresAt),previousReference:previous});}send(res,200,{status:response.status,data:result});return;}
    if(poll){if(input.credentialReference||input.body!==undefined)throw Error('Invalid login poll');const id=route.split('/').at(-1)!,login=pending.get(id);if(!login||login.environment!==env||login.expiresAt<=Date.now())throw refusal(410,'expired');if(((await load())[env]?.credentialReference??null)!==login.previousReference)throw Error('Cloud account changed');const response=await canonical(env,route,controller.signal),result=object(await response.json());if(result.status==='authenticated'){
      const token=['token','accessToken','stewardToken','sessionToken','apiKey'].map(k=>result[k]).find(v=>typeof v==='string'&&v.trim());if(!token){send(res,200,{status:response.status,data:{status:'authenticated'}});return;}
      const identityResponse=await canonical(env,'/api/v1/user',controller.signal,{}, {token}as Credential),identity=object(await identityResponse.json()),who=object(identity.data??identity);if(!identityResponse.ok||!UUID.test(who.id)||!UUID.test(who.organization_id))throw Error('Cloud owner verification failed');
      if(result.expiresAt&&(!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()))throw Error('Cloud credential expired');
      const reference='browser-cloud-reference:'+randomUUID(),claimed:Credential={token,credentialReference:reference,credentialId:randomUUID(),userId:who.id,organizationId:who.organization_id,...(result.expiresAt?{expiresAt:Date.parse(result.expiresAt)}:{})};controller.signal.throwIfAborted();if(login.expiresAt<=Date.now())throw refusal(410,'expired');if(pending.get(id)!==login||((await load())[env]?.credentialReference??null)!==login.previousReference)throw refusal(409,'account-changed');controller.signal.throwIfAborted();claims.set(reference,{environment:env,previousReference:login.previousReference,expiresAt:login.expiresAt,credential:claimed});pending.delete(id);send(res,200,{status:response.status,data:{status:'authenticated',credentialReference:reference,userId:who.id,organizationId:who.organization_id,...(result.expiresAt?{expiresAt:result.expiresAt}:{})}});return;
     }send(res,200,{status:response.status,data:result});return;}
    // Public signing keys must work before/without account credentials. No bearer is attached.
    if(method==='GET'&&route==='/api/v1/subscription/entitlement-keys'&&input.body===undefined&&input.credentialReference===undefined){
     const response=await canonical(env,route,controller.signal),result=await boundedServiceJson(response);send(res,200,{status:response.status,data:result});return;
    }
    // Subscription redemption: exactly {code,idempotencyKey}; the code is forwarded, never logged or stored.
    const redeem=method==='POST'&&route==='/api/v1/subscription/redeem';
    if(redeem){const body=object(JSON.parse(input.body??'null'));if(Object.keys(body).sort().join()!=='code,idempotencyKey'||typeof body.code!=='string'||body.code.length>128||typeof body.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey))throw Error('Invalid subscription redemption');}
    const accountRead=method==='GET'&&input.body===undefined&&['/api/v1/user','/api/v1/billing/limits','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys','/api/v1/maps/capabilities'].includes(route);
    const selfRevoke=method==='DELETE'&&route==='/api/v1/api-keys/current'&&input.body===undefined;
    if(!selfRevoke&&!redeem&&!accountRead&&!mapsPost&&!managedGoogleRequest(url,method,input.body))throw Error('Unsupported Cloud route');
    const c=await admitted(env,input.credentialReference);active.get(ownedId)!.credentialId=c.credentialId;if(selfRevoke)await current(env,c,controller.signal);const response=await canonical(env,route,controller.signal,{method,...(input.body===undefined?{}:{headers:{'Content-Type':'application/json',...(mapsRequestId?{'Idempotency-Key':mapsRequestId}:{})},body:input.body})},c);if(selfRevoke)options.diagnostic?.({environment:env,operation:route,status:response.status});let result=await boundedServiceJson(response);await current(env,c,controller.signal);if(response.ok&&route==='/api/v1/user'&&result.success===true){const who=object(result.data);result={success:true,data:{id:who.id,organization_id:who.organization_id,...(typeof who.email==='string'?{email:who.email}:{})}};}if(selfRevoke)result={success:result.success,...(typeof result.status==='string'?{status:result.status}:{}),...(typeof result.credentialId==='string'?{credentialId:result.credentialId}:{}),...(typeof result.revokedAt==='string'?{revokedAt:result.revokedAt}:{})};send(res,200,{status:response.status,data:result});return;
   }
   if(data.operation==='stt'||data.operation==='tts'){
    const c=await admitted(env,data.credentialReference,data.credentialId);active.get(ownedId)!.credentialId=c.credentialId;
    let init:RequestInit;
    if(data.operation==='stt'){if(!audio)throw Error('Speech audio required');const form=new FormData();form.append('provider','cartesia');form.append('audio',audio,'recording.'+(audio.type.includes('ogg')?'ogg':audio.type.includes('mp4')?'mp4':audio.type.includes('wav')?'wav':'webm'));init={method:'POST',body:form};}
    else{if(audio||typeof data.text!=='string'||!data.text.trim()||data.text.length>5000)throw Error('Invalid speech text');init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:data.text,format:'mp3'})};}
    const response=await canonical(env,'/api/v1/voice/'+data.operation,controller.signal,init,c);
    if(!response.ok){
     // A 429 keeps only its retry facts (cloud-voice-limit.ts); no Cloud or provider text crosses.
     let limit:CloudVoiceLimitFacts|undefined;
     if(response.status===429){let body:unknown=null;const reader=response.body?.getReader();try{if(reader){const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384)throw Error('Cloud limit body too large');chunks.push(part.value);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}}catch{body=null;}finally{await reader?.cancel().catch(()=>{});}limit=readCloudVoiceLimit(response.headers.get('Retry-After'),body);}else await response.body?.cancel();
     await current(env,c,controller.signal);send(res,response.status,{error:'Cloud voice request failed',code:'voice-http-'+response.status,...(limit?{limit}:{})});return;
    }
    if(data.operation==='stt'){if(response.headers.get('X-Eliza-STT-Provider')!=='cartesia'){await response.body?.cancel();throw Error('Cloud transcription provider was not verified');}const result=object(await response.json());await current(env,c,controller.signal);if(typeof result.transcript!=='string'||!result.transcript.trim())throw Error('Cloud returned no transcript');send(res,200,{text:result.transcript,local:false});return;}
    const type=response.headers.get('content-type')?.split(';')[0];if(!['audio/mpeg','audio/wav','audio/mp3'].includes(type??'')){await response.body?.cancel();throw Error('Invalid Cloud speech response');}
    const reader=response.body?.getReader();if(!reader)throw Error('Empty Cloud speech');const output:Uint8Array[]=[];let total=0;try{for(;;){const value=await reader.read();if(value.done)break;total+=value.value.byteLength;if(total>8*1024*1024)throw Error('Cloud speech exceeded bounds');output.push(value.value);}}finally{await reader.cancel().catch(()=>{});}
    await current(env,c,controller.signal);res.writeHead(200,{'Content-Type':type!,'Cache-Control':'no-store'});res.end(Buffer.concat(output));return;
   }
   throw Error('Unsupported development operation');
  }catch(error:any){if(!res.writableEnded&&!res.destroyed)send(res,error.name==='AbortError'?409:error.status??400,{error:error.name==='AbortError'?'Cloud operation cancelled':'Cloud development request rejected',...(error.code?{code:error.code}:{})});}
  finally{if(ownedId)active.delete(ownedId);res.removeListener('close',closed);}
 };
 // Host-only read port for the local development agent. It shares the exact
 // credential store and fences with the browser bridge; no bearer leaves it.
 const agentRead=async(input:{url:string;method:string;body?:unknown;credentialReference?:string;signal:AbortSignal})=>{
   const url=new URL(input.url);
   if(url.origin!==authorities.production||url.username||url.password||url.hash||url.port||input.method!=='GET'||input.body!==undefined||!(url.pathname==='/api/v1/user'&&!url.search||['/api/v1/eliza/google/accounts','/api/v1/eliza/google/gmail/search','/api/v1/eliza/google/gmail/read','/api/v1/eliza/google/calendar/calendars','/api/v1/eliza/google/calendar/feed'].includes(url.pathname)&&managedGoogleRequest(url,'GET',undefined)))throw refusal(403,'agent-read-route-refused');
   const c=await admitted('production',input.credentialReference);
   const response=await canonical('production',url.pathname+url.search,input.signal,{},c);
   const data=await boundedServiceJson(response);await current('production',c,input.signal);
   return {status:response.status,data};
  };
 return Object.assign(handler,{
  async agentCredential(){const c=(await load()).production;return c?publicCredential(c):null;},
  agentRead,
  async agentCalendarOperation(input:Parameters<typeof agentRead>[0]){
   const url=new URL(input.url),body=input.body===undefined?undefined:JSON.stringify(input.body);
   if(!url.pathname.startsWith('/api/v1/eliza/google/calendar/sync-v1/'))return agentRead(input);
   if(url.origin!==authorities.production||url.username||url.password||url.hash||url.port||!managedGoogleRequest(url,input.method,body))throw refusal(403,'agent-calendar-route-refused');
   const c=await admitted('production',input.credentialReference);
   const response=await canonical('production',url.pathname+url.search,input.signal,{method:input.method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body})},c);
   const data=await boundedServiceJson(response);await current('production',c,input.signal);return {status:response.status,data};
  },
  async agentGmailOperation(input:Parameters<typeof agentRead>[0]){
   const url=new URL(input.url),route=url.pathname,body=input.body===undefined?undefined:JSON.stringify(input.body);
   const operation=/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations(?:\/[A-Za-z0-9_-]{1,160}(?:\/dispatch)?)?$/.test(route);
   if(!operation)return agentRead(input);
   if(url.origin!==authorities.production||url.username||url.password||url.hash||url.port||!managedGoogleRequest(url,input.method,body))throw refusal(403,'agent-operation-route-refused');
   if(input.method==='POST'&&!['send','archive','trash','mark-read','mark-unread'].includes(JSON.parse(body!).proposal.kind))throw refusal(403,'agent-operation-kind-refused');
   const c=await admitted('production',input.credentialReference);
   const response=await canonical('production',route+url.search,input.signal,{method:input.method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body})},c);
   const data=await boundedServiceJson(response);await current('production',c,input.signal);return {status:response.status,data};
  }
 });
}
export function browserCloudDevBridge():Plugin {
 return {name:'alpha-browser-cloud-dev-bridge',apply:'serve',async configureServer(server){
  const cloudResident=process.env.VITE_ALPHA_CLOUD_RESIDENT==='1';
  const privatePreview=process.env.ALPHA_PRIVATE_LOCAL_PREVIEW==='1'&&process.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW==='1'&&process.env.VITE_LOCAL_AGENT==='1'&&!!process.env.ALPHA_BROWSER_CLOUD_PROFILE;
  if(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1'&&!cloudResident&&!privatePreview)return;
  if(cloudResident&&(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS==='1'||process.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'||process.env.VITE_LOCAL_AGENT!=='1'||!process.env.ALPHA_ELIZA_SOURCE||!process.env.ALPHA_REMOTE_PROFILE))throw Error('Cloud resident requires real local source and mocks off');
  const profile=path.resolve(process.env.ALPHA_BROWSER_CLOUD_PROFILE??path.join(homedir(),'.local/share/alphaphone/browser-cloud'));
  const selected=environment(process.env.VITE_ALPHA_CLOUD_ENVIRONMENT??'production');
  let resident:Awaited<ReturnType<typeof createCloudResidentHost>>|undefined;
  const currentResident=()=>{if(!resident)throw Error('Cloud resident host is unavailable');return resident;};
  const residentPort=cloudResident?{bind:(credential:Parameters<NonNullable<typeof resident>['bind']>[0])=>currentResident().bind(credential),clear:()=>currentResident().clear(),status:(id?:string)=>currentResident().status(id),ready:(signal:AbortSignal)=>currentResident().ready(signal)}:undefined;
  const handler=createBrowserCloudDevHandler({profile,resident:residentPort,...(cloudResident?{environment:selected,diagnostic:(event:unknown)=>console.info('[alpha-cloud-auth]',JSON.stringify(event))}:{})});
  if(cloudResident){
   const profileMode=process.env.ALPHA_CLOUD_RESIDENT_PROFILE??'lean';
   if(profileMode!=='lean'&&profileMode!=='full')throw Error('Invalid Cloud resident profile mode');
   resident=await createCloudResidentHost({source:path.resolve(process.env.ALPHA_ELIZA_SOURCE!),profile:path.resolve(process.env.ALPHA_REMOTE_PROFILE!),port:Number(process.env.ALPHA_REMOTE_PORT),environment:selected,profileMode,
    // This browser QA host admits reads only. Future writes require the canonical
    // owner access binding; these false gates must never be promoted by a tool.
    startGoogleHost:selected==='production'?async(apiToken:string,binding:{credentialId:string;reference:string})=>{
     let retired=false;
     const current=async()=>{if(retired)throw refusal(409,'account-changed');const credential=await handler.agentCredential();if(retired||!credential||credential.credentialId!==binding.credentialId||credential.credentialReference!==binding.reference)throw refusal(409,'account-changed');return credential;};
     const read=async(input:Parameters<typeof handler.agentRead>[0])=>{await current();const result=await handler.agentRead(input);await current();return result;};
     const googlePort={agentCredential:current,agentRead:read,agentGmailOperation:read,agentCalendarOperation:read};
     await current();const host=await startManagedGoogleAgentHost({port:googlePort,apiToken,access:()=>({gmailChanges:false,calendarEdits:false})});
     return {port:host.port,close:()=>{retired=true;return host.close();}};
    }:undefined});
  }
  if(resident)server.httpServer?.once('close',()=>{void resident.close();});
  server.middlewares.use(BROWSER_CLOUD_BRIDGE_PATH,(req,res)=>{void handler(req,res);});
 }};
}
