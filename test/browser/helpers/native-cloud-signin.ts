import {expect,type Page} from '@playwright/test';
import {createServer,type Plugin,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';

// In-app Eliza Cloud sign-in (owner directive 2026-10-14) on the actual flag-off Android chooser and
// controller composition. Only native ports are synthetic: AlphaCloudSignIn stands in for the native
// Steward + mobile App Auth client and "stores" a synthetic key the way the plugin does. No device,
// account, browser, Google consent, App Link verification, Cloud request or real code is involved.
export async function startNativeCloudSignInFixture(cacheDir=resolve('test-results/native-cloud-signin/vite-cache'), plugins:Plugin[]=[]){
 let server:ViteDevServer;
 const previous=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
 try{server=await createServer({configFile:resolve('vite.config.ts'),cacheDir,server:{host:'127.0.0.1',port:0,hmr:false,watch:null},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[...plugins,{name:'native-signin-composition',resolveId(id){if(id==='/subscription-entry.tsx')return '\0subscription-entry';},load(id){if(id==='\0subscription-entry')return `
 import React,{useSyncExternalStore} from 'react';
 import {createRoot} from 'react-dom/client';
 import '/src/prototype/prototype.css';
 import {Capacitor} from '@capacitor/core';
 Capacitor.getPlatform=()=> 'android';Capacitor.isNativePlatform=()=>true;
 const {ConnectionChooser,connectionController}=await import('/src/runtime/connection-ui.tsx');
 const {StartupPermissions}=await import('/src/startup-permissions.tsx');
 const flags=await import('/src/build-flags.ts');window.planFlags={native:Capacitor.getPlatform(),mocks:flags.testMocksEnabled};
 window.planController=connectionController;
 document.body.insertAdjacentHTML('afterbegin','<div class="os" style="position:fixed;inset:0;background:var(--bg)" aria-hidden="true"></div>');
 function Composition(){const state=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);return React.createElement(React.Fragment,null,React.createElement(ConnectionChooser),!state.open&&React.createElement(StartupPermissions));}
 createRoot(document.getElementById('root')).render(React.createElement(Composition));
 `;},configureServer(s){s.middlewares.use('/subscription-composition',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await s.transformIndexHtml('/subscription-composition','<div id="root"></div><script type="module" src="/subscription-entry.tsx"></script>'));});}}]});}finally{if(previous===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=previous;}
 try{await server.listen();}catch(error){await server.close();throw error;}
 const origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
 return {close:()=>server.close(), boot:(page:Page,initial?:SignInFixtureInput)=>boot(page,origin,initial)};
}

export const USER='22222222-2222-4222-8222-222222222222';
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


