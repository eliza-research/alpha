import type {Page} from '@playwright/test';
import {webcrypto} from 'node:crypto';
import {installResidentAgentPlugin} from './resident-agent-plugin.ts';

export const USER='22222222-2222-4222-8222-222222222222';
export const CREDENTIAL='11111111-1111-4111-8111-111111111111';
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
async function signer(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'synthetic-key-1'};
 const sign=async(claims:Record<string,unknown>,kid='synthetic-key-1')=>{
  const input=`${b64(Buffer.from(JSON.stringify({alg:'ES256',typ:'eliza-entitlement+jwt',kid})))}.${b64(Buffer.from(JSON.stringify(claims)))}`;
  const signature=new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(input)));
  return `${input}.${b64(signature)}`;
 };
 return {jwk,sign};
}
/** Tokens for every plan status, signed with one throwaway key. */
export async function entitlements(overrides:Record<string,unknown>={}){
 const {jwk,sign}=await signer();const now=Math.floor(Date.now()/1000);
 const claims=(status:string)=>({iss:'https://api.eliza.app',aud:'eliza-alpha-phone',sub:USER,jti:'synthetic-entitlement-'+status,iat:now,exp:now+600,
  plan:{id:'synthetic-plan',name:'Synthetic plan',status},allowance:{unit:'requests',period:'month',limit:40,used:3},services:['inference'],...overrides});
 const tokens:Record<string,string>={};for(const status of ['active','trialing','past_due','canceled','none'])tokens[status]=await sign(claims(status));
 return {keys:[jwk],tokens};
}

type Fixture={plan?:string;route?:'signed'|'absent'|'503'|'401'|'offline';limits?:'active'|'none'|'canceled'|'balance-only'|'absent'|'503';identity?:'ok'|'offline'|'401';
 redeem?:'ok'|'invalid'|'rate'|'already'|'transport-once';redeemPlan?:string;saved?:boolean;expiresAt?:number;holdProvider?:boolean;providerFailure?:string;
 /** Exact USD organization credit balance in the billing snapshot (data.v2.balance); absent when unset. */
 credits?:string;storage?:Record<string,string>;fullApp?:boolean;
 /** Actual Android connectivity observation, independent of whether Cloud answers. */
 networkConnected?:boolean};
export type NativePlanFixture = Fixture & {tokens?:Record<string,string>;keys?:unknown[]};

/** Supply closed native ports to the actual chooser and resident controller. */
export async function installNativeCloudPlanPorts(page:Page, initial:NativePlanFixture={}){
 await installResidentAgentPlugin(page);
 await page.addInitScript(initial=>{
  const w=window as any;
  if(initial.fullApp)w.androidBridge={};
  if(!sessionStorage.getItem('plan-fixture-seeded')){sessionStorage.setItem('plan-fixture-seeded','1');for(const [key,value] of Object.entries(initial.storage||{}))localStorage.setItem(key,value as string);}
  const f=w.planFixture={plan:'active',route:'signed',limits:'absent',identity:'ok',redeem:'ok',redeemPlan:'active',saved:true,holdProvider:true,networkConnected:true,...initial,calls:[]as any[],bodies:[]as any[],releaseProvider:null as null|(()=>void)};
  const residentId='9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const resident=w.residentAgent=w.createResidentAgentPlugin({owner:()=>residentId,agentId:residentId});
  const credential={credentialId:'11111111-1111-4111-8111-111111111111',token:'synthetic-plan-token',expiresAt:initial.expiresAt??Date.now()+60*24*3600*1000};
  const names={ElizaSystem:['getNetworkStatus'],AlphaCloudSignIn:['status','startEmail','verifyEmail','cancel','addListener','removeListener'],AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal','addListener','removeListener'],Agent:['stop','getStatus','configureCloudProvider','clearProvider','providerStatus','start','request','setGoogleAgentAccess'],AlphaHostedResults:['disableBackground','addListener','removeListener'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status','addListener','removeListener'],AlphaVoiceCloud:['checkPermissions']};
  // Android's active-network observation follows the simulated network events.
  window.addEventListener('offline',()=>{f.networkConnected=false;});
  window.addEventListener('online',()=>{f.networkConnected=true;});
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:name==='Agent'?resident.methods(methods):methods.map(name=>({name,rtype:'promise'}))})),nativeCallback:resident.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:undefined,url:input?.url,httpMethod:input?.method});
   if(plugin==='ElizaSystem'&&method==='getNetworkStatus'){
    if(typeof f.networkConnected!=='boolean')throw Error('Invalid synthetic native network observation');
    (f.networkObservations??=[]).push(f.networkConnected);
    return {connected:f.networkConnected,internetValidated:f.networkConnected};
   }
   if(plugin==='AlphaCloudSignIn'){
    if(method==='status')return {active:false,inApp:true,email:true,google:false};
    if(method==='addListener'||method==='removeListener'||method==='cancel')return {};
    throw Error('Unexpected sign-in operation in plan fixture');
   }
   if(plugin==='Agent'){
    const owned=resident.answer(method,input);if(owned)return owned;
    if(method==='getStatus')return {packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    if(method==='configureCloudProvider'){if(f.providerFailure)throw Error(f.providerFailure);if(f.holdProvider)await new Promise<void>(resolve=>f.releaseProvider=resolve);return {};}
    // Unbinding removes the stored provider; native confirms it (provider status reads unconfigured).
    if(method==='clearProvider')return {configured:false};
    if(method==='providerStatus')return {provider:'elizacloud',configured:false};
    // The always-running resident answers its owner and agent reads (P-43).
    if(method==='request'){const id=residentId;const body=input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:input.path==='/api/conversations'?{conversations:[]}:{};return {status:200,body:JSON.stringify(body)};}
    return {};
   }
   if(plugin==='AlphaNotifications')return method==='status'?{permissionGranted:false,appEnabled:false}:{};
   // Retiring a running agent pauses its hosted background delivery.
   if(plugin==='AlphaHostedResults')return {};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native plan fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(credential):null};
   if(method==='secureRemove'){if(input.slot==='cloud:production')f.saved=false;return {};}
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/v1/user'){if(f.identity==='offline')throw Error('Connection request failed');return f.identity==='401'?{status:401,data:{}}:{status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-plan@example.invalid'}}};}
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement'){
    if(f.route==='signed')return {status:200,data:{entitlement:f.tokens[f.plan]}};
    if(f.route==='401')return {status:401,data:{}};
    if(f.route==='503')return {status:503,data:{success:false,code:'service_unavailable'}};
    if(f.route==='offline')throw Error('Connection request failed');
    return {status:404,data:{}};
   }
   if(path==='/api/v1/billing/limits'){
    if(f.limits==='absent')return {status:404,data:{}};
    if(f.limits==='503')return {status:503,data:{}};
    const observedAt=new Date().toISOString();
    const subscription=f.limits==='balance-only'
     ? {status:'unavailable',source:'subscriptions',observedAt,error:{code:'subscription_unavailable',retryable:true}}
     : f.limits==='none'
      ? {status:'not_applicable',reason:'no_organization_subscription'}
      : {status:'available',value:{planKey:'plus_monthly',state:f.limits,currentPeriodEnd:'2099-01-01T00:00:00.000Z'}};
    const balance=f.credits===undefined?{}:{balance:{status:'available',source:'organizations',observedAt,value:{balance:{value:f.credits,unit:'usd',currency:'USD'},revision:'1'}}};
    return {status:200,data:{success:true,data:{schemaVersion:2,v2:{subscription,...balance}}}};
   }
   if(path==='/api/v1/subscription/redeem'){
    const body=JSON.parse(input.body);f.bodies.push(body);
    if(f.redeem==='transport-once'&&f.bodies.length===1)throw Error('Connection request failed');
    if(f.redeem==='invalid')return {status:400,data:{success:false,error:'This subscription code cannot be redeemed.',code:'invalid_subscription_code'}};
    if(f.redeem==='rate')return {status:429,data:{success:false,code:'rate_limit_exceeded',retryAfterSeconds:840}};
    if(f.redeem==='already')return {status:409,data:{success:false,code:'subscription_grant_already_redeemed'}};
    f.plan=f.redeemPlan;f.route='signed';
    return {status:200,data:{success:true,replayed:f.bodies.length>1,grant:{id:'synthetic-grant',planKey:'plus_monthly',startsAt:'2026-10-13T00:00:00.000Z',endsAt:'2027-04-14T00:00:00.000Z',revoked:false,paidPlanTakesPrecedence:false},entitlement:{plan:{id:'plus_monthly',name:'Plus',status:'active'},source:'grant',effectiveUntil:'2027-04-14T00:00:00.000Z'}}};
   }
   if(path==='/api/auth/cli-session')return {status:503,data:{}};
   throw Error('Unexpected Cloud route '+path);
  }};
 },initial);
}