type SignInMode='ok'|'created'|'mfa'|'hold'|'offline'|'readiness-hold'|'not-ready';
type SignInFixtureInput={signIn?:SignInMode;tokens?:Record<string,string>;keys?:unknown[];serviceName?:string;keyLifetimeMs?:number;methods?:{email:boolean;phone:boolean;google:boolean}};
async function boot(page:Page,origin:string,initial:SignInFixtureInput={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.addInitScript(initial=>{
  const w=window as any;
  if(!sessionStorage.getItem('signin-fixture-seeded')){sessionStorage.setItem('signin-fixture-seeded','1');localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));}
  const f=w.signInFixture={signIn:'ok',...initial,saved:false as boolean,credential:null as any,running:false,bound:false,calls:[] as any[],release:null as null|((error:unknown)=>void)};
  const names={AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal'],AlphaCloudSignIn:['serviceInfo','startPhone','verifyPhone','startGoogle','startEmail','verifyEmail','verifyMfa','cancel','status','addListener','removeListener'],Agent:['start','stop','getStatus','configureCloudProvider','clearProvider','providerStatus','residentAttachment','request','addListener','requestStream','cancelStream'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status'],AlphaVoiceCloud:['checkPermissions'],AlphaHostedResults:['disableBackground']};
  const fail=(code:string)=>Object.assign(new Error(code),{code});
  // The native host stores the key before reporting success and returns only non-secret fields.
  const store=()=>{f.saved=true;f.credential={credentialId:crypto.randomUUID(),token:'synthetic-mobile-key',expiresAt:Date.now()+((f as any).keyLifetimeMs??30*24*3600*1000),serverCredentialId:'55555555-5555-4555-8555-555555555555'};return {status:'authenticated',environment:'production',expiresAt:f.credential.expiresAt,accountCreated:f.signIn==='created'};};
  const reply=(status:number,body:unknown)=>({status,body:JSON.stringify(body)});
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:input?.path,email:input?.email,phone:input?.phone,environment:input?.environment,refreshNegative:input?.refreshNegative});
   if(plugin==='AlphaCloudSignIn'){
    if(method==='addListener'||method==='removeListener')return {};
    if(method==='serviceInfo'){const doc={title:'Terms of Service',revision:'fixture-v1',sections:[{title:'Provider terms',paragraphs:['Synthetic provider document.']}]};return {success:true,version:1,service:{name:f.serviceName||'Eliza Cloud',terms:doc,privacy:{...doc,title:'Privacy Policy'}}};}
    if(method==='cancel'){f.release?.(fail('cancelled'));f.release=null;return {};}
    if(method==='status'&&f.signIn==='readiness-hold')return new Promise(resolve=>{(f as any).releaseReadiness=()=>resolve({active:false,inApp:true,google:true,email:true,phone:true});});
    if(method==='status'&&f.methods)return {active:false,inApp:Object.values(f.methods).some(Boolean),methodsKnown:true,...f.methods};
    if(method==='status')return f.signIn==='not-ready'?{active:false,inApp:false,google:false,email:false}:{active:false,inApp:true,google:true,email:true,phone:true};
    if(method==='startGoogle'){if(f.signIn==='hold')return new Promise((_,reject)=>{f.release=reject;});return store();}
    if(method==='startEmail'||method==='startPhone'){if(f.signIn==='offline')throw fail('offline');return {attemptId:'33333333-3333-4333-8333-333333333333',expiresAt:Date.now()+600000,resendAt:Date.now()+60000};}
    if(method==='verifyEmail'||method==='verifyPhone'){if(input.code!=='123456')throw fail('invalid-code');if(f.signIn==='mfa')return {status:'mfa',method:'totp',expiresAt:Date.now()+300000};return store();}
    if(method==='verifyMfa'){if(input.code!=='654321')throw fail('invalid-code');return store();}
   }
   if(plugin==='Agent'){
    if(method==='getStatus')return {packaged:true,state:f.running?'listening':'stopped',serviceActive:f.running,socketListening:f.running};
    if(method==='start'){f.running=true;return {state:'ready'};}
    if(method==='stop'){f.running=false;return {};}
    if(method==='configureCloudProvider'){f.running=false;f.bound=true;return {configured:true};}
    if(method==='clearProvider'){if(f.bound)f.running=false;f.bound=false;return {configured:false};}
    if(method==='providerStatus')return {provider:'elizacloud',configured:f.bound,...(f.bound?{model:'cerebras/qwen-3.8-27b'}:{})};
    if(method==='residentAttachment')return {attachable:false,reason:'not-enrolled'};
    if(method==='addListener')return {remove:async()=>{}};
    if(method==='requestStream')throw Error('Native stream unavailable');
    if(method==='request'){
     if(!f.running)return reply(503,{});
     if(input.path==='/api/auth/me')return reply(200,{identity:{kind:'owner',id:'owner-1'},access:{role:'OWNER',mode:'local'}});
     if(input.path==='/api/agents')return reply(200,{agents:[{id:'44444444-4444-4444-8444-444444444444',name:'Alpha',status:'running'}]});
     return reply(404,{});
    }
    return {};
   }
   if(plugin==='AlphaNotifications')return {permissionGranted:false,appEnabled:false};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin==='AlphaHostedResults')return {};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native sign-in fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(f.credential):null};
   if(method==='secureRemove'){if(input.slot==='cloud:production'){f.saved=false;f.credential=null;}return {};}
   if(method==='openExternal'){if(f.signIn==='not-ready'||f.signIn==='readiness-hold')return {};throw Error('In-app sign-in opens no page');}
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/auth/cli-session')return {status:200,data:{sessionId:'b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString()}};
   if(path==='/api/auth/cli-session/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d')return {status:200,data:{status:'pending'}};
   if(path==='/api/v1/user')return {status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-signin@example.invalid'}}};
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement')return {status:200,data:{entitlement:f.tokens[(f as any).entitlementStatus??'active']}};
   if(path==='/api/v1/billing/limits')return {status:404,data:{}};
   throw Error('Unexpected Cloud route '+path);
  }};
 },initial);
 await page.goto(origin+'/subscription-composition',{waitUntil:'domcontentloaded',timeout:90000});
 // The composition imports the complete runtime before publishing its readiness marker.
 await expect.poll(()=>page.evaluate(()=>(window as any).planFlags),{timeout:30000}).toEqual({native:'android',mocks:false});
}
